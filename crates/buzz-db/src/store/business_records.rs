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

/// Coordinates that identify one accepted proposal conversion.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProposalConversionKey {
    /// Trusted internal business channel for the proposal.
    pub business_channel_id: Uuid,
    /// Client supplied idempotency identifier.
    pub conversion_id: Uuid,
    /// Proposal coordinate being accepted.
    pub proposal_id: Uuid,
    /// Exact immutable proposal version event.
    pub proposal_version_event_id: Vec<u8>,
    /// SHA-256 digest of the exact proposal version content.
    pub proposal_version_digest: Vec<u8>,
    /// Authenticated signer of the acceptance event.
    pub accepted_by_pubkey: Vec<u8>,
    /// Client stream UUID created or linked by conversion.
    pub client_id: Uuid,
    /// Work item UUID created by conversion.
    pub work_item_id: Uuid,
    /// Draft invoice UUID created by conversion.
    pub draft_invoice_id: Uuid,
}

/// Complete data persisted for one proposal conversion claim.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProposalConversionClaim {
    /// The conversion identity and output coordinates.
    pub key: ProposalConversionKey,
    /// Signed acceptance event id.
    pub acceptance_event_id: Vec<u8>,
    /// Relay signed conversion receipt event id.
    pub receipt_event_id: Vec<u8>,
}

/// Read the community's trusted internal business channel selection.
pub async fn get_business_channel_id(
    db: &crate::Db,
    community_id: CommunityId,
) -> Result<Option<Uuid>> {
    let mut connection = crate::observability::acquire_writer(
        &db.pool,
        crate::observability::WriterOperation::Authorization,
    )
    .await?;
    let channel_id = sqlx::query_scalar::<_, Option<Uuid>>(
        "SELECT business_channel_id FROM communities WHERE id = $1",
    )
    .bind(community_id.as_uuid())
    .fetch_optional(&mut *connection)
    .await?;
    Ok(channel_id.flatten())
}

/// Register the first owner-authorized Party channel inside the event transaction.
///
/// An already registered identical channel is an idempotent success. A
/// different channel cannot replace the community's internal business channel.
pub async fn register_business_channel_in_transaction(
    tx: &mut Transaction<'_, Postgres>,
    community_id: CommunityId,
    channel_id: Uuid,
) -> Result<bool> {
    let registered: Option<Uuid> = sqlx::query_scalar(
        "UPDATE communities SET business_channel_id = $2 \
         WHERE id = $1 AND (business_channel_id IS NULL OR business_channel_id = $2) \
         RETURNING business_channel_id",
    )
    .bind(community_id.as_uuid())
    .bind(channel_id)
    .fetch_optional(&mut **tx)
    .await?;
    Ok(registered == Some(channel_id))
}

impl crate::Db {
    /// Find an exact accepted conversion replay before validating mutable heads.
    ///
    /// This lets an already-committed acceptance retry return its original
    /// receipt even if the proposal or resulting heads have since advanced.
    /// The transaction-bound claim remains authoritative for concurrent writes.
    #[allow(clippy::too_many_arguments)]
    pub async fn find_proposal_conversion_claim(
        &self,
        community_id: CommunityId,
        key: &ProposalConversionKey,
    ) -> Result<Option<ConversionClaimResult>> {
        if [
            key.proposal_version_event_id.as_slice(),
            key.proposal_version_digest.as_slice(),
            key.accepted_by_pubkey.as_slice(),
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
        .bind(key.conversion_id)
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

        let exact_replay = existing_business_channel_id == key.business_channel_id
            && existing_proposal_id == key.proposal_id
            && existing_version_id == key.proposal_version_event_id
            && existing_digest == key.proposal_version_digest
            && existing_accepted_by == key.accepted_by_pubkey
            && existing_client_id == key.client_id
            && existing_work_item_id == key.work_item_id
            && existing_invoice_id == key.draft_invoice_id;
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
#[allow(clippy::too_many_arguments)]
pub async fn claim_proposal_conversion(
    tx: &mut Transaction<'_, Postgres>,
    community_id: CommunityId,
    claim: &ProposalConversionClaim,
) -> Result<ConversionClaimResult> {
    let key = &claim.key;
    if [
        key.proposal_version_event_id.as_slice(),
        key.proposal_version_digest.as_slice(),
        claim.acceptance_event_id.as_slice(),
        claim.receipt_event_id.as_slice(),
        key.accepted_by_pubkey.as_slice(),
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
    .bind(key.business_channel_id)
    .bind(key.conversion_id)
    .bind(key.proposal_id)
    .bind(&key.proposal_version_event_id)
    .bind(&key.proposal_version_digest)
    .bind(&claim.acceptance_event_id)
    .bind(&claim.receipt_event_id)
    .bind(&key.accepted_by_pubkey)
    .bind(key.client_id)
    .bind(key.work_item_id)
    .bind(key.draft_invoice_id)
    .execute(&mut **tx)
    .await?;

    if inserted.rows_affected() == 1 {
        return Ok(ConversionClaimResult {
            disposition: ConversionClaimDisposition::Claimed,
            acceptance_event_id: claim.acceptance_event_id.clone(),
            receipt_event_id: claim.receipt_event_id.clone(),
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
    .bind(key.conversion_id)
    .bind(&key.proposal_version_event_id)
    .bind(key.work_item_id)
    .bind(key.draft_invoice_id)
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

    let exact_replay = existing_business_channel_id == key.business_channel_id
        && existing_conversion_id == key.conversion_id
        && existing_proposal_id == key.proposal_id
        && existing_version_id == key.proposal_version_event_id
        && existing_digest == key.proposal_version_digest
        && existing_accepted_by == key.accepted_by_pubkey
        && existing_client_id == key.client_id
        && existing_work_item_id == key.work_item_id
        && existing_invoice_id == key.draft_invoice_id;
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
