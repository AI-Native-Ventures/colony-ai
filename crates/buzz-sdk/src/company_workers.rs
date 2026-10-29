//! Typed event builder for budgeted employee worker runs.

use buzz_core::company_workers::{validate_worker_action, worker_d_tag, WorkerRunAction};
use buzz_core::kind::KIND_WORKER_RUN_ACTION;
use nostr::{EventBuilder, Kind, Tag};

use crate::SdkError;

/// Build a community-wide worker run write with the exact d and p tags.
///
/// The `p` tag names the employee that started the run. When that employee
/// signs, nostr would scrub a same-pubkey `p` tag the relay requires, so the
/// builder allows self tagging.
pub fn build_worker_run_action(action: &WorkerRunAction) -> Result<EventBuilder, SdkError> {
    validate_worker_action(action)
        .map_err(|error| SdkError::InvalidInput(format!("worker action is invalid: {error}")))?;
    let d_value = worker_d_tag(&action.run.worker_id)
        .map_err(|error| SdkError::InvalidInput(format!("worker d-tag is invalid: {error}")))?;
    let content = serde_json::to_string(action).map_err(|error| {
        SdkError::InvalidInput(format!("worker action serialization failed: {error}"))
    })?;
    let d_tag = Tag::parse(["d", d_value.as_str()])
        .map_err(|error| SdkError::InvalidTag(error.to_string()))?;
    let p_tag = Tag::parse(["p", action.run.parent_pubkey.as_str()])
        .map_err(|error| SdkError::InvalidTag(error.to_string()))?;
    Ok(
        EventBuilder::new(Kind::Custom(KIND_WORKER_RUN_ACTION as u16), content)
            .tags([d_tag, p_tag])
            .allow_self_tagging(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use buzz_core::company_records::COMPANY_RECORD_SCHEMA_VERSION;
    use buzz_core::company_workers::{WorkerRun, WorkerStatus};
    use nostr::Keys;

    fn action(parent: &str) -> WorkerRunAction {
        WorkerRunAction {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            run: WorkerRun {
                worker_id: "7f0c3c1e-5b1e-4d52-9a55-3d1f2b6a8c10".into(),
                parent_pubkey: parent.into(),
                label: "Research".into(),
                model: "colony-credits".into(),
                status: WorkerStatus::Running,
                started_at: 1_000,
                deadline_at: 1_600,
                finished_at: None,
                input_tokens: 0,
                output_tokens: 0,
                cost_usd: None,
                output_text: None,
                failure_reason: None,
            },
            expected_head_event_id: None,
        }
    }

    #[test]
    fn worker_builder_keeps_the_employee_p_tag_when_the_employee_signs() {
        let employee = Keys::generate();
        let event = build_worker_run_action(&action(&employee.public_key().to_hex()))
            .expect("build worker action")
            .sign_with_keys(&employee)
            .expect("sign worker action");
        assert_eq!(event.kind, Kind::Custom(KIND_WORKER_RUN_ACTION as u16));
        assert_eq!(event.tags.len(), 2);
        assert!(event.tags.iter().any(|tag| {
            tag.kind().to_string() == "d"
                && tag.content() == Some("company:worker:7f0c3c1e-5b1e-4d52-9a55-3d1f2b6a8c10")
        }));
        assert!(event.tags.iter().any(|tag| {
            tag.kind().to_string() == "p"
                && tag.content() == Some(employee.public_key().to_hex().as_str())
        }));
        assert!(!event.tags.iter().any(|tag| tag.kind().to_string() == "h"));
    }

    #[test]
    fn worker_builder_rejects_an_invalid_action() {
        let mut bad = action(&"ab".repeat(32));
        bad.run.deadline_at = bad.run.started_at;
        assert!(build_worker_run_action(&bad).is_err());
    }
}
