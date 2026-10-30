//! Typed event builders for co-founder playbook and running-copy actions.

use buzz_core::company_playbooks::{
    playbook_d_tag, playbook_job_d_tag, validate_job_action, validate_playbook_action,
    PlaybookAction, PlaybookJobAction,
};
use buzz_core::kind::KIND_PLAYBOOK_ACTION;
use nostr::{EventBuilder, Kind, Tag};

use crate::SdkError;

fn build(content: String, d_value: &str) -> Result<EventBuilder, SdkError> {
    let d_tag =
        Tag::parse(["d", d_value]).map_err(|error| SdkError::InvalidTag(error.to_string()))?;
    Ok(EventBuilder::new(Kind::Custom(KIND_PLAYBOOK_ACTION as u16), content).tag(d_tag))
}

/// Build a member-signed playbook action with its community-wide d-tag and no
/// `h` or `p` tag.
pub fn build_playbook_action(action: &PlaybookAction) -> Result<EventBuilder, SdkError> {
    validate_playbook_action(action)
        .map_err(|error| SdkError::InvalidInput(format!("playbook action is invalid: {error}")))?;
    let d_value = playbook_d_tag(&action.playbook_id)
        .map_err(|error| SdkError::InvalidInput(format!("playbook d-tag is invalid: {error}")))?;
    let content = serde_json::to_string(action).map_err(|error| {
        SdkError::InvalidInput(format!("playbook action serialization failed: {error}"))
    })?;
    build(content, &d_value)
}

/// Build a member-signed running-copy action with its community-wide d-tag and
/// no `h` or `p` tag.
pub fn build_playbook_job_action(action: &PlaybookJobAction) -> Result<EventBuilder, SdkError> {
    validate_job_action(action)
        .map_err(|error| SdkError::InvalidInput(format!("job action is invalid: {error}")))?;
    let d_value = playbook_job_d_tag(&action.job_id)
        .map_err(|error| SdkError::InvalidInput(format!("job d-tag is invalid: {error}")))?;
    let content = serde_json::to_string(action).map_err(|error| {
        SdkError::InvalidInput(format!("job action serialization failed: {error}"))
    })?;
    build(content, &d_value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use buzz_core::company_functions::CompanyFunction;
    use buzz_core::company_plans::{PlanOwnerKind, PlanStepOwner};
    use buzz_core::company_playbooks::{
        JobActionKind, PlaybookActionKind, PlaybookContent, PlaybookStep,
    };
    use buzz_core::company_records::COMPANY_RECORD_SCHEMA_VERSION;
    use nostr::Keys;

    const PLAYBOOK_ID: &str = "3c2f6a0e-1b7d-4f0a-9c55-7a1d0e4b2f11";
    const JOB_ID: &str = "9d41b7c2-5e0a-4a63-8f12-c0a7e3d5b6a4";

    fn playbook_action() -> PlaybookAction {
        PlaybookAction {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            playbook_id: PLAYBOOK_ID.into(),
            kind: PlaybookActionKind::Propose,
            content: Some(PlaybookContent {
                title: "Delivery".into(),
                summary: String::new(),
                function: Some(CompanyFunction::Operations),
                steps: vec![PlaybookStep {
                    step_id: "brief".into(),
                    title: "Client brief".into(),
                    detail: None,
                    owner: PlanStepOwner {
                        kind: PlanOwnerKind::Function,
                        function: Some(CompanyFunction::Operations),
                        agent_pubkey: None,
                        worker_type: None,
                    },
                    inputs: Vec::new(),
                    outputs: Vec::new(),
                    tools: Vec::new(),
                    approval_point: None,
                }],
            }),
            change_summary: None,
            revision: None,
            note: None,
            expected_head_event_id: None,
        }
    }

    fn job_action() -> PlaybookJobAction {
        PlaybookJobAction {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            job_id: JOB_ID.into(),
            kind: JobActionKind::Start,
            playbook_id: Some(PLAYBOOK_ID.into()),
            playbook_version: None,
            title: Some("Plane Tree Guesthouse".into()),
            step_id: None,
            step_status: None,
            progress_label: None,
            hand_off_to: None,
            note: None,
            expected_head_event_id: None,
        }
    }

    #[test]
    fn playbook_builder_uses_the_playbook_coordinate_without_h_or_p_tag() {
        let member = Keys::generate();
        let event = build_playbook_action(&playbook_action())
            .expect("build playbook action")
            .sign_with_keys(&member)
            .expect("sign playbook action");
        assert_eq!(event.kind, Kind::Custom(KIND_PLAYBOOK_ACTION as u16));
        assert_eq!(event.tags.len(), 1);
        assert!(event.tags.iter().any(|tag| {
            tag.kind().to_string() == "d"
                && tag.content() == Some("company:playbook:3c2f6a0e-1b7d-4f0a-9c55-7a1d0e4b2f11")
        }));
    }

    #[test]
    fn job_builder_uses_the_job_coordinate_without_h_or_p_tag() {
        let member = Keys::generate();
        let event = build_playbook_job_action(&job_action())
            .expect("build job action")
            .sign_with_keys(&member)
            .expect("sign job action");
        assert_eq!(event.kind, Kind::Custom(KIND_PLAYBOOK_ACTION as u16));
        assert_eq!(event.tags.len(), 1);
        assert!(event.tags.iter().any(|tag| {
            tag.kind().to_string() == "d"
                && tag.content()
                    == Some("company:playbook-job:9d41b7c2-5e0a-4a63-8f12-c0a7e3d5b6a4")
        }));
    }

    #[test]
    fn builders_reject_an_invalid_action() {
        let mut bad = playbook_action();
        bad.expected_head_event_id = Some("ab".repeat(32));
        assert!(build_playbook_action(&bad).is_err());
        let mut bad = job_action();
        bad.expected_head_event_id = Some("ab".repeat(32));
        assert!(build_playbook_job_action(&bad).is_err());
    }
}
