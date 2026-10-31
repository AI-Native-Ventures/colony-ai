//! The private Outreach channel: creation, one thread per contact, and relay-signed posts.
//!
//! Inbound and outbound WhatsApp messages and operator notices are ordinary relay-signed
//! kind 9 messages. They carry `wa*` tags so the desktop can show the contact (not the
//! relay) as the author and read the delivery state from the `thread` query.

use std::sync::Arc;

use chrono::{DateTime, Duration, Utc};
use nostr::{Event, EventBuilder, Kind, Tag};
use uuid::Uuid;

use buzz_core::channel::MemberRole;
use buzz_core::kind::KIND_STREAM_MESSAGE;
use buzz_core::TenantContext;
use buzz_db::channel::{ChannelType, ChannelVisibility};
use buzz_db::whatsapp::{WhatsappContact, WhatsappMessage};

use super::policy::{contact_label, e164};
use crate::state::AppState;

const CHANNEL_NAME: &str = "Outreach";
const CHANNEL_DESCRIPTION: &str =
    "WhatsApp outreach: one thread per contact. Owner, admins and agents only.";

/// Create the private Outreach channel when the company has none yet, and make sure the
/// owner and admins are in it. Returns the channel id.
pub async fn ensure_outreach_channel(
    state: &Arc<AppState>,
    tenant: &TenantContext,
    actor: &[u8],
) -> Result<Uuid, String> {
    let community = tenant.community();
    let settings = state
        .db
        .whatsapp_ensure_settings(community)
        .await
        .map_err(|error| format!("settings lookup failed: {error}"))?;
    let channel_id = match settings.outreach_channel_id {
        Some(id) => id,
        None => {
            let created = match state
                .db
                .create_channel(
                    community,
                    CHANNEL_NAME,
                    ChannelType::Stream,
                    ChannelVisibility::Private,
                    Some(CHANNEL_DESCRIPTION),
                    actor,
                    None,
                )
                .await
            {
                Ok(channel) => channel,
                // A channel called Outreach may already exist; take a distinct name.
                Err(_) => state
                    .db
                    .create_channel(
                        community,
                        &format!(
                            "{CHANNEL_NAME} {}",
                            &Uuid::new_v4().simple().to_string()[..6]
                        ),
                        ChannelType::Stream,
                        ChannelVisibility::Private,
                        Some(CHANNEL_DESCRIPTION),
                        actor,
                        None,
                    )
                    .await
                    .map_err(|error| format!("could not create the Outreach channel: {error}"))?,
            };
            state
                .db
                .whatsapp_set_outreach_channel(community, created.id)
                .await
                .map_err(|error| format!("could not remember the Outreach channel: {error}"))?;
            created.id
        }
    };

    let members = state
        .db
        .list_relay_members(community)
        .await
        .map_err(|error| format!("relay member lookup failed: {error}"))?;
    for member in members
        .iter()
        .filter(|member| member.role == "owner" || member.role == "admin")
    {
        let Ok(pubkey) = hex::decode(&member.pubkey) else {
            continue;
        };
        if pubkey.len() != 32 {
            continue;
        }
        let already = state
            .db
            .is_member(community, channel_id, &pubkey)
            .await
            .map_err(|error| format!("channel membership lookup failed: {error}"))?;
        if already {
            continue;
        }
        state
            .db
            .add_member(
                community,
                channel_id,
                &pubkey,
                MemberRole::Member,
                Some(actor),
            )
            .await
            .map_err(|error| format!("could not add an admin to Outreach: {error}"))?;
        state.invalidate_membership(tenant, channel_id, &pubkey);
    }
    if let Err(error) =
        crate::handlers::side_effects::emit_group_discovery_events(tenant, state, channel_id).await
    {
        tracing::warn!(%channel_id, "outreach channel discovery events failed: {error}");
    }
    Ok(channel_id)
}

/// A post whose wanted time is at most this old keeps it. The database refuses to commit a
/// channel event older than 960 s (`CREATED_AT_FLOOR_SECS`, the replica-fence floor), so this
/// leaves 360 s for the commit.
const KEEP_AGE_SECS: i64 = 600;
/// A post whose wanted time is older than [`KEEP_AGE_SECS`] is stamped with the start of the
/// five-minute bucket before the current one (so 300 to 600 s old). Every attempt inside one
/// bucket signs the same event, which keeps a repeated post idempotent.
const STALE_BUCKET_SECS: i64 = 300;

/// The time a Colony post must carry so the database accepts it: `wanted` while it is recent
/// enough, otherwise a deterministic recent bucket. A retry of an old message, or the first
/// post of a contact created long ago, would otherwise be refused for ever.
pub fn fence_safe_time(wanted: DateTime<Utc>, now: DateTime<Utc>) -> DateTime<Utc> {
    if now - wanted <= Duration::seconds(KEEP_AGE_SECS) {
        return wanted;
    }
    let bucket = now.timestamp().div_euclid(STALE_BUCKET_SECS) * STALE_BUCKET_SECS;
    DateTime::from_timestamp(bucket - STALE_BUCKET_SECS, 0).unwrap_or(now)
}

/// Content and tags of a contact's thread root. Deterministic for one contact while the
/// fence-safe time is (the contact's creation time while recent, else a five-minute bucket),
/// so two racing first messages sign the same event and the second insert is a no-op. A race
/// that straddles a bucket edge can sign two roots; [`ensure_thread_root`] keeps the one that
/// was recorded first.
pub fn thread_root_parts(
    contact: &WhatsappContact,
    now: DateTime<Utc>,
) -> (String, Vec<Vec<String>>, DateTime<Utc>) {
    let name = contact_label(&contact.display_name, &contact.wa_id);
    let content = format!("WhatsApp: {name} ({})", e164(&contact.wa_id));
    let tags = vec![
        vec!["wa".to_string(), contact.wa_id.clone()],
        vec!["wa-name".to_string(), name],
    ];
    (content, tags, fence_safe_time(contact.created_at, now))
}

/// Make sure the contact has its one thread and return the root event id (hex).
pub async fn ensure_thread_root(
    state: &Arc<AppState>,
    tenant: &TenantContext,
    channel_id: Uuid,
    contact: &WhatsappContact,
) -> Result<String, String> {
    if let Some(root) = contact.thread_root_event_id.as_ref() {
        return Ok(hex::encode(root));
    }
    let community = tenant.community();
    // The caller's copy may predate a racing first post: use the root that already won.
    let fresh = state
        .db
        .whatsapp_get_contact(community, &contact.wa_id)
        .await
        .map_err(|error| format!("contact lookup failed: {error}"))?;
    if let Some(root) = fresh
        .as_ref()
        .and_then(|fresh| fresh.thread_root_event_id.as_ref())
    {
        return Ok(hex::encode(root));
    }
    let (content, tags, created_at) =
        thread_root_parts(fresh.as_ref().unwrap_or(contact), Utc::now());
    let event = post_message(state, tenant, channel_id, None, content, tags, created_at).await?;
    let won = state
        .db
        .whatsapp_set_thread_root(community, &contact.wa_id, event.id.as_bytes())
        .await
        .map_err(|error| format!("could not remember the thread root: {error}"))?;
    if won {
        return Ok(event.id.to_hex());
    }
    // Lost the compare-and-set to a racing first post: every reply belongs under the winner.
    let winner = state
        .db
        .whatsapp_get_contact(community, &contact.wa_id)
        .await
        .map_err(|error| format!("contact lookup failed: {error}"))?
        .and_then(|contact| contact.thread_root_event_id)
        .ok_or_else(|| "the thread root vanished after a lost race".to_string())?;
    if winner.as_slice() != event.id.as_bytes() {
        tracing::warn!(%community, "whatsapp thread root race: an unused duplicate root was posted");
    }
    Ok(hex::encode(winner))
}

/// Post one relay-signed message. With `thread_root_hex` it is a reply in that thread,
/// otherwise a new top-level message. `p` tags in `extra_tags` are indexed as mentions in the
/// same transaction, which is what wakes the owning agent.
pub async fn post_message(
    state: &Arc<AppState>,
    tenant: &TenantContext,
    channel_id: Uuid,
    thread_root_hex: Option<&str>,
    content: String,
    extra_tags: Vec<Vec<String>>,
    created_at: DateTime<Utc>,
) -> Result<Event, String> {
    let community = tenant.community();
    let mut tags = vec![Tag::parse(["h", &channel_id.to_string()])
        .map_err(|error| format!("channel tag invalid: {error}"))?];
    let ancestry = match thread_root_hex {
        Some(root_hex) => {
            let ancestry = crate::handlers::ingest::resolve_relay_reply_thread_meta(
                community, root_hex, channel_id, state,
            )
            .await?;
            let root = ancestry.root_hex();
            let parent = ancestry.parent_hex();
            if root == parent {
                tags.push(
                    Tag::parse(["e", &root, "", "reply"])
                        .map_err(|error| format!("reply tag invalid: {error}"))?,
                );
            } else {
                tags.push(
                    Tag::parse(["e", &root, "", "root"])
                        .map_err(|error| format!("root tag invalid: {error}"))?,
                );
                tags.push(
                    Tag::parse(["e", &parent, "", "reply"])
                        .map_err(|error| format!("reply tag invalid: {error}"))?,
                );
            }
            Some(ancestry)
        }
        None => None,
    };
    for tag in extra_tags {
        tags.push(Tag::parse(tag).map_err(|error| format!("message tag invalid: {error}"))?);
    }
    // The database refuses an event older than the replica-fence floor, so a post that is
    // retried long after its message must be stamped inside it, and never before its root.
    let mut created_at = fence_safe_time(created_at, Utc::now());
    if let Some(root_at) = ancestry
        .as_ref()
        .map(|ancestry| ancestry.root_event_created_at)
    {
        created_at = created_at.max(root_at);
    }
    let timestamp = u64::try_from(created_at.timestamp())
        .map_err(|_| "message time predates the Unix epoch".to_string())?;
    let event = EventBuilder::new(Kind::from(KIND_STREAM_MESSAGE as u16), content)
        .tags(tags)
        .custom_created_at(nostr::Timestamp::from_secs(timestamp))
        .sign_with_keys(&state.relay_keypair)
        .map_err(|error| format!("could not sign the message: {error}"))?;

    let event_created_at =
        DateTime::<Utc>::from_timestamp(timestamp as i64, 0).unwrap_or(created_at);
    let owned_meta = match ancestry {
        Some(ancestry) => {
            ancestry.into_thread_meta(event.id.as_bytes().to_vec(), event_created_at, channel_id)
        }
        None => crate::handlers::ingest::ThreadMetadataOwned {
            event_id: event.id.as_bytes().to_vec(),
            event_created_at,
            channel_id,
            parent_event_id: None,
            parent_event_created_at: None,
            root_event_id: Some(event.id.as_bytes().to_vec()),
            root_event_created_at: Some(event_created_at),
            depth: 0,
            broadcast: false,
        },
    };

    let mut tx = state
        .db
        .begin_event_write_transaction()
        .await
        .map_err(|error| format!("could not begin the message write: {error}"))?;
    buzz_deletion::store(&state.db)
        .guard_transaction(&mut tx, community)
        .await
        .map_err(|error| format!("community writes are fenced: {error}"))?;
    let (stored, inserted) = buzz_db::event::insert_message_with_mentions_in_transaction(
        &mut tx,
        community,
        &event,
        channel_id,
        Some(owned_meta.as_params()),
    )
    .await
    .map_err(|error| format!("could not store the message: {error}"))?;
    tx.commit()
        .await
        .map_err(|error| format!("could not commit the message: {error}"))?;

    if inserted {
        crate::handlers::event::dispatch_persistent_event(
            tenant,
            state,
            &stored,
            KIND_STREAM_MESSAGE,
            &event.pubkey.to_hex(),
            None,
        )
        .await;
        if let Some(root) = owned_meta
            .root_event_id
            .as_ref()
            .filter(|_| thread_root_hex.is_some())
        {
            crate::handlers::side_effects::emit_live_thread_summary(
                tenant,
                state,
                channel_id,
                root.clone(),
            );
        }
    }
    Ok(event)
}

/// Tags of the Colony message that mirrors one WhatsApp message. The `p` tag on an inbound
/// message is what wakes the owning agent, so it is added only for an owner who can read the
/// channel.
pub fn message_tags(
    contact: &WhatsappContact,
    message: &WhatsappMessage,
    owner_in_channel: bool,
) -> Vec<Vec<String>> {
    let name = contact_label(&contact.display_name, &contact.wa_id);
    let direction = if message.direction == "out" {
        "out"
    } else {
        "in"
    };
    let mut tags = vec![
        vec!["wa".to_string(), contact.wa_id.clone()],
        vec!["wa-name".to_string(), name],
        vec!["wa-dir".to_string(), direction.to_string()],
    ];
    if direction == "out" {
        // The message id is what an owner decision names; a draft is flagged so the thread can
        // show an approve / edit / reject control on it.
        tags.push(vec!["wa-msg".to_string(), message.id.to_string()]);
        if message.state == "draft" {
            tags.push(vec!["wa-draft".to_string(), message.id.to_string()]);
        }
    }
    if let Some(wamid) = message.wamid.as_ref() {
        tags.push(vec!["wamid".to_string(), wamid.clone()]);
    }
    if let Some(lead) = contact.lead_id.as_ref() {
        tags.push(vec!["lead".to_string(), lead.clone()]);
    }
    if direction == "out" {
        if let Some(sender) = message.sender_pubkey.as_ref() {
            tags.push(vec!["wa-sender".to_string(), hex::encode(sender)]);
        }
    } else if let Some(owner) = contact.owner_pubkey.as_ref().filter(|_| owner_in_channel) {
        tags.push(vec!["p".to_string(), hex::encode(owner)]);
    }
    tags
}

/// Write the Colony message for a stored WhatsApp message into the contact's thread and
/// remember its event id. Safe to repeat: the event is deterministic.
pub async fn post_for_message(
    state: &Arc<AppState>,
    tenant: &TenantContext,
    channel_id: Uuid,
    contact: &WhatsappContact,
    message: &WhatsappMessage,
) -> Result<(), String> {
    let root_hex = ensure_thread_root(state, tenant, channel_id, contact).await?;
    let owner_in_channel = match contact.owner_pubkey.as_ref() {
        Some(owner) => state
            .db
            .is_member(tenant.community(), channel_id, owner)
            .await
            .unwrap_or(false),
        None => false,
    };
    let tags = message_tags(contact, message, owner_in_channel);
    let created_at = message.sent_at.unwrap_or(message.created_at);
    let event = post_message(
        state,
        tenant,
        channel_id,
        Some(&root_hex),
        message.body.clone(),
        tags,
        created_at,
    )
    .await?;
    state
        .db
        .whatsapp_set_message_event(tenant.community(), message.id, event.id.as_bytes())
        .await
        .map_err(|error| format!("could not remember the message event: {error}"))
}

/// Post an operator notice (token expired, quality change, contact paused, batch waiting).
/// Failure is logged, never fatal: a notice must not undo the work it reports.
pub async fn post_notice(state: &Arc<AppState>, tenant: &TenantContext, code: &str, text: &str) {
    let settings = match state.db.whatsapp_ensure_settings(tenant.community()).await {
        Ok(settings) => settings,
        Err(error) => {
            tracing::warn!("whatsapp notice settings lookup failed: {error}");
            return;
        }
    };
    let Some(channel_id) = settings.outreach_channel_id else {
        return;
    };
    let tags = vec![vec!["wa-notice".to_string(), code.to_string()]];
    if let Err(error) = post_message(
        state,
        tenant,
        channel_id,
        None,
        text.to_string(),
        tags,
        Utc::now(),
    )
    .await
    {
        tracing::warn!(code, "whatsapp notice post failed: {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn contact(name: &str) -> WhatsappContact {
        WhatsappContact {
            wa_id: "27821234567".into(),
            display_name: name.into(),
            lead_id: None,
            owner_pubkey: None,
            thread_root_event_id: None,
            last_inbound_at: None,
            last_outbound_at: None,
            outbound_since_inbound: 0,
            opted_out_at: None,
            opt_out_reason: None,
            paused_at: None,
            pause_reason: None,
            created_at: DateTime::from_timestamp(1_800_000_000, 0).expect("time"),
        }
    }

    fn at(secs: i64) -> DateTime<Utc> {
        DateTime::from_timestamp(secs, 0).expect("time")
    }

    #[test]
    fn thread_root_is_deterministic_for_one_contact() {
        let contact = contact("Thabo");
        let now = at(1_800_000_060);
        assert_eq!(
            thread_root_parts(&contact, now),
            thread_root_parts(&contact, now)
        );
        let (content, tags, root_at) = thread_root_parts(&contact, now);
        assert_eq!(content, "WhatsApp: Thabo (+27821234567)");
        assert!(tags.contains(&vec!["wa".to_string(), "27821234567".to_string()]));
        assert!(tags.contains(&vec!["wa-name".to_string(), "Thabo".to_string()]));
        // A recent contact keeps its creation time.
        assert_eq!(root_at.timestamp(), 1_800_000_000);
    }

    #[test]
    fn an_old_contacts_thread_root_is_stamped_inside_the_database_fence() {
        // GUARD: the root used to be signed with `contact.created_at` for ever, so a contact
        // created a day before its first post was refused by the 960 s fence on every retry.
        let contact = contact("Thabo");
        let now = at(1_800_000_000 + 86_400 + 137);
        let (_, _, root_at) = thread_root_parts(&contact, now);
        let age = now.timestamp() - root_at.timestamp();
        assert!((300..=600).contains(&age), "root age {age} s");
        assert!(age < buzz_db::replica_fence::CREATED_AT_FLOOR_SECS);
        assert!(
            KEEP_AGE_SECS + 300 <= buzz_db::replica_fence::CREATED_AT_FLOOR_SECS,
            "keep at least 300 s of the floor for the commit"
        );
        // Two racing first posts in the same bucket sign the same root.
        let racing = at(now.timestamp() + 60);
        assert_eq!(thread_root_parts(&contact, racing).2, root_at);
    }

    #[test]
    fn fence_safe_time_keeps_recent_times_and_buckets_old_ones() {
        let now = at(1_800_000_650);
        assert_eq!(fence_safe_time(now, now), now);
        assert_eq!(fence_safe_time(at(1_800_000_050), now), at(1_800_000_050));
        // Slightly in the future (clock skew) is kept as it is.
        assert_eq!(fence_safe_time(at(1_800_000_700), now), at(1_800_000_700));
        // Older than 600 s: the bucket before the current five-minute one.
        let stale = fence_safe_time(at(1_800_000_049), now);
        assert_eq!(stale, at(1_800_000_300));
        for age in [601, 3_600, 86_400, 30 * 86_400] {
            for jitter in 0..300 {
                let now = at(1_800_100_000 + jitter);
                let stamped = fence_safe_time(now - Duration::seconds(age), now);
                let gap = (now - stamped).num_seconds();
                assert!(
                    (300..=600).contains(&gap),
                    "age {age} jitter {jitter} gap {gap}"
                );
            }
        }
    }

    fn message(direction: &str) -> WhatsappMessage {
        WhatsappMessage {
            id: Uuid::nil(),
            wa_id: "27821234567".into(),
            direction: direction.into(),
            kind: "text".into(),
            body: "hello".into(),
            template_name: None,
            template_language: None,
            params: serde_json::json!([]),
            state: "received".into(),
            skip_reason: None,
            wamid: Some("wamid.X".into()),
            error_code: None,
            error_text: None,
            event_id: None,
            batch_id: None,
            batch_idx: None,
            new_chat: false,
            send_after: None,
            sender_pubkey: Some(vec![7; 32]),
            sent_at: None,
            created_at: DateTime::from_timestamp(1_800_000_000, 0).expect("time"),
        }
    }

    #[test]
    fn inbound_message_wakes_the_owning_agent_only_when_they_can_read_the_channel() {
        let mut owned = contact("Thabo");
        owned.owner_pubkey = Some(vec![9; 32]);
        owned.lead_id = Some("lead-1".into());
        let inbound = message("in");
        let with_owner = message_tags(&owned, &inbound, true);
        assert!(with_owner.contains(&vec!["p".to_string(), hex::encode([9u8; 32])]));
        assert!(with_owner.contains(&vec!["wa-dir".to_string(), "in".to_string()]));
        assert!(with_owner.contains(&vec!["wamid".to_string(), "wamid.X".to_string()]));
        assert!(with_owner.contains(&vec!["lead".to_string(), "lead-1".to_string()]));
        let without = message_tags(&owned, &inbound, false);
        assert!(!without.iter().any(|tag| tag[0] == "p"));
    }

    #[test]
    fn a_draft_is_flagged_so_the_thread_can_offer_approval() {
        let draft_message = {
            let mut m = message("out");
            m.state = "draft".into();
            m
        };
        let tags = message_tags(&contact("Thabo"), &draft_message, false);
        assert!(tags.contains(&vec!["wa-draft".to_string(), Uuid::nil().to_string()]));
        assert!(tags.contains(&vec!["wa-msg".to_string(), Uuid::nil().to_string()]));
        let sent = message_tags(&contact("Thabo"), &message("out"), false);
        assert!(!sent.iter().any(|tag| tag[0] == "wa-draft"));
    }

    #[test]
    fn outbound_message_names_its_sender_and_never_pings() {
        let mut owned = contact("Thabo");
        owned.owner_pubkey = Some(vec![9; 32]);
        let tags = message_tags(&owned, &message("out"), true);
        assert!(tags.contains(&vec!["wa-sender".to_string(), hex::encode([7u8; 32])]));
        assert!(tags.contains(&vec!["wa-dir".to_string(), "out".to_string()]));
        assert!(!tags.iter().any(|tag| tag[0] == "p"));
    }

    #[test]
    fn unnamed_contact_shows_their_number() {
        let now = at(1_800_000_060);
        let (content, tags, _) = thread_root_parts(&contact(""), now);
        assert_eq!(content, "WhatsApp: +27821234567 (+27821234567)");
        assert!(tags.contains(&vec!["wa-name".to_string(), "+27821234567".to_string()]));
    }

    #[test]
    fn a_dot_profile_name_is_no_name_in_the_root_and_in_message_tags() {
        // GUARD: the contact's WhatsApp profile name was ".", and the app showed ".".
        let now = at(1_800_000_060);
        let (content, tags, _) = thread_root_parts(&contact("."), now);
        assert_eq!(content, "WhatsApp: +27821234567 (+27821234567)");
        assert!(tags.contains(&vec!["wa-name".to_string(), "+27821234567".to_string()]));
        let message_tags = message_tags(&contact("."), &message("in"), false);
        assert!(message_tags.contains(&vec!["wa-name".to_string(), "+27821234567".to_string()]));
    }
}
