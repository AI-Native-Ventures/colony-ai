//! Typed event builders for Colony company-record commands.
//!
//! Goal actions are community-wide Nostr events. They carry the namespaced
//! goal d-tag and intentionally omit a channel h-tag.

use buzz_core::company_records::{goal_d_tag, validate_goal_action};
pub use buzz_core::company_records::{
    GoalAction, GoalActionKind, GoalHead, GoalProgress, GoalRecord, GoalStatus, GoalTarget,
    RecordedGoalProgress,
};
use buzz_core::kind::KIND_GOAL_ACTION;
use nostr::{EventBuilder, Kind, Tag};
use uuid::Uuid;

use crate::SdkError;

/// Build a member-signed goal action with its community-scoped d-tag.
pub fn build_goal_action(
    community_id: Uuid,
    action: &GoalAction,
) -> Result<EventBuilder, SdkError> {
    validate_goal_action(action)
        .map_err(|error| SdkError::InvalidInput(format!("goal action is invalid: {error}")))?;
    let content = serde_json::to_string(action).map_err(|error| {
        SdkError::InvalidInput(format!("goal action serialization failed: {error}"))
    })?;
    let d_tag = goal_d_tag(community_id, action.goal_id);
    let tag = Tag::parse(["d", d_tag.as_str()])
        .map_err(|error| SdkError::InvalidTag(error.to_string()))?;
    Ok(EventBuilder::new(Kind::Custom(KIND_GOAL_ACTION as u16), content).tag(tag))
}

#[cfg(test)]
mod tests {
    use super::*;
    use buzz_core::company_records::{GoalActionKind, COMPANY_RECORD_SCHEMA_VERSION};

    #[test]
    fn goal_action_builder_uses_the_global_goal_coordinate_without_h_tag() {
        let community_id = Uuid::from_u128(1);
        let goal_id = Uuid::from_u128(2);
        let action = GoalAction {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            goal_id,
            action: GoalActionKind::Create,
            expected_head_event_id: None,
            goal: Some(GoalRecord {
                schema_version: COMPANY_RECORD_SCHEMA_VERSION,
                goal_id,
                parent_goal_id: None,
                title: "Prepare the October plan".into(),
                owner_pubkey: "ab".repeat(32),
                due_date: None,
                done_condition: "The client approved the plan".into(),
                target: None,
                linked_channel_ids: Vec::new(),
            }),
            progress: None,
            status: None,
            reason: None,
        };

        let event = build_goal_action(community_id, &action)
            .expect("builder")
            .sign_with_keys(&nostr::Keys::generate())
            .expect("signed event");

        assert_eq!(event.kind, Kind::Custom(KIND_GOAL_ACTION as u16));
        assert_eq!(event.tags.len(), 1);
        let d_tag = goal_d_tag(community_id, goal_id);
        let tags: Vec<_> = event.tags.iter().collect();
        assert_eq!(tags.len(), 1);
        assert_eq!(tags[0].kind().to_string(), "d");
        assert_eq!(tags[0].content(), Some(d_tag.as_str()));
        let parsed: GoalAction = serde_json::from_str(&event.content).expect("typed content");
        assert_eq!(parsed, action);
    }

    #[test]
    fn goal_action_builder_rejects_payloads_outside_the_contract() {
        let action = GoalAction {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            goal_id: Uuid::from_u128(2),
            action: GoalActionKind::Create,
            expected_head_event_id: None,
            goal: None,
            progress: None,
            status: None,
            reason: None,
        };

        assert!(build_goal_action(Uuid::from_u128(1), &action).is_err());
    }
}
