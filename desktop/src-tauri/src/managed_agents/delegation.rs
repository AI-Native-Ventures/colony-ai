//! Which Colony account delegated a managed agent.
//!
//! A managed agent reaches the relay through its NIP-OA `auth_tag`. The relay
//! verifies the tag, then admits the agent only when the tag's owner is a
//! relay member. The tag is minted once, at creation, with the owner keys of
//! that moment, and is never refreshed. After an identity reset the previous
//! account's records stay in `managed-agents.json` naming an owner the relay
//! no longer admits, so reusing one fails with `403` on every connection.
//!
//! Every path that lists, starts, deploys or publishes a record asks
//! [`record_delegated_by`] first. Foreign records are skipped or refused,
//! never deleted or rewritten, so signing back into the account that made
//! them shows them again.

use std::collections::HashSet;
use std::sync::{Mutex, OnceLock};

use super::{find_managed_agent_mut, BackendKind, ManagedAgentRecord};
use crate::app_state::AppState;

/// Refusal for a start, deploy or publish that targets a record another
/// Colony account on this computer delegated.
pub(crate) const FOREIGN_DELEGATION_ERROR: &str =
    "This AI employee was set up by a different Colony account on this computer. \
     Sign in to that account to use it, or add a new AI employee.";

/// The signed-in owner's pubkey hex, the account every delegation check
/// compares against.
pub(crate) fn signed_in_owner_hex(state: &AppState) -> Result<String, String> {
    state
        .keys
        .lock()
        .map(|keys| keys.public_key().to_hex())
        .map_err(|error| error.to_string())
}

/// True when `record` may act for the signed-in owner `owner_hex`. See
/// [`auth_tag_delegated_by`] for the rules.
pub(crate) fn record_delegated_by(record: &ManagedAgentRecord, owner_hex: &str) -> bool {
    auth_tag_delegated_by(&record.pubkey, record.auth_tag.as_deref(), owner_hex)
}

/// True when the agent `agent_pubkey` carrying `auth_tag` may act for the
/// signed-in owner `owner_hex`.
///
/// - No tag: a legacy record from before NIP-OA. It keeps today's behavior,
///   the harness falls back to the workspace owner.
/// - A tag whose verified owner is `owner_hex`: delegated by this account.
/// - Any other tag is foreign. A tag that fails to parse or verify fails
///   closed and is logged once per agent.
pub(crate) fn auth_tag_delegated_by(
    agent_pubkey: &str,
    auth_tag: Option<&str>,
    owner_hex: &str,
) -> bool {
    let Some(auth_tag) = auth_tag else {
        return true;
    };
    match delegating_owner_hex(agent_pubkey, auth_tag) {
        Ok(owner) => owner.eq_ignore_ascii_case(owner_hex),
        Err(error) => {
            log_unreadable_tag_once(agent_pubkey, &error);
            false
        }
    }
}

/// The owner named by `auth_tag`, verified against `agent_pubkey` with the
/// same buzz-sdk check the relay runs, so a tag copied from another agent or
/// with a broken signature never counts as delegated.
fn delegating_owner_hex(agent_pubkey: &str, auth_tag: &str) -> Result<String, String> {
    let agent = nostr::PublicKey::from_hex(agent_pubkey)
        .map_err(|error| format!("invalid agent pubkey: {error}"))?;
    buzz_sdk_pkg::nip_oa::verify_auth_tag(auth_tag, &agent)
        .map(|owner| owner.to_hex())
        .map_err(|error| error.to_string())
}

/// Log an unreadable tag once per agent per process. The agent list polls
/// every few seconds, so logging on every check would flood the app log.
fn log_unreadable_tag_once(agent_pubkey: &str, error: &str) {
    static LOGGED: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    let first = LOGGED
        .get_or_init(|| Mutex::new(HashSet::new()))
        .lock()
        .map(|mut logged| logged.insert(agent_pubkey.to_ascii_lowercase()))
        .unwrap_or(true);
    if first {
        eprintln!(
            "buzz-desktop: agent {agent_pubkey} has an unreadable NIP-OA auth tag ({error}); \
             treating it as set up by another account"
        );
    }
}

/// `None` when `record` may act for `owner_hex`, else the plain-words refusal
/// a start, deploy or publish returns.
pub(crate) fn foreign_delegation_refusal(
    record: &ManagedAgentRecord,
    owner_hex: &str,
) -> Option<String> {
    if record_delegated_by(record, owner_hex) {
        return None;
    }
    eprintln!(
        "buzz-desktop: refusing agent {}: its auth tag names another Colony account",
        record.pubkey
    );
    Some(FOREIGN_DELEGATION_ERROR.to_string())
}

/// Find `pubkey` for a start or publish, refusing a record another account
/// delegated. The record stays in `records` untouched either way.
pub(crate) fn find_delegated_agent_mut<'a>(
    records: &'a mut [ManagedAgentRecord],
    pubkey: &str,
    owner_hex: &str,
) -> Result<&'a mut ManagedAgentRecord, String> {
    let record = find_managed_agent_mut(records, pubkey)?;
    match foreign_delegation_refusal(record, owner_hex) {
        Some(error) => Err(error),
        None => Ok(record),
    }
}

/// The records a list shown to the signed-in owner may contain: their own
/// agents plus legacy records without a tag.
pub(crate) fn delegated_records<'a>(
    records: &'a [ManagedAgentRecord],
    owner_hex: &'a str,
) -> impl Iterator<Item = &'a ManagedAgentRecord> + 'a {
    records
        .iter()
        .filter(move |record| record_delegated_by(record, owner_hex))
}

/// True when launch restore and the community fan-out may auto-start
/// `record`: a local agent marked to start with the app, delegated by
/// `owner_hex`. Both auto-start paths use this one predicate.
pub(crate) fn auto_start_eligible(record: &ManagedAgentRecord, owner_hex: &str) -> bool {
    record.start_on_app_launch
        && record.backend == BackendKind::Local
        && record_delegated_by(record, owner_hex)
}

#[cfg(test)]
mod tests;
