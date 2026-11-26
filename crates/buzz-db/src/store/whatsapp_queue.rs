//! Approved WhatsApp batch messages that still wait to be sent, and taking them out of the
//! queue.
//!
//! A batch row is `ready` once the owner approved its batch. Until the sender claims it, the
//! owner (or an agent acting for the owner) may decide that it should not go out after all:
//! it then becomes `skipped` with a reason, exactly like a row whose contact opted out, and the
//! sender never reads it again.

use buzz_core::CommunityId;
use sqlx::Row;
use uuid::Uuid;

use crate::error::Result;
use crate::Db;

/// One approved batch message that has not been sent yet.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QueuedRow {
    /// Message id.
    pub message_id: Uuid,
    /// Recipient phone number in WhatsApp form.
    pub wa_id: String,
    /// Batch the message belongs to.
    pub batch_id: Uuid,
    /// Lead the contact is linked to, when it has one.
    pub lead_id: Option<String>,
}

impl Db {
    /// Approved batch messages still waiting to be sent, oldest first, at most `limit` rows.
    /// `batch_id` narrows the answer to one batch.
    pub async fn whatsapp_list_queued_rows(
        &self,
        community: CommunityId,
        batch_id: Option<Uuid>,
        limit: i64,
    ) -> Result<Vec<QueuedRow>> {
        let rows = sqlx::query(
            "SELECT m.id, m.wa_id, m.batch_id, c.lead_id \
             FROM whatsapp_messages m \
             JOIN whatsapp_contacts c \
               ON c.community_id = m.community_id AND c.wa_id = m.wa_id \
             WHERE m.community_id = $1 AND m.direction = 'out' AND m.batch_id IS NOT NULL \
               AND m.state IN ('queued', 'ready') \
               AND ($2::uuid IS NULL OR m.batch_id = $2) \
             ORDER BY m.created_at, m.id \
             LIMIT $3",
        )
        .bind(community.as_uuid())
        .bind(batch_id)
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;
        rows.iter()
            .map(|row| {
                Ok(QueuedRow {
                    message_id: row.try_get("id")?,
                    wa_id: row.try_get("wa_id")?,
                    batch_id: row.try_get("batch_id")?,
                    lead_id: row.try_get("lead_id")?,
                })
            })
            .collect()
    }

    /// Take waiting batch messages out of the queue in one statement. A row the sender claimed
    /// in the meantime is left alone, so the answer is the number of rows that really left the
    /// queue. Removed rows keep their history: state `skipped` with `reason`.
    pub async fn whatsapp_remove_queued_rows(
        &self,
        community: CommunityId,
        message_ids: &[Uuid],
        reason: &str,
    ) -> Result<i64> {
        if message_ids.is_empty() {
            return Ok(0);
        }
        let result = sqlx::query(
            "UPDATE whatsapp_messages SET state = 'skipped', skip_reason = $3, updated_at = now() \
             WHERE community_id = $1 AND id = ANY($2) AND direction = 'out' \
               AND batch_id IS NOT NULL AND state IN ('queued', 'ready')",
        )
        .bind(community.as_uuid())
        .bind(message_ids)
        .bind(reason.chars().take(300).collect::<String>())
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() as i64)
    }
}
