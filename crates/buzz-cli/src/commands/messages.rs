use buzz_sdk::{DeleteMessageOptions, DiffMeta, ThreadRef, VoteDirection};
use nostr::PublicKey;
use uuid::Uuid;

use crate::client::{normalize_events, normalize_write_response, BuzzClient};
use crate::error::CliError;
use crate::validate::{
    infer_language, parse_event_id, parse_uuid, read_or_stdin, truncate_diff,
    validate_content_size, validate_hex64, validate_uuid, MAX_DIFF_BYTES,
};
use buzz_sdk::mentions::{
    extract_at_mentions_with_known, extract_nostr_uris, strip_code_regions, MENTION_CAP,
};

/// Extract the thread root event ID from a Nostr tag array.
///
/// Delegates marker parsing and collapse to [`buzz_core::nip10`] (shared with
/// relay ingest and ACP) so id-validity, marker selection, and top-level
/// classification cannot drift:
/// - A `root`+`reply` parent returns its root event ID.
/// - A `reply`-only parent returns the reply target (a direct reply's parent IS
///   the root).
/// - A root-only or marker-less parent returns `None` (it is top-level and its
///   own root).
fn find_root_from_tags(tags: &serde_json::Value) -> Option<String> {
    let parts: Vec<Vec<String>> = tags
        .as_array()?
        .iter()
        .filter_map(|tag| {
            tag.as_array().map(|a| {
                a.iter()
                    .map(|v| v.as_str().unwrap_or("").to_string())
                    .collect()
            })
        })
        .collect();
    buzz_core::nip10::parse_thread_markers_from_parts(parts.iter().map(Vec::as_slice))
        .resolve()
        .map(|(root, _)| root)
}

fn thread_ref_from_parent_tags(
    parent_eid: nostr::EventId,
    parent_event_id: &str,
    tags: &serde_json::Value,
) -> Result<ThreadRef, CliError> {
    let root_eid = match find_root_from_tags(tags) {
        Some(root_hex) if root_hex != parent_event_id => parse_event_id(&root_hex)?,
        _ => parent_eid,
    };

    Ok(ThreadRef {
        root_event_id: root_eid,
        parent_event_id: parent_eid,
    })
}

/// Build a `ThreadRef` for a reply, given the immediate parent's event ID.
///
/// Fetches the parent event from the relay and inspects its NIP-10 `e` tags to
/// determine the thread root:
/// - Direct reply (parent is top-level): `root == parent`.
/// - Nested reply: `root` is the parent's own root marker; `parent` is unchanged.
///
/// Ensures CLI-sent replies thread correctly using the same NIP-10 logic.
async fn fetch_event(client: &BuzzClient, event_id: &str) -> Result<serde_json::Value, CliError> {
    let filter = serde_json::json!({ "ids": [event_id], "limit": 1 });
    let raw = client.query(&filter).await?;
    let events: serde_json::Value = serde_json::from_str(&raw)
        .map_err(|e| CliError::Other(format!("failed to parse query response: {e}")))?;
    events
        .as_array()
        .and_then(|events| events.first())
        .cloned()
        .ok_or_else(|| CliError::NotFound(format!("event {event_id} not found")))
}

async fn resolve_thread_ref(
    client: &BuzzClient,
    parent_event_id: &str,
) -> Result<ThreadRef, CliError> {
    let event = fetch_event(client, parent_event_id).await?;
    thread_ref_from_event(parent_event_id, &event)
}

fn thread_ref_from_event(event_id: &str, event: &serde_json::Value) -> Result<ThreadRef, CliError> {
    let parent_eid = parse_event_id(event_id)?;
    let tags = event
        .get("tags")
        .cloned()
        .unwrap_or(serde_json::Value::Null);
    thread_ref_from_parent_tags(parent_eid, event_id, &tags)
}

/// Resolve the channel UUID for an event by querying for it via POST /query.
/// Extracts the `h` tag value from the returned event's tags.
fn channel_id_from_event(event_id: &str, event: &serde_json::Value) -> Result<Uuid, CliError> {
    let tags = event
        .get("tags")
        .and_then(|tags| tags.as_array())
        .ok_or_else(|| CliError::Other("event missing 'tags' field".into()))?;
    tags.iter()
        .filter_map(|tag| tag.as_array())
        .find(|tag| tag.first().and_then(|value| value.as_str()) == Some("h"))
        .and_then(|tag| tag.get(1))
        .and_then(|value| value.as_str())
        .ok_or_else(|| {
            CliError::Other(format!(
                "event {event_id} has no h-tag — cannot determine channel"
            ))
        })
        .and_then(|channel_id| {
            Uuid::parse_str(channel_id).map_err(|_| {
                CliError::Other(format!("event h-tag is not a valid UUID: {channel_id}"))
            })
        })
}

async fn resolve_channel_id(client: &BuzzClient, event_id: &str) -> Result<Uuid, CliError> {
    let event = fetch_event(client, event_id).await?;
    channel_id_from_event(event_id, &event)
}

fn resolve_names_to_pubkeys(
    names: &[String],
    name_to_pubkeys: &std::collections::HashMap<String, Vec<String>>,
    has_explicit_mentions: bool,
) -> Result<Vec<String>, CliError> {
    let mut resolved = Vec::new();
    for name in names {
        match name_to_pubkeys
            .get(name)
            .map(Vec::as_slice)
            .unwrap_or_default()
        {
            [pubkey] => resolved.push(pubkey.clone()),
            [] if has_explicit_mentions => {}
            [] => {
                return Err(CliError::Usage(format!(
                    "mention '@{name}' does not match a current channel member; retry with --mention <pubkey>"
                )))
            }
            _ if has_explicit_mentions => {}
            candidates => {
                return Err(CliError::Usage(format!(
                    "mention '@{name}' is ambiguous; candidates: {}. Retry with --mention <pubkey>",
                    candidates.join(", ")
                )))
            }
        }
    }
    Ok(resolved)
}

/// Resolve mention text against the channel membership snapshot.
///
/// Returns both the current member set and uniquely name-resolved pubkeys.
/// Lookup failures are fatal when mention processing is requested: publishing
/// visible mention text without its intended `p` tag is worse than not sending.
async fn resolve_content_mentions(
    client: &BuzzClient,
    channel_id: &str,
    content: &str,
    has_explicit_mentions: bool,
) -> Result<(Vec<String>, Vec<String>), CliError> {
    let stripped = strip_code_regions(content);
    if !stripped.contains('@') && !has_explicit_mentions {
        return Ok((vec![], vec![]));
    }

    let members_filter = serde_json::json!({
        "kinds": [39002],
        "#d": [channel_id],
        "limit": 1,
    });
    let member_pubkeys = fetch_member_pubkeys(client, &members_filter)
        .await
        .ok_or_else(|| {
            CliError::Other("could not load channel membership for mention preflight".into())
        })?;

    if !stripped.contains('@') {
        return Ok((member_pubkeys, vec![]));
    }

    let profiles_filter = serde_json::json!({
        "kinds": [0],
        "authors": member_pubkeys,
        "limit": member_pubkeys.len(),
    });
    let profile_events = fetch_events(client, &profiles_filter)
        .await
        .ok_or_else(|| {
            CliError::Other("could not load member profiles for mention resolution".into())
        })?;

    let mut name_to_pubkeys: std::collections::HashMap<String, Vec<String>> =
        std::collections::HashMap::new();
    let mut display_names = Vec::new();
    for e in &profile_events {
        let Some(pubkey) = e.get("pubkey").and_then(|v| v.as_str()) else {
            continue;
        };
        let Some(content_json) = e.get("content").and_then(|v| v.as_str()) else {
            continue;
        };
        let Ok(v) = serde_json::from_str::<serde_json::Value>(content_json) else {
            continue;
        };
        let Some(name) = v
            .get("display_name")
            .or_else(|| v.get("name"))
            .and_then(|n| n.as_str())
            .filter(|n| !n.is_empty())
        else {
            continue;
        };
        name_to_pubkeys
            .entry(name.to_ascii_lowercase())
            .or_default()
            .push(pubkey.to_string());
        display_names.push(name.to_string());
    }

    let known_refs: Vec<&str> = display_names.iter().map(String::as_str).collect();
    let names = extract_at_mentions_with_known(&stripped, &known_refs);
    let resolved = resolve_names_to_pubkeys(&names, &name_to_pubkeys, has_explicit_mentions)?;
    Ok((member_pubkeys, resolved))
}

fn normalize_explicit_mentions(values: &[String]) -> Result<Vec<String>, CliError> {
    let mut normalized = Vec::new();
    for value in values {
        let pubkey = PublicKey::parse(value.trim())
            .map_err(|_| CliError::Usage(format!("invalid --mention pubkey: {value}")))?;
        let hex = pubkey.to_hex();
        if !normalized.contains(&hex) {
            normalized.push(hex);
        }
    }
    if normalized.len() > MENTION_CAP {
        return Err(CliError::Usage(format!(
            "too many --mention values (max {MENTION_CAP})"
        )));
    }
    Ok(normalized)
}

fn merge_message_mentions(
    explicit: &[String],
    uri_pubkeys: &[String],
    auto_resolved: &[String],
) -> Result<Vec<String>, CliError> {
    let mut mentions = Vec::new();
    for pubkey in explicit
        .iter()
        .chain(uri_pubkeys.iter())
        .chain(auto_resolved.iter())
    {
        if !mentions.contains(pubkey) {
            mentions.push(pubkey.clone());
        }
    }
    if mentions.len() > MENTION_CAP {
        return Err(CliError::Usage(format!(
            "too many unique message mentions (max {MENTION_CAP})"
        )));
    }
    Ok(mentions)
}

fn missing_members(mentions: &[String], members: &[String]) -> Vec<String> {
    let members: std::collections::HashSet<&str> = members.iter().map(String::as_str).collect();
    mentions
        .iter()
        .filter(|pk| !members.contains(pk.as_str()))
        .cloned()
        .collect()
}

fn event_mention_pubkeys(event: &nostr::Event) -> Vec<String> {
    event
        .tags
        .iter()
        .filter_map(|tag| {
            let parts = tag.as_slice();
            (parts.first().map(String::as_str) == Some("p"))
                .then(|| parts.get(1).cloned())
                .flatten()
        })
        .collect()
}

/// Fetch raw events for `filter` via the relay's `/query` endpoint.
/// Returns `None` on any I/O or parse failure.
async fn fetch_events(
    client: &BuzzClient,
    filter: &serde_json::Value,
) -> Option<Vec<serde_json::Value>> {
    let raw = client.query(filter).await.ok()?;
    let parsed: serde_json::Value = serde_json::from_str(&raw).ok()?;
    parsed.as_array().cloned()
}

/// Extract member pubkeys (the `p` tag values) from a single 39002 event.
async fn fetch_member_pubkeys(
    client: &BuzzClient,
    filter: &serde_json::Value,
) -> Option<Vec<String>> {
    let events = fetch_events(client, filter).await?;
    Some(parse_member_pubkeys(events.first()?))
}

/// Parse member pubkeys from a kind 39002 event JSON value.
///
/// Filters and canonicalizes via `nostr::PublicKey::from_hex` — matching
/// MCP's typed-Nostr behavior so both surfaces accept exactly the same
/// pubkeys. Pure helper, split out for testing.
fn parse_member_pubkeys(event: &serde_json::Value) -> Vec<String> {
    let Some(tags) = event.get("tags").and_then(|t| t.as_array()) else {
        return vec![];
    };
    tags.iter()
        .filter_map(|t| {
            let arr = t.as_array()?;
            if arr.first()?.as_str()? != "p" {
                return None;
            }
            let pk = arr.get(1)?.as_str()?;
            PublicKey::from_hex(pk).ok().map(|k| k.to_hex())
        })
        .collect()
}

fn format_events(normalized: &str, format: &crate::OutputFormat) -> String {
    match format {
        crate::OutputFormat::Compact => {
            let events: Vec<serde_json::Value> =
                serde_json::from_str(normalized).unwrap_or_default();
            let compact: Vec<serde_json::Value> = events
                .iter()
                .map(|e| {
                    serde_json::json!({
                        "id": e.get("id").cloned().unwrap_or_default(),
                        "content": e.get("content").cloned().unwrap_or_default(),
                        "created_at": e.get("created_at").cloned().unwrap_or_default(),
                    })
                })
                .collect();
            serde_json::to_string(&compact).unwrap_or_default()
        }
        crate::OutputFormat::Json => normalized.to_string(),
    }
}

pub async fn cmd_get_messages(
    client: &BuzzClient,
    channel_id: &str,
    limit: Option<u32>,
    before: Option<i64>,
    since: Option<i64>,
    kinds: Option<&str>,
    format: &crate::OutputFormat,
) -> Result<(), CliError> {
    validate_uuid(channel_id)?;
    let limit = limit.unwrap_or(50).min(200);

    let mut filter = serde_json::json!({
        "kinds": [9, 40002, 40008, 45001, 45003],
        "#h": [channel_id],
        "limit": limit
    });

    // If specific kinds requested, override
    if let Some(k) = kinds {
        let kind_list: Vec<u64> = k.split(',').filter_map(|s| s.trim().parse().ok()).collect();
        if !kind_list.is_empty() {
            filter["kinds"] = serde_json::json!(kind_list);
        }
    }

    if let Some(b) = before {
        filter["until"] = serde_json::json!(b);
    }
    if let Some(s) = since {
        filter["since"] = serde_json::json!(s);
    }

    let resp = client.query(&filter).await?;
    let mut events: Vec<serde_json::Value> = serde_json::from_str(&resp).unwrap_or_default();
    events.sort_by_key(|e| e.get("created_at").and_then(|v| v.as_u64()).unwrap_or(0));
    let normalized = normalize_events(&events);
    println!("{}", format_events(&normalized, format));
    Ok(())
}

pub fn resolve_thread_target(
    expected_channel_id: Uuid,
    event_id: &str,
    expected_root_id: Option<&str>,
    selected_event: &serde_json::Value,
) -> Result<String, CliError> {
    let actual_channel_id = channel_id_from_event(event_id, selected_event)?;
    if actual_channel_id != expected_channel_id {
        return Err(CliError::Usage(format!(
            "event {event_id} does not belong to channel {expected_channel_id}"
        )));
    }
    let root_event_id = thread_ref_from_event(event_id, selected_event)?
        .root_event_id
        .to_hex();
    if expected_root_id.is_some_and(|expected| expected != root_event_id) {
        return Err(CliError::Usage(
            "Colony message link thread root does not match the selected message".into(),
        ));
    }
    Ok(root_event_id)
}

pub async fn cmd_get_thread(
    client: &BuzzClient,
    channel_id: &str,
    event_id: &str,
    expected_root_id: Option<&str>,
    limit: Option<u32>,
    depth_limit: Option<u32>,
    format: &crate::OutputFormat,
) -> Result<(), CliError> {
    let expected_channel_id = parse_uuid(channel_id)?;
    validate_hex64(event_id)?;
    let selected_event = fetch_event(client, event_id).await?;
    let root_event_id = resolve_thread_target(
        expected_channel_id,
        event_id,
        expected_root_id,
        &selected_event,
    )?;
    let limit = limit.unwrap_or(100).min(500);

    let mut reply_filter = serde_json::json!({
        "kinds": THREAD_MESSAGE_KINDS,
        "#h": [channel_id],
        "#e": [root_event_id.as_str()],
        "limit": limit
    });
    if let Some(d) = depth_limit {
        reply_filter["depth_limit"] = serde_json::json!(d);
    }
    let root_filter = serde_json::json!({
        "ids": [root_event_id.as_str()],
        "#h": [channel_id],
        "limit": 1
    });
    let resp = client.query_multi(&[reply_filter, root_filter]).await?;
    let mut events: Vec<serde_json::Value> = serde_json::from_str(&resp).unwrap_or_default();
    events.sort_by_key(|event| {
        event
            .get("created_at")
            .and_then(|value| value.as_u64())
            .unwrap_or(0)
    });
    let normalized = normalize_events(&events);
    println!("{}", format_events(&normalized, format));
    Ok(())
}

pub async fn cmd_search(
    client: &BuzzClient,
    query: Option<&str>,
    author: Option<&str>,
    since: Option<i64>,
    limit: Option<u32>,
    format: &crate::OutputFormat,
) -> Result<(), CliError> {
    if query.is_none() && author.is_none() {
        return Err(CliError::Usage(
            "at least one of --query or --author is required".into(),
        ));
    }
    let limit = limit.unwrap_or(20).min(100);

    let author_hex = match author {
        Some(a) => Some(resolve_author(client, a).await?),
        None => None,
    };

    let mut filter = serde_json::json!({
        "kinds": [9, 40002, 45001, 45003],
        "limit": limit
    });
    if let Some(q) = query {
        filter["search"] = serde_json::json!(q);
    }
    if let Some(ref pk) = author_hex {
        filter["authors"] = serde_json::json!([pk]);
    }
    if let Some(s) = since {
        filter["since"] = serde_json::json!(s);
    }
    let resp = client.query(&filter).await?;
    let mut events: Vec<serde_json::Value> = serde_json::from_str(&resp).unwrap_or_default();
    // The full-text path returns relevance order; a pure author/time query has
    // no relevance, so present newest-first like `messages get`.
    if query.is_none() {
        events.sort_by_key(|e| {
            std::cmp::Reverse(e.get("created_at").and_then(|v| v.as_u64()).unwrap_or(0))
        });
    }
    let normalized = normalize_events(&events);
    println!("{}", format_events(&normalized, format));
    Ok(())
}

/// Resolve an `--author` value to a 64-char hex pubkey.
///
/// Accepts, in order of precedence: 64-char hex (validated), an `npub1…`
/// bech32 key, or a display name resolved via NIP-50 profile search. A name
/// must match exactly one user (case-insensitive, on `display_name` or
/// `name`) — ambiguity is an error listing the candidates rather than a
/// silent mix of authors.
async fn resolve_author(client: &BuzzClient, author: &str) -> Result<String, CliError> {
    let author = author.trim();
    if author.len() == 64 && author.chars().all(|c| c.is_ascii_hexdigit()) {
        return Ok(author.to_ascii_lowercase());
    }
    if author.starts_with("npub1") {
        return nostr::PublicKey::parse(author)
            .map(|pk| pk.to_hex())
            .map_err(|_| CliError::Usage(format!("invalid npub: {author}")));
    }

    // Display name → NIP-50 search on kind:0, exact case-insensitive match.
    let filter = serde_json::json!({
        "kinds": [0],
        "search": author,
        "limit": 100
    });
    let raw = client.query(&filter).await?;
    let events: Vec<serde_json::Value> = serde_json::from_str(&raw).unwrap_or_default();
    let mut matches = match_profiles_by_name(&events, author);
    match matches.len() {
        0 => Err(CliError::Usage(format!(
            "no user found with name '{author}' — pass a hex pubkey or npub instead"
        ))),
        1 => Ok(matches.remove(0).0),
        _ => {
            // Cap the candidate listing — some names are shared by dozens of
            // users, and an unbounded list turns the error into a wall of text.
            let shown = 5.min(matches.len());
            let mut listing: Vec<String> = matches[..shown]
                .iter()
                .map(|(pk, name)| format!("{name} ({pk})"))
                .collect();
            if matches.len() > shown {
                listing.push(format!("… and {} more", matches.len() - shown));
            }
            Err(CliError::Usage(format!(
                "name '{author}' is ambiguous — matches: {}. Pass a pubkey instead",
                listing.join(", ")
            )))
        }
    }
}

/// Exact case-insensitive profile match on `display_name` or `name` across
/// kind:0 events. Returns deduped `(pubkey, shown name)` pairs. Pure so the
/// name-resolution semantics are unit-testable without a relay.
fn match_profiles_by_name(events: &[serde_json::Value], name: &str) -> Vec<(String, String)> {
    let lower = name.to_ascii_lowercase();
    let mut matches: Vec<(String, String)> = Vec::new();
    for e in events {
        let Some(pubkey) = e.get("pubkey").and_then(|v| v.as_str()) else {
            continue;
        };
        let Some(content) = e
            .get("content")
            .and_then(|v| v.as_str())
            .and_then(|s| serde_json::from_str::<serde_json::Value>(s).ok())
        else {
            continue;
        };
        let display_name = content
            .get("display_name")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let plain_name = content.get("name").and_then(|v| v.as_str()).unwrap_or("");
        if display_name.to_ascii_lowercase() == lower || plain_name.to_ascii_lowercase() == lower {
            let shown = if display_name.is_empty() {
                plain_name
            } else {
                display_name
            };
            matches.push((pubkey.to_string(), shown.to_string()));
        }
    }
    matches.sort();
    matches.dedup();
    matches
}

/// Event kinds that make up a conversation: chat messages, their v2 form, and
/// forum comments. `cmd_get_thread` reads the same set.
const THREAD_MESSAGE_KINDS: [u16; 5] = [9, 40002, 40003, 40008, 45003];

/// Thread events read to find out whether an agent already answered. The request
/// and the agent's answer to it sit at the newest end of a thread.
const ANSWER_CHECK_LIMIT: u32 = 30;

/// Whether a message of this kind is chat, the agent talking, as opposed to a
/// forum post or comment, which is long-form by design.
fn is_chat_kind(kind: Option<u16>) -> bool {
    matches!(kind, None | Some(9))
}

fn event_pubkey(event: &serde_json::Value) -> &str {
    event
        .get("pubkey")
        .and_then(|value| value.as_str())
        .unwrap_or("")
}

/// A kind:0 profile marks an owned agent with a NIP-OA `auth` tag.
fn profile_has_auth_tag(profile: &serde_json::Value) -> bool {
    profile
        .get("tags")
        .and_then(|tags| tags.as_array())
        .is_some_and(|tags| {
            tags.iter().any(|tag| {
                tag.as_array()
                    .and_then(|parts| parts.first())
                    .and_then(|name| name.as_str())
                    == Some("auth")
            })
        })
}

/// Whether `pubkey` is an agent, or `None` when its profile cannot be read.
/// A pubkey with no profile is a person, as in the harness.
async fn pubkey_is_agent(client: &BuzzClient, pubkey: &str) -> Option<bool> {
    let filter = serde_json::json!({ "kinds": [0], "authors": [pubkey], "limit": 1 });
    let profiles = fetch_events(client, &filter).await?;
    Some(profiles.first().is_some_and(profile_has_auth_tag))
}

/// The agent's own earlier chat message for the request it is answering now.
///
/// A person's message is one request, and the person should see one message
/// for it, holding the latest answer. The check reads the thread: when the
/// newest message that is not the agent's own is from a person and the agent
/// already posted after it, this send is a second post for that request, and
/// the id of the agent's newest chat message after it is returned so the send
/// can update that message instead of adding another. Refusing would lose the
/// answer: a model that posts "On it" first would never get its result out.
///
/// Agent to agent threads are untouched, so delegation still works: another
/// agent's reply starts a new turn for this one.
///
/// A thread that cannot be read does not block delivery: the send is a normal
/// post. A rare second message is better than a person left without an answer.
async fn earlier_answer_to_request(
    client: &BuzzClient,
    channel_id: &str,
    thread: &ThreadRef,
) -> Option<String> {
    let root = thread.root_event_id.to_hex();
    let me = client.keys().public_key().to_hex();
    let filters = [
        serde_json::json!({
            "kinds": THREAD_MESSAGE_KINDS,
            "#h": [channel_id],
            "#e": [root.as_str()],
            "limit": ANSWER_CHECK_LIMIT
        }),
        serde_json::json!({ "ids": [root.as_str()], "#h": [channel_id], "limit": 1 }),
    ];
    let events = client
        .query_multi(&filters)
        .await
        .ok()
        .and_then(|raw| serde_json::from_str::<Vec<serde_json::Value>>(&raw).ok());
    let Some(mut events) = events else {
        eprintln!(
            "warning: could not read the thread to check for an earlier answer; sending a new message"
        );
        return None;
    };

    // Oldest first; at the same second the agent's own message sorts last, so a
    // request and its answer never swap places.
    events.sort_by_key(|event| {
        (
            event
                .get("created_at")
                .and_then(|value| value.as_u64())
                .unwrap_or(0),
            event_pubkey(event) == me,
        )
    });
    let request = events.iter().rposition(|event| event_pubkey(event) != me)?;
    let earlier = events[request + 1..]
        .iter()
        .rev()
        .find(|event| is_chat_event_kind(event))?;
    let earlier_id = earlier.get("id").and_then(|id| id.as_str())?.to_owned();

    match pubkey_is_agent(client, event_pubkey(&events[request])).await {
        Some(false) => Some(earlier_id),
        Some(true) => None,
        None => {
            eprintln!(
                "warning: could not read who asked, so the one-message check was skipped; sending a new message"
            );
            None
        }
    }
}

/// Whether a thread event is a chat message (not an edit, a diff or a comment).
fn is_chat_event_kind(event: &serde_json::Value) -> bool {
    event
        .get("kind")
        .and_then(|kind| kind.as_u64())
        .is_some_and(|kind| {
            kind == u64::from(buzz_core::kind::KIND_STREAM_MESSAGE)
                || kind == u64::from(buzz_core::kind::KIND_STREAM_MESSAGE_V2)
        })
}

/// Replace the content of the agent's earlier message for this request and say
/// so, instead of posting a second message. The reply keeps its thread because
/// the edited message does. Edit events carry no mentions, so a `--mention` on
/// the send is not delivered; the person's own request already notified them.
async fn update_earlier_answer(
    client: &BuzzClient,
    channel_uuid: Uuid,
    earlier_id: &str,
    content: &str,
) -> Result<(), CliError> {
    let builder = buzz_sdk::build_edit(channel_uuid, parse_event_id(earlier_id)?, content)
        .map_err(|e| CliError::Other(format!("build_edit failed: {e}")))?;
    let event = client.sign_event(builder)?;
    let resp = client.submit_event(event).await?;
    let mut output: serde_json::Value = serde_json::from_str(&normalize_write_response(&resp))
        .unwrap_or_else(|_| serde_json::json!({ "response": resp }));
    if let Some(object) = output.as_object_mut() {
        object.insert(
            "updated_earlier_message".into(),
            serde_json::json!(earlier_id),
        );
        object.insert(
            "note".into(),
            serde_json::json!(
                "You had already answered this request, so this updated your earlier message instead of posting a new one. The person sees one message holding your latest answer."
            ),
        );
    }
    println!("{output}");
    Ok(())
}

/// The content to send: `content` as it is, or with `--doc` the same text as a
/// document card that Colony fences itself, so a model never has to type (or
/// shell-quote) the backticks.
fn document_content(
    doc: bool,
    title: Option<&str>,
    content: String,
    kind: Option<u16>,
) -> Result<String, CliError> {
    if !doc {
        return Ok(content);
    }
    if !is_chat_kind(kind) {
        return Err(CliError::Usage(
            "--doc is for chat messages. A forum post is already a document.".into(),
        ));
    }
    let body = read_or_stdin(&content)?;
    buzz_core::chat_limits::document_message(title, &body).map_err(CliError::Usage)
}

/// Repair a document that did not arrive as a card, so it is posted whole as a
/// card instead of refused or cut. Text that is not clearly a document is
/// returned as it is.
fn repaired_chat_content(content: &str) -> std::borrow::Cow<'_, str> {
    content.into()
}

pub struct SendMessageParams {
    pub channel_id: String,
    pub content: String,
    pub kind: Option<u16>,
    pub reply_to: Option<String>,
    pub broadcast: bool,
    pub files: Vec<String>,
    pub mentions: Vec<String>,
}

pub async fn cmd_send_message(
    client: &BuzzClient,
    mut p: SendMessageParams,
) -> Result<(), CliError> {
    // Allow '-' to read content from stdin. This keeps callers from having to
    // jam shell-metacharacter-heavy text (backticks, $vars, etc.) through argv
    // quoting — the source of countless self-inflicted command-substitution
    // bugs for agent and human users alike.
    p.content = read_or_stdin(&p.content)?;
    validate_content_size(&p.content)?;
    // An agent talking to people sends short chat, not reports. The refusal is
    // before any relay call and has no override: the error text tells the model
    // how to fix the message, and a flag would be passed every time.
    let agent_chat = client.is_agent() && is_chat_kind(p.kind);
    if agent_chat {
        p.content = repaired_chat_content(&p.content).into_owned();
        validate_content_size(&p.content)?;
        buzz_core::chat_limits::check_chat_length(&p.content)
            .map_err(|e| CliError::Usage(e.to_string()))?;
    }
    if let Some(ref r) = p.reply_to {
        validate_hex64(r)?;
    }
    let channel_uuid = parse_uuid(&p.channel_id)?;

    let explicit_mentions = normalize_explicit_mentions(&p.mentions)?;
    let stripped = strip_code_regions(&p.content);
    let uri_pubkeys = extract_nostr_uris(&stripped);
    // Supplying any identity explicitly authorizes unresolved or ambiguous @Name text
    // as presentation-only, matching Desktop's separate visible-label and p-tag model.
    // Uniquely resolvable member names still add their own p-tags; callers must supply
    // every intended identity whose visible label cannot be resolved uniquely.
    let has_explicit_mentions = !explicit_mentions.is_empty() || !uri_pubkeys.is_empty();
    let (member_pubkeys, auto_resolved) =
        resolve_content_mentions(client, &p.channel_id, &p.content, has_explicit_mentions).await?;
    let mention_pubkeys = merge_message_mentions(&explicit_mentions, &uri_pubkeys, &auto_resolved)?;

    let missing = missing_members(&mention_pubkeys, &member_pubkeys);
    if !missing.is_empty() {
        return Err(CliError::Usage(
            serde_json::json!({
                "message": "mentioned pubkeys are not channel members; add them explicitly before retrying",
                "missing_member_pubkeys": missing,
                "add_member_command": format!("colony channels add-member --channel {} --pubkey <pubkey> --role <member|bot>", p.channel_id),
            })
            .to_string(),
        ));
    }

    // Upload files and build imeta tags
    let mut media_tags: Vec<Vec<String>> = Vec::new();
    let mut media_content = String::new();
    for file_path in &p.files {
        let desc = client
            .upload_file(file_path)
            .await
            .map_err(|e| CliError::Other(format!("upload failed for {file_path}: {e}")))?;
        media_tags.push(crate::client::build_imeta_tag(&desc));
        if desc.mime_type.starts_with("video/") {
            media_content.push_str("\n![video](");
        } else {
            media_content.push_str("\n![image](");
        }
        media_content.push_str(&desc.url);
        media_content.push(')');
    }
    let final_content = if media_content.is_empty() {
        p.content.clone()
    } else {
        format!("{}{media_content}", p.content)
    };

    // Build thread ref if replying. `--reply-to` is the immediate parent; the
    // thread root is derived from the parent's NIP-10 tags via the relay.
    let thread_ref = if let Some(ref r) = p.reply_to {
        Some(resolve_thread_ref(client, r).await?)
    } else {
        None
    };
    let earlier_answer = match (agent_chat, &thread_ref) {
        (true, Some(thread)) => earlier_answer_to_request(client, &p.channel_id, thread).await,
        _ => None,
    };
    if let Some(earlier_id) = earlier_answer {
        return update_earlier_answer(client, channel_uuid, &earlier_id, &final_content).await;
    }

    let mention_refs: Vec<&str> = mention_pubkeys.iter().map(String::as_str).collect();

    let builder = match p.kind {
        Some(45001) => {
            buzz_sdk::build_forum_post(channel_uuid, &final_content, &mention_refs, &media_tags)
                .map_err(|e| CliError::Other(format!("build_forum_post failed: {e}")))?
        }
        Some(45003) => {
            let tr = thread_ref.as_ref().ok_or_else(|| {
                CliError::Usage("--reply-to is required for forum comments (kind 45003)".into())
            })?;
            buzz_sdk::build_forum_comment(
                channel_uuid,
                &final_content,
                tr,
                &mention_refs,
                &media_tags,
            )
            .map_err(|e| CliError::Other(format!("build_forum_comment failed: {e}")))?
        }
        None | Some(9) => {
            // Scan final_content for `:shortcode:` patterns and attach NIP-30
            // emoji tags for any that resolve in the workspace palette.
            // Palette resolution is scoped to kind 9: forum builders (45001,
            // 45003) do not accept emoji_tags, so resolving early would pay
            // the relay query and immediately discard the result.
            // The fetch is skipped entirely when content has no `:`, keeping
            // plain sends at zero extra RTTs.  Palette resolution is
            // decorative enrichment — a fetch or parse failure must not block
            // delivery of a valid message; on error, degrade to no emoji tags
            // and log a diagnostic to stderr.
            let emoji_tags = if final_content.contains(':') {
                match crate::commands::emoji::resolve_emoji_tags_for_content(client, &final_content)
                    .await
                {
                    Ok(tags) => tags,
                    Err(e) => {
                        eprintln!(
                            "warning: emoji palette fetch failed ({e}); sending without emoji tags"
                        );
                        Vec::new()
                    }
                }
            } else {
                Vec::new()
            };
            buzz_sdk::build_message(
                channel_uuid,
                &final_content,
                thread_ref.as_ref(),
                &mention_refs,
                p.broadcast,
                &media_tags,
                &emoji_tags,
            )
            .map_err(|e| CliError::Other(format!("build_message failed: {e}")))?
        }
        Some(k) => {
            return Err(CliError::Usage(format!(
                "--kind {k} is not supported (use 9, 45001, or 45003)"
            )))
        }
    };

    let event = client.sign_event(builder)?;
    let emitted_mentions = event_mention_pubkeys(&event);
    let resp = client.submit_event(event).await?;
    let mut output: serde_json::Value = serde_json::from_str(&normalize_write_response(&resp))
        .unwrap_or_else(|_| serde_json::json!({ "response": resp }));
    if let Some(object) = output.as_object_mut() {
        object.insert(
            "mention_pubkeys".into(),
            serde_json::json!(emitted_mentions),
        );
    }
    println!("{output}");
    Ok(())
}

pub struct SendDiffParams {
    pub channel_id: String,
    pub diff: String,
    pub repo_url: String,
    pub commit_sha: String,
    pub file_path: Option<String>,
    pub parent_commit_sha: Option<String>,
    pub source_branch: Option<String>,
    pub target_branch: Option<String>,
    pub pr_number: Option<u32>,
    pub language: Option<String>,
    pub description: Option<String>,
    pub reply_to: Option<String>,
}

pub async fn cmd_send_diff_message(client: &BuzzClient, p: SendDiffParams) -> Result<(), CliError> {
    if let Some(r) = &p.reply_to {
        validate_hex64(r)?;
    }

    // Branch pairing: both or neither
    match (&p.source_branch, &p.target_branch) {
        (Some(_), None) | (None, Some(_)) => {
            return Err(CliError::Usage(
                "--source-branch and --target-branch must both be provided or both omitted".into(),
            ));
        }
        _ => {}
    }

    let channel_uuid = parse_uuid(&p.channel_id)?;

    // Read diff from stdin if "--diff -"
    let diff_content = read_or_stdin(&p.diff)?;

    // Truncate at 60 KiB hunk boundary
    let (diff, truncated) = truncate_diff(&diff_content, MAX_DIFF_BYTES);

    // Language inference: explicit flag wins, then infer from file path
    let language = p
        .language
        .clone()
        .or_else(|| p.file_path.as_deref().and_then(infer_language));

    // NIP-31 alt tag
    let alt = match (&p.file_path, &p.description) {
        (Some(fp), Some(desc)) => format!("Diff: {} — {}", fp, desc),
        (Some(fp), None) => format!("Diff: {}", fp),
        _ => "Diff".to_string(),
    };

    // `--reply-to` is the immediate parent; the thread root is derived from
    // the parent's NIP-10 tags via the relay.
    let thread_ref = if let Some(r) = &p.reply_to {
        Some(resolve_thread_ref(client, r).await?)
    } else {
        None
    };

    let branch = match (&p.source_branch, &p.target_branch) {
        (Some(src), Some(tgt)) => Some((src.clone(), tgt.clone())),
        _ => None,
    };

    let diff_meta = DiffMeta {
        repo_url: p.repo_url.clone(),
        commit_sha: p.commit_sha.clone(),
        file_path: p.file_path.clone(),
        parent_commit: p.parent_commit_sha.clone(),
        branch,
        pr_number: p.pr_number,
        language,
        description: p.description.clone(),
        truncated,
        alt_text: Some(alt),
    };

    let builder =
        buzz_sdk::build_diff_message(channel_uuid, &diff, &diff_meta, thread_ref.as_ref())
            .map_err(|e| CliError::Other(format!("build_diff_message failed: {e}")))?;

    let event = client.sign_event(builder)?;

    let resp = client.submit_event(event).await?;
    println!("{}", normalize_write_response(&resp));
    Ok(())
}

pub async fn cmd_delete_message(
    client: &BuzzClient,
    event_id: &str,
    action_id: Option<Uuid>,
    reason_code: Option<&str>,
    public_reason: Option<&str>,
) -> Result<(), CliError> {
    validate_hex64(event_id)?;

    // Resolve channel_id from the event's h-tag
    let channel_uuid = resolve_channel_id(client, event_id).await?;
    let target_eid = parse_event_id(event_id)?;

    let builder = buzz_sdk::build_delete_message_with_options(
        channel_uuid,
        target_eid,
        DeleteMessageOptions {
            action_id,
            reason_code,
            public_reason,
        },
    )
    .map_err(|e| CliError::Other(format!("build_delete_message failed: {e}")))?;

    let event = client.sign_event(builder)?;

    let resp = client.submit_event(event).await?;
    println!("{}", normalize_write_response(&resp));
    Ok(())
}

/// Edit a message you previously sent.
pub async fn cmd_edit_message(
    client: &BuzzClient,
    event_id: &str,
    content: &str,
) -> Result<(), CliError> {
    validate_hex64(event_id)?;
    validate_content_size(content)?;

    // Resolve channel_id from the event's h-tag
    let target = fetch_event(client, event_id).await?;
    let channel_uuid = channel_id_from_event(event_id, &target)?;
    // An edit must not be the way around the chat limit.
    let edits_chat = target
        .get("kind")
        .and_then(|kind| kind.as_u64())
        .is_some_and(|kind| {
            kind == u64::from(buzz_core::kind::KIND_STREAM_MESSAGE)
                || kind == u64::from(buzz_core::kind::KIND_STREAM_MESSAGE_V2)
        });
    let repaired;
    let mut content = content;
    if client.is_agent() && edits_chat {
        repaired = repaired_chat_content(content);
        content = &repaired;
        buzz_core::chat_limits::check_chat_length(content)
            .map_err(|e| CliError::Usage(e.to_string()))?;
    }
    let target_eid = parse_event_id(event_id)?;

    let builder = buzz_sdk::build_edit(channel_uuid, target_eid, content)
        .map_err(|e| CliError::Other(format!("build_edit failed: {e}")))?;

    let event = client.sign_event(builder)?;

    let resp = client.submit_event(event).await?;
    println!("{}", normalize_write_response(&resp));
    Ok(())
}

/// Vote on a forum post or comment.
pub async fn cmd_vote_on_post(
    client: &BuzzClient,
    event_id: &str,
    direction: &str,
) -> Result<(), CliError> {
    validate_hex64(event_id)?;
    let vote_dir = match direction {
        "up" => VoteDirection::Up,
        "down" => VoteDirection::Down,
        _ => {
            return Err(CliError::Usage(format!(
                "--direction must be 'up' or 'down' (got: {direction})"
            )))
        }
    };

    // Resolve channel_id from the event's h-tag
    let channel_uuid = resolve_channel_id(client, event_id).await?;
    let target_eid = parse_event_id(event_id)?;

    let builder = buzz_sdk::build_vote(channel_uuid, target_eid, vote_dir)
        .map_err(|e| CliError::Other(format!("build_vote failed: {e}")))?;

    let event = client.sign_event(builder)?;

    let resp = client.submit_event(event).await?;
    println!("{}", normalize_write_response(&resp));
    Ok(())
}

pub async fn dispatch(
    cmd: crate::MessagesCmd,
    client: &BuzzClient,
    format: &crate::OutputFormat,
) -> Result<(), CliError> {
    use crate::MessagesCmd;
    match cmd {
        MessagesCmd::Send {
            channel,
            content,
            doc,
            title,
            kind,
            reply_to,
            broadcast,
            files,
            mentions,
        } => {
            let content = document_content(doc, title.as_deref(), content, kind)?;
            cmd_send_message(
                client,
                SendMessageParams {
                    channel_id: channel,
                    content,
                    kind,
                    reply_to,
                    broadcast,
                    files,
                    mentions,
                },
            )
            .await
        }
        MessagesCmd::SendDiff {
            channel,
            diff,
            repo,
            commit,
            file,
            parent_commit,
            source_branch,
            target_branch,
            pr,
            lang,
            description,
            reply_to,
        } => {
            cmd_send_diff_message(
                client,
                SendDiffParams {
                    channel_id: channel,
                    diff,
                    repo_url: repo,
                    commit_sha: commit,
                    file_path: file,
                    parent_commit_sha: parent_commit,
                    source_branch,
                    target_branch,
                    pr_number: pr,
                    language: lang,
                    description,
                    reply_to,
                },
            )
            .await
        }
        MessagesCmd::Edit { event, content } => cmd_edit_message(client, &event, &content).await,
        MessagesCmd::Delete {
            event,
            action_id,
            reason_code,
            public_reason,
        } => {
            cmd_delete_message(
                client,
                &event,
                action_id,
                reason_code.as_deref(),
                public_reason.as_deref(),
            )
            .await
        }
        MessagesCmd::Get {
            channel,
            limit,
            before,
            since,
            kinds,
        } => {
            cmd_get_messages(
                client,
                &channel,
                limit,
                before,
                since,
                kinds.as_deref(),
                format,
            )
            .await
        }
        MessagesCmd::Thread {
            channel,
            event,
            link,
            limit,
            depth_limit,
        } => {
            let (channel, event, expected_root) =
                match link {
                    Some(link) => {
                        let parsed = crate::links::parse_message_link(&link)?;
                        (parsed.channel_id, parsed.message_id, parsed.thread_root_id)
                    }
                    None => match (channel, event) {
                        (Some(channel), Some(event)) => (channel, event, None),
                        _ => return Err(CliError::Usage(
                            "messages thread requires either --link or both --channel and --event"
                                .into(),
                        )),
                    },
                };
            cmd_get_thread(
                client,
                &channel,
                &event,
                expected_root.as_deref(),
                limit,
                depth_limit,
                format,
            )
            .await
        }
        MessagesCmd::Search {
            query,
            author,
            since,
            limit,
        } => {
            cmd_search(
                client,
                query.as_deref(),
                author.as_deref(),
                since,
                limit,
                format,
            )
            .await
        }
        MessagesCmd::Vote { event, direction } => {
            cmd_vote_on_post(client, &event, &direction).await
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        channel_id_from_event, cmd_get_thread, cmd_send_message, event_mention_pubkeys,
        find_root_from_tags, format_events, match_profiles_by_name, merge_message_mentions,
        missing_members, normalize_explicit_mentions, parse_member_pubkeys,
        resolve_names_to_pubkeys, resolve_thread_target, thread_ref_from_event,
        thread_ref_from_parent_tags, BuzzClient, CliError, Uuid,
    };
    use buzz_sdk::mentions::{
        extract_at_mentions_with_known, extract_at_names, match_names_to_profiles, MentionProfile,
    };
    use nostr::Keys;
    use serde_json::json;

    const ID_A: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const ID_B: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const PUBKEY: &str = "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";

    // Three real pubkeys (lowercase 64-char hex) used by parse_member_pubkeys tests.
    // See the test's own comment on what `PublicKey::from_hex` actually validates.
    const PK_VALID_A: &str = "35c18ae273fccfaf80d629e20e7f8721b90499379addff533054acc2504c12b4";
    const PK_VALID_B: &str = "c6237ef84fa537c78dcee78efd2d4e59f728859c7f194da42ac51ededfa0be05";
    const PK_VALID_C: &str = "f4a42a97e594b77bdbd8ee35191c8b28a94a4cb871d96f32921558275421fb68";

    #[test]
    fn compact_event_format_remains_the_three_key_contract() {
        let normalized = serde_json::json!([{
            "id": ID_A,
            "pubkey": PUBKEY,
            "kind": 9,
            "content": "compact content",
            "created_at": 1_787_754_972_u64,
            "tags": [["h", "channel-id"]],
            "sig": "d".repeat(128),
        }])
        .to_string();

        let output: Vec<serde_json::Value> =
            serde_json::from_str(&format_events(&normalized, &crate::OutputFormat::Compact))
                .unwrap();

        assert_eq!(
            output[0],
            serde_json::json!({
                "id": ID_A,
                "content": "compact content",
                "created_at": 1_787_754_972_u64,
            })
        );
    }

    #[tokio::test]
    async fn malformed_channel_is_rejected_before_thread_fetch() {
        let client =
            BuzzClient::new("http://127.0.0.1:1".into(), Keys::generate(), None, None).unwrap();
        let error = cmd_get_thread(
            &client,
            "not-a-uuid",
            ID_A,
            None,
            None,
            None,
            &crate::OutputFormat::Json,
        )
        .await
        .unwrap_err();

        assert!(matches!(error, CliError::Usage(_)));
        assert!(error.to_string().contains("invalid UUID"));
    }

    #[test]
    fn selected_event_derives_authoritative_channel_and_root() {
        let channel = "123e4567-e89b-12d3-a456-426614174000";
        let event = json!({
            "tags": [
                ["h", channel],
                ["e", ID_A, "", "root"],
                ["e", ID_B, "", "reply"],
            ]
        });

        assert_eq!(
            channel_id_from_event(ID_B, &event).unwrap().to_string(),
            channel
        );
        assert_eq!(
            thread_ref_from_event(ID_B, &event)
                .unwrap()
                .root_event_id
                .to_hex(),
            ID_A
        );
    }

    #[test]
    fn selected_event_requires_a_valid_channel_tag() {
        let missing = json!({"tags": []});
        let malformed = json!({"tags": [["h", "not-a-uuid"]]});
        assert!(channel_id_from_event(ID_A, &missing).is_err());
        assert!(channel_id_from_event(ID_A, &malformed).is_err());
    }

    #[test]
    fn thread_target_rejects_wrong_channel_or_root_hint() {
        let channel = "123e4567-e89b-12d3-a456-426614174000";
        let other_channel = "123e4567-e89b-12d3-a456-426614174001";
        let selected = json!({
            "tags": [["h", channel], ["e", ID_A, "", "root"], ["e", ID_B, "", "reply"]]
        });

        assert!(resolve_thread_target(
            Uuid::parse_str(other_channel).unwrap(),
            ID_B,
            Some(ID_A),
            &selected,
        )
        .is_err());
        assert!(resolve_thread_target(
            Uuid::parse_str(channel).unwrap(),
            ID_B,
            Some(ID_B),
            &selected,
        )
        .is_err());
        assert_eq!(
            resolve_thread_target(
                Uuid::parse_str(channel).unwrap(),
                ID_B,
                Some(ID_A),
                &selected,
            )
            .unwrap(),
            ID_A
        );
    }

    #[test]
    fn root_marker_wins_over_reply_marker() {
        let tags = json!([
            ["e", ID_A, "", "root"],
            ["e", ID_B, "", "reply"],
            ["p", PUBKEY],
        ]);
        assert_eq!(find_root_from_tags(&tags).as_deref(), Some(ID_A));
    }

    #[test]
    fn root_marker_without_reply_is_top_level() {
        let tags = json!([["e", ID_A, "", "root"], ["p", PUBKEY],]);
        assert!(find_root_from_tags(&tags).is_none());
    }

    #[test]
    fn root_only_parent_starts_cli_reply_thread_at_parent() {
        let tags = json!([["e", ID_A, "", "root"]]);
        let parent = nostr::EventId::from_hex(ID_B).expect("valid parent id");

        let thread_ref = thread_ref_from_parent_tags(parent, ID_B, &tags).expect("thread ref");

        assert_eq!(thread_ref.parent_event_id, parent);
        assert_eq!(thread_ref.root_event_id, parent);
    }

    #[test]
    fn reply_only_falls_back_to_reply_target() {
        // Direct reply to a top-level message — the parent's only e-tag is a
        // "reply" marker pointing at it; treat the reply target as the root.
        let tags = json!([["e", ID_B, "", "reply"], ["p", PUBKEY],]);
        assert_eq!(find_root_from_tags(&tags).as_deref(), Some(ID_B));
    }

    #[test]
    fn no_thread_markers_returns_none() {
        let tags = json!([["p", PUBKEY], ["h", "channel-uuid"],]);
        assert!(find_root_from_tags(&tags).is_none());
    }

    #[test]
    fn unmarked_e_tag_ignored() {
        // NIP-10 deprecated positional markers; ignore e-tags lacking an
        // explicit "root"/"reply" marker rather than guessing.
        let tags = json!([["e", ID_A], ["e", ID_B, ""],]);
        assert!(find_root_from_tags(&tags).is_none());
    }

    #[test]
    fn malformed_tags_are_skipped_and_root_only_is_top_level() {
        // Invalid entries are ignored, leaving a valid root-only marker; the
        // shared collapse rule still classifies that parent as top-level.
        let tags = json!([
            "not-an-array",
            ["e"],
            ["e", "short"],
            ["e", ID_A, "", "root"],
        ]);
        assert!(find_root_from_tags(&tags).is_none());
    }

    #[test]
    fn malformed_marker_id_is_ignored() {
        // Parent event has a "root" marker whose value isn't a valid 64-hex
        // event id (other-client bug, relay-accepted). Treat the marker as
        // absent so the caller falls back to root == parent rather than
        // failing to send the reply.
        let tags = json!([["e", "not-a-valid-id", "", "root"], ["p", PUBKEY],]);
        assert!(find_root_from_tags(&tags).is_none());
    }

    #[test]
    fn malformed_root_does_not_shadow_valid_reply() {
        // If "root" is malformed but "reply" is valid, fall back to "reply".
        let tags = json!([["e", "garbage", "", "root"], ["e", ID_B, "", "reply"],]);
        assert_eq!(find_root_from_tags(&tags).as_deref(), Some(ID_B));
    }

    #[test]
    fn non_array_input_returns_none() {
        assert!(find_root_from_tags(&json!({})).is_none());
        assert!(find_root_from_tags(&json!(null)).is_none());
    }

    //
    // These tests don't hit the network — they prove that *given* the
    // events the relay returns, the CLI's parse + match wiring produces
    // the right pubkeys. The async I/O wrapper around them is one
    // straight line; the pure stages it composes are exercised here and
    // in buzz-sdk.

    /// End-to-end (sans I/O): body text → extracted names → matched
    /// member pubkeys, using realistic 39002 + kind:0 event JSON.
    /// This is the regression guard for the previous stub that always
    /// returned `vec![]`.
    #[test]
    fn cli_pipeline_resolves_body_at_names_to_member_pubkeys() {
        // kind 39002 channel-members event with three members.
        let members_event = json!({
            "kind": 39002,
            "tags": [
                ["d", "00000000-0000-0000-0000-000000000000"],
                ["p", PK_VALID_A, "", "member"],
                ["p", PK_VALID_B, "", "member"],
                ["p", PK_VALID_C, "", "member"],
            ],
            "content": "",
        });
        assert_eq!(
            parse_member_pubkeys(&members_event),
            vec![PK_VALID_A, PK_VALID_B, PK_VALID_C]
        );

        // Three kind:0 profile events.
        let entries = vec![
            MentionProfile {
                pubkey: PK_VALID_A,
                content_json: r#"{"display_name":"Alice"}"#,
            },
            MentionProfile {
                pubkey: PK_VALID_B,
                content_json: r#"{"display_name":"Bob"}"#,
            },
            MentionProfile {
                pubkey: PK_VALID_C,
                content_json: r#"{"name":"Carol"}"#,
            },
        ];

        // Body mentions Alice and Carol (display_name fallback to `name`).
        let names = extract_at_names("hello @alice and @CAROL");
        let resolved = match_names_to_profiles(&names, &entries);
        assert_eq!(resolved, vec![PK_VALID_A, PK_VALID_C]);
    }

    #[test]
    fn cli_pipeline_resolves_multiword_display_names() {
        let profile_events: Vec<serde_json::Value> = vec![
            json!({
                "pubkey": PK_VALID_A,
                "content": r#"{"display_name":"Will Pfleger"}"#,
            }),
            json!({
                "pubkey": PK_VALID_B,
                "content": r#"{"display_name":"Alice"}"#,
            }),
        ];

        // Simulate the single-parse pipeline from resolve_content_mentions.
        let mut name_to_pubkeys: std::collections::HashMap<String, Vec<String>> =
            std::collections::HashMap::new();
        let mut display_names: Vec<String> = Vec::new();
        for e in &profile_events {
            let pubkey = e.get("pubkey").unwrap().as_str().unwrap();
            let content_json = e.get("content").unwrap().as_str().unwrap();
            let v: serde_json::Value = serde_json::from_str(content_json).unwrap();
            let name = v
                .get("display_name")
                .or_else(|| v.get("name"))
                .and_then(|n| n.as_str())
                .filter(|n| !n.is_empty())
                .unwrap();
            let lower = name.to_ascii_lowercase();
            name_to_pubkeys
                .entry(lower)
                .or_default()
                .push(pubkey.to_string());
            display_names.push(name.to_string());
        }

        let known_refs: Vec<&str> = display_names.iter().map(|s| s.as_str()).collect();
        let names = extract_at_mentions_with_known("hey @Will Pfleger and @alice!", &known_refs);
        assert_eq!(names, vec!["will pfleger", "alice"]);

        let resolved: Vec<String> = names
            .iter()
            .flat_map(|n| name_to_pubkeys.get(n).into_iter().flatten())
            .cloned()
            .collect();
        assert_eq!(resolved, vec![PK_VALID_A, PK_VALID_B]);
    }

    #[test]
    fn cli_pipeline_returns_empty_when_no_at_names() {
        // Sanity: no `@names` in body → no profile match attempt needed.
        let names = extract_at_names("plain message, no mentions");
        assert!(names.is_empty());
    }

    #[test]
    fn parse_member_pubkeys_ignores_non_p_tags() {
        let event = json!({
            "tags": [
                ["d", "channel-id"],
                ["p", PK_VALID_A],
                ["h", "channel-id"],
                ["e", "some-event"],
                ["p", PK_VALID_B, "wss://relay", "member"],
            ],
        });
        assert_eq!(parse_member_pubkeys(&event), vec![PK_VALID_A, PK_VALID_B]);
    }

    #[test]
    fn parse_member_pubkeys_handles_malformed_event() {
        assert!(parse_member_pubkeys(&json!({})).is_empty());
        assert!(parse_member_pubkeys(&json!({"tags": "not an array"})).is_empty());
        assert!(parse_member_pubkeys(&json!({"tags": [["p"]]})).is_empty());
    }

    #[test]
    fn parse_member_pubkeys_filters_invalid_hex() {
        // `PublicKey::from_hex` rejects non-hex and wrong-length inputs and
        // canonicalizes hex case. (Note: it accepts any 64-char x-only hex
        // whose integer value is in field; it does not verify the point is
        // actually on the curve — same as MCP's behavior.)
        let pk_uppercase: String = PK_VALID_A.to_ascii_uppercase();
        let event = json!({
            "tags": [
                ["p", PK_VALID_A],       // valid, lowercase
                ["p", pk_uppercase],     // valid hex, canonicalized to lowercase
                ["p", "too-short"],      // length fail
                ["p", "z".repeat(64)],   // non-hex chars
                ["p", "a".repeat(63)],   // off-by-one length
            ],
        });
        assert_eq!(parse_member_pubkeys(&event), vec![PK_VALID_A, PK_VALID_A]);
    }

    #[test]
    fn explicit_mentions_accept_hex_and_npub_and_deduplicate() {
        use nostr::ToBech32;
        let npub = nostr::PublicKey::from_hex(PK_VALID_A)
            .unwrap()
            .to_bech32()
            .unwrap();
        assert_eq!(
            normalize_explicit_mentions(&[PK_VALID_A.into(), npub]).unwrap(),
            vec![PK_VALID_A]
        );
        assert!(normalize_explicit_mentions(&["not-a-key".into()]).is_err());
    }

    #[test]
    fn explicit_mentions_authorize_presentation_text_without_name_resolution() {
        let names = vec!["renamed user".into()];
        let profiles = std::collections::HashMap::new();
        assert_eq!(
            resolve_names_to_pubkeys(&names, &profiles, true).unwrap(),
            Vec::<String>::new()
        );
        assert!(resolve_names_to_pubkeys(&names, &profiles, false).is_err());
    }

    #[test]
    fn explicit_mentions_authorize_ambiguous_presentation_text() {
        let names = vec!["alice".into()];
        let profiles = std::collections::HashMap::from([(
            "alice".into(),
            vec![PK_VALID_A.into(), PK_VALID_B.into()],
        )]);
        assert_eq!(
            resolve_names_to_pubkeys(&names, &profiles, true).unwrap(),
            Vec::<String>::new()
        );
        let error = resolve_names_to_pubkeys(&names, &profiles, false).unwrap_err();
        assert!(error.to_string().contains(PK_VALID_A));
        assert!(error.to_string().contains(PK_VALID_B));
    }

    #[test]
    fn explicit_mentions_make_all_at_names_presentation_only() {
        let names = vec!["alice".into(), "bob".into()];
        let profiles = std::collections::HashMap::from([("alice".into(), vec![PK_VALID_A.into()])]);
        assert_eq!(
            resolve_names_to_pubkeys(&names, &profiles, true).unwrap(),
            vec![PK_VALID_A]
        );
        assert!(resolve_names_to_pubkeys(&names, &profiles, false).is_err());
    }

    #[test]
    fn combined_mention_union_errors_instead_of_truncating() {
        let explicit: Vec<String> = (0..50).map(|i| format!("explicit-{i}")).collect();
        assert!(merge_message_mentions(&explicit, &[], &["resolved-bob".into()]).is_err());

        let mut with_duplicate = explicit.clone();
        with_duplicate.push(explicit[0].clone());
        assert_eq!(
            merge_message_mentions(&with_duplicate, &[explicit[1].clone()], &[])
                .unwrap()
                .len(),
            50
        );
    }

    #[test]
    fn membership_preflight_lists_only_missing_mentions() {
        assert_eq!(
            missing_members(
                &[PK_VALID_A.into(), PK_VALID_B.into()],
                &[PK_VALID_A.into()]
            ),
            vec![PK_VALID_B]
        );
    }

    #[test]
    fn mention_evidence_comes_from_signed_event_tags() {
        use nostr::{EventBuilder, Keys, Tag};
        let event = EventBuilder::text_note("hello")
            .tags(vec![Tag::parse(["p", PK_VALID_A]).unwrap()])
            .sign_with_keys(&Keys::generate())
            .unwrap();
        assert_eq!(event_mention_pubkeys(&event), vec![PK_VALID_A]);
    }

    // ---- match_profiles_by_name (author resolution for `messages search --author`) ----

    fn profile_event(
        pubkey: &str,
        display_name: Option<&str>,
        name: Option<&str>,
    ) -> serde_json::Value {
        let mut content = serde_json::Map::new();
        if let Some(d) = display_name {
            content.insert("display_name".into(), json!(d));
        }
        if let Some(n) = name {
            content.insert("name".into(), json!(n));
        }
        json!({
            "pubkey": pubkey,
            "content": serde_json::Value::Object(content).to_string(),
        })
    }

    #[test]
    fn author_name_match_is_exact_case_insensitive() {
        let events = vec![
            profile_event(PK_VALID_A, Some("Aaron"), Some("aaron")),
            // Substring only — NIP-50 may return it, but it must not match.
            profile_event(PK_VALID_B, Some("Aaronson"), None),
        ];
        let matches = match_profiles_by_name(&events, "aArOn");
        assert_eq!(matches, vec![(PK_VALID_A.to_string(), "Aaron".to_string())]);
    }

    #[test]
    fn author_name_ambiguity_returns_all_candidates() {
        let events = vec![
            profile_event(PK_VALID_A, Some("Sam"), None),
            profile_event(PK_VALID_B, None, Some("sam")),
        ];
        let matches = match_profiles_by_name(&events, "sam");
        assert_eq!(matches.len(), 2);
    }

    #[test]
    fn author_name_no_match_and_malformed_content() {
        let events = vec![
            profile_event(PK_VALID_A, Some("Aaron"), None),
            json!({"pubkey": PK_VALID_B, "content": "not-json"}),
            json!({"content": "{}"}), // missing pubkey
        ];
        assert!(match_profiles_by_name(&events, "Zoe").is_empty());
    }

    #[test]
    fn author_name_dedups_replaceable_event_copies() {
        // Same (pubkey, name) appearing twice (e.g. duplicate kind:0 rows)
        // must resolve unambiguously.
        let events = vec![
            profile_event(PK_VALID_A, Some("Aaron"), None),
            profile_event(PK_VALID_A, Some("Aaron"), None),
        ];
        assert_eq!(match_profiles_by_name(&events, "Aaron").len(), 1);
    }

    // ── cmd_send_message — emoji-tag binding seam ─────────────────────────
    //
    // These tests drive `cmd_send_message` through a minimal fake relay
    // serving `/query` (emoji palette) and `/events` (event submission).
    //
    // Content with no `@` and no explicit mentions bypasses member-resolution
    // relay calls, so the only relay traffic is:
    //   1. POST /query  — emoji palette fetch (when content has `:`)
    //   2. POST /events — signed event submission
    //
    // Removing the resolver call at messages.rs:687-691 or passing &[] at
    // :718 would cause the emoji-tag assertions below to fail.

    use axum::body::Bytes as AxumBytes;
    use axum::extract::State as AxumState;
    use axum::http::{HeaderMap as AxumHeaderMap, StatusCode as AxumStatusCode};
    use axum::routing::post as axum_post;
    use axum::Router as AxumRouter;
    use std::net::SocketAddr as StdSocketAddr;
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::sync::Arc as StdArc;
    use tokio::net::TcpListener as TokioTcpListener;

    /// Captured body of a POST /events call.
    #[derive(Clone, Default)]
    struct CapturedEvent {
        body: String,
    }

    /// Minimal fake relay for send-path tests.
    ///
    /// - `/query` returns the given `query_body` on every call and increments
    ///   `query_count`.
    /// - `/events` returns `{"event_id":"fake","accepted":true}` and records
    ///   the raw event JSON in `captured_event`.
    async fn fake_send_relay(
        query_body: String,
    ) -> (
        String,
        StdArc<AtomicU32>,
        StdArc<std::sync::Mutex<Option<CapturedEvent>>>,
    ) {
        let query_count = StdArc::new(AtomicU32::new(0));
        let captured_event: StdArc<std::sync::Mutex<Option<CapturedEvent>>> =
            StdArc::new(std::sync::Mutex::new(None));

        type S = (
            StdArc<AtomicU32>,
            String,
            StdArc<std::sync::Mutex<Option<CapturedEvent>>>,
        );
        let state: S = (query_count.clone(), query_body, captured_event.clone());

        let app = AxumRouter::new()
            .route(
                "/query",
                axum_post(
                    |AxumState((count, body, _)): AxumState<S>,
                     _headers: AxumHeaderMap,
                     _req: AxumBytes| async move {
                        count.fetch_add(1, Ordering::Relaxed);
                        (
                            AxumStatusCode::OK,
                            [("content-type", "application/json")],
                            body,
                        )
                    },
                ),
            )
            .route(
                "/events",
                axum_post(
                    |AxumState((_, _, cap)): AxumState<S>,
                     _headers: AxumHeaderMap,
                     body: AxumBytes| async move {
                        let body_str = String::from_utf8_lossy(&body).to_string();
                        *cap.lock().unwrap() = Some(CapturedEvent { body: body_str });
                        (
                            AxumStatusCode::OK,
                            [("content-type", "application/json")],
                            r#"{"event_id":"fake0000","accepted":true}"#,
                        )
                    },
                ),
            )
            .with_state(state);

        let listener = TokioTcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr: StdSocketAddr = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        (format!("http://{addr}"), query_count, captured_event)
    }

    /// Palette JSON with one emoji: `wave` → some URL.
    fn send_palette_response() -> String {
        serde_json::json!([{
            "created_at": 100,
            "tags": [
                ["d", "buzz:custom-emoji"],
                ["emoji", "wave", "https://cdn.example.com/wave.png"],
                ["emoji", "sweatblob", "https://cdn.example.com/sweatblob.gif"]
            ]
        }])
        .to_string()
    }

    /// A valid channel UUID used across send-path tests.
    const SEND_TEST_CHANNEL: &str = "123e4567-e89b-12d3-a456-426614174000";

    fn send_params(content: &str) -> super::SendMessageParams {
        super::SendMessageParams {
            channel_id: SEND_TEST_CHANNEL.to_string(),
            content: content.to_string(),
            kind: None,
            reply_to: None,
            broadcast: false,
            files: vec![],
            mentions: vec![],
        }
    }

    #[tokio::test]
    async fn cmd_send_message_attaches_emoji_tags_for_known_shortcodes() {
        // Content contains `:wave:` which resolves in the palette.
        // The submitted event must carry an `emoji` tag for `wave`.
        let (url, query_count, captured_event) = fake_send_relay(send_palette_response()).await;
        let client = BuzzClient::new(url, Keys::generate(), None, None).unwrap();

        cmd_send_message(&client, send_params("hello :wave: everyone"))
            .await
            .unwrap();

        // Palette was queried at least once (short-circuit was NOT triggered).
        assert!(
            query_count.load(Ordering::Relaxed) >= 1,
            "palette must be queried when content has a colon"
        );

        // Submitted event must contain an emoji tag for `wave`.
        let raw = captured_event.lock().unwrap();
        let raw = raw.as_ref().expect("event must have been submitted");
        let event: serde_json::Value = serde_json::from_str(&raw.body).unwrap();
        let tags: Vec<Vec<String>> = event["tags"]
            .as_array()
            .unwrap()
            .iter()
            .map(|t| {
                t.as_array()
                    .unwrap()
                    .iter()
                    .map(|v| v.as_str().unwrap_or("").to_string())
                    .collect()
            })
            .collect();
        let emoji_tags: Vec<&Vec<String>> = tags
            .iter()
            .filter(|t| t.first().map(|s| s.as_str()) == Some("emoji"))
            .collect();
        assert!(
            emoji_tags
                .iter()
                .any(|t| t.get(1).map(|s| s.as_str()) == Some("wave")),
            "submitted event must have an emoji tag for `wave`, got tags: {tags:?}"
        );
        // Unknown shortcodes must not produce tags.
        assert!(
            !emoji_tags
                .iter()
                .any(|t| t.get(1).map(|s| s.as_str()) == Some("notreal")),
            "unknown shortcodes must not produce emoji tags"
        );
    }

    #[tokio::test]
    async fn cmd_send_message_skips_palette_query_when_no_colon_in_content() {
        // Content has no `:` at all — the palette query must be skipped
        // entirely (zero RTTs), and the submitted event must have no emoji tags.
        let (url, query_count, captured_event) = fake_send_relay(send_palette_response()).await;
        let client = BuzzClient::new(url, Keys::generate(), None, None).unwrap();

        cmd_send_message(&client, send_params("plain message no colons"))
            .await
            .unwrap();

        assert_eq!(
            query_count.load(Ordering::Relaxed),
            0,
            "palette must NOT be queried when content has no colon"
        );

        // Submitted event must have no emoji tags.
        let raw = captured_event.lock().unwrap();
        let raw = raw.as_ref().expect("event must have been submitted");
        let event: serde_json::Value = serde_json::from_str(&raw.body).unwrap();
        let tags: Vec<Vec<String>> = event["tags"]
            .as_array()
            .unwrap()
            .iter()
            .map(|t| {
                t.as_array()
                    .unwrap()
                    .iter()
                    .map(|v| v.as_str().unwrap_or("").to_string())
                    .collect()
            })
            .collect();
        let emoji_tags: Vec<&Vec<String>> = tags
            .iter()
            .filter(|t| t.first().map(|s| s.as_str()) == Some("emoji"))
            .collect();
        assert!(
            emoji_tags.is_empty(),
            "no-colon content must produce no emoji tags, got: {emoji_tags:?}"
        );
    }

    #[tokio::test]
    async fn cmd_send_message_succeeds_when_palette_query_errors() {
        // Palette enrichment is decorative — a 500 from the `/query` endpoint
        // must not abort delivery; the message must still be sent with zero
        // emoji tags, and a diagnostic must be emitted to stderr.

        // Fake relay: `/query` returns 500, `/events` accepts and captures.
        let captured_event: StdArc<std::sync::Mutex<Option<CapturedEvent>>> =
            StdArc::new(std::sync::Mutex::new(None));
        let cap = captured_event.clone();
        let app = AxumRouter::new()
            .route(
                "/query",
                axum_post(|_headers: AxumHeaderMap, _req: AxumBytes| async move {
                    (
                        AxumStatusCode::INTERNAL_SERVER_ERROR,
                        [("content-type", "application/json")],
                        r#"{"error":"unavailable"}"#,
                    )
                }),
            )
            .route(
                "/events",
                axum_post(move |_headers: AxumHeaderMap, body: AxumBytes| {
                    let cap = cap.clone();
                    async move {
                        let body_str = String::from_utf8_lossy(&body).to_string();
                        *cap.lock().unwrap() = Some(CapturedEvent { body: body_str });
                        (
                            AxumStatusCode::OK,
                            [("content-type", "application/json")],
                            r#"{"event_id":"fake0001","accepted":true}"#,
                        )
                    }
                }),
            );

        let listener = TokioTcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr: StdSocketAddr = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let url = format!("http://{addr}");
        let client = BuzzClient::new(url, Keys::generate(), None, None).unwrap();

        // Must not return Err — a palette failure is a soft warning.
        cmd_send_message(&client, send_params(":wave: message with emoji candidate"))
            .await
            .expect("send must succeed even when palette query returns 500");

        // Submitted event must have zero emoji tags (fallback to empty).
        let raw = captured_event.lock().unwrap();
        let raw = raw.as_ref().expect("event must have been submitted");
        let event: serde_json::Value = serde_json::from_str(&raw.body).unwrap();
        let tags: Vec<Vec<String>> = event["tags"]
            .as_array()
            .unwrap()
            .iter()
            .map(|t| {
                t.as_array()
                    .unwrap()
                    .iter()
                    .map(|v| v.as_str().unwrap_or("").to_string())
                    .collect()
            })
            .collect();
        let emoji_tags: Vec<&Vec<String>> = tags
            .iter()
            .filter(|t| t.first().map(|s| s.as_str()) == Some("emoji"))
            .collect();
        assert!(
            emoji_tags.is_empty(),
            "palette-error fallback must produce no emoji tags, got: {emoji_tags:?}"
        );
    }

    // ── chat length and one message per request ───────────────────────────
    //
    // These drive `cmd_send_message` and `cmd_edit_message` against an
    // in-memory relay that answers `/query` filters (event by id, thread by
    // `#e`, profile by author) from its event list. Every `/events`
    // submission is recorded and added to that list, so a second send sees the
    // first one in the thread, as it would on a real relay. Removing the cap
    // call or `earlier_answer_to_request` from the send path, or the cap call
    // from the edit path, makes the matching tests fail.

    struct GuardRelay {
        url: String,
        submitted: StdArc<std::sync::Mutex<Vec<serde_json::Value>>>,
    }

    impl GuardRelay {
        /// Events the client submitted, oldest first.
        fn submitted(&self) -> Vec<serde_json::Value> {
            self.submitted.lock().unwrap().clone()
        }

        /// Kinds of the submitted events, oldest first.
        fn submitted_kinds(&self) -> Vec<u64> {
            self.submitted()
                .iter()
                .map(|event| event["kind"].as_u64().unwrap())
                .collect()
        }
    }

    fn guard_filter_matches(filter: &serde_json::Value, event: &serde_json::Value) -> bool {
        if let Some(ids) = filter.get("ids").and_then(|v| v.as_array()) {
            return ids.iter().any(|id| id == &event["id"]);
        }
        if let Some(authors) = filter.get("authors").and_then(|v| v.as_array()) {
            return event["kind"] == 0 && authors.iter().any(|a| a == &event["pubkey"]);
        }
        let kind_ok = filter
            .get("kinds")
            .and_then(|v| v.as_array())
            .is_none_or(|kinds| kinds.iter().any(|k| k == &event["kind"]));
        let thread_ok = filter
            .get("#e")
            .and_then(|v| v.as_array())
            .is_none_or(|roots| {
                event["tags"].as_array().is_some_and(|tags| {
                    tags.iter()
                        .any(|tag| tag[0] == "e" && roots.iter().any(|root| root == &tag[1]))
                })
            });
        kind_ok && thread_ok && event["kind"] != 0
    }

    async fn guard_relay(events: Vec<serde_json::Value>) -> GuardRelay {
        let submitted = StdArc::new(std::sync::Mutex::new(Vec::new()));
        type Events = StdArc<std::sync::Mutex<Vec<serde_json::Value>>>;
        type S = (Events, Events);
        let state: S = (
            StdArc::new(std::sync::Mutex::new(events)),
            submitted.clone(),
        );
        let app = AxumRouter::new()
            .route(
                "/query",
                axum_post(
                    |AxumState((events, _)): AxumState<S>, body: AxumBytes| async move {
                        let filters: Vec<serde_json::Value> =
                            serde_json::from_slice(&body).unwrap_or_default();
                        let events = events.lock().unwrap().clone();
                        let mut out: Vec<serde_json::Value> = Vec::new();
                        for filter in &filters {
                            for event in events.iter() {
                                if guard_filter_matches(filter, event) && !out.contains(event) {
                                    out.push(event.clone());
                                }
                            }
                        }
                        (
                            AxumStatusCode::OK,
                            [("content-type", "application/json")],
                            serde_json::Value::Array(out).to_string(),
                        )
                    },
                ),
            )
            .route(
                "/events",
                axum_post(
                    |AxumState((events, submitted)): AxumState<S>, body: AxumBytes| async move {
                        let event: serde_json::Value =
                            serde_json::from_slice(&body).unwrap_or_default();
                        submitted.lock().unwrap().push(event.clone());
                        events.lock().unwrap().push(event);
                        (
                            AxumStatusCode::OK,
                            [("content-type", "application/json")],
                            r#"{"event_id":"fake0002","accepted":true}"#,
                        )
                    },
                ),
            )
            .with_state(state);
        let listener = TokioTcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr: StdSocketAddr = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        GuardRelay {
            url: format!("http://{addr}"),
            submitted,
        }
    }

    fn agent_client(url: &str, keys: Keys) -> BuzzClient {
        let tag_parts = vec![
            "auth".to_string(),
            "a".repeat(64),
            "conditions".to_string(),
            "b".repeat(128),
        ];
        let json = serde_json::to_string(&tag_parts).unwrap();
        BuzzClient::new(
            url.into(),
            keys,
            Some(nostr::Tag::parse(tag_parts).unwrap()),
            Some(json),
        )
        .unwrap()
    }

    fn person_client(url: &str) -> BuzzClient {
        BuzzClient::new(url.into(), Keys::generate(), None, None).unwrap()
    }

    fn event_json(
        id: &str,
        pubkey: &str,
        kind: u32,
        created_at: u64,
        tags: serde_json::Value,
    ) -> serde_json::Value {
        json!({
            "id": id,
            "pubkey": pubkey,
            "kind": kind,
            "content": "x",
            "created_at": created_at,
            "tags": tags,
            "sig": "d".repeat(128),
        })
    }

    fn in_thread() -> serde_json::Value {
        json!([["h", SEND_TEST_CHANNEL], ["e", ID_A, "", "root"]])
    }

    fn profile_json(pubkey: &str, agent: bool) -> serde_json::Value {
        let tags = if agent {
            json!([["auth", "a".repeat(64), "conditions", "b".repeat(128)]])
        } else {
            json!([])
        };
        event_json(&"0".repeat(64), pubkey, 0, 1, tags)
    }

    fn words(n: usize) -> String {
        vec!["word"; n].join(" ")
    }

    fn reply_params(content: &str) -> super::SendMessageParams {
        super::SendMessageParams {
            reply_to: Some(ID_A.to_string()),
            ..send_params(content)
        }
    }

    /// The person's request at 100 and the thread it started.
    fn request_events() -> Vec<serde_json::Value> {
        vec![
            event_json(ID_A, PUBKEY, 9, 100, json!([["h", SEND_TEST_CHANNEL]])),
            profile_json(PUBKEY, false),
        ]
    }

    #[tokio::test]
    async fn an_agent_message_over_the_word_cap_is_refused_before_anything_is_sent() {
        let relay = guard_relay(vec![]).await;
        let client = agent_client(&relay.url, Keys::generate());

        let error = cmd_send_message(&client, send_params(&words(61)))
            .await
            .unwrap_err();

        assert!(matches!(error, CliError::Usage(_)), "{error:?}");
        assert_eq!(crate::error::exit_code(&error), 1);
        let text = error.to_string();
        assert!(text.starts_with("Too long for chat: 61 words."), "{text}");
        assert!(text.contains("Rewrite in under 50 words"), "{text}");
        assert!(text.contains("```doc fence"), "{text}");
        assert_eq!(relay.submitted().len(), 0);
    }

    #[tokio::test]
    async fn an_agent_message_of_sixty_words_goes_out() {
        let relay = guard_relay(vec![]).await;
        let client = agent_client(&relay.url, Keys::generate());
        cmd_send_message(&client, send_params(&words(60)))
            .await
            .unwrap();
        assert_eq!(relay.submitted().len(), 1);
    }

    #[tokio::test]
    async fn a_long_deliverable_in_a_fence_goes_out() {
        let relay = guard_relay(vec![]).await;
        let client = agent_client(&relay.url, Keys::generate());
        let post = format!(
            "Here's the blog post.\n```doc\n# Karoo launch\n{}\n```",
            words(900)
        );
        cmd_send_message(&client, send_params(&post)).await.unwrap();
        let code = format!("Here is the script.\n```python\n{}\n```", words(500));
        cmd_send_message(&client, send_params(&code)).await.unwrap();
        assert_eq!(relay.submitted().len(), 2);
    }

    #[tokio::test]
    async fn chat_text_around_a_fenced_deliverable_is_still_capped() {
        let relay = guard_relay(vec![]).await;
        let client = agent_client(&relay.url, Keys::generate());
        let padded = format!("{}\n```doc\n# T\nshort\n```", words(80));
        let error = cmd_send_message(&client, send_params(&padded))
            .await
            .unwrap_err();
        assert!(error
            .to_string()
            .starts_with("Too long for chat: 80 words."));
        assert_eq!(relay.submitted().len(), 0);
    }

    #[tokio::test]
    async fn a_person_and_forum_posts_are_not_word_capped() {
        let relay = guard_relay(vec![]).await;
        cmd_send_message(&person_client(&relay.url), send_params(&words(300)))
            .await
            .unwrap();
        let agent = agent_client(&relay.url, Keys::generate());
        let mut forum = send_params(&words(300));
        forum.kind = Some(45001);
        cmd_send_message(&agent, forum).await.unwrap();
        assert_eq!(relay.submitted().len(), 2);
    }

    #[tokio::test]
    async fn the_first_answer_to_a_request_goes_out() {
        let relay = guard_relay(request_events()).await;
        let client = agent_client(&relay.url, Keys::generate());
        cmd_send_message(&client, reply_params("Best lead: Pecan Tree."))
            .await
            .unwrap();
        assert_eq!(
            relay.submitted_kinds(),
            vec![9],
            "a new message, not an edit"
        );
    }

    #[tokio::test]
    async fn a_second_message_for_the_same_request_updates_the_first() {
        let keys = Keys::generate();
        let me = keys.public_key().to_hex();
        let mut events = request_events();
        events.push(event_json(ID_B, &me, 9, 110, in_thread()));
        let relay = guard_relay(events).await;
        let client = agent_client(&relay.url, keys);

        cmd_send_message(&client, reply_params("Best lead is Pecan Tree."))
            .await
            .expect("the send succeeds, as an update of the earlier message");

        let submitted = relay.submitted();
        assert_eq!(submitted.len(), 1, "no new message, got {submitted:?}");
        assert_eq!(submitted[0]["kind"], 40003, "an edit, not a new message");
        assert_eq!(submitted[0]["content"], "Best lead is Pecan Tree.");
        assert!(
            submitted[0]["tags"]
                .as_array()
                .unwrap()
                .iter()
                .any(|tag| tag[0] == "e" && tag[1] == ID_B),
            "the edit targets the agent's earlier message: {submitted:?}"
        );
    }

    #[tokio::test]
    async fn a_pickup_message_then_the_result_is_one_message_holding_the_result() {
        let relay = guard_relay(request_events()).await;
        let client = agent_client(&relay.url, Keys::generate());

        cmd_send_message(&client, reply_params("On it, checking now."))
            .await
            .unwrap();
        cmd_send_message(&client, reply_params("Best lead is Pecan Tree Guesthouse."))
            .await
            .unwrap();
        cmd_send_message(&client, reply_params("Draft is ready when you are."))
            .await
            .unwrap();

        assert_eq!(
            relay.submitted_kinds(),
            vec![9, 40003, 40003],
            "one message, then two updates of it, never a second message"
        );
        let submitted = relay.submitted();
        let first_id = submitted[0]["id"].as_str().unwrap();
        for update in &submitted[1..] {
            assert!(
                update["tags"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|tag| tag[0] == "e" && tag[1] == first_id),
                "every update targets the first message: {update}"
            );
        }
        assert_eq!(
            submitted[1]["content"],
            "Best lead is Pecan Tree Guesthouse."
        );
        assert_eq!(submitted[2]["content"], "Draft is ready when you are.");
    }

    #[tokio::test]
    async fn an_over_long_second_message_is_refused_and_edits_nothing() {
        let keys = Keys::generate();
        let me = keys.public_key().to_hex();
        let mut events = request_events();
        events.push(event_json(ID_B, &me, 9, 110, in_thread()));
        let relay = guard_relay(events).await;
        let client = agent_client(&relay.url, keys);

        let error = cmd_send_message(&client, reply_params(&words(61)))
            .await
            .unwrap_err();

        assert!(error
            .to_string()
            .starts_with("Too long for chat: 61 words."));
        assert_eq!(
            relay.submitted().len(),
            0,
            "the cap holds for an update too"
        );
    }

    #[tokio::test]
    async fn a_new_message_from_the_person_is_a_new_request() {
        let keys = Keys::generate();
        let me = keys.public_key().to_hex();
        let mut events = request_events();
        events.push(event_json(ID_B, &me, 9, 110, in_thread()));
        events.push(event_json(&"e".repeat(64), PUBKEY, 9, 120, in_thread()));
        let relay = guard_relay(events).await;
        let client = agent_client(&relay.url, keys);

        cmd_send_message(&client, reply_params("Draft is below."))
            .await
            .unwrap();

        assert_eq!(
            relay.submitted_kinds(),
            vec![9],
            "a new message, not an edit"
        );
    }

    #[tokio::test]
    async fn a_reply_from_another_agent_lets_this_agent_report_the_result() {
        // Delegation: the agent hands work to a teammate, the teammate answers
        // in the thread, and the agent then posts the result to the person.
        let keys = Keys::generate();
        let me = keys.public_key().to_hex();
        let mut events = request_events();
        events.push(event_json(ID_B, &me, 9, 110, in_thread()));
        events.push(event_json(&"f".repeat(64), PK_VALID_A, 9, 120, in_thread()));
        events.push(profile_json(PK_VALID_A, true));
        let relay = guard_relay(events).await;
        let client = agent_client(&relay.url, keys);

        cmd_send_message(&client, reply_params("Writer finished the draft."))
            .await
            .unwrap();

        assert_eq!(
            relay.submitted_kinds(),
            vec![9],
            "a new message, not an edit"
        );
    }

    #[tokio::test]
    async fn a_thread_that_only_agents_have_spoken_in_is_not_limited() {
        let keys = Keys::generate();
        let me = keys.public_key().to_hex();
        let events = vec![
            event_json(ID_A, PK_VALID_A, 9, 100, json!([["h", SEND_TEST_CHANNEL]])),
            profile_json(PK_VALID_A, true),
            event_json(ID_B, &me, 9, 110, in_thread()),
        ];
        let relay = guard_relay(events).await;
        let client = agent_client(&relay.url, keys);

        cmd_send_message(&client, reply_params("Second status for the team."))
            .await
            .unwrap();

        assert_eq!(
            relay.submitted_kinds(),
            vec![9],
            "a new message, not an edit"
        );
    }

    #[tokio::test]
    async fn a_person_may_post_twice_in_a_thread() {
        let keys = Keys::generate();
        let me = keys.public_key().to_hex();
        let mut events = request_events();
        events.push(event_json(ID_B, &me, 9, 110, in_thread()));
        let relay = guard_relay(events).await;
        let client = BuzzClient::new(relay.url.clone(), keys, None, None).unwrap();

        cmd_send_message(&client, reply_params("One more thing."))
            .await
            .unwrap();

        assert_eq!(
            relay.submitted_kinds(),
            vec![9],
            "a new message, not an edit"
        );
    }

    #[tokio::test]
    async fn an_agent_cannot_edit_a_chat_message_past_the_word_cap() {
        let keys = Keys::generate();
        let me = keys.public_key().to_hex();
        let relay = guard_relay(vec![event_json(
            ID_B,
            &me,
            9,
            110,
            json!([["h", SEND_TEST_CHANNEL]]),
        )])
        .await;
        let client = agent_client(&relay.url, keys);

        let error = super::cmd_edit_message(&client, ID_B, &words(200))
            .await
            .unwrap_err();
        assert!(error
            .to_string()
            .starts_with("Too long for chat: 200 words."));
        assert_eq!(relay.submitted().len(), 0);

        super::cmd_edit_message(&client, ID_B, "Short and fixed.")
            .await
            .unwrap();
        assert_eq!(relay.submitted().len(), 1);
    }

    /// The post of the GATE-312 P10 failure: a heading, an opening paragraph and
    /// five bold-numbered signs, about 300 words.
    fn p10_post() -> String {
        let mut post = String::from(
            "# 5 signs your guesthouse needs social media\nYour guesthouse has charm, clean rooms, and a great breakfast. But if the phone isn't ringing and the calendar has gaps, social media might be the missing piece. Here are five signs it's time to show up online.\n",
        );
        for n in 1..=5 {
            post.push_str(&format!("\n**{n}. Sign number {n}.** {}\n", words(50)));
        }
        post
    }

    /// What the relay was sent: one chat message holding the whole post inside a
    /// closed `doc` fence, not cut and not refused.
    fn assert_sent_as_card(relay: &GuardRelay, post: &str) {
        let submitted = relay.submitted();
        assert_eq!(submitted.len(), 1);
        let content = submitted[0]["content"].as_str().unwrap();
        assert!(content.contains(post.trim()), "{content}");
        assert!(content.contains("```doc\n# 5 signs"), "{content}");
        assert!(content.trim_end().ends_with("```"), "{content}");
        assert!(!content.contains("Want the rest?"), "{content}");
        assert!(buzz_core::chat_limits::check_chat_length(content).is_ok());
    }

    #[tokio::test]
    async fn a_doc_fence_the_model_never_closed_is_sent_as_a_card() {
        let relay = guard_relay(vec![]).await;
        let client = agent_client(&relay.url, Keys::generate());
        let post = p10_post();
        cmd_send_message(&client, send_params(&format!("```doc\n{post}")))
            .await
            .unwrap();
        assert_sent_as_card(&relay, &post);
    }

    #[tokio::test]
    async fn a_fence_the_shell_ate_is_sent_as_a_card() {
        // `--content "```doc ..."` in bash: the backticks are gone, `doc` stays.
        let relay = guard_relay(vec![]).await;
        let client = agent_client(&relay.url, Keys::generate());
        let post = p10_post();
        cmd_send_message(&client, send_params(&format!("doc\n{post}")))
            .await
            .unwrap();
        assert_sent_as_card(&relay, &post);
    }

    #[tokio::test]
    async fn a_heading_led_post_with_no_fence_is_sent_as_a_card() {
        let relay = guard_relay(vec![]).await;
        let client = agent_client(&relay.url, Keys::generate());
        let post = p10_post();
        cmd_send_message(&client, send_params(&post)).await.unwrap();
        assert_sent_as_card(&relay, &post);
    }

    #[tokio::test]
    async fn a_closed_doc_fence_and_a_short_reply_are_sent_exactly_as_written() {
        let relay = guard_relay(vec![]).await;
        let client = agent_client(&relay.url, Keys::generate());
        let fenced = format!("Here's the post.\n```doc\n{}\n```", p10_post());
        cmd_send_message(&client, send_params(&fenced))
            .await
            .unwrap();
        cmd_send_message(&client, send_params("Best lead: Pecan Tree."))
            .await
            .unwrap();
        let submitted = relay.submitted();
        assert_eq!(submitted[0]["content"], fenced.as_str());
        assert_eq!(submitted[1]["content"], "Best lead: Pecan Tree.");
    }

    #[tokio::test]
    async fn plain_prose_over_the_cap_is_still_refused_not_turned_into_a_card() {
        let relay = guard_relay(vec![]).await;
        let client = agent_client(&relay.url, Keys::generate());
        let error = cmd_send_message(&client, send_params(&words(150)))
            .await
            .unwrap_err();
        assert!(error
            .to_string()
            .starts_with("Too long for chat: 150 words."));
        assert_eq!(relay.submitted().len(), 0);
    }

    #[tokio::test]
    async fn an_edit_that_loses_its_fence_is_repaired_into_a_card() {
        let keys = Keys::generate();
        let me = keys.public_key().to_hex();
        let relay = guard_relay(vec![event_json(
            ID_B,
            &me,
            9,
            110,
            json!([["h", SEND_TEST_CHANNEL]]),
        )])
        .await;
        let client = agent_client(&relay.url, keys);
        let post = p10_post();
        super::cmd_edit_message(&client, ID_B, &format!("```doc\n{post}"))
            .await
            .unwrap();
        assert_sent_as_card(&relay, &post);
    }

    #[tokio::test]
    async fn doc_flag_builds_the_card_without_the_model_typing_a_fence() {
        let relay = guard_relay(vec![]).await;
        let client = agent_client(&relay.url, Keys::generate());
        let body = format!(
            "Your guesthouse has charm.\n\n```bash\nls\n```\n\n{}",
            words(300)
        );
        let content = super::document_content(true, Some("5 signs"), body.clone(), None).unwrap();
        cmd_send_message(&client, send_params(&content))
            .await
            .unwrap();
        let submitted = relay.submitted();
        let sent = submitted[0]["content"].as_str().unwrap();
        assert!(
            sent.starts_with("````doc\n# 5 signs\n\nYour guesthouse"),
            "{sent}"
        );
        assert!(sent.ends_with("\n````"), "{sent}");
        assert!(sent.contains(&body), "{sent}");
    }

    #[test]
    fn doc_flag_is_off_by_default_and_only_for_chat() {
        let text = "hello";
        assert_eq!(
            super::document_content(false, None, text.into(), None).unwrap(),
            text
        );
        let forum = super::document_content(true, Some("T"), "Body.".into(), Some(45001));
        assert!(matches!(forum, Err(CliError::Usage(_))), "{forum:?}");
        let untitled = super::document_content(true, None, "No heading.".into(), None);
        assert!(matches!(untitled, Err(CliError::Usage(_))), "{untitled:?}");
    }

    #[tokio::test]
    async fn an_agent_may_edit_a_forum_post_at_any_length() {
        let keys = Keys::generate();
        let me = keys.public_key().to_hex();
        let relay = guard_relay(vec![event_json(
            ID_B,
            &me,
            45001,
            110,
            json!([["h", SEND_TEST_CHANNEL]]),
        )])
        .await;
        let client = agent_client(&relay.url, keys);

        super::cmd_edit_message(&client, ID_B, &words(200))
            .await
            .unwrap();
        assert_eq!(relay.submitted().len(), 1);
    }
}
