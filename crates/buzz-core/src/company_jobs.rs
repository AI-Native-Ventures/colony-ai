//! Signed per-job specialist assignment records.
//!
//! Each addressable job head is keyed by a company function and a stable job id.
//! The independent hire-intent coordinate lets a hire completion atomically put
//! the newly created employee into the intended job without adding fields to
//! existing function or hire records.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::company_functions::CompanyFunction;
use crate::company_records::{is_hex_id, CompanyRecordError, COMPANY_RECORD_SCHEMA_VERSION};

/// Relay-authored job assignment head (community-wide).
pub const KIND_COMPANY_JOB_HEAD: u32 = crate::kind::KIND_COMPANY_JOB_HEAD;
/// Member job-assignment mutation, brokered and community-wide.
pub const KIND_COMPANY_JOB_ACTION: u32 = crate::kind::KIND_COMPANY_JOB_ACTION;

/// Relay NIP-11 extension required before a desktop sends job commands.
pub const JOB_ASSIGNMENT_EXTENSION: &str = "colony-job-assignments";

const JOB_D_TAG_PREFIX: &str = "company:job:";
const JOB_HIRE_D_TAG_PREFIX: &str = "company:job-hire:";

/// Largest stable job identifier in characters.
pub const MAX_JOB_ID_CHARS: usize = 40;

/// Whether an id is safe as the stable portion of a job coordinate.
pub fn is_job_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_JOB_ID_CHARS
        && !value.starts_with('-')
        && !value.ends_with('-')
        && !value.contains("--")
        && value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
}

/// Builds the relay coordinate for one job assignment.
pub fn job_d_tag(function: CompanyFunction, job_id: &str) -> Result<String, CompanyRecordError> {
    if !is_job_id(job_id) {
        return Err(CompanyRecordError::Invalid(
            "jobId must be 1 to 40 characters of a-z, 0-9 and -",
        ));
    }
    Ok(format!("{JOB_D_TAG_PREFIX}{}:{job_id}", function.id()))
}

/// Builds the relay coordinate for a hire's job intent.
pub fn job_hire_d_tag(hire_id: Uuid) -> String {
    format!("{JOB_HIRE_D_TAG_PREFIX}{hire_id}")
}

/// Identifies which coordinate a job-head kind event names.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum JobRecordRef {
    /// The current assignment for a job.
    Assignment { function: CompanyFunction, job_id: String },
    /// A pending job intent attached to a hire.
    HireIntent(Uuid),
}

/// Parses one job-head d-tag without accepting alternate spellings.
pub fn parse_job_d_tag(tag: &str) -> Result<JobRecordRef, CompanyRecordError> {
    if let Some(value) = tag.strip_prefix(JOB_D_TAG_PREFIX) {
        let (function_id, job_id) = value
            .split_once(':')
            .ok_or(CompanyRecordError::DTagMismatch)?;
        let function = CompanyFunction::ALL
            .into_iter()
            .find(|candidate| candidate.id() == function_id)
            .ok_or(CompanyRecordError::DTagMismatch)?;
        return if is_job_id(job_id) {
            Ok(JobRecordRef::Assignment {
                function,
                job_id: job_id.to_owned(),
            })
        } else {
            Err(CompanyRecordError::DTagMismatch)
        };
    }
    let Some(value) = tag.strip_prefix(JOB_HIRE_D_TAG_PREFIX) else {
        return Err(CompanyRecordError::DTagMismatch);
    };
    let hire_id = Uuid::parse_str(value).map_err(|_| CompanyRecordError::DTagMismatch)?;
    if hire_id.hyphenated().to_string() != value {
        return Err(CompanyRecordError::DTagMismatch);
    }
    Ok(JobRecordRef::HireIntent(hire_id))
}

/// The canonical state of a job assignment.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum JobState {
    /// The job is done by the function head or Scout.
    Empty,
    /// A specialist employee does this job.
    Filled,
}

/// Relay-authored canonical job assignment head.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct JobHead {
    /// Schema version.
    pub schema_version: u8,
    /// Function containing this job.
    pub function: CompanyFunction,
    /// Stable job identifier from the coordinate.
    pub job_id: String,
    /// Whether the job has a specialist.
    pub state: JobState,
    /// Specialist employee key for a filled job.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub assignee_pubkey: Option<String>,
    /// Owner or administrator who last changed it.
    pub updated_by_pubkey: String,
    /// Unix seconds of the last write.
    pub updated_at: i64,
}

/// Relay-authored intent that says a pending hire belongs to one job.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct JobHireHead {
    /// Schema version.
    pub schema_version: u8,
    /// Pending hire id.
    pub hire_id: Uuid,
    /// Function containing the destination job.
    pub function: CompanyFunction,
    /// Stable destination job id.
    pub job_id: String,
    /// Owner or administrator who recorded the intent.
    pub set_by_pubkey: String,
    /// Unix seconds of the last write.
    pub updated_at: i64,
}

/// Supported commands on a job assignment.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum JobActionKind {
    /// Give the job to a current company member or employee.
    Assign,
    /// Return the job to its part head or Scout.
    Clear,
    /// Attach a pending hire to a job before it completes.
    HireSet,
}

/// Owner or administrator signed job write.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct JobAction {
    /// Schema version.
    pub schema_version: u8,
    /// Requested change.
    pub action: JobActionKind,
    /// Function containing the job.
    pub function: CompanyFunction,
    /// Stable job identifier.
    pub job_id: String,
    /// Employee assigned by assign.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub assignee_pubkey: Option<String>,
    /// Pending hire id assigned by hire_set.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hire_id: Option<Uuid>,
    /// Exact current assignment or intent head, omitted only on first write.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_head_event_id: Option<String>,
}

impl JobAction {
    /// Returns the addressable coordinate this action writes.
    pub fn d_tag(&self) -> Result<String, CompanyRecordError> {
        match self.action {
            JobActionKind::HireSet => self
                .hire_id
                .map(job_hire_d_tag)
                .ok_or(CompanyRecordError::Invalid("hire_set needs hireId")),
            JobActionKind::Assign | JobActionKind::Clear => job_d_tag(self.function, &self.job_id),
        }
    }
}

/// Validates a brokered job command before relay I/O.
pub fn validate_job_action(action: &JobAction) -> Result<(), CompanyRecordError> {
    if action.schema_version != COMPANY_RECORD_SCHEMA_VERSION {
        return Err(CompanyRecordError::UnsupportedSchemaVersion);
    }
    if !is_job_id(&action.job_id) {
        return Err(CompanyRecordError::Invalid(
            "jobId must be 1 to 40 characters of a-z, 0-9 and -",
        ));
    }
    if let Some(expected) = action.expected_head_event_id.as_deref() {
        if !is_hex_id(expected) {
            return Err(CompanyRecordError::Invalid(
                "expectedHeadEventId must be a 64-character event id",
            ));
        }
    }
    match (
        action.action,
        action.assignee_pubkey.as_deref(),
        action.hire_id,
    ) {
        (JobActionKind::Assign, Some(assignee), None) if is_hex_id(assignee) => Ok(()),
        (JobActionKind::Assign, _, _) => Err(CompanyRecordError::Invalid(
            "assign needs assigneePubkey and no hireId",
        )),
        (JobActionKind::Clear, None, None) => Ok(()),
        (JobActionKind::Clear, _, _) => Err(CompanyRecordError::Invalid(
            "clear takes no assigneePubkey or hireId",
        )),
        (JobActionKind::HireSet, None, Some(_)) => Ok(()),
        (JobActionKind::HireSet, _, _) => Err(CompanyRecordError::Invalid(
            "hire_set needs hireId and no assigneePubkey",
        )),
    }
}

/// Validates a relay-authored assignment head.
pub fn validate_job_head(head: &JobHead) -> Result<(), CompanyRecordError> {
    if head.schema_version != COMPANY_RECORD_SCHEMA_VERSION {
        return Err(CompanyRecordError::UnsupportedSchemaVersion);
    }
    if !is_job_id(&head.job_id) || !is_hex_id(&head.updated_by_pubkey) || head.updated_at < 0 {
        return Err(CompanyRecordError::Invalid(
            "job head needs a valid job id, updater and time",
        ));
    }
    match (head.state, head.assignee_pubkey.as_deref()) {
        (JobState::Filled, Some(assignee)) if is_hex_id(assignee) => Ok(()),
        (JobState::Filled, _) => Err(CompanyRecordError::Invalid(
            "a filled job needs a 64-character assigneePubkey",
        )),
        (JobState::Empty, None) => Ok(()),
        (JobState::Empty, Some(_)) => Err(CompanyRecordError::Invalid(
            "an empty job has no assigneePubkey",
        )),
    }
}

/// Validates a relay-authored hire intent head.
pub fn validate_job_hire_head(head: &JobHireHead) -> Result<(), CompanyRecordError> {
    if head.schema_version != COMPANY_RECORD_SCHEMA_VERSION {
        return Err(CompanyRecordError::UnsupportedSchemaVersion);
    }
    if !is_job_id(&head.job_id) || !is_hex_id(&head.set_by_pubkey) || head.updated_at < 0 {
        return Err(CompanyRecordError::Invalid(
            "job hire head needs a valid job id, setter and time",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const PUBKEY: &str = "a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f90123";

    fn assign() -> JobAction {
        JobAction {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            action: JobActionKind::Assign,
            function: CompanyFunction::Sales,
            job_id: "follow-ups".into(),
            assignee_pubkey: Some(PUBKEY.into()),
            hire_id: None,
            expected_head_event_id: None,
        }
    }

    #[test]
    fn job_d_tags_round_trip_without_display_names() {
        let tag = job_d_tag(CompanyFunction::Sales, "follow-ups").unwrap();
        assert_eq!(tag, "company:job:sales:follow-ups");
        assert_eq!(
            parse_job_d_tag(&tag),
            Ok(JobRecordRef::Assignment {
                function: CompanyFunction::Sales,
                job_id: "follow-ups".into(),
            })
        );
        assert!(job_d_tag(CompanyFunction::Sales, "Follow ups").is_err());
        assert!(job_d_tag(CompanyFunction::Sales, "follow--ups").is_err());
        assert!(job_d_tag(CompanyFunction::Sales, "follow-ups-").is_err());
    }

    #[test]
    fn hire_d_tag_round_trips_only_canonical_uuid() {
        let hire_id = Uuid::nil();
        let tag = job_hire_d_tag(hire_id);
        assert_eq!(parse_job_d_tag(&tag), Ok(JobRecordRef::HireIntent(hire_id)));
        assert!(parse_job_d_tag("company:job-hire:00000000000000000000000000000000").is_err());
    }

    #[test]
    fn action_is_closed_and_parses_through_company_command() {
        let content = serde_json::to_string(&assign()).unwrap();
        assert!(crate::company_records::parse_company_command(KIND_COMPANY_JOB_ACTION, &content)
            .is_ok());
        let with_extra = content.replacen('}', ",\"extra\":true}", 1);
        assert!(serde_json::from_str::<JobAction>(&with_extra).is_err());
    }

    #[test]
    fn assignment_shape_is_strict() {
        assert!(validate_job_action(&assign()).is_ok());
        let mut clear = assign();
        clear.action = JobActionKind::Clear;
        clear.assignee_pubkey = None;
        assert!(validate_job_action(&clear).is_ok());
        clear.hire_id = Some(Uuid::nil());
        assert!(validate_job_action(&clear).is_err());
    }

    #[test]
    fn head_requires_matching_state_and_assignee() {
        let filled = JobHead {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            function: CompanyFunction::Finance,
            job_id: "invoices".into(),
            state: JobState::Filled,
            assignee_pubkey: Some(PUBKEY.into()),
            updated_by_pubkey: PUBKEY.into(),
            updated_at: 1,
        };
        assert!(validate_job_head(&filled).is_ok());
        let empty = JobHead {
            state: JobState::Empty,
            assignee_pubkey: None,
            ..filled
        };
        assert!(validate_job_head(&empty).is_ok());
    }

    #[derive(Deserialize)]
    #[serde(deny_unknown_fields, rename_all = "camelCase")]
    struct PrebuiltSpecialistWireFixture {
        create: crate::company_records::HireAction,
        job_hire_set: JobAction,
        approve: crate::company_records::HireAction,
        attach_employee: crate::company_records::HireAction,
        complete: crate::company_records::HireAction,
    }

    #[test]
    fn specialist_wire_fixture_keeps_hire_and_job_records_additive() {
        let fixture: PrebuiltSpecialistWireFixture = serde_json::from_str(include_str!(
            "../../../test-fixtures/company-hire/prebuilt-specialist-follow-ups.json"
        ))
        .expect("the checked-in specialist fixture must deserialize");
        assert!(crate::company_records::validate_hire_action(&fixture.create).is_ok());
        assert!(validate_job_action(&fixture.job_hire_set).is_ok());
        assert_eq!(
            fixture
                .job_hire_set
                .d_tag()
                .expect("the job intent fixture needs a d-tag"),
            "company:job-hire:00000000-0000-4000-8000-000000000021"
        );
        assert!(crate::company_records::validate_hire_action(&fixture.approve).is_ok());
        assert!(crate::company_records::validate_hire_action(&fixture.attach_employee).is_ok());
        assert!(crate::company_records::validate_hire_action(&fixture.complete).is_ok());
    }
}
