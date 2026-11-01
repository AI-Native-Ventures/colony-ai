//! Runs owner-approved request recipes against a payment provider.
//!
//! The runner is the only place a provider key is opened. Every run re-checks the refusal list
//! and the host lock, substitutes values from the approved card (never from Scout), sends the
//! request through [`ProviderHttp`], reads the facts out of the JSON response, and scrubs every
//! string it hands back by exact match against the key. The raw response never leaves here.

use std::sync::Arc;

use zeroize::Zeroizing;

use buzz_core::money_rails::connection::AuthScheme;
use buzz_core::money_rails::link::LinkHead;
use buzz_core::money_rails::notice::LookupResult;
use buzz_core::money_rails::recipe::{
    extract_values, render, scrub_str, validate_recipe, RecipePurpose, RenderValues,
};
use buzz_core::tenant::CommunityId;

use super::provider::{ProviderHttp, ProviderRequest};
use super::vault::{self, SecretField};
use super::LoadedConnection;
use crate::state::AppState;

/// Why a run produced no usable result. `reason` is plain words and never holds a secret.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RunFailure {
    /// Stable code, shown on the card.
    pub code: String,
    /// Plain words for the owner.
    pub reason: String,
    /// Whether trying again can help.
    pub retryable: bool,
}

impl RunFailure {
    /// A failure.
    pub fn new(code: &str, reason: impl Into<String>, retryable: bool) -> Self {
        Self {
            code: code.to_owned(),
            reason: reason.into(),
            retryable,
        }
    }
}

/// What the provider said about a created link.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CreatedByProvider {
    /// The link URL.
    pub url: String,
    /// The provider's reference.
    pub provider_reference: Option<String>,
    /// The amount the link shows, in minor units.
    pub amount_minor: i64,
    /// The currency the link shows.
    pub currency: String,
}

fn kek(state: &AppState) -> Result<&[u8; 32], RunFailure> {
    state.config.accounts.account_kek().ok_or_else(|| {
        RunFailure::new(
            "key_unavailable",
            "Colony cannot open stored provider keys on this relay.",
            false,
        )
    })
}

/// Open the sealed API key of a connection.
pub fn open_api_key(
    state: &AppState,
    community: CommunityId,
    loaded: &LoadedConnection,
) -> Result<Zeroizing<String>, RunFailure> {
    let (Some(kek_id), Some(ciphertext), Some(nonce)) = (
        loaded.row.kek_id.as_deref(),
        loaded.row.sealed_api_key.as_deref(),
        loaded.row.api_key_nonce.as_deref(),
    ) else {
        return Err(RunFailure::new(
            "key_unavailable",
            "This connection has no API key. Paste the key again in Settings.",
            false,
        ));
    };
    vault::open(
        kek(state)?,
        kek_id,
        *community.as_uuid(),
        loaded.row.id,
        SecretField::ApiKey,
        ciphertext,
        nonce,
    )
    .map_err(|_| {
        RunFailure::new(
            "key_unavailable",
            "The stored provider key could not be opened. Paste the key again in Settings.",
            false,
        )
    })
}

/// Open the sealed notice signing secret of a connection, if it has one.
pub fn open_signing_secret(
    state: &AppState,
    community: CommunityId,
    loaded: &LoadedConnection,
) -> Result<Option<Zeroizing<String>>, RunFailure> {
    let (Some(kek_id), Some(ciphertext), Some(nonce)) = (
        loaded.row.kek_id.as_deref(),
        loaded.row.sealed_signing_secret.as_deref(),
        loaded.row.signing_secret_nonce.as_deref(),
    ) else {
        return Ok(None);
    };
    vault::open(
        kek(state)?,
        kek_id,
        *community.as_uuid(),
        loaded.row.id,
        SecretField::SigningSecret,
        ciphertext,
        nonce,
    )
    .map(Some)
    .map_err(|_| {
        RunFailure::new(
            "key_unavailable",
            "The stored signing secret could not be opened.",
            false,
        )
    })
}

fn render_values(head: &LinkHead, provider_reference: Option<&str>) -> RenderValues {
    RenderValues {
        amount_minor: head.amount_minor,
        currency: head.currency.clone(),
        purpose: head.purpose.clone(),
        card_ref: head.card_ref.clone(),
        invoice_number: head.invoice_number.clone(),
        recipient_name: head.recipient_name.clone(),
        expires_at_unix: head.expires_at.unwrap_or_default(),
        provider_reference: provider_reference.map(str::to_owned),
    }
}

/// A short, scrubbed excerpt of a provider error body for the owner.
fn error_excerpt(body: &[u8], key: &str) -> String {
    let text = serde_json::from_slice::<serde_json::Value>(body)
        .ok()
        .and_then(|value| {
            value
                .pointer("/error/message")
                .or_else(|| value.pointer("/message"))
                .or_else(|| value.pointer("/error"))
                .and_then(|found| found.as_str().map(str::to_owned))
        })
        .unwrap_or_default();
    let scrubbed = scrub_str(&text, &[key]);
    scrubbed
        .chars()
        .filter(|c| !c.is_control())
        .take(160)
        .collect()
}

async fn call(
    http: &dyn ProviderHttp,
    request: ProviderRequest,
    key: &str,
) -> Result<serde_json::Value, RunFailure> {
    let response = http
        .execute(&request)
        .await
        .map_err(|error| RunFailure::new(error.code(), error.reason(), error.retryable()))?;
    if !(200..300).contains(&response.status) {
        let excerpt = error_excerpt(&response.body, key);
        let retryable = response.status == 429 || response.status >= 500;
        let reason = if excerpt.is_empty() {
            format!(
                "The payment provider refused the request (status {}).",
                response.status
            )
        } else {
            format!(
                "The payment provider refused the request (status {}): {excerpt}",
                response.status
            )
        };
        return Err(RunFailure::new("provider_rejected", reason, retryable));
    }
    serde_json::from_slice::<serde_json::Value>(&response.body).map_err(|_| {
        RunFailure::new(
            "provider_response",
            "The payment provider answered with something Colony could not read.",
            false,
        )
    })
}

/// Run the connection's approved `create_link` recipe for an approved card.
///
/// Refuses unless the card is approved and its approval still matches its facts, and unless the
/// recipe passes the refusal list and the host lock right now.
pub async fn run_create(
    state: &Arc<AppState>,
    http: &dyn ProviderHttp,
    community: CommunityId,
    head: &LinkHead,
    loaded: &LoadedConnection,
    recipe_id: Option<&str>,
) -> Result<CreatedByProvider, RunFailure> {
    if !head.approval_is_valid() {
        return Err(RunFailure::new(
            "card_not_approved",
            "The card is not approved, so no link is created.",
            false,
        ));
    }
    let stored = match recipe_id {
        Some(id) => loaded.config.approved_recipe_by_id(id),
        None => loaded.config.approved_recipe(RecipePurpose::CreateLink),
    }
    .filter(|stored| stored.recipe.purpose == RecipePurpose::CreateLink)
    .ok_or_else(|| {
        RunFailure::new(
            "recipe_missing",
            "There is no approved create link recipe for this provider.",
            false,
        )
    })?;
    // The refusal list and the host lock run again at every run, whatever was approved.
    validate_recipe(&stored.recipe, &loaded.config.api_hosts)
        .map_err(|error| RunFailure::new(error.code, error.message, false))?;
    let rendered = render(&stored.recipe, &render_values(head, None))
        .map_err(|error| RunFailure::new(error.code, error.message, false))?;
    let key = open_api_key(state, community, loaded)?;
    let scheme = loaded
        .config
        .auth_scheme
        .clone()
        .unwrap_or(AuthScheme::Bearer);
    let request = ProviderRequest {
        method: rendered.method,
        host: rendered.host,
        path_and_query: rendered.path_and_query,
        headers: rendered.headers,
        body: rendered.body,
        auth: Some((scheme, key.clone())),
    };
    let value = call(http, request, key.as_str()).await?;
    let extracted = extract_values(&value, &stored.recipe.extract, &head.currency)
        .map_err(|error| RunFailure::new(error.code, error.message, false))?;
    if let Err(error) = state
        .db
        .money_touch_connection(community, loaded.row.id)
        .await
    {
        tracing::warn!(%community, "money rails could not note a connection use: {error}");
    }
    let (Some(url), Some(amount_minor), Some(currency)) =
        (extracted.url, extracted.amount_minor, extracted.currency)
    else {
        return Err(RunFailure::new(
            "provider_response",
            "The provider answer did not say the link, the amount and the currency.",
            false,
        ));
    };
    Ok(CreatedByProvider {
        url: scrub_str(&url, &[key.as_str()]),
        provider_reference: extracted
            .reference
            .map(|reference| scrub_str(&reference, &[key.as_str()])),
        amount_minor,
        currency,
    })
}

/// Run the connection's approved `lookup_payment` recipe (read only) for a card.
pub async fn run_lookup(
    state: &Arc<AppState>,
    http: &dyn ProviderHttp,
    community: CommunityId,
    head: &LinkHead,
    loaded: &LoadedConnection,
    provider_reference: &str,
) -> Result<LookupResult, RunFailure> {
    let stored = loaded
        .config
        .approved_recipe(RecipePurpose::LookupPayment)
        .ok_or_else(|| {
            RunFailure::new(
                "recipe_missing",
                "There is no approved lookup recipe for this provider.",
                false,
            )
        })?;
    validate_recipe(&stored.recipe, &loaded.config.api_hosts)
        .map_err(|error| RunFailure::new(error.code, error.message, false))?;
    let rendered = render(
        &stored.recipe,
        &render_values(head, Some(provider_reference)),
    )
    .map_err(|error| RunFailure::new(error.code, error.message, false))?;
    let key = open_api_key(state, community, loaded)?;
    let scheme = loaded
        .config
        .auth_scheme
        .clone()
        .unwrap_or(AuthScheme::Bearer);
    let request = ProviderRequest {
        method: rendered.method,
        host: rendered.host,
        path_and_query: rendered.path_and_query,
        headers: rendered.headers,
        body: None,
        auth: Some((scheme, key.clone())),
    };
    let value = call(http, request, key.as_str()).await?;
    let extracted = extract_values(&value, &stored.recipe.extract, &head.currency)
        .map_err(|error| RunFailure::new(error.code, error.message, false))?;
    Ok(LookupResult {
        reference: extracted.reference,
        amount_minor: extracted.amount_minor,
        currency: extracted.currency,
        paid: extracted.paid,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_excerpts_are_short_scrubbed_and_single_line() {
        let key = "sk_live_abcdef";
        let body = serde_json::to_vec(&serde_json::json!({
            "error": {"message": "Invalid API Key provided: sk_live_abcdef\nplease retry"}
        }))
        .expect("body");
        let excerpt = error_excerpt(&body, key);
        assert!(!excerpt.contains(key), "{excerpt}");
        assert!(!excerpt.contains('\n'));
        assert!(excerpt.contains("[removed]"));
        assert!(error_excerpt(b"not json", key).is_empty());
        let long =
            serde_json::to_vec(&serde_json::json!({"message": "x".repeat(500)})).expect("body");
        assert_eq!(error_excerpt(&long, key).chars().count(), 160);
    }

    #[test]
    fn failures_carry_codes_and_no_extra_detail() {
        let failure = RunFailure::new("provider_rejected", "No.", true);
        assert_eq!(failure.code, "provider_rejected");
        assert!(failure.retryable);
    }
}
