//! Typed event builder for the company team computer record.
//!
//! The action is company-wide: it carries the fixed `d` coordinate and no
//! channel `h` tag.

use crate::SdkError;
use buzz_core::kind::KIND_TEAM_COMPUTER_ACTION;
use buzz_core::team_computer::{
    validate_team_computer_action, TeamComputerAction, TEAM_COMPUTER_D_TAG,
};
use nostr::{EventBuilder, Kind, Tag};

/// Build an owner- or admin-signed team computer claim, heartbeat or release.
pub fn build_team_computer_action(action: &TeamComputerAction) -> Result<EventBuilder, SdkError> {
    validate_team_computer_action(action).map_err(|error| {
        SdkError::InvalidInput(format!("team computer action is invalid: {error}"))
    })?;
    let content = serde_json::to_string(action).map_err(|error| {
        SdkError::InvalidInput(format!(
            "team computer action serialization failed: {error}"
        ))
    })?;
    let d = Tag::parse(["d", TEAM_COMPUTER_D_TAG])
        .map_err(|error| SdkError::InvalidTag(error.to_string()))?;
    Ok(EventBuilder::new(Kind::Custom(KIND_TEAM_COMPUTER_ACTION as u16), content).tag(d))
}

#[cfg(test)]
mod tests {
    use super::*;
    use buzz_core::team_computer::TeamComputerActionKind;
    use nostr::Keys;

    fn claim() -> TeamComputerAction {
        TeamComputerAction {
            action: TeamComputerActionKind::Claim,
            computer_id: "3f6e0b8a-6c52-4b5f-9a0e-2d1c4b7e9f10".into(),
            computer_name: "Lerato's MacBook Air".into(),
            force: false,
        }
    }

    #[test]
    fn team_computer_action_is_company_wide_with_the_fixed_coordinate() {
        let event = build_team_computer_action(&claim())
            .expect("valid action")
            .sign_with_keys(&Keys::generate())
            .expect("sign action");
        assert_eq!(event.kind, Kind::Custom(KIND_TEAM_COMPUTER_ACTION as u16));
        let d_tags: Vec<_> = event
            .tags
            .iter()
            .filter(|tag| tag.kind().to_string() == "d")
            .filter_map(|tag| tag.content())
            .collect();
        assert_eq!(d_tags, vec![TEAM_COMPUTER_D_TAG]);
        assert!(event.tags.iter().all(|tag| tag.kind().to_string() != "h"));
        let parsed: TeamComputerAction =
            serde_json::from_str(&event.content).expect("content round-trips");
        assert_eq!(parsed, claim());
    }

    #[test]
    fn invalid_actions_are_refused_before_signing() {
        let mut invalid = claim();
        invalid.computer_id = "not-a-uuid".into();
        assert!(build_team_computer_action(&invalid).is_err());
    }
}
