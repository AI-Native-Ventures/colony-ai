//! Typed employee lessons with explicitly recorded evidence and confidence.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::company_records::{CompanyRecordError, COMPANY_RECORD_SCHEMA_VERSION};

/// Maximum lesson text length, in characters.
pub const MAX_LESSON_TEXT_CHARS: usize = 4000;
/// Maximum references attached to one lesson.
pub const MAX_LESSON_EVIDENCE_REFS: usize = 100;

/// Assessment recorded explicitly for one evidence reference.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LessonEvidenceAssessment {
    /// Evidence supports the lesson.
    Helpful,
    /// Evidence contradicts or weakens the lesson.
    Harmful,
}

/// Existing community event referenced as lesson evidence.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct LessonEvidenceRef {
    /// Referenced event id as 64 lowercase hex characters.
    pub event_id: String,
    /// Optional human assessment. Never inferred from event content.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub assessment: Option<LessonEvidenceAssessment>,
}

/// Explicit confidence stored with a lesson.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LessonConfidence {
    /// No owner or admin has assessed confidence yet.
    Unassessed,
    /// Low confidence.
    Low,
    /// Moderate confidence.
    Moderate,
    /// High confidence.
    High,
}

/// Structured lesson content and evidence.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct LessonSnapshot {
    /// Schema version.
    pub schema_version: u8,
    /// Stable lesson UUID.
    pub lesson_id: Uuid,
    /// Employee whose Lessons section contains this record.
    pub employee_pubkey: String,
    /// The reusable lesson as written by a member or managed agent.
    pub lesson: String,
    /// Explicit event references supporting or challenging the lesson.
    pub evidence: Vec<LessonEvidenceRef>,
    /// Confidence explicitly recorded by an owner or admin.
    pub confidence: LessonConfidence,
}

/// Lesson lifecycle state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LessonStatus {
    /// Proposed or edited and awaiting owner/admin review.
    Candidate,
    /// Approved for use.
    Approved,
    /// Deprecated and excluded from current guidance.
    Deprecated,
}

/// Supported lesson operations.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LessonActionKind {
    /// Create a candidate lesson.
    Create,
    /// Edit a lesson and return it to candidate state.
    Update,
    /// Approve a candidate and explicitly set confidence.
    Approve,
    /// Deprecate an approved or candidate lesson.
    Deprecate,
    /// Restore a deprecated lesson as a candidate.
    RestoreCandidate,
}

/// Member-signed lesson mutation (kind 47045).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct LessonAction {
    /// Schema version.
    pub schema_version: u8,
    /// Stable lesson UUID.
    pub lesson_id: Uuid,
    /// Requested transition.
    pub action: LessonActionKind,
    /// Exact current lesson head, omitted only for create.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_head_event_id: Option<String>,
    /// New full snapshot for create or update.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub snapshot: Option<LessonSnapshot>,
    /// Explicit reviewer confidence on approval.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub confidence: Option<LessonConfidence>,
}

/// Recorded human approval.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct LessonApproval {
    /// Owner or admin pubkey that approved the lesson.
    pub approved_by_pubkey: String,
    /// Approval timestamp in RFC 3339 format.
    pub approved_at: String,
}

/// Relay-authored canonical lesson head (kind 30656).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct LessonHead {
    /// Schema version.
    pub schema_version: u8,
    /// Stable lesson UUID.
    pub lesson_id: Uuid,
    /// Current lesson state and content.
    pub snapshot: LessonSnapshot,
    /// Current lifecycle state.
    pub status: LessonStatus,
    /// Original proposer pubkey.
    pub proposed_by_pubkey: String,
    /// Current approval provenance, if approved.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub approval: Option<LessonApproval>,
    /// Creation timestamp in RFC 3339 format.
    pub created_at: String,
    /// Last record update timestamp in RFC 3339 format.
    pub updated_at: String,
    /// Action event that produced this head.
    pub source_action_event_id: String,
}

/// Build the canonical community-wide lesson d-tag.
pub fn lesson_d_tag(lesson_id: Uuid) -> String {
    format!("company:lesson:{lesson_id}")
}

/// Number of evidence refs with an explicit helpful assessment.
pub fn helpful_evidence_count(snapshot: &LessonSnapshot) -> usize {
    snapshot
        .evidence
        .iter()
        .filter(|reference| reference.assessment == Some(LessonEvidenceAssessment::Helpful))
        .count()
}

/// Number of evidence refs with an explicit harmful assessment.
pub fn harmful_evidence_count(snapshot: &LessonSnapshot) -> usize {
    snapshot
        .evidence
        .iter()
        .filter(|reference| reference.assessment == Some(LessonEvidenceAssessment::Harmful))
        .count()
}

/// Validate the identity, content, evidence and initial confidence of a snapshot.
pub fn validate_lesson_snapshot(snapshot: &LessonSnapshot) -> Result<(), CompanyRecordError> {
    if snapshot.schema_version != COMPANY_RECORD_SCHEMA_VERSION {
        return Err(CompanyRecordError::UnsupportedSchemaVersion);
    }
    if snapshot.lesson_id.is_nil() || !is_hex_id(&snapshot.employee_pubkey) {
        return Err(CompanyRecordError::Invalid(
            "lessonId and employeePubkey must identify one employee",
        ));
    }
    if snapshot.lesson.trim().is_empty() || snapshot.lesson.chars().count() > MAX_LESSON_TEXT_CHARS
    {
        return Err(CompanyRecordError::Invalid(
            "lesson is required, 4000 characters at most",
        ));
    }
    if snapshot.evidence.is_empty() || snapshot.evidence.len() > MAX_LESSON_EVIDENCE_REFS {
        return Err(CompanyRecordError::Invalid(
            "lesson needs 1 to 100 evidence references",
        ));
    }
    let mut seen = std::collections::BTreeSet::new();
    for reference in &snapshot.evidence {
        if !is_hex_id(&reference.event_id) || !seen.insert(reference.event_id.as_str()) {
            return Err(CompanyRecordError::Invalid(
                "evidence references must be unique 64-character event ids",
            ));
        }
    }
    if snapshot.confidence != LessonConfidence::Unassessed {
        return Err(CompanyRecordError::Invalid(
            "new and edited lessons begin unassessed",
        ));
    }
    Ok(())
}

/// Validate a relay-authored lesson head, including state and approval provenance.
pub fn validate_lesson_head(head: &LessonHead) -> Result<(), CompanyRecordError> {
    if head.schema_version != COMPANY_RECORD_SCHEMA_VERSION
        || head.lesson_id.is_nil()
        || head.snapshot.lesson_id != head.lesson_id
        || !is_hex_id(&head.proposed_by_pubkey)
        || !is_hex_id(&head.source_action_event_id)
        || !is_rfc3339(&head.created_at)
        || !is_rfc3339(&head.updated_at)
    {
        return Err(CompanyRecordError::Invalid(
            "lesson head identity and timestamps must be valid",
        ));
    }
    let mut snapshot = head.snapshot.clone();
    snapshot.confidence = LessonConfidence::Unassessed;
    validate_lesson_snapshot(&snapshot)?;
    match head.status {
        LessonStatus::Candidate => {
            if head.snapshot.confidence != LessonConfidence::Unassessed || head.approval.is_some() {
                return Err(CompanyRecordError::Invalid(
                    "candidate lessons have no current approval or confidence assessment",
                ));
            }
        }
        LessonStatus::Approved => {
            let approval = head.approval.as_ref().ok_or(CompanyRecordError::Invalid(
                "approved lessons need approval provenance",
            ))?;
            if head.snapshot.confidence == LessonConfidence::Unassessed
                || !is_hex_id(&approval.approved_by_pubkey)
                || !is_rfc3339(&approval.approved_at)
            {
                return Err(CompanyRecordError::Invalid(
                    "approved lessons need assessed confidence and valid actor and time",
                ));
            }
        }
        LessonStatus::Deprecated => {
            if let Some(approval) = head.approval.as_ref() {
                if head.snapshot.confidence == LessonConfidence::Unassessed
                    || !is_hex_id(&approval.approved_by_pubkey)
                    || !is_rfc3339(&approval.approved_at)
                {
                    return Err(CompanyRecordError::Invalid(
                        "deprecated approval provenance must remain valid",
                    ));
                }
            } else if head.snapshot.confidence != LessonConfidence::Unassessed {
                return Err(CompanyRecordError::Invalid(
                    "unapproved deprecated lessons cannot retain assessed confidence",
                ));
            }
        }
    }
    Ok(())
}

/// Validate the shape of a member-signed lesson action.
pub fn validate_lesson_action(action: &LessonAction) -> Result<(), CompanyRecordError> {
    if action.schema_version != COMPANY_RECORD_SCHEMA_VERSION {
        return Err(CompanyRecordError::UnsupportedSchemaVersion);
    }
    if action.lesson_id.is_nil() {
        return Err(CompanyRecordError::Invalid("lessonId must be a UUID"));
    }
    let expected_valid = action
        .expected_head_event_id
        .as_deref()
        .is_some_and(is_hex_id);
    match action.action {
        LessonActionKind::Create => {
            if action.expected_head_event_id.is_some()
                || action.snapshot.is_none()
                || action.confidence.is_some()
            {
                return Err(CompanyRecordError::Invalid(
                    "create needs a snapshot and no expected head or confidence",
                ));
            }
        }
        LessonActionKind::Update => {
            if !expected_valid || action.snapshot.is_none() || action.confidence.is_some() {
                return Err(CompanyRecordError::Invalid(
                    "update needs an exact head and snapshot",
                ));
            }
        }
        LessonActionKind::Approve => {
            if !expected_valid
                || action.snapshot.is_some()
                || action.confidence.is_none()
                || action.confidence == Some(LessonConfidence::Unassessed)
            {
                return Err(CompanyRecordError::Invalid(
                    "approve needs an exact head and explicit confidence",
                ));
            }
        }
        LessonActionKind::Deprecate | LessonActionKind::RestoreCandidate => {
            if !expected_valid || action.snapshot.is_some() || action.confidence.is_some() {
                return Err(CompanyRecordError::Invalid(
                    "lifecycle changes need an exact head and no snapshot or confidence",
                ));
            }
        }
    }
    if let Some(snapshot) = action.snapshot.as_ref() {
        validate_lesson_snapshot(snapshot)?;
        if snapshot.lesson_id != action.lesson_id {
            return Err(CompanyRecordError::Invalid(
                "snapshot lessonId must match action lessonId",
            ));
        }
    }
    Ok(())
}

/// Check a lesson d-tag against its stable UUID.
pub fn validate_lesson_d_tag(d_tag: &str, lesson_id: Uuid) -> Result<(), CompanyRecordError> {
    if d_tag == lesson_d_tag(lesson_id) {
        Ok(())
    } else {
        Err(CompanyRecordError::DTagMismatch)
    }
}

fn is_hex_id(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn is_rfc3339(value: &str) -> bool {
    chrono::DateTime::parse_from_rfc3339(value).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snapshot() -> LessonSnapshot {
        LessonSnapshot {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            lesson_id: Uuid::parse_str("d14e1a58-a238-4a61-b0c7-9907cf8e659c").unwrap(),
            employee_pubkey: "ab".repeat(32),
            lesson: "Use source links in weekly campaign reviews.".into(),
            evidence: vec![LessonEvidenceRef {
                event_id: "cd".repeat(32),
                assessment: Some(LessonEvidenceAssessment::Helpful),
            }],
            confidence: LessonConfidence::Unassessed,
        }
    }

    #[test]
    fn lesson_counts_use_only_explicit_assessments() {
        let mut record = snapshot();
        record.evidence.push(LessonEvidenceRef {
            event_id: "ef".repeat(32),
            assessment: None,
        });
        assert_eq!(record.evidence.len(), 2);
        assert_eq!(helpful_evidence_count(&record), 1);
        assert_eq!(harmful_evidence_count(&record), 0);
    }

    #[test]
    fn lesson_snapshot_requires_unique_real_event_ids_and_unassessed_confidence() {
        let mut record = snapshot();
        assert!(validate_lesson_snapshot(&record).is_ok());
        record.evidence.push(record.evidence[0].clone());
        assert!(validate_lesson_snapshot(&record).is_err());
        record.evidence.pop();
        record.confidence = LessonConfidence::Moderate;
        assert!(validate_lesson_snapshot(&record).is_err());
    }

    #[test]
    fn lesson_approval_requires_assessed_confidence_and_an_exact_head() {
        let action = LessonAction {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            lesson_id: snapshot().lesson_id,
            action: LessonActionKind::Approve,
            expected_head_event_id: Some("12".repeat(32)),
            snapshot: None,
            confidence: Some(LessonConfidence::Moderate),
        };
        assert!(validate_lesson_action(&action).is_ok());

        let mut invalid = action.clone();
        invalid.confidence = Some(LessonConfidence::Unassessed);
        assert!(validate_lesson_action(&invalid).is_err());
        invalid.confidence = Some(LessonConfidence::High);
        invalid.expected_head_event_id = None;
        assert!(validate_lesson_action(&invalid).is_err());
    }

    #[test]
    fn lesson_head_state_must_match_approval_and_confidence() {
        let now = "2026-09-30T10:00:00Z".to_owned();
        let mut head = LessonHead {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            lesson_id: snapshot().lesson_id,
            snapshot: snapshot(),
            status: LessonStatus::Candidate,
            proposed_by_pubkey: "ab".repeat(32),
            approval: None,
            created_at: now.clone(),
            updated_at: now.clone(),
            source_action_event_id: "cd".repeat(32),
        };
        assert!(validate_lesson_head(&head).is_ok());
        head.status = LessonStatus::Approved;
        assert!(validate_lesson_head(&head).is_err());
        head.snapshot.confidence = LessonConfidence::High;
        head.approval = Some(LessonApproval {
            approved_by_pubkey: "ef".repeat(32),
            approved_at: now,
        });
        assert!(validate_lesson_head(&head).is_ok());
    }
}
