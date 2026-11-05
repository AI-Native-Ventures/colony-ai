//! Money rails, payment links: the relay side.
//!
//! Contract: `docs/money-rails-pay-contract.md`. The pure rules live in
//! `buzz_core::money_rails`; this module resolves who the caller is, reads the invoice and the
//! connection, opens sealed secrets, calls the provider through [`provider::ProviderHttp`], and
//! runs the durable jobs that carry a card from approval to Paid.

pub mod evidence;
pub mod jobs;
pub mod notices;
pub mod provider;
pub mod runner;
pub mod vault;

#[cfg(test)]
mod postgres_tests;

use std::sync::Arc;

use buzz_core::business_records::{ClientHead, InvoiceHead};
use buzz_core::kind::{KIND_CLIENT_HEAD, KIND_INVOICE_HEAD};
use buzz_core::money_rails::connection::{ConnectionConfig, ConnectionStatus};
use buzz_core::money_rails::link::{ConnectionFacts, InvoiceFacts};
use buzz_core::money_rails::ActorRole;
use buzz_core::tenant::{CommunityId, TenantContext};
use buzz_core::StoredEvent;
use buzz_db::money_rails::MoneyConnectionRow;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::state::AppState;

/// Resolve the caller's role for money rails: owner or admin, an agent owned by one of them, or
/// anyone else. A managed agent never counts as an owner or admin, whatever role row it holds.
pub async fn access_for(
    state: &Arc<AppState>,
    tenant: &TenantContext,
    pubkey: &nostr::PublicKey,
) -> Result<ActorRole, String> {
    let member = state
        .db
        .get_relay_member(tenant.community(), &pubkey.to_hex())
        .await
        .map_err(|error| format!("role lookup failed: {error}"))?;
    let is_managed_agent = state
        .db
        .get_agent_channel_policy(tenant.community(), &pubkey.to_bytes())
        .await
        .map_err(|error| format!("agent lookup failed: {error}"))?
        .is_some_and(|(_, owner_pubkey)| owner_pubkey.is_some());
    if !is_managed_agent
        && member
            .as_ref()
            .is_some_and(|member| member.role == "owner" || member.role == "admin")
    {
        return Ok(ActorRole::OwnerAdmin);
    }
    let owned = state
        .db
        .whatsapp_agent_is_owned_by_admin(tenant.community(), &pubkey.to_bytes())
        .await
        .map_err(|error| format!("agent owner lookup failed: {error}"))?;
    Ok(if owned {
        ActorRole::OwnedAgent
    } else {
        ActorRole::Other
    })
}

/// A UUID derived from a label and an id, the same every time. Used for idempotency keys.
pub fn derived_uuid(label: &str, id: Uuid) -> Uuid {
    let mut hasher = Sha256::new();
    hasher.update(label.as_bytes());
    hasher.update(b":");
    hasher.update(id.as_bytes());
    let digest = hasher.finalize();
    let mut bytes = [0u8; 16];
    bytes.copy_from_slice(&digest[..16]);
    Uuid::from_bytes(bytes)
}

/// A 64 character hex id derived from a label and an id, for relay-made transitions.
pub fn derived_event_id(label: &str, id: Uuid, version: u32) -> String {
    let mut hasher = Sha256::new();
    hasher.update(label.as_bytes());
    hasher.update(b":");
    hasher.update(id.as_bytes());
    hasher.update(version.to_be_bytes());
    hex::encode(&hasher.finalize()[..])
}

/// Display number for an invoice, derived from its id (invoices carry no number of their own).
pub fn invoice_number(invoice_id: Uuid) -> String {
    let simple = invoice_id.simple().to_string();
    format!("INV-{}", simple[..8].to_ascii_uppercase())
}

/// The invoice behind a card, read from the company's relay-signed invoice heads.
pub struct InvoiceRead {
    /// The invoice head event (its id is the lock for payment evidence).
    pub event: StoredEvent,
    /// The invoice head.
    pub head: InvoiceHead,
    /// The facts the card rules need.
    pub facts: InvoiceFacts,
}

/// Find an invoice by id and the name of its client.
pub async fn read_invoice(
    state: &Arc<AppState>,
    community: CommunityId,
    invoice_id: Uuid,
) -> Result<Option<InvoiceRead>, String> {
    let invoices =
        crate::numbers_inputs::read_events(state, community, KIND_INVOICE_HEAD, true, None, None)
            .await?;
    let found = invoices.into_iter().find_map(|stored| {
        serde_json::from_str::<InvoiceHead>(&stored.event.content)
            .ok()
            .filter(|head| head.invoice_id == invoice_id)
            .map(|head| (stored, head))
    });
    let Some((event, head)) = found else {
        return Ok(None);
    };
    let clients =
        crate::numbers_inputs::read_events(state, community, KIND_CLIENT_HEAD, true, None, None)
            .await?;
    let customer_name = clients
        .iter()
        .filter_map(|stored| serde_json::from_str::<ClientHead>(&stored.event.content).ok())
        .find(|client| client.client_id == head.client_id)
        .map(|client| client.display_name)
        .unwrap_or_else(|| "Customer".to_owned());
    let facts = InvoiceFacts {
        status: head.status,
        currency: head.currency.clone(),
        total_minor: head.total_minor,
        outstanding_minor: head.outstanding_minor,
        number: invoice_number(head.invoice_id),
        client_id: head.client_id,
        customer_name,
    };
    Ok(Some(InvoiceRead { event, head, facts }))
}

/// A connection with its parsed configuration.
pub struct LoadedConnection {
    /// The stored row (secrets still sealed).
    pub row: MoneyConnectionRow,
    /// The non secret configuration.
    pub config: ConnectionConfig,
}

impl LoadedConnection {
    /// The facts the card rules need.
    pub fn facts(&self) -> ConnectionFacts {
        ConnectionFacts {
            connection_id: self.config.connection_id,
            label: self.config.label.clone(),
            route: self.config.route,
            status: self.config.status,
            has_create_recipe: buzz_core::money_rails::connection::has_approved_create_recipe(
                &self.config,
            ),
            browser_host: self.config.browser_hosts.first().cloned(),
        }
    }
}

/// Parse the stored configuration of a connection row.
pub fn parse_connection(row: MoneyConnectionRow) -> Result<LoadedConnection, String> {
    let config = serde_json::from_value::<ConnectionConfig>(row.config.clone())
        .map_err(|error| format!("stored connection configuration is invalid: {error}"))?;
    Ok(LoadedConnection { row, config })
}

/// Load a connection of the company.
pub async fn load_connection(
    state: &Arc<AppState>,
    community: CommunityId,
    connection_id: Uuid,
) -> Result<Option<LoadedConnection>, String> {
    let row = state
        .db
        .money_get_connection(community, connection_id)
        .await
        .map_err(|error| format!("connection lookup failed: {error}"))?;
    row.map(parse_connection).transpose()
}

/// The connection a new card should use: the one named, else the default, else the only
/// connected one.
pub async fn resolve_connection(
    state: &Arc<AppState>,
    community: CommunityId,
    named: Option<Uuid>,
) -> Result<Option<LoadedConnection>, String> {
    if let Some(connection_id) = named {
        return load_connection(state, community, connection_id).await;
    }
    let rows = state
        .db
        .money_list_connections(community)
        .await
        .map_err(|error| format!("connection list failed: {error}"))?;
    let mut live = Vec::new();
    for row in rows {
        let loaded = parse_connection(row)?;
        if loaded.config.status == ConnectionStatus::Connected {
            live.push(loaded);
        }
    }
    if let Some(index) = live.iter().position(|loaded| loaded.config.is_default) {
        return Ok(Some(live.swap_remove(index)));
    }
    if live.len() == 1 {
        return Ok(live.pop());
    }
    Ok(None)
}

/// The host of a community, for the notice address.
pub async fn community_host(
    state: &Arc<AppState>,
    community: CommunityId,
) -> Result<String, String> {
    state
        .db
        .lookup_community_host(community)
        .await
        .map_err(|error| format!("host lookup failed: {error}"))?
        .ok_or_else(|| "the community is gone".to_owned())
}

/// The private notice address of a connection.
pub fn notice_address(host: &str, notice_id: Uuid) -> String {
    format!("https://{host}/hooks/pay/{notice_id}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derived_ids_are_stable_and_distinct() {
        let id = Uuid::from_u128(42);
        assert_eq!(derived_uuid("send", id), derived_uuid("send", id));
        assert_ne!(derived_uuid("send", id), derived_uuid("pay", id));
        assert_ne!(
            derived_uuid("send", id),
            derived_uuid("send", Uuid::from_u128(43))
        );
        let event_id = derived_event_id("sys", id, 3);
        assert_eq!(event_id.len(), 64);
        assert!(buzz_core::company_records::is_hex_id(&event_id));
        assert_ne!(event_id, derived_event_id("sys", id, 4));
    }

    #[test]
    fn invoice_numbers_come_from_the_id() {
        let number = invoice_number(Uuid::from_u128(0xabcdef12_3456_7890_abcd_ef1234567890));
        assert_eq!(number, "INV-ABCDEF12");
    }

    #[test]
    fn notice_addresses_have_the_documented_shape() {
        let id = Uuid::from_u128(7);
        assert_eq!(
            notice_address("acme.example", id),
            format!("https://acme.example/hooks/pay/{id}")
        );
    }
}
