//! Typed event builder for co-founder plan actions.

use buzz_core::company_plans::{plan_d_tag, validate_plan_action, PlanAction};
use buzz_core::kind::KIND_PLAN_ACTION;
use nostr::{EventBuilder, Kind, Tag};

use crate::SdkError;

/// Build a member-signed plan action with its community-wide d-tag and no
/// `h` or `p` tag.
pub fn build_plan_action(action: &PlanAction) -> Result<EventBuilder, SdkError> {
    validate_plan_action(action)
        .map_err(|error| SdkError::InvalidInput(format!("plan action is invalid: {error}")))?;
    let d_value = plan_d_tag(&action.plan_id)
        .map_err(|error| SdkError::InvalidInput(format!("plan d-tag is invalid: {error}")))?;
    let content = serde_json::to_string(action).map_err(|error| {
        SdkError::InvalidInput(format!("plan action serialization failed: {error}"))
    })?;
    let d_tag = Tag::parse(["d", d_value.as_str()])
        .map_err(|error| SdkError::InvalidTag(error.to_string()))?;
    Ok(EventBuilder::new(Kind::Custom(KIND_PLAN_ACTION as u16), content).tag(d_tag))
}

#[cfg(test)]
mod tests {
    use super::*;
    use buzz_core::company_functions::CompanyFunction;
    use buzz_core::company_plans::{
        PlanActionKind, PlanOwnerKind, PlanProposal, PlanStep, PlanStepOwner, PlanStepStatus,
    };
    use buzz_core::company_records::COMPANY_RECORD_SCHEMA_VERSION;
    use nostr::Keys;

    fn action() -> PlanAction {
        PlanAction {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            plan_id: "7f0c3c1e-5b1e-4d52-9a55-3d1f2b6a8c10".into(),
            kind: PlanActionKind::Propose,
            plan: Some(PlanProposal {
                title: "November".into(),
                summary: String::new(),
                function: Some(CompanyFunction::Sales),
                currency: "ZAR".into(),
                budget_cents: 0,
                decide_by: None,
                target_label: None,
                timing_label: None,
                steps: vec![PlanStep {
                    step_id: "find".into(),
                    title: "Find guesthouses".into(),
                    detail: None,
                    owner: PlanStepOwner {
                        kind: PlanOwnerKind::Function,
                        function: Some(CompanyFunction::Sales),
                        agent_pubkey: None,
                        worker_type: None,
                    },
                    tools: Vec::new(),
                    cost_label: "Free".into(),
                    cost_estimate_cents: 0,
                    when_label: "This week".into(),
                    approval_point: None,
                    status: PlanStepStatus::Pending,
                    note: None,
                }],
            }),
            revision: None,
            step_id: None,
            step_status: None,
            note: None,
            expected_head_event_id: None,
        }
    }

    #[test]
    fn plan_builder_uses_the_global_plan_coordinate_without_h_or_p_tag() {
        let member = Keys::generate();
        let event = build_plan_action(&action())
            .expect("build plan action")
            .sign_with_keys(&member)
            .expect("sign plan action");
        assert_eq!(event.kind, Kind::Custom(KIND_PLAN_ACTION as u16));
        assert_eq!(event.tags.len(), 1);
        assert!(event.tags.iter().any(|tag| {
            tag.kind().to_string() == "d"
                && tag.content() == Some("company:plan:7f0c3c1e-5b1e-4d52-9a55-3d1f2b6a8c10")
        }));
    }

    #[test]
    fn plan_builder_rejects_an_invalid_action() {
        let mut bad = action();
        bad.expected_head_event_id = Some("ab".repeat(32));
        assert!(build_plan_action(&bad).is_err());
    }
}
