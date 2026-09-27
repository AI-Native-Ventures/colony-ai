//! Nostr-first broker for company records (goals and asks).
//!
//! Contract: `docs/company-records.md`. Parsing and pure validation live in
//! `buzz_core::company_records`. The brokers are implemented by the company
//! layer batch 1 lanes (asks and goals). Until a record's broker lands, its
//! commands are rejected here so no half-built path can persist them.

use std::sync::Arc;

use nostr::Event;

use buzz_core::company_records::parse_company_command;
use buzz_core::tenant::TenantContext;

use super::ingest::{IngestAuth, IngestError, IngestResult};
use crate::state::AppState;

/// Handles a member-signed company command (kinds 47031 to 47033).
pub async fn handle(
    _tenant: &TenantContext,
    _state: &Arc<AppState>,
    event: Event,
    _auth: IngestAuth,
) -> Result<IngestResult, IngestError> {
    let kind = event.kind.as_u16() as u32;
    parse_company_command(kind, &event.content)
        .map_err(|e| IngestError::Rejected(format!("invalid: {e}")))?;
    Err(IngestError::Rejected(
        "restricted: company records are not enabled on this relay yet".into(),
    ))
}
