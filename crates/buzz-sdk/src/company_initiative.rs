//! Typed event builders for the co-founder initiative records: the business
//! brief and onboarding progress.

use buzz_core::company_brief::{validate_brief_action, BriefAction, BRIEF_D_TAG};
use buzz_core::company_onboarding::{
    validate_onboarding_action, OnboardingAction, ONBOARDING_D_TAG,
};
use buzz_core::kind::{KIND_BRIEF_ACTION, KIND_ONBOARDING_ACTION};
use nostr::{EventBuilder, Kind, Tag};

use crate::SdkError;

/// Build a member-signed business brief action with its single d-tag.
pub fn build_brief_action(action: &BriefAction) -> Result<EventBuilder, SdkError> {
    validate_brief_action(action)
        .map_err(|error| SdkError::InvalidInput(format!("brief action is invalid: {error}")))?;
    let content = serde_json::to_string(action).map_err(|error| {
        SdkError::InvalidInput(format!("brief action serialization failed: {error}"))
    })?;
    let tag =
        Tag::parse(["d", BRIEF_D_TAG]).map_err(|error| SdkError::InvalidTag(error.to_string()))?;
    Ok(EventBuilder::new(Kind::Custom(KIND_BRIEF_ACTION as u16), content).tag(tag))
}

/// Build a member-signed onboarding action with its single d-tag.
pub fn build_onboarding_action(action: &OnboardingAction) -> Result<EventBuilder, SdkError> {
    validate_onboarding_action(action).map_err(|error| {
        SdkError::InvalidInput(format!("onboarding action is invalid: {error}"))
    })?;
    let content = serde_json::to_string(action).map_err(|error| {
        SdkError::InvalidInput(format!("onboarding action serialization failed: {error}"))
    })?;
    let tag = Tag::parse(["d", ONBOARDING_D_TAG])
        .map_err(|error| SdkError::InvalidTag(error.to_string()))?;
    Ok(EventBuilder::new(Kind::Custom(KIND_ONBOARDING_ACTION as u16), content).tag(tag))
}

#[cfg(test)]
mod tests {
    use super::*;
    use buzz_core::company_brief::BriefActionKind;
    use buzz_core::company_onboarding::OnboardingActionKind;
    use buzz_core::company_records::COMPANY_RECORD_SCHEMA_VERSION;
    use nostr::Keys;

    #[test]
    fn brief_action_carries_the_kind_and_single_d_tag() {
        let keys = Keys::generate();
        let action = BriefAction {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            kind: BriefActionKind::Confirm,
            content: None,
            expected_head_event_id: None,
        };
        let event = build_brief_action(&action)
            .expect("build brief action")
            .sign_with_keys(&keys)
            .expect("sign brief action");
        assert_eq!(event.kind, Kind::Custom(KIND_BRIEF_ACTION as u16));
        assert_eq!(event.tags.len(), 1);
        assert_eq!(
            event.tags.first().and_then(|tag| tag.content()),
            Some(BRIEF_D_TAG)
        );
    }

    #[test]
    fn invalid_brief_action_is_refused_before_signing() {
        let action = BriefAction {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            kind: BriefActionKind::Propose,
            content: None,
            expected_head_event_id: None,
        };
        assert!(build_brief_action(&action).is_err());
    }

    #[test]
    fn onboarding_action_carries_the_kind_and_single_d_tag() {
        let keys = Keys::generate();
        let action = OnboardingAction {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            kind: OnboardingActionKind::Start,
            step: None,
            text: None,
            account: None,
            map: None,
            skipped: false,
            money_preference: None,
            approval_switches: None,
            lead_pubkey: None,
            expected_head_event_id: None,
        };
        let event = build_onboarding_action(&action)
            .expect("build onboarding action")
            .sign_with_keys(&keys)
            .expect("sign onboarding action");
        assert_eq!(event.kind, Kind::Custom(KIND_ONBOARDING_ACTION as u16));
        assert_eq!(
            event.tags.first().and_then(|tag| tag.content()),
            Some(ONBOARDING_D_TAG)
        );
    }

    #[test]
    fn invalid_onboarding_action_is_refused_before_signing() {
        let action = OnboardingAction {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            kind: OnboardingActionKind::Ask,
            step: None,
            text: None,
            account: None,
            map: None,
            skipped: false,
            money_preference: None,
            approval_switches: None,
            lead_pubkey: None,
            expected_head_event_id: None,
        };
        assert!(build_onboarding_action(&action).is_err());
    }
}
