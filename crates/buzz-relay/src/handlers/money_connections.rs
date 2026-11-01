//! Broker for money rails connections (kind 47074, relay-signed head kind 30683), plus the
//! transactional pieces the HTTP secret intake uses.
//!
//! A connection is one payment provider. Its non secret configuration lives as JSON next to the
//! sealed secrets; the head is a community-wide projection that never carries a secret, a
//! notice address or a full recipe. Contract: `docs/money-rails-pay-contract.md`.

use std::sync::Arc;

use chrono::Utc;
use nostr::Event;
use uuid::Uuid;
use zeroize::Zeroizing;

use buzz_core::kind::{KIND_MONEY_CONNECTION_ACTION, KIND_MONEY_CONNECTION_HEAD};
use buzz_core::money_rails::connection::{
    apply_connection_action, authorize_connection_op, validate_new_connection, AuthScheme,
    ConnectionAction, ConnectionConfig, ConnectionEffect, ConnectionOp, ConnectionStatus,
};
use buzz_core::money_rails::notice::{validate_signature_config, SignatureConfig};
use buzz_core::money_rails::{connection_d_tag, ActorRole, ErrorKind, Route};
use buzz_core::tenant::TenantContext;
use buzz_db::money_rails::{
    money_clear_other_defaults_tx, money_delete_secrets_tx, money_insert_connection_tx,
    money_lock_connection_tx, money_save_connection_tx, money_set_secret_tx, NewMoneyConnection,
};

use super::company_cofounder::{
    check_expected_head, command_d_tag, conflict, duplicate_result, forbidden, internal, invalid,
};
use super::company_initiative::{commit_head, lock_current_head, HeadWrite};
use super::ingest::{IngestAuth, IngestError, IngestResult};
use super::money_pay_links::{commit_head_only, map_money_error, HeadOnly};
use crate::money_rails::vault::{self, SecretField};
use crate::money_rails::{derived_event_id, parse_connection};
use crate::state::AppState;

const LOCK_NAME: &str = "money-connection";
/// Longest secret accepted, in bytes.
const MAX_SECRET_BYTES: usize = 4096;

fn status_str(status: ConnectionStatus) -> &'static str {
    match status {
        ConnectionStatus::Connected => "connected",
        ConnectionStatus::NeedsAttention => "needs_attention",
        ConnectionStatus::Disconnected => "disconnected",
    }
}

fn route_str(route: Route) -> &'static str {
    match route {
        Route::Api => "api",
        Route::Browser => "browser",
    }
}

async fn fenced_tx(
    state: &Arc<AppState>,
    tenant: &TenantContext,
) -> Result<sqlx::Transaction<'static, sqlx::Postgres>, IngestError> {
    let mut tx = state
        .db
        .begin_event_write_transaction()
        .await
        .map_err(internal)?;
    buzz_deletion::store(&state.db)
        .guard_transaction(&mut tx, tenant.community())
        .await
        .map_err(|error| {
            IngestError::Rejected(format!("restricted: community writes are fenced: {error}"))
        })?;
    Ok(tx)
}

/// Handles a connection command (kind 47074).
pub(crate) async fn handle(
    tenant: &TenantContext,
    state: &Arc<AppState>,
    event: Event,
    auth: IngestAuth,
) -> Result<IngestResult, IngestError> {
    if u32::from(event.kind.as_u16()) != KIND_MONEY_CONNECTION_ACTION {
        return Err(invalid("connection action has the wrong event kind"));
    }
    let action = serde_json::from_str::<ConnectionAction>(&event.content)
        .map_err(|error| invalid(format!("connection action: {error}")))?;
    action.validate().map_err(map_money_error)?;
    if event.verify().is_err() {
        return Err(invalid("connection action signature is invalid"));
    }
    if event.pubkey.to_hex() != auth.pubkey().to_hex() {
        return Err(forbidden(
            "event signer does not match the authenticated member",
        ));
    }
    if auth.channel_ids().is_some() {
        return Err(forbidden(
            "channel-scoped authentication cannot write connections",
        ));
    }
    let d_tag = command_d_tag(&event, "connection")?;
    if d_tag != action.d_tag() {
        return Err(invalid(
            "connection command d tag must match its connection",
        ));
    }
    let community = tenant.community();
    let actor = auth.pubkey();
    let role = crate::money_rails::access_for(state, tenant, actor)
        .await
        .map_err(internal)?;
    authorize_connection_op(action.op, role).map_err(map_money_error)?;

    let mut tx = fenced_tx(state, tenant).await?;
    let already_stored = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS (SELECT 1 FROM events WHERE community_id = $1 AND id = $2)",
    )
    .bind(community.as_uuid())
    .bind(event.id.to_bytes().as_slice())
    .fetch_one(&mut *tx)
    .await
    .map_err(internal)?;
    if already_stored {
        return Ok(duplicate_result(&event));
    }
    let (current_head_id, current_stored) = lock_current_head(
        state,
        &mut tx,
        community,
        KIND_MONEY_CONNECTION_HEAD,
        &d_tag,
        LOCK_NAME,
    )
    .await?;
    let now = Utc::now().timestamp();
    let actor_hex = actor.to_hex();

    let config = if action.op == ConnectionOp::AddBrowser {
        if current_stored.is_some() {
            return Err(conflict("this connection already exists"));
        }
        let provider = action.provider.clone().unwrap_or_default();
        let label = action.label.clone().unwrap_or_default();
        let hosts = action.browser_hosts.clone().unwrap_or_default();
        validate_new_connection(&provider, &label, Route::Browser, &[], &hosts)
            .map_err(map_money_error)?;
        let live = state
            .db
            .money_list_connections(community)
            .await
            .map_err(internal)?;
        let first = !live.iter().any(|row| row.status != "disconnected");
        let config = ConnectionConfig {
            connection_id: action.connection_id,
            provider,
            label,
            route: Route::Browser,
            status: ConnectionStatus::Connected,
            is_default: first,
            api_hosts: Vec::new(),
            browser_hosts: hosts,
            auth_scheme: None,
            recipes: Vec::new(),
            notice_map: None,
            signature: None,
            has_api_key: false,
            has_signing_secret: false,
            created_at: now,
            last_used_at: None,
            version: 1,
        };
        let created = money_insert_connection_tx(
            &mut tx,
            community,
            &NewMoneyConnection {
                id: config.connection_id,
                notice_id: Uuid::new_v4(),
                provider: config.provider.clone(),
                route: route_str(Route::Browser).to_owned(),
                config: serde_json::to_value(&config).map_err(internal)?,
                kek_id: None,
                api_key: None,
                signing_secret: None,
                created_by: actor.to_bytes().to_vec(),
                is_default: config.is_default,
            },
        )
        .await
        .map_err(internal)?;
        if !created {
            return Err(conflict("this connection already exists"));
        }
        config
    } else {
        check_expected_head(
            "connection",
            action.expected_head_event_id.as_deref(),
            current_head_id.as_deref(),
        )?;
        let row = money_lock_connection_tx(&mut tx, community, action.connection_id)
            .await
            .map_err(internal)?
            .ok_or_else(|| conflict("there is no connection with this id"))?;
        let mut loaded = parse_connection(row).map_err(internal)?;
        let effect = apply_connection_action(&mut loaded.config, &action, &actor_hex, role, now)
            .map_err(map_money_error)?;
        if effect == ConnectionEffect::MakeDefaultExclusive {
            money_clear_other_defaults_tx(&mut tx, community, action.connection_id)
                .await
                .map_err(internal)?;
        }
        money_save_connection_tx(
            &mut tx,
            community,
            action.connection_id,
            status_str(loaded.config.status),
            loaded.config.is_default,
            &serde_json::to_value(&loaded.config).map_err(internal)?,
        )
        .await
        .map_err(internal)?;
        if effect == ConnectionEffect::DeleteSecrets {
            money_delete_secrets_tx(&mut tx, community, action.connection_id)
                .await
                .map_err(internal)?;
        }
        loaded.config
    };

    let head_json = serde_json::to_string(&config.to_head(&event.id.to_hex())).map_err(internal)?;
    commit_head(
        tenant,
        state,
        tx,
        &event,
        &actor_hex,
        HeadWrite {
            head_kind: KIND_MONEY_CONNECTION_HEAD,
            action_kind: KIND_MONEY_CONNECTION_ACTION,
            d_tag: &d_tag,
            head_json,
            current_head_id,
            current_stored,
            label: "connection",
        },
    )
    .await
}

/// Why the HTTP intake refused.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ConnectError {
    /// The relay has no key-encryption key.
    NotConfigured,
    /// The input is not valid.
    Invalid(String),
    /// A host is not a public host name.
    HostNotAllowed(String),
    /// The same provider and route is connected already.
    AlreadyConnected,
    /// No such connection.
    NotFound,
    /// Something failed inside the relay.
    Internal(String),
}

impl ConnectError {
    /// Stable code for the API.
    pub(crate) fn code(&self) -> &'static str {
        match self {
            Self::NotConfigured => "money_not_configured",
            Self::Invalid(_) => "money_invalid_input",
            Self::HostNotAllowed(_) => "money_host_not_allowed",
            Self::AlreadyConnected => "money_already_connected",
            Self::NotFound => "money_not_found",
            Self::Internal(_) => "money_internal",
        }
    }

    /// Plain words. Never a secret.
    pub(crate) fn message(&self) -> String {
        match self {
            Self::NotConfigured => "Payment connections are not set up on this relay.".to_owned(),
            Self::Invalid(message) | Self::HostNotAllowed(message) => message.clone(),
            Self::AlreadyConnected => {
                "This provider is already connected. Replace its key or disconnect it first."
                    .to_owned()
            }
            Self::NotFound => "There is no such connection.".to_owned(),
            Self::Internal(_) => "Something went wrong inside the relay.".to_owned(),
        }
    }
}

impl From<IngestError> for ConnectError {
    fn from(error: IngestError) -> Self {
        match error {
            IngestError::Rejected(message)
            | IngestError::AuthFailed(message)
            | IngestError::Internal(message) => Self::Internal(message),
        }
    }
}

fn internal_connect(error: impl std::fmt::Display) -> ConnectError {
    ConnectError::Internal(error.to_string())
}

/// Everything the Settings dialog sends. The secrets are zeroized on drop and never formatted.
pub(crate) struct ConnectInput {
    pub provider: String,
    pub label: String,
    pub route: Route,
    pub api_key: Option<Zeroizing<String>>,
    pub api_hosts: Vec<String>,
    pub auth_scheme: Option<AuthScheme>,
    pub browser_hosts: Vec<String>,
    pub signing_secret: Option<Zeroizing<String>>,
    pub signature: Option<SignatureConfig>,
}

fn secret_ok(secret: &str) -> bool {
    !secret.is_empty()
        && secret.len() <= MAX_SECRET_BYTES
        && !secret.chars().any(|c| c.is_control() || c.is_whitespace())
}

/// Creates a connection: seals the secrets, stores the row and publishes the head in one
/// transaction. Returns the configuration and the notice address id.
pub(crate) async fn create_connection(
    tenant: &TenantContext,
    state: &Arc<AppState>,
    actor: &nostr::PublicKey,
    input: ConnectInput,
) -> Result<(ConnectionConfig, Uuid), ConnectError> {
    let community = tenant.community();
    validate_new_connection(
        &input.provider,
        &input.label,
        input.route,
        &input.api_hosts,
        &input.browser_hosts,
    )
    .map_err(|error| match error.code {
        "money_host_not_allowed" => ConnectError::HostNotAllowed(error.message),
        _ => ConnectError::Invalid(error.message),
    })?;
    if let Some(signature) = &input.signature {
        validate_signature_config(signature)
            .map_err(|error| ConnectError::Invalid(error.message))?;
    }
    if input.signing_secret.is_some() != input.signature.is_some() {
        return Err(ConnectError::Invalid(
            "send the signing secret together with how the provider signs notices".to_owned(),
        ));
    }
    for secret in [&input.api_key, &input.signing_secret]
        .into_iter()
        .flatten()
    {
        if !secret_ok(secret.as_str()) {
            return Err(ConnectError::Invalid(
                "a pasted key or secret must be one line with no spaces".to_owned(),
            ));
        }
    }
    match (input.route, &input.api_key) {
        (Route::Api, None) => {
            return Err(ConnectError::Invalid(
                "an API connection needs the provider API key".to_owned(),
            ))
        }
        (Route::Browser, Some(_)) => {
            return Err(ConnectError::Invalid(
                "a browser connection holds no API key".to_owned(),
            ))
        }
        _ => {}
    }
    let kek = state
        .config
        .accounts
        .account_kek()
        .ok_or(ConnectError::NotConfigured)?;
    if state
        .db
        .money_find_live_connection(community, &input.provider, route_str(input.route))
        .await
        .map_err(internal_connect)?
        .is_some()
    {
        return Err(ConnectError::AlreadyConnected);
    }
    let live = state
        .db
        .money_list_connections(community)
        .await
        .map_err(internal_connect)?;
    let first = !live.iter().any(|row| row.status != "disconnected");
    let connection_id = Uuid::new_v4();
    let notice_id = Uuid::new_v4();
    let kek_id = vault::kek_id(kek);
    let seal = |field: SecretField, secret: &Option<Zeroizing<String>>| {
        secret
            .as_ref()
            .map(|secret| {
                vault::seal(
                    kek,
                    *community.as_uuid(),
                    connection_id,
                    field,
                    secret.as_str(),
                )
                .map(|sealed| (sealed.ciphertext, sealed.nonce.to_vec()))
            })
            .transpose()
    };
    let api_key = seal(SecretField::ApiKey, &input.api_key)
        .map_err(|_| ConnectError::Internal("could not seal the key".to_owned()))?;
    let signing_secret = seal(SecretField::SigningSecret, &input.signing_secret)
        .map_err(|_| ConnectError::Internal("could not seal the secret".to_owned()))?;
    let now = Utc::now().timestamp();
    let config = ConnectionConfig {
        connection_id,
        provider: input.provider.clone(),
        label: input.label.clone(),
        route: input.route,
        status: ConnectionStatus::Connected,
        is_default: first,
        api_hosts: input.api_hosts.clone(),
        browser_hosts: input.browser_hosts.clone(),
        auth_scheme: match input.route {
            Route::Api => Some(input.auth_scheme.clone().unwrap_or(AuthScheme::Bearer)),
            Route::Browser => None,
        },
        recipes: Vec::new(),
        notice_map: None,
        signature: input.signature.clone(),
        has_api_key: api_key.is_some(),
        has_signing_secret: signing_secret.is_some(),
        created_at: now,
        last_used_at: None,
        version: 1,
    };
    let d_tag = connection_d_tag(connection_id);
    let mut tx = fenced_tx(state, tenant).await?;
    let (current_head_id, current_stored) = lock_current_head(
        state,
        &mut tx,
        community,
        KIND_MONEY_CONNECTION_HEAD,
        &d_tag,
        LOCK_NAME,
    )
    .await?;
    let created = money_insert_connection_tx(
        &mut tx,
        community,
        &NewMoneyConnection {
            id: connection_id,
            notice_id,
            provider: config.provider.clone(),
            route: route_str(config.route).to_owned(),
            config: serde_json::to_value(&config).map_err(internal_connect)?,
            kek_id: (api_key.is_some() || signing_secret.is_some()).then_some(kek_id),
            api_key,
            signing_secret,
            created_by: actor.to_bytes().to_vec(),
            is_default: config.is_default,
        },
    )
    .await
    .map_err(internal_connect)?;
    if !created {
        return Err(ConnectError::AlreadyConnected);
    }
    let head = config.to_head(&derived_event_id(
        "connection",
        connection_id,
        config.version,
    ));
    commit_head_only(
        tenant,
        state,
        tx,
        HeadOnly {
            head_kind: KIND_MONEY_CONNECTION_HEAD,
            d_tag: &d_tag,
            head_json: serde_json::to_string(&head).map_err(internal_connect)?,
            current_head_id,
            current_stored,
        },
    )
    .await?;
    Ok((config, notice_id))
}

/// Replaces one sealed secret of a connection. `field` is `apiKey` or `signingSecret`.
pub(crate) async fn replace_secret(
    tenant: &TenantContext,
    state: &Arc<AppState>,
    connection_id: Uuid,
    field: &str,
    value: &Zeroizing<String>,
) -> Result<ConnectionConfig, ConnectError> {
    let community = tenant.community();
    if !secret_ok(value.as_str()) {
        return Err(ConnectError::Invalid(
            "a pasted key or secret must be one line with no spaces".to_owned(),
        ));
    }
    let (secret_field, column) = match field {
        "apiKey" => (SecretField::ApiKey, "api_key"),
        "signingSecret" => (SecretField::SigningSecret, "signing_secret"),
        _ => {
            return Err(ConnectError::Invalid(
                "field must be apiKey or signingSecret".to_owned(),
            ))
        }
    };
    let kek = state
        .config
        .accounts
        .account_kek()
        .ok_or(ConnectError::NotConfigured)?;
    let d_tag = connection_d_tag(connection_id);
    let mut tx = fenced_tx(state, tenant).await?;
    let (current_head_id, current_stored) = lock_current_head(
        state,
        &mut tx,
        community,
        KIND_MONEY_CONNECTION_HEAD,
        &d_tag,
        LOCK_NAME,
    )
    .await?;
    let row = money_lock_connection_tx(&mut tx, community, connection_id)
        .await
        .map_err(internal_connect)?
        .ok_or(ConnectError::NotFound)?;
    let mut loaded = parse_connection(row).map_err(ConnectError::Internal)?;
    if loaded.config.status == ConnectionStatus::Disconnected {
        return Err(ConnectError::NotFound);
    }
    if column == "api_key" && loaded.config.route != Route::Api {
        return Err(ConnectError::Invalid(
            "a browser connection holds no API key".to_owned(),
        ));
    }
    if column == "signing_secret" && loaded.config.signature.is_none() {
        return Err(ConnectError::Invalid(
            "this connection has no signature settings, so there is no signing secret to hold"
                .to_owned(),
        ));
    }
    let sealed = vault::seal(
        kek,
        *community.as_uuid(),
        connection_id,
        secret_field,
        value.as_str(),
    )
    .map_err(|_| ConnectError::Internal("could not seal the secret".to_owned()))?;
    let stored = money_set_secret_tx(
        &mut tx,
        community,
        connection_id,
        column,
        &vault::kek_id(kek),
        &sealed.ciphertext,
        &sealed.nonce,
    )
    .await
    .map_err(internal_connect)?;
    if !stored {
        return Err(ConnectError::NotFound);
    }
    if column == "api_key" {
        loaded.config.has_api_key = true;
    } else {
        loaded.config.has_signing_secret = true;
    }
    if loaded.config.status == ConnectionStatus::NeedsAttention {
        loaded.config.status = ConnectionStatus::Connected;
    }
    loaded.config.version = loaded.config.version.saturating_add(1);
    money_save_connection_tx(
        &mut tx,
        community,
        connection_id,
        status_str(loaded.config.status),
        loaded.config.is_default,
        &serde_json::to_value(&loaded.config).map_err(internal_connect)?,
    )
    .await
    .map_err(internal_connect)?;
    let head = loaded.config.to_head(&derived_event_id(
        "connection",
        connection_id,
        loaded.config.version,
    ));
    commit_head_only(
        tenant,
        state,
        tx,
        HeadOnly {
            head_kind: KIND_MONEY_CONNECTION_HEAD,
            d_tag: &d_tag,
            head_json: serde_json::to_string(&head).map_err(internal_connect)?,
            current_head_id,
            current_stored,
        },
    )
    .await?;
    Ok(loaded.config)
}

/// Disconnects a connection: both sealed secrets are deleted in the same transaction as the
/// head change. Cards already made stay.
pub(crate) async fn disconnect_connection(
    tenant: &TenantContext,
    state: &Arc<AppState>,
    connection_id: Uuid,
) -> Result<ConnectionConfig, ConnectError> {
    let community = tenant.community();
    let d_tag = connection_d_tag(connection_id);
    let mut tx = fenced_tx(state, tenant).await?;
    let (current_head_id, current_stored) = lock_current_head(
        state,
        &mut tx,
        community,
        KIND_MONEY_CONNECTION_HEAD,
        &d_tag,
        LOCK_NAME,
    )
    .await?;
    let row = money_lock_connection_tx(&mut tx, community, connection_id)
        .await
        .map_err(internal_connect)?
        .ok_or(ConnectError::NotFound)?;
    let mut loaded = parse_connection(row).map_err(ConnectError::Internal)?;
    let action = ConnectionAction {
        schema_version: buzz_core::money_rails::MONEY_RAILS_SCHEMA_VERSION,
        op: ConnectionOp::Disconnect,
        connection_id,
        expected_head_event_id: None,
        provider: None,
        label: None,
        browser_hosts: None,
        recipe: None,
        recipe_id: None,
        recipe_hash: None,
        notice_map: None,
        map_hash: None,
    };
    let effect = apply_connection_action(
        &mut loaded.config,
        &action,
        "system",
        ActorRole::OwnerAdmin,
        Utc::now().timestamp(),
    )
    .map_err(|error| match error.kind {
        ErrorKind::Conflict => ConnectError::NotFound,
        _ => ConnectError::Invalid(error.message),
    })?;
    debug_assert_eq!(effect, ConnectionEffect::DeleteSecrets);
    money_save_connection_tx(
        &mut tx,
        community,
        connection_id,
        status_str(loaded.config.status),
        loaded.config.is_default,
        &serde_json::to_value(&loaded.config).map_err(internal_connect)?,
    )
    .await
    .map_err(internal_connect)?;
    money_delete_secrets_tx(&mut tx, community, connection_id)
        .await
        .map_err(internal_connect)?;
    let head = loaded.config.to_head(&derived_event_id(
        "connection",
        connection_id,
        loaded.config.version,
    ));
    commit_head_only(
        tenant,
        state,
        tx,
        HeadOnly {
            head_kind: KIND_MONEY_CONNECTION_HEAD,
            d_tag: &d_tag,
            head_json: serde_json::to_string(&head).map_err(internal_connect)?,
            current_head_id,
            current_stored,
        },
    )
    .await?;
    Ok(loaded.config)
}
