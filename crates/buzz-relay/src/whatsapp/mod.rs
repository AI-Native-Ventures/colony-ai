//! WhatsApp outreach on the official Cloud API, one number per company.
//!
//! Contract: `docs/whatsapp-outreach.md`. The relay is the only caller of the Graph send
//! API; everything else reaches Meta through [`graph::GraphApi`].

pub mod channel;
pub mod connect;
pub mod graph;
pub mod inbound;
pub mod policy;
pub mod secrets;
pub mod sender;

#[cfg(test)]
mod postgres_tests;

use std::sync::Arc;

use buzz_core::TenantContext;
use uuid::Uuid;

use crate::state::AppState;

/// What a caller may do with outreach, from strongest to weakest.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Access {
    /// Relay owner or admin: connect, approve, change the cap.
    OwnerAdmin,
    /// An agent managed by the owner or an admin (proven by the recorded agent owner, not by
    /// name), or an active member of the Outreach channel. Prepares batches and drafts; never
    /// approves or sends on its own.
    Outreach,
    /// Any other authenticated member: status and templates only.
    Member,
}

impl Access {
    /// May prepare batches and send inside an open window.
    pub fn can_send(self) -> bool {
        matches!(self, Self::OwnerAdmin | Self::Outreach)
    }

    /// May read contacts, inbox, batches and threads.
    pub fn can_read_private(self) -> bool {
        self.can_send()
    }

    /// May connect, decide batches and change settings.
    pub fn is_owner_admin(self) -> bool {
        self == Self::OwnerAdmin
    }
}

/// Resolve the caller's access for this company.
pub async fn access_for(
    state: &Arc<AppState>,
    tenant: &TenantContext,
    pubkey: &nostr::PublicKey,
) -> Result<Access, String> {
    let member = state
        .db
        .get_relay_member(tenant.community(), &pubkey.to_hex())
        .await
        .map_err(|error| format!("role lookup failed: {error}"))?;
    if member
        .as_ref()
        .is_some_and(|member| member.role == "owner" || member.role == "admin")
    {
        return Ok(Access::OwnerAdmin);
    }
    // An agent owned by the owner or an admin needs no channel membership, so where the
    // owner asks from does not matter. Foreign agents have another (or no) recorded owner.
    let owned = state
        .db
        .whatsapp_agent_is_owned_by_admin(tenant.community(), &pubkey.to_bytes())
        .await
        .map_err(|error| format!("agent owner lookup failed: {error}"))?;
    // RED PROOF: ownership guard removed.
    let _ = owned;
    let settings = state
        .db
        .whatsapp_ensure_settings(tenant.community())
        .await
        .map_err(|error| format!("settings lookup failed: {error}"))?;
    if let Some(channel_id) = settings.outreach_channel_id {
        let is_member = state
            .db
            .is_member(tenant.community(), channel_id, &pubkey.to_bytes())
            .await
            .map_err(|error| format!("channel membership lookup failed: {error}"))?;
        if is_member {
            return Ok(Access::Outreach);
        }
    }
    Ok(Access::Member)
}

/// Parse a UUID field from a command.
pub fn parse_uuid(value: &str, field: &str) -> Result<Uuid, String> {
    Uuid::parse_str(value.trim()).map_err(|_| format!("{field} must be a UUID"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn access_levels_gate_the_right_actions() {
        assert!(Access::OwnerAdmin.can_send() && Access::OwnerAdmin.is_owner_admin());
        assert!(Access::Outreach.can_send() && !Access::Outreach.is_owner_admin());
        assert!(!Access::Member.can_send() && !Access::Member.can_read_private());
    }

    #[test]
    fn uuid_fields_are_checked() {
        assert!(parse_uuid("not-a-uuid", "batchId").is_err());
        assert!(parse_uuid(&Uuid::new_v4().to_string(), "batchId").is_ok());
    }
}
