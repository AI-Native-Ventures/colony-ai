//! The business brief: what the company sells, to whom, at what price, and how
//! it talks.
//!
//! Scout reads what Colony already knows and plays the brief back; the owner
//! confirms or corrects it. One relay-signed head (`company:brief`) holds the
//! confirmed text and, separately, a revision Scout has proposed. Scout can only
//! propose; an owner or admin confirms or edits. The brief stays a living page
//! the owner can edit at any time.
//!
//! This is a new kind, so a desktop that predates it keeps loading its existing
//! lists.

use serde::{Deserialize, Serialize};

use crate::company_records::{is_hex_id, CompanyRecordError, COMPANY_RECORD_SCHEMA_VERSION};

/// Relay-authored business brief head (community-wide).
pub const KIND_BRIEF_HEAD: u32 = crate::kind::KIND_BRIEF_HEAD;
/// Member business brief mutation, brokered and community-wide.
pub const KIND_BRIEF_ACTION: u32 = crate::kind::KIND_BRIEF_ACTION;
/// The single d-tag of the business brief record.
pub const BRIEF_D_TAG: &str = "company:brief";

/// Longest text in one brief field, in characters.
pub const MAX_BRIEF_FIELD_CHARS: usize = 600;
/// Most sources a brief can list.
pub const MAX_BRIEF_SOURCES: usize = 8;
/// Longest source label, in characters.
pub const MAX_BRIEF_SOURCE_CHARS: usize = 80;

/// The words of a business brief.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct BriefContent {
    /// What the company sells.
    pub what_you_sell: String,
    /// Who buys it.
    pub who_buys: String,
    /// Prices. `None` means Scout found none, so the screen shows "Not found".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prices: Option<String>,
    /// How the company talks to customers.
    pub how_you_talk: String,
    /// Where Scout read this (for example "Your website", "38 leads").
    #[serde(default)]
    pub sources: Vec<String>,
}

/// What a brief action does.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BriefActionKind {
    /// Scout (or an admin) offers a brief or a revision. Needs `content`.
    Propose,
    /// An owner or admin accepts the proposed brief as it is.
    Confirm,
    /// An owner or admin sets the confirmed brief to their own text. Needs `content`.
    Edit,
    /// An owner or admin drops the proposed brief.
    Discard,
}

impl BriefActionKind {
    /// Whether only an owner or an admin may take this action.
    pub const fn needs_admin(self) -> bool {
        !matches!(self, BriefActionKind::Propose)
    }
}

/// Member-signed business brief change (kind 47064).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct BriefAction {
    /// Schema version.
    pub schema_version: u8,
    /// What to do.
    pub kind: BriefActionKind,
    /// The brief text for `propose` and `edit`; absent for `confirm` and `discard`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content: Option<BriefContent>,
    /// Exact current head event id, omitted only while no head exists.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_head_event_id: Option<String>,
}

/// Relay-authored canonical business brief head (kind 30674).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct BriefHead {
    /// Schema version.
    pub schema_version: u8,
    /// Counts every accepted action, starting at 1.
    pub revision: u32,
    /// The brief the owner confirmed or wrote.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub confirmed: Option<BriefContent>,
    /// A brief Scout proposed that the owner has not decided on yet.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pending: Option<BriefContent>,
    /// Owner or admin who last confirmed or edited the brief.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub confirmed_by_pubkey: Option<String>,
    /// Unix seconds of the last confirmation or edit.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub confirmed_at: Option<i64>,
    /// Who made the last change.
    pub updated_by_pubkey: String,
    /// Unix seconds of the last change.
    pub updated_at: i64,
}

fn text_ok(value: &str) -> bool {
    let length = value.chars().count();
    !value.trim().is_empty() && length <= MAX_BRIEF_FIELD_CHARS
}

/// Validate the words of a brief.
pub fn validate_brief_content(content: &BriefContent) -> Result<(), CompanyRecordError> {
    if !text_ok(&content.what_you_sell) {
        return Err(CompanyRecordError::Invalid(
            "whatYouSell must be 1 to 600 characters",
        ));
    }
    if !text_ok(&content.who_buys) {
        return Err(CompanyRecordError::Invalid(
            "whoBuys must be 1 to 600 characters",
        ));
    }
    if !text_ok(&content.how_you_talk) {
        return Err(CompanyRecordError::Invalid(
            "howYouTalk must be 1 to 600 characters",
        ));
    }
    if let Some(prices) = content.prices.as_deref() {
        if !text_ok(prices) {
            return Err(CompanyRecordError::Invalid(
                "prices must be 1 to 600 characters, or omitted when none were found",
            ));
        }
    }
    if content.sources.len() > MAX_BRIEF_SOURCES {
        return Err(CompanyRecordError::Invalid(
            "a brief lists at most 8 sources",
        ));
    }
    if content
        .sources
        .iter()
        .any(|source| source.trim().is_empty() || source.chars().count() > MAX_BRIEF_SOURCE_CHARS)
    {
        return Err(CompanyRecordError::Invalid(
            "each source must be 1 to 80 characters",
        ));
    }
    Ok(())
}

/// Validate a business brief action.
pub fn validate_brief_action(action: &BriefAction) -> Result<(), CompanyRecordError> {
    if action.schema_version != COMPANY_RECORD_SCHEMA_VERSION {
        return Err(CompanyRecordError::UnsupportedSchemaVersion);
    }
    if let Some(expected) = action.expected_head_event_id.as_deref() {
        if !is_hex_id(expected) {
            return Err(CompanyRecordError::Invalid(
                "expectedHeadEventId must be a 64-character event id",
            ));
        }
    }
    match (action.kind, action.content.as_ref()) {
        (BriefActionKind::Propose | BriefActionKind::Edit, Some(content)) => {
            validate_brief_content(content)
        }
        (BriefActionKind::Propose | BriefActionKind::Edit, None) => Err(
            CompanyRecordError::Invalid("propose and edit need the brief content"),
        ),
        (BriefActionKind::Confirm | BriefActionKind::Discard, None) => Ok(()),
        (BriefActionKind::Confirm | BriefActionKind::Discard, Some(_)) => Err(
            CompanyRecordError::Invalid("confirm and discard carry no brief content"),
        ),
    }
}

/// Validate a relay-authored business brief head.
pub fn validate_brief_head(head: &BriefHead) -> Result<(), CompanyRecordError> {
    if head.schema_version != COMPANY_RECORD_SCHEMA_VERSION {
        return Err(CompanyRecordError::UnsupportedSchemaVersion);
    }
    if head.revision == 0 || !is_hex_id(&head.updated_by_pubkey) || head.updated_at < 0 {
        return Err(CompanyRecordError::Invalid(
            "brief head needs a revision, an updater and a time",
        ));
    }
    for content in head.confirmed.iter().chain(head.pending.iter()) {
        validate_brief_content(content)?;
    }
    Ok(())
}

/// Check that a d-tag is the business brief coordinate.
pub fn validate_brief_d_tag(tag: &str) -> Result<(), CompanyRecordError> {
    if tag == BRIEF_D_TAG {
        Ok(())
    } else {
        Err(CompanyRecordError::DTagMismatch)
    }
}

/// The head a brief action produces, given the current head.
///
/// `Propose` only sets `pending`. `Confirm` promotes `pending` to `confirmed`.
/// `Edit` replaces `confirmed` and drops `pending`. `Discard` drops `pending`.
/// Who may take the action is decided by the caller (`needs_admin`).
pub fn next_brief_head(
    current: Option<&BriefHead>,
    action: &BriefAction,
    actor_pubkey: &str,
    now: i64,
) -> Result<BriefHead, CompanyRecordError> {
    validate_brief_action(action)?;
    let mut head = current.cloned().unwrap_or(BriefHead {
        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
        revision: 0,
        confirmed: None,
        pending: None,
        confirmed_by_pubkey: None,
        confirmed_at: None,
        updated_by_pubkey: actor_pubkey.to_owned(),
        updated_at: now,
    });
    match action.kind {
        BriefActionKind::Propose => {
            head.pending = action.content.clone();
        }
        BriefActionKind::Confirm => {
            let Some(pending) = head.pending.take() else {
                return Err(CompanyRecordError::Invalid(
                    "there is no proposed brief to confirm",
                ));
            };
            head.confirmed = Some(pending);
            head.confirmed_by_pubkey = Some(actor_pubkey.to_owned());
            head.confirmed_at = Some(now);
        }
        BriefActionKind::Edit => {
            head.confirmed = action.content.clone();
            head.pending = None;
            head.confirmed_by_pubkey = Some(actor_pubkey.to_owned());
            head.confirmed_at = Some(now);
        }
        BriefActionKind::Discard => {
            if head.pending.take().is_none() {
                return Err(CompanyRecordError::Invalid(
                    "there is no proposed brief to discard",
                ));
            }
        }
    }
    head.revision = head.revision.saturating_add(1);
    head.updated_by_pubkey = actor_pubkey.to_owned();
    head.updated_at = now;
    Ok(head)
}

#[cfg(test)]
mod tests {
    use super::*;

    const OWNER: &str = "1111111111111111111111111111111111111111111111111111111111111111";
    const SCOUT: &str = "2222222222222222222222222222222222222222222222222222222222222222";

    fn content(what: &str) -> BriefContent {
        BriefContent {
            what_you_sell: what.into(),
            who_buys: "Guesthouses around Johannesburg".into(),
            prices: None,
            how_you_talk: "Friendly and short".into(),
            sources: vec!["Your website".into(), "38 leads".into()],
        }
    }

    fn action(kind: BriefActionKind, content: Option<BriefContent>) -> BriefAction {
        BriefAction {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            kind,
            content,
            expected_head_event_id: None,
        }
    }

    #[test]
    fn propose_sets_pending_and_leaves_confirmed_alone() {
        let first = next_brief_head(
            None,
            &action(BriefActionKind::Propose, Some(content("Websites"))),
            SCOUT,
            10,
        )
        .unwrap();
        assert_eq!(first.revision, 1);
        assert!(first.confirmed.is_none());
        assert_eq!(first.pending, Some(content("Websites")));
        assert!(validate_brief_head(&first).is_ok());
    }

    #[test]
    fn confirm_promotes_pending_and_records_who_and_when() {
        let proposed = next_brief_head(
            None,
            &action(BriefActionKind::Propose, Some(content("Websites"))),
            SCOUT,
            10,
        )
        .unwrap();
        let confirmed = next_brief_head(
            Some(&proposed),
            &action(BriefActionKind::Confirm, None),
            OWNER,
            20,
        )
        .unwrap();
        assert_eq!(confirmed.revision, 2);
        assert_eq!(confirmed.confirmed, Some(content("Websites")));
        assert!(confirmed.pending.is_none());
        assert_eq!(confirmed.confirmed_by_pubkey.as_deref(), Some(OWNER));
        assert_eq!(confirmed.confirmed_at, Some(20));
    }

    #[test]
    fn confirm_without_a_proposal_is_refused() {
        assert!(next_brief_head(None, &action(BriefActionKind::Confirm, None), OWNER, 1).is_err());
    }

    #[test]
    fn edit_replaces_confirmed_and_drops_pending() {
        let proposed = next_brief_head(
            None,
            &action(BriefActionKind::Propose, Some(content("Websites"))),
            SCOUT,
            10,
        )
        .unwrap();
        let edited = next_brief_head(
            Some(&proposed),
            &action(BriefActionKind::Edit, Some(content("Websites and social"))),
            OWNER,
            30,
        )
        .unwrap();
        assert_eq!(edited.confirmed, Some(content("Websites and social")));
        assert!(edited.pending.is_none());
    }

    #[test]
    fn a_later_proposal_keeps_the_confirmed_brief() {
        let edited = next_brief_head(
            None,
            &action(BriefActionKind::Edit, Some(content("Websites"))),
            OWNER,
            10,
        )
        .unwrap();
        let revised = next_brief_head(
            Some(&edited),
            &action(BriefActionKind::Propose, Some(content("Websites and ads"))),
            SCOUT,
            20,
        )
        .unwrap();
        assert_eq!(revised.confirmed, Some(content("Websites")));
        assert_eq!(revised.pending, Some(content("Websites and ads")));
    }

    #[test]
    fn discard_without_a_proposal_is_refused() {
        assert!(next_brief_head(None, &action(BriefActionKind::Discard, None), OWNER, 1).is_err());
    }

    #[test]
    fn only_propose_is_open_to_agents() {
        assert!(!BriefActionKind::Propose.needs_admin());
        assert!(BriefActionKind::Confirm.needs_admin());
        assert!(BriefActionKind::Edit.needs_admin());
        assert!(BriefActionKind::Discard.needs_admin());
    }

    #[test]
    fn content_rules_are_enforced() {
        let mut bad = content("Websites");
        bad.what_you_sell = "  ".into();
        assert!(validate_brief_content(&bad).is_err());
        let mut long = content("Websites");
        long.who_buys = "x".repeat(MAX_BRIEF_FIELD_CHARS + 1);
        assert!(validate_brief_content(&long).is_err());
        let mut empty_prices = content("Websites");
        empty_prices.prices = Some(String::new());
        assert!(validate_brief_content(&empty_prices).is_err());
        let mut many = content("Websites");
        many.sources = (0..=MAX_BRIEF_SOURCES).map(|i| format!("s{i}")).collect();
        assert!(validate_brief_content(&many).is_err());
    }

    #[test]
    fn action_shape_rules() {
        assert!(validate_brief_action(&action(BriefActionKind::Propose, None)).is_err());
        assert!(validate_brief_action(&action(
            BriefActionKind::Confirm,
            Some(content("Websites"))
        ))
        .is_err());
        let mut wrong_version = action(BriefActionKind::Confirm, None);
        wrong_version.schema_version = 2;
        assert_eq!(
            validate_brief_action(&wrong_version),
            Err(CompanyRecordError::UnsupportedSchemaVersion)
        );
        let mut bad_head = action(BriefActionKind::Confirm, None);
        bad_head.expected_head_event_id = Some("nope".into());
        assert!(validate_brief_action(&bad_head).is_err());
    }

    #[test]
    fn brief_action_rejects_unknown_fields() {
        let json = r#"{"schemaVersion":1,"kind":"confirm","surprise":1}"#;
        assert!(serde_json::from_str::<BriefAction>(json).is_err());
        let nested = r#"{"schemaVersion":1,"kind":"propose","content":{"whatYouSell":"a","whoBuys":"b","howYouTalk":"c","extra":true}}"#;
        assert!(serde_json::from_str::<BriefAction>(nested).is_err());
        let ok = r#"{"schemaVersion":1,"kind":"propose","content":{"whatYouSell":"a","whoBuys":"b","howYouTalk":"c"}}"#;
        assert!(serde_json::from_str::<BriefAction>(ok).is_ok());
    }

    #[test]
    fn brief_d_tag_is_a_single_coordinate() {
        assert!(validate_brief_d_tag(BRIEF_D_TAG).is_ok());
        assert_eq!(
            validate_brief_d_tag("company:brief:x"),
            Err(CompanyRecordError::DTagMismatch)
        );
    }
}
