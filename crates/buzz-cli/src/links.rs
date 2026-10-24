//! Canonical `buzz://` deep links for Colony entities.
//!
//! Buzz Desktop renders these links as rich preview cards in chat and
//! navigates in-app when they are clicked. The desktop parser lives in
//! `desktop/src/shared/lib/entityLink.ts` for git entities and
//! `desktop/src/features/messages/lib/messageLink.ts` for messages. The
//! implementations must stay format-compatible.
//!
//! Callers are expected to validate inputs first (`validate_hex64`,
//! `validate_repo_id`); the identifier charsets need no URL encoding.
//!
//! Coordinate links additionally accept an optional `&tab=<tab>` parameter
//! (`files|commits|issues|prs|contributors|channels`) selecting a workspace tab on
//! the receiving side. The CLI builders emit the canonical no-tab form
//! (overview); the parameter exists for the desktop's tab-aware copy-link
//! button.

use crate::error::CliError;

/// Schemes accepted for message links: the current brand first, then the legacy
/// scheme that older clients still mint.
const MESSAGE_LINK_SCHEMES: [&str; 2] = ["colony", "buzz"];

/// Schemes accepted for lead links, same order as [`MESSAGE_LINK_SCHEMES`].
const LEAD_LINK_SCHEMES: [&str; 2] = ["colony", "buzz"];

/// A validated `colony://message` (or legacy `buzz://message`) deep link.
#[derive(Debug, PartialEq, Eq)]
pub struct MessageLink {
    pub channel_id: String,
    pub message_id: String,
    pub thread_root_id: Option<String>,
}

/// Parse a `colony://message?channel=<uuid>&id=<event>[&thread=<root>]` link.
/// The legacy `buzz://message` scheme is accepted too.
///
/// The link chooses only the channel and event within the relay already
/// configured for this CLI process. It cannot override the relay or identity.
pub fn parse_message_link(input: &str) -> Result<MessageLink, CliError> {
    let url = url::Url::parse(input.trim())
        .map_err(|_| CliError::Usage("invalid Colony message link".into()))?;

    if !MESSAGE_LINK_SCHEMES.contains(&url.scheme())
        || url.host_str() != Some("message")
        || !matches!(url.path(), "" | "/")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return Err(CliError::Usage(
            "expected a colony://message link without credentials or a fragment".into(),
        ));
    }

    let mut channel = None;
    let mut message = None;
    let mut thread = None;
    for (key, value) in url.query_pairs() {
        let slot = match key.as_ref() {
            "channel" => &mut channel,
            "id" => &mut message,
            "thread" => &mut thread,
            _ => {
                return Err(CliError::Usage(
                    "Colony message link contains an unsupported query parameter".into(),
                ))
            }
        };
        if slot.replace(value.into_owned()).is_some() {
            return Err(CliError::Usage(format!(
                "Colony message link contains more than one {key} parameter"
            )));
        }
    }

    let channel = channel
        .filter(|value| !value.is_empty())
        .ok_or_else(|| CliError::Usage("Colony message link is missing channel".into()))?;
    let message = message
        .filter(|value| !value.is_empty())
        .ok_or_else(|| CliError::Usage("Colony message link is missing id".into()))?;
    if thread.as_deref() == Some("") {
        return Err(CliError::Usage(
            "Colony message link contains an empty thread parameter".into(),
        ));
    }

    let channel_id = uuid::Uuid::parse_str(&channel)
        .map_err(|_| {
            CliError::Usage("Colony message link contains an invalid channel UUID".into())
        })?
        .to_string();
    let message_id = canonical_event_id(&message, "id")?;
    let thread_root_id = thread
        .as_deref()
        .map(|value| canonical_event_id(value, "thread"))
        .transpose()?;

    Ok(MessageLink {
        channel_id,
        message_id,
        thread_root_id,
    })
}

fn canonical_event_id(value: &str, parameter: &str) -> Result<String, CliError> {
    if value.len() != 64 || !value.chars().all(|character| character.is_ascii_hexdigit()) {
        return Err(CliError::Usage(format!(
            "Colony message link contains an invalid {parameter} event ID"
        )));
    }
    Ok(value.to_ascii_lowercase())
}

/// Whether a d-tag can be expressed in a `buzz://` link.
///
/// Project slugs accept up to 1024 bytes of arbitrary UTF-8, but the link
/// format is restricted to `[a-zA-Z0-9._-]{1,64}` (no leading dot, no `..`)
/// so links need no escaping and stay safe to paste. Callers must check
/// before building a link and omit the field when it returns false, rather
/// than emitting a link no client can parse. Mirrors `isValidDtag` in
/// `desktop/src/shared/lib/entityLink.ts`.
pub fn is_linkable_dtag(dtag: &str) -> bool {
    !dtag.is_empty()
        && dtag.len() <= 64
        && !dtag.starts_with('.')
        && !dtag.contains("..")
        && dtag
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-')
}

/// Build a `buzz://repo` link for a repository announcement (kind 30617).
pub fn repo_link(owner: &str, repo_id: &str) -> String {
    format!("buzz://repo?owner={owner}&d={repo_id}")
}

/// Build a `buzz://project` link for a project announcement (kind 30621).
pub fn project_link(owner: &str, project_id: &str) -> String {
    format!("buzz://project?owner={owner}&d={project_id}")
}

/// Build a `buzz://pr` link for a pull request event (kind 1618).
pub fn pull_request_link(event_id: &str, owner: &str, repo_id: &str) -> String {
    format!("buzz://pr?id={event_id}&owner={owner}&d={repo_id}")
}

/// Build a `buzz://issue` link for an issue event (kind 1621).
pub fn issue_link(event_id: &str, owner: &str, repo_id: &str) -> String {
    format!("buzz://issue?id={event_id}&owner={owner}&d={repo_id}")
}

/// Build a `buzz://lead/<uuid>` link for a lead (a prospect record). The
/// desktop renders it as a lead card and opens the lead when it is clicked;
/// the format mirrors `buildLeadLink` in `desktop/src/shared/lib/entityLink.ts`.
pub fn lead_link(lead_id: uuid::Uuid) -> String {
    format!("buzz://lead/{}", lead_id.hyphenated())
}

/// Read a lead reference: a bare UUID, or a `buzz://lead/<uuid>` /
/// `colony://lead/<uuid>` link. Anything with credentials, a port, a query or
/// a fragment is rejected so a link cannot carry extra meaning.
pub fn parse_lead_reference(input: &str) -> Result<uuid::Uuid, CliError> {
    let input = input.trim();
    if let Ok(lead_id) = uuid::Uuid::parse_str(input) {
        return Ok(lead_id);
    }
    let invalid = || CliError::Usage("expected a lead UUID or a colony://lead/<uuid> link".into());
    let url = url::Url::parse(input).map_err(|_| invalid())?;
    if !LEAD_LINK_SCHEMES.contains(&url.scheme())
        || url.host_str() != Some("lead")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(invalid());
    }
    let id = url.path().strip_prefix('/').ok_or_else(invalid)?;
    uuid::Uuid::parse_str(id).map_err(|_| invalid())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    const CHANNEL: &str = "123e4567-e89b-12d3-a456-426614174000";
    const MESSAGE: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const THREAD: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

    fn golden() -> Value {
        serde_json::from_str(include_str!("../../../test-fixtures/entity-links.json"))
            .expect("valid entity-links golden fixture")
    }

    #[test]
    fn golden_format_matches_desktop() {
        let golden = golden();
        let owner = golden["owner"].as_str().unwrap();
        let event_id = golden["eventId"].as_str().unwrap();
        let dtag = golden["dtag"].as_str().unwrap();
        assert_eq!(
            pull_request_link(event_id, owner, dtag),
            golden["links"]["pullRequest"].as_str().unwrap()
        );
        assert_eq!(
            issue_link(event_id, owner, dtag),
            golden["links"]["issue"].as_str().unwrap()
        );
        assert_eq!(
            repo_link(owner, dtag),
            golden["links"]["repository"].as_str().unwrap()
        );
        assert_eq!(
            project_link(owner, dtag),
            golden["links"]["project"].as_str().unwrap()
        );
    }

    const LEAD: &str = "5f0a7d2c-1b3e-4a6f-9c8d-2e4b6a8c0d1f";

    #[test]
    fn lead_link_has_the_golden_format() {
        let lead_id = uuid::Uuid::parse_str(LEAD).unwrap();
        assert_eq!(lead_link(lead_id), format!("buzz://lead/{LEAD}"));
        assert_eq!(
            lead_link(uuid::Uuid::from_u128(0xAB)),
            "buzz://lead/00000000-0000-0000-0000-0000000000ab"
        );
    }

    #[test]
    fn lead_reference_accepts_a_uuid_or_either_scheme() {
        let expected = uuid::Uuid::parse_str(LEAD).unwrap();
        for input in [
            LEAD.to_string(),
            format!("  {LEAD}  "),
            LEAD.to_ascii_uppercase(),
            format!("buzz://lead/{LEAD}"),
            format!("colony://lead/{LEAD}"),
            format!("colony://lead/{}", LEAD.to_ascii_uppercase()),
        ] {
            assert_eq!(parse_lead_reference(&input).unwrap(), expected, "{input}");
        }
        // A built link always parses back to its lead.
        assert_eq!(
            parse_lead_reference(&lead_link(expected)).unwrap(),
            expected
        );
    }

    #[test]
    fn lead_reference_rejects_other_links_and_extra_parts() {
        for input in [
            "",
            "not a link",
            "buzz://goal/5f0a7d2c-1b3e-4a6f-9c8d-2e4b6a8c0d1f",
            "other://lead/5f0a7d2c-1b3e-4a6f-9c8d-2e4b6a8c0d1f",
            "buzz://lead/not-a-uuid",
            "buzz://lead/",
            "buzz://lead",
            "buzz://lead/5f0a7d2c-1b3e-4a6f-9c8d-2e4b6a8c0d1f?relay=other",
            "buzz://lead/5f0a7d2c-1b3e-4a6f-9c8d-2e4b6a8c0d1f#fragment",
            "buzz://user:secret@lead/5f0a7d2c-1b3e-4a6f-9c8d-2e4b6a8c0d1f",
            "buzz://lead:99/5f0a7d2c-1b3e-4a6f-9c8d-2e4b6a8c0d1f",
            "buzz://lead/5f0a7d2c-1b3e-4a6f-9c8d-2e4b6a8c0d1f/extra",
        ] {
            assert!(parse_lead_reference(input).is_err(), "accepted {input:?}");
        }
        let error = parse_lead_reference("nope").unwrap_err().to_string();
        assert!(!error.to_ascii_lowercase().contains("buzz"), "{error}");
    }

    #[test]
    fn linkable_dtag_matches_the_desktop_charset() {
        let golden = golden();
        for ok in golden["validDtags"].as_array().unwrap() {
            let ok = ok.as_str().unwrap();
            assert!(is_linkable_dtag(ok), "{ok:?} should be linkable");
        }
        assert!(is_linkable_dtag(&"a".repeat(64)));
        for bad in golden["invalidDtags"].as_array().unwrap() {
            let bad = bad.as_str().unwrap();
            assert!(!is_linkable_dtag(bad), "{bad:?} should not be linkable");
        }
        assert!(!is_linkable_dtag(&"a".repeat(65)));
    }

    #[test]
    fn parses_message_link_with_thread_root() {
        let parsed = parse_message_link(&format!(
            "buzz://message?channel={CHANNEL}&id={MESSAGE}&thread={THREAD}"
        ))
        .unwrap();

        assert_eq!(
            parsed,
            MessageLink {
                channel_id: CHANNEL.into(),
                message_id: MESSAGE.into(),
                thread_root_id: Some(THREAD.into()),
            }
        );
    }

    #[test]
    fn parses_colony_scheme_message_link_like_the_legacy_scheme() {
        let colony = parse_message_link(&format!(
            "colony://message?channel={CHANNEL}&id={MESSAGE}&thread={THREAD}"
        ))
        .unwrap();
        let legacy = parse_message_link(&format!(
            "buzz://message?channel={CHANNEL}&id={MESSAGE}&thread={THREAD}"
        ))
        .unwrap();
        assert_eq!(colony, legacy);
        assert!(
            parse_message_link(&format!("other://message?channel={CHANNEL}&id={MESSAGE}")).is_err()
        );
    }

    #[test]
    fn message_link_errors_say_colony() {
        let err = parse_message_link("not a link").unwrap_err().to_string();
        assert!(err.contains("Colony message link"), "{err}");
        let err = parse_message_link("other://message")
            .unwrap_err()
            .to_string();
        assert!(err.contains("colony://message"), "{err}");
        assert!(!err.to_ascii_lowercase().contains("buzz"), "{err}");
    }

    #[test]
    fn parses_message_link_without_thread_root() {
        let parsed =
            parse_message_link(&format!("buzz://message?channel={CHANNEL}&id={MESSAGE}")).unwrap();
        assert_eq!(parsed.thread_root_id, None);
    }

    #[test]
    fn normalizes_message_link_identifiers() {
        let parsed = parse_message_link(&format!(
            "buzz://message?channel={}&id={}",
            CHANNEL.to_ascii_uppercase(),
            MESSAGE.to_ascii_uppercase()
        ))
        .unwrap();

        assert_eq!(parsed.channel_id, CHANNEL);
        assert_eq!(parsed.message_id, MESSAGE);
    }

    #[test]
    fn rejects_message_link_that_could_change_connection_context() {
        for link in [
            format!("buzz://message?channel={CHANNEL}&id={MESSAGE}&relay=other"),
            format!("buzz://user:secret@message?channel={CHANNEL}&id={MESSAGE}"),
            format!("buzz://message?channel={CHANNEL}&id={MESSAGE}#fragment"),
        ] {
            assert!(parse_message_link(&link).is_err(), "accepted {link}");
        }
    }

    #[test]
    fn rejects_duplicate_or_malformed_message_link_identifiers() {
        for link in [
            format!("buzz://message?channel={CHANNEL}&channel={CHANNEL}&id={MESSAGE}"),
            format!("buzz://message?channel=not-a-uuid&id={MESSAGE}"),
            format!("buzz://message?channel={CHANNEL}&id=not-an-event"),
            format!("buzz://message?channel={CHANNEL}&id={MESSAGE}&thread="),
        ] {
            assert!(parse_message_link(&link).is_err(), "accepted {link}");
        }
    }
}
