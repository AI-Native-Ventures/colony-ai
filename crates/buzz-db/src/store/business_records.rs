//! Community-scoped idempotency claims for business-record conversions.

use sqlx::{Postgres, Transaction};
use uuid::Uuid;

use buzz_core::CommunityId;

use crate::{DbError, Result};

/// Whether a proposal conversion claim was created or already existed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConversionClaimDisposition {
    /// This transaction inserted the first claim for the conversion.
    Claimed,
    /// The request matched an existing conversion and its original receipt.
    Existing,
}

/// Stable event ids returned by an idempotent proposal conversion claim.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConversionClaimResult {
    /// Whether this transaction created the claim or found an exact replay.
    pub disposition: ConversionClaimDisposition,
    /// Acceptance event id from the first successful claim.
    pub acceptance_event_id: Vec<u8>,
    /// Relay receipt event id from the first successful claim.
    pub receipt_event_id: Vec<u8>,
}

impl crate::Db {
    /// Find an exact accepted conversion replay before validating mutable heads.
    ///
    /// This lets an already-committed acceptance retry return its original
    /// receipt even if the proposal or resulting heads have since advanced.
    /// The transaction-bound claim remains authoritative for concurrent writes.
    pub async fn find_proposal_conversion_claim(
        &self,
        community_id: CommunityId,
        business_channel_id: Uuid,
        conversion_id: Uuid,
        proposal_id: Uuid,
        proposal_version_event_id: &[u8],
        proposal_version_digest: &[u8],
        accepted_by_pubkey: &[u8],
        client_id: Uuid,
        work_item_id: Uuid,
        draft_invoice_id: Uuid,
    ) -> Result<Option<ConversionClaimResult>> {
        if [
            proposal_version_event_id,
            proposal_version_digest,
            accepted_by_pubkey,
        ]
        .iter()
        .any(|value| value.len() != 32)
        {
            return Err(DbError::InvalidData(
                "business conversion references must be 32 bytes".into(),
            ));
        }

        let mut connection = crate::observability::acquire_writer(
            &self.pool,
            crate::observability::WriterOperation::Authorization,
        )
        .await?;
        let existing = sqlx::query_as::<
            _,
            (
                Uuid,
                Uuid,
                Vec<u8>,
                Vec<u8>,
                Vec<u8>,
                Vec<u8>,
                Vec<u8>,
                Uuid,
                Uuid,
                Uuid,
            ),
        >(
            "SELECT business_channel_id, proposal_id, proposal_version_event_id, proposal_version_digest, \
                    acceptance_event_id, receipt_event_id, accepted_by_pubkey, \
                    client_id, work_item_id, draft_invoice_id \
             FROM business_proposal_conversion_claims \
             WHERE community_id = $1 AND conversion_id = $2",
        )
        .bind(community_id.as_uuid())
        .bind(conversion_id)
        .fetch_optional(&mut *connection)
        .await?;

        let Some((
            existing_business_channel_id,
            existing_proposal_id,
            existing_version_id,
            existing_digest,
            acceptance_event_id,
            receipt_event_id,
            existing_accepted_by,
            existing_client_id,
            existing_work_item_id,
            existing_invoice_id,
        )) = existing
        else {
            return Ok(None);
        };

        let exact_replay = existing_business_channel_id == business_channel_id
            && existing_proposal_id == proposal_id
            && existing_version_id.as_slice() == proposal_version_event_id
            && existing_digest.as_slice() == proposal_version_digest
            && existing_accepted_by.as_slice() == accepted_by_pubkey
            && existing_client_id == client_id
            && existing_work_item_id == work_item_id
            && existing_invoice_id == draft_invoice_id;
        if !exact_replay {
            return Err(DbError::InvalidData(
                "proposal conversion id was already claimed with different values".into(),
            ));
        }

        Ok(Some(ConversionClaimResult {
            disposition: ConversionClaimDisposition::Existing,
            acceptance_event_id,
            receipt_event_id,
        }))
    }
}

/// Claim one accepted proposal conversion inside the caller's event transaction.
///
/// `proposal_version_event_id`, both source event ids, the digest, and the
/// accepted pubkey must each be exactly 32 bytes. A retry with the same
/// conversion id and linked record ids returns the original receipt. Reusing
/// any claimed proposal version, work item, or invoice for a different request
/// fails closed with `DbError::InvalidData`.
pub async fn claim_proposal_conversion(
    tx: &mut Transaction<'_, Postgres>,
    community_id: CommunityId,
    business_channel_id: Uuid,
    conversion_id: Uuid,
    proposal_id: Uuid,
    proposal_version_event_id: &[u8],
    proposal_version_digest: &[u8],
    acceptance_event_id: &[u8],
    receipt_event_id: &[u8],
    accepted_by_pubkey: &[u8],
    client_id: Uuid,
    work_item_id: Uuid,
    draft_invoice_id: Uuid,
) -> Result<ConversionClaimResult> {
    if [
        proposal_version_event_id,
        proposal_version_digest,
        acceptance_event_id,
        receipt_event_id,
        accepted_by_pubkey,
    ]
    .iter()
    .any(|value| value.len() != 32)
    {
        return Err(DbError::InvalidData(
            "business conversion references must be 32 bytes".into(),
        ));
    }

    let inserted = sqlx::query(
        "INSERT INTO business_proposal_conversion_claims \
         (community_id, business_channel_id, conversion_id, proposal_id, proposal_version_event_id, \
          proposal_version_digest, acceptance_event_id, receipt_event_id, accepted_by_pubkey, \
          client_id, work_item_id, draft_invoice_id) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) \
         ON CONFLICT DO NOTHING",
    )
    .bind(community_id.as_uuid())
    .bind(business_channel_id)
    .bind(conversion_id)
    .bind(proposal_id)
    .bind(proposal_version_event_id)
    .bind(proposal_version_digest)
    .bind(acceptance_event_id)
    .bind(receipt_event_id)
    .bind(accepted_by_pubkey)
    .bind(client_id)
    .bind(work_item_id)
    .bind(draft_invoice_id)
    .execute(&mut **tx)
    .await?;

    if inserted.rows_affected() == 1 {
        return Ok(ConversionClaimResult {
            disposition: ConversionClaimDisposition::Claimed,
            acceptance_event_id: acceptance_event_id.to_vec(),
            receipt_event_id: receipt_event_id.to_vec(),
        });
    }

    let existing = sqlx::query_as::<_, (Uuid, Uuid, Uuid, Vec<u8>, Vec<u8>, Vec<u8>, Vec<u8>, Vec<u8>, Uuid, Uuid, Uuid)>(
        "SELECT business_channel_id, conversion_id, proposal_id, proposal_version_event_id, proposal_version_digest, \
                acceptance_event_id, receipt_event_id, accepted_by_pubkey, client_id, work_item_id, draft_invoice_id \
         FROM business_proposal_conversion_claims \
         WHERE community_id = $1 AND (conversion_id = $2 OR proposal_version_event_id = $3 \
               OR work_item_id = $4 OR draft_invoice_id = $5) \
         ORDER BY (conversion_id = $2) DESC \
         LIMIT 1 FOR UPDATE",
    )
    .bind(community_id.as_uuid())
    .bind(conversion_id)
    .bind(proposal_version_event_id)
    .bind(work_item_id)
    .bind(draft_invoice_id)
    .fetch_optional(&mut **tx)
    .await?;

    let Some((
        existing_business_channel_id,
        existing_conversion_id,
        existing_proposal_id,
        existing_version_id,
        existing_digest,
        existing_acceptance_id,
        existing_receipt_id,
        existing_accepted_by,
        existing_client_id,
        existing_work_item_id,
        existing_invoice_id,
    )) = existing
    else {
        return Err(DbError::InvalidData(
            "conversion claim conflict did not resolve to a stored claim".into(),
        ));
    };

    let exact_replay = existing_business_channel_id == business_channel_id
        && existing_conversion_id == conversion_id
        && existing_proposal_id == proposal_id
        && existing_version_id.as_slice() == proposal_version_event_id
        && existing_digest.as_slice() == proposal_version_digest
        && existing_accepted_by.as_slice() == accepted_by_pubkey
        && existing_client_id == client_id
        && existing_work_item_id == work_item_id
        && existing_invoice_id == draft_invoice_id;
    if !exact_replay {
        return Err(DbError::InvalidData(
            "proposal version or conversion output ids were already claimed".into(),
        ));
    }

    Ok(ConversionClaimResult {
        disposition: ConversionClaimDisposition::Existing,
        acceptance_event_id: existing_acceptance_id,
        receipt_event_id: existing_receipt_id,
    })
}
