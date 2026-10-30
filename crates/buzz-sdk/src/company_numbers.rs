//! Typed event builder for co-founder numbers actions (goals, scorecard
//! refresh and weekly review).

use buzz_core::company_numbers::{validate_numbers_action, NumbersAction};
use buzz_core::kind::KIND_NUMBERS_ACTION;
use nostr::{EventBuilder, Kind, Tag};

use crate::SdkError;

/// Build a member-signed numbers action with its community-wide d-tag and no
/// `h` or `p` tag.
pub fn build_numbers_action(action: &NumbersAction) -> Result<EventBuilder, SdkError> {
    validate_numbers_action(action)
        .map_err(|error| SdkError::InvalidInput(format!("numbers action is invalid: {error}")))?;
    let d_value = action
        .d_tag()
        .map_err(|error| SdkError::InvalidInput(format!("numbers d-tag is invalid: {error}")))?;
    let content = serde_json::to_string(action).map_err(|error| {
        SdkError::InvalidInput(format!("numbers action serialization failed: {error}"))
    })?;
    let d_tag = Tag::parse(["d", d_value.as_str()])
        .map_err(|error| SdkError::InvalidTag(error.to_string()))?;
    Ok(EventBuilder::new(Kind::Custom(KIND_NUMBERS_ACTION as u16), content).tag(d_tag))
}

#[cfg(test)]
mod tests {
    use super::*;
    use buzz_core::company_functions::CompanyFunction;
    use buzz_core::company_numbers::{GoalPeriod, Metric, NumbersOp, SCORECARD_D_TAG};
    use buzz_core::company_records::COMPANY_RECORD_SCHEMA_VERSION;
    use nostr::Keys;

    fn goal_action() -> NumbersAction {
        NumbersAction {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            op: NumbersOp::GoalPropose,
            goal_id: Some("7f0c3c1e-5b1e-4d52-9a55-3d1f2b6a8c10".into()),
            function: Some(CompanyFunction::Sales),
            title: Some("5 new clients a month".into()),
            metric: Some(Metric::Won),
            target: Some(5),
            period: Some(GoalPeriod::Month),
            reason: None,
            review_date: None,
            wins: None,
            misses: None,
            decisions: None,
            decision_id: None,
            choice: None,
            note: None,
            expected_head_event_id: None,
        }
    }

    #[test]
    fn a_goal_action_carries_one_d_tag_and_signs() {
        let event = build_numbers_action(&goal_action())
            .expect("builder")
            .sign_with_keys(&Keys::generate())
            .expect("sign");
        assert_eq!(event.kind, Kind::Custom(KIND_NUMBERS_ACTION as u16));
        assert_eq!(event.tags.len(), 1);
        assert!(event.tags.iter().any(|tag| {
            tag.kind().to_string() == "d"
                && tag.content() == Some("company:fngoal:7f0c3c1e-5b1e-4d52-9a55-3d1f2b6a8c10")
        }));
    }

    #[test]
    fn a_refresh_uses_the_scorecard_d_tag() {
        let action = NumbersAction {
            op: NumbersOp::ScorecardRefresh,
            goal_id: None,
            function: None,
            title: None,
            metric: None,
            target: None,
            period: None,
            ..goal_action()
        };
        let event = build_numbers_action(&action)
            .expect("builder")
            .sign_with_keys(&Keys::generate())
            .expect("sign");
        assert!(event
            .tags
            .iter()
            .any(|tag| tag.kind().to_string() == "d" && tag.content() == Some(SCORECARD_D_TAG)));
    }

    #[test]
    fn an_invalid_action_is_not_built() {
        let mut action = goal_action();
        action.target = Some(0);
        assert!(build_numbers_action(&action).is_err());
    }
}
