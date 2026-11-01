//! The payment notice inbox: `POST /hooks/pay/<noticeId>`.
//!
//! A notice is stored raw (64 KiB cap, 90 days), deduped by the provider's event id or the hash
//! of the body, and judged by `buzz_core::money_rails::notice::judge_notice`, which is the only
//! decision that can lead to "paid". A forged, replayed or mismatching post can at most raise a
//! "Payment reported, check" on a card; it can never mark one Paid.

use std::sync::Arc;

use chrono::Utc;
use uuid::Uuid;

use buzz_core::kind::KIND_PAYMENT_LINK_HEAD;
use buzz_core::money_rails::link::{LinkHead, SystemOp};
use buzz_core::money_rails::notice::{
    dedupe_key, judge_notice, matches_card, read_notice, verify_signature, Judgement, LookupResult,
    MatchKeys, SignatureState,
};
use buzz_core::money_rails::{sha256_hex, NOTICE_MAX_BYTES};
use buzz_core::tenant::TenantContext;
use buzz_db::money_rails::NewMoneyNotice;

use super::provider::ProviderHttp;
use super::{parse_connection, runner};
use crate::handlers::money_pay_links::{apply_system_op, SystemApplied};
use crate::state::AppState;

/// Notices a connection may post per minute.
const MAX_PER_MINUTE: i64 = 60;
/// Notices with a raw body a connection may hold at once.
const MAX_HELD: i64 = 1_000;

/// Why the inbox refused a post.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NoticeError {
    /// No such address.
    NotFound,
    /// The body is larger than 64 KiB.
    TooLarge,
    /// Too many posts.
    RateLimited,
    /// Something failed inside the relay; the provider should retry.
    Internal(String),
}

/// What the inbox did with a post.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NoticeOutcome {
    /// The same notice was stored before.
    pub duplicate: bool,
    /// How it was judged: `unmatched`, `ignored`, `reported` or `verified`.
    pub judgement: &'static str,
    /// The card it belongs to.
    pub link_id: Option<Uuid>,
}

fn internal(error: impl std::fmt::Display) -> NoticeError {
    NoticeError::Internal(error.to_string())
}

/// Cards of a connection that have a link, newest change first.
async fn candidate_cards(
    state: &Arc<AppState>,
    tenant: &TenantContext,
    connection_id: Uuid,
) -> Result<Vec<LinkHead>, NoticeError> {
    let stored = crate::numbers_inputs::read_events(
        state,
        tenant.community(),
        KIND_PAYMENT_LINK_HEAD,
        true,
        None,
        None,
    )
    .await
    .map_err(internal)?;
    let mut cards: Vec<LinkHead> = stored
        .iter()
        .filter_map(|stored| serde_json::from_str::<LinkHead>(&stored.event.content).ok())
        .filter(|head| head.connection_id == connection_id && head.link_exists())
        .collect();
    cards.sort_by_key(|head| std::cmp::Reverse(head.updated_at));
    Ok(cards)
}

/// Receive one post on a notice address.
pub async fn receive(
    state: &Arc<AppState>,
    http: &dyn ProviderHttp,
    tenant: &TenantContext,
    notice_id: Uuid,
    header: &(dyn Fn(&str) -> Option<String> + Sync),
    body: &[u8],
) -> Result<NoticeOutcome, NoticeError> {
    let community = tenant.community();
    if body.len() > NOTICE_MAX_BYTES {
        return Err(NoticeError::TooLarge);
    }
    let row = state
        .db
        .money_get_connection_by_notice(community, notice_id)
        .await
        .map_err(internal)?
        .ok_or(NoticeError::NotFound)?;
    let connection_id = row.id;
    if state
        .db
        .money_count_recent_notices(community, connection_id, 60)
        .await
        .map_err(internal)?
        >= MAX_PER_MINUTE
        || state
            .db
            .money_count_unreduced_notices(community, connection_id)
            .await
            .map_err(internal)?
            >= MAX_HELD
    {
        return Err(NoticeError::RateLimited);
    }
    let loaded = parse_connection(row).map_err(internal)?;
    let now = Utc::now().timestamp();

    // Signature: checked only when a signing secret is held. A missing or wrong signature on a
    // connection that holds a secret is never acted on.
    let signature_value = loaded
        .config
        .signature
        .as_ref()
        .and_then(|config| header(&config.header.to_ascii_lowercase()));
    let signature = match (
        loaded.config.signature.as_ref(),
        runner::open_signing_secret(state, community, &loaded),
    ) {
        (Some(config), Ok(Some(secret))) => verify_signature(
            config,
            secret.as_bytes(),
            signature_value.as_deref(),
            body,
            now,
        ),
        _ => SignatureState::NoSecret,
    };

    let map = loaded.config.approved_notice_map();
    let first_read = read_notice(body, map, "");
    // Only a verified signature earns the provider's own event id as the dedupe key. Anything
    // else dedupes by the hash of the body, so a forged post that borrows a real event id can
    // never block the genuine notice that carries it.
    let key = if signature == SignatureState::Verified {
        dedupe_key(&first_read, body)
    } else {
        format!("sha256:{}", sha256_hex(body))
    };
    if state
        .db
        .money_notice_exists(community, connection_id, &key)
        .await
        .map_err(internal)?
    {
        return Ok(NoticeOutcome {
            duplicate: true,
            judgement: "unmatched",
            link_id: None,
        });
    }

    // Which card is it about?
    let cards = candidate_cards(state, tenant, connection_id).await?;
    let matched = cards.iter().find(|head| {
        let keys = MatchKeys {
            card_ref: &head.card_ref,
            provider_reference: head
                .link
                .as_ref()
                .and_then(|link| link.provider_reference.as_deref()),
        };
        matches_card(body, &first_read, &keys)
    });

    let stored_id = Uuid::new_v4();
    let mut judgement_label = "unmatched";
    let mut link_id = None;
    let mut read = first_read;
    if let Some(head) = matched {
        link_id = Some(head.link_id);
        read = read_notice(body, map, &head.currency);
        let provider_reference = head
            .link
            .as_ref()
            .and_then(|link| link.provider_reference.clone());
        // Without a verified signature, an approved lookup recipe can still confirm it.
        let lookup: Option<LookupResult> = match (&provider_reference, signature) {
            (Some(reference), signature) if signature != SignatureState::Verified => {
                match runner::run_lookup(state, http, community, head, &loaded, reference).await {
                    Ok(result) => Some(result),
                    Err(failure) => {
                        tracing::info!(
                            %community,
                            code = %failure.code,
                            "payment lookup did not confirm a notice"
                        );
                        None
                    }
                }
            }
            _ => None,
        };
        let judgement = judge_notice(
            signature,
            &read,
            lookup.as_ref(),
            head.amount_minor,
            &head.currency,
            provider_reference.as_deref(),
        );
        judgement_label = match judgement {
            Judgement::Ignore => "ignored",
            Judgement::Reported { .. } => "reported",
            Judgement::Verified { .. } => "verified",
        };
        let op = match judgement {
            Judgement::Ignore => None,
            Judgement::Reported { mismatch } => Some((None, mismatch)),
            Judgement::Verified { by } => Some((Some(by), None)),
        };
        if let Some((verified_by, mismatch)) = op {
            let applied = apply_system_op(
                tenant,
                state,
                head.link_id,
                SystemOp::Notice {
                    notice_id: stored_id,
                    verified_by,
                    reference: read.reference.clone().or(provider_reference),
                    amount_minor: read.amount_minor,
                    currency: read.currency.clone(),
                    at: read.occurred_at.unwrap_or(now),
                    mismatch,
                },
            )
            .await
            .map_err(|error| internal(format!("{error:?}")))?;
            if matches!(applied, SystemApplied::Changed(_)) && verified_by.is_some() {
                super::jobs::process_now(state, http, tenant, head.link_id, "evidence").await;
            }
        }
    }

    let mut tx = state
        .db
        .begin_event_write_transaction()
        .await
        .map_err(internal)?;
    let stored = buzz_db::money_rails::money_insert_notice_tx(
        &mut tx,
        community,
        &NewMoneyNotice {
            id: stored_id,
            connection_id,
            dedupe_key: key,
            body: body.to_vec(),
            signature_state: signature.as_str().to_owned(),
            signature_header: signature_value.map(|value| value.chars().take(512).collect()),
            link_id,
            reference: read.reference.clone(),
            amount_minor: read.amount_minor,
            currency: read.currency.clone(),
            judgement: judgement_label.to_owned(),
        },
    )
    .await
    .map_err(internal)?;
    tx.commit().await.map_err(internal)?;
    Ok(NoticeOutcome {
        duplicate: !stored,
        judgement: judgement_label,
        link_id,
    })
}
