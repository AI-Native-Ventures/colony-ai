//! Typed, additive qualification observations for Discovery prospects.
//!
//! A qualification action carries the complete selected-signal result for one
//! lead and one run. The relay turns that action into a replaceable head, while
//! immutable member actions retain prior runs. This module has no I/O and
//! validates the payload before a relay can persist it.

use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;
use url::Url;
use uuid::Uuid;

use crate::business_records::{business_d_tag, BUSINESS_RECORD_SCHEMA_VERSION};

/// At most the thirteen v1 signals may be stored in one lead snapshot.
pub const MAX_QUALIFY_OBSERVATIONS_PER_ACTION: usize = 13;
/// A fetched run can retain evidence from at most five pages.
pub const MAX_QUALIFY_EVIDENCE_URLS: usize = 5;
/// Longest text signal value in characters.
pub const MAX_QUALIFY_VALUE_CHARS: usize = 1_000;
/// Longest reason explaining why a signal was not checked.
pub const MAX_QUALIFY_NOT_CHECKED_REASON_CHARS: usize = 160;
/// Longest evidence URL in characters.
pub const MAX_QUALIFY_EVIDENCE_URL_CHARS: usize = 2_048;

/// The thirteen v1 website and Maps signals.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum QualifySignal {
    /// Google Maps has no website URL, or it points at a non-site profile.
    NoWebsite,
    /// The website homepage could not be reached.
    SiteDown,
    /// The final homepage does not use HTTPS.
    NoHttps,
    /// The homepage lacks basic responsive hints.
    NotMobileFriendly,
    /// No booking option was found in the bounded fetched pages.
    NoOnlineBooking,
    /// No WhatsApp link was found in static page content.
    NoWhatsappLink,
    /// A WhatsApp link was found in fetched page content.
    HasWhatsappLink,
    /// Google Ads or Meta pixel markers were found.
    RunningAds,
    /// The site contains an old copyright or post date.
    StaleSite,
    /// A known website builder marker was found.
    SiteBuilder,
    /// A credible footer credit names another website builder or agency.
    IncumbentBuilder,
    /// A Facebook or Instagram link was found.
    SocialLinks,
    /// A public contact email was found in page content.
    PublicEmail,
}

/// Whether a selected signal was actually observed or could not be checked.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum QualifyObservationState {
    /// The signal is supported by the stored value and evidence.
    Observed,
    /// The selected signal was not assessed and cannot support a claim.
    NotChecked,
}

/// One observed or explicitly not-checked qualification fact.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct QualifyObservation {
    /// Stable v1 signal code.
    pub signal: QualifySignal,
    /// Whether the signal was observed or could not be checked.
    pub state: QualifyObservationState,
    /// Human-readable or numeric fact value when the signal was observed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<Value>,
    /// Confidence from zero through one.
    pub confidence: f64,
    /// Bounded page or Maps URLs that support the observation.
    #[serde(default)]
    pub evidence_urls: Vec<String>,
    /// Unix seconds when the fact was observed or declared not checked.
    pub observed_at: i64,
    /// Stable id of the qualification run that produced this row.
    pub run_id: Uuid,
    /// Bounded reason when `state` is `not_checked`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub not_checked_reason: Option<String>,
    /// Whether a public email appears to be personal data.
    #[serde(default)]
    pub personal_data: bool,
}

/// Member request to store a complete qualification result for one lead.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct QualifyObservationAction {
    /// Schema version shared by business records.
    pub schema_version: u8,
    /// Prospect UUID whose website was checked.
    pub lead_id: Uuid,
    /// Stable run UUID shared by all rows in this write.
    pub run_id: Uuid,
    /// Exact existing head event id, absent only when this lead has no head.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_head_event_id: Option<String>,
    /// Signals explicitly selected and attempted in this complete lead check.
    pub checked_signals: Vec<QualifySignal>,
    /// Complete set of selected-signal results for this lead and run.
    pub observations: Vec<QualifyObservation>,
}

/// Relay-authored latest qualification snapshot for one lead.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct QualifyObservationHead {
    /// Schema version shared by business records.
    pub schema_version: u8,
    /// Prospect UUID whose website was checked.
    pub lead_id: Uuid,
    /// Stable run UUID shared by all rows in this snapshot.
    pub run_id: Uuid,
    /// Signals explicitly selected and attempted in this complete lead check.
    pub checked_signals: Vec<QualifySignal>,
    /// Complete selected-signal result set.
    pub observations: Vec<QualifyObservation>,
    /// Unix seconds when the relay accepted the complete snapshot.
    pub checked_at: i64,
    /// Member action event that caused this head.
    pub source_action_event_id: String,
}

/// A qualification payload breaks a bounded schema rule.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum QualifyError {
    /// The payload is malformed or outside the v1 contract.
    #[error("{0}")]
    Invalid(String),
}

fn invalid<T>(message: impl Into<String>) -> Result<T, QualifyError> {
    Err(QualifyError::Invalid(message.into()))
}

/// Return the NIP-33 d-tag for one lead's qualification snapshot.
pub fn qualify_observation_d_tag(community_id: Uuid, lead_id: Uuid) -> String {
    business_d_tag(community_id, "qualify_observation", lead_id)
}

/// Validate a member action before the relay reads or writes a head.
pub fn validate_qualify_observation_action(
    action: &QualifyObservationAction,
) -> Result<(), QualifyError> {
    if action.schema_version != BUSINESS_RECORD_SCHEMA_VERSION {
        return invalid("unsupported qualification schema version");
    }
    if action.lead_id.is_nil() || action.run_id.is_nil() {
        return invalid("qualification leadId and runId are required");
    }
    if let Some(event_id) = action.expected_head_event_id.as_deref() {
        validate_event_id(event_id, "expectedHeadEventId")?;
    }
    validate_observation_snapshot(
        action.lead_id,
        action.run_id,
        &action.checked_signals,
        &action.observations,
    )
}

/// Validate a relay-authored qualification head before clients rely on it.
pub fn validate_qualify_observation_head(
    head: &QualifyObservationHead,
) -> Result<(), QualifyError> {
    if head.schema_version != BUSINESS_RECORD_SCHEMA_VERSION {
        return invalid("unsupported qualification schema version");
    }
    if head.checked_at <= 0 {
        return invalid("qualification checkedAt must be a positive timestamp");
    }
    validate_event_id(&head.source_action_event_id, "sourceActionEventId")?;
    validate_observation_snapshot(
        head.lead_id,
        head.run_id,
        &head.checked_signals,
        &head.observations,
    )
}

/// Build the relay-authored latest head from an already validated action.
pub fn qualify_observation_head_from_action(
    action: &QualifyObservationAction,
    checked_at: i64,
    source_action_event_id: String,
) -> Result<QualifyObservationHead, QualifyError> {
    validate_qualify_observation_action(action)?;
    if checked_at <= 0 {
        return invalid("qualification checkedAt must be a positive timestamp");
    }
    validate_event_id(&source_action_event_id, "sourceActionEventId")?;
    Ok(QualifyObservationHead {
        schema_version: BUSINESS_RECORD_SCHEMA_VERSION,
        lead_id: action.lead_id,
        run_id: action.run_id,
        checked_signals: action.checked_signals.clone(),
        observations: action.observations.clone(),
        checked_at,
        source_action_event_id,
    })
}

fn validate_observation_snapshot(
    lead_id: Uuid,
    run_id: Uuid,
    checked_signals: &[QualifySignal],
    observations: &[QualifyObservation],
) -> Result<(), QualifyError> {
    if lead_id.is_nil() || run_id.is_nil() {
        return invalid("qualification leadId and runId are required");
    }
    if checked_signals.is_empty() || checked_signals.len() > MAX_QUALIFY_OBSERVATIONS_PER_ACTION {
        return invalid("qualification needs one through thirteen checked signals");
    }
    if observations.len() > MAX_QUALIFY_OBSERVATIONS_PER_ACTION {
        return invalid("qualification has too many observations");
    }
    let checked: BTreeSet<_> = checked_signals.iter().copied().collect();
    if checked.len() != checked_signals.len() {
        return invalid("qualification checked signals must be unique");
    }
    let mut observed_signals = BTreeSet::new();
    for observation in observations {
        if observation.run_id != run_id {
            return invalid("qualification observation runId does not match action runId");
        }
        if !checked.contains(&observation.signal) {
            return invalid("qualification observation signal was not selected");
        }
        if !observed_signals.insert(observation.signal) {
            return invalid("qualification observations must use unique signals");
        }
        validate_observation(observation)?;
    }
    Ok(())
}

fn validate_observation(observation: &QualifyObservation) -> Result<(), QualifyError> {
    if observation.observed_at <= 0 {
        return invalid("qualification observedAt must be a positive timestamp");
    }
    if !observation.confidence.is_finite()
        || observation.confidence < 0.0
        || observation.confidence > 1.0
    {
        return invalid("qualification confidence must be between zero and one");
    }
    if observation.evidence_urls.len() > MAX_QUALIFY_EVIDENCE_URLS {
        return invalid("qualification has too many evidence URLs");
    }
    for url in &observation.evidence_urls {
        validate_evidence_url(url)?;
    }
    match observation.state {
        QualifyObservationState::Observed => {
            validate_observed_value(observation.value.as_ref())?;
            if observation.not_checked_reason.is_some() {
                return invalid("observed qualification cannot have a notCheckedReason");
            }
            if observation.signal != QualifySignal::NoWebsite
                && observation.evidence_urls.is_empty()
            {
                return invalid("observed qualification needs evidence URLs");
            }
            if observation.personal_data && observation.signal != QualifySignal::PublicEmail {
                return invalid("only a public email can be marked personal data");
            }
            if observation.signal == QualifySignal::NoOnlineBooking && observation.confidence > 0.6
            {
                return invalid("no-online-booking confidence cannot exceed 0.6");
            }
            if observation.signal == QualifySignal::NoWhatsappLink && observation.confidence > 0.7 {
                return invalid("no-WhatsApp-link confidence cannot exceed 0.7");
            }
            if observation.signal == QualifySignal::IncumbentBuilder
                && observation.confidence < 0.75
            {
                return invalid("incumbent-builder confidence must be at least 0.75");
            }
        }
        QualifyObservationState::NotChecked => {
            if observation.value.is_some()
                || observation.confidence != 0.0
                || !observation.evidence_urls.is_empty()
                || observation.personal_data
            {
                return invalid("not-checked qualification cannot carry a claim");
            }
            let reason = observation
                .not_checked_reason
                .as_deref()
                .map(str::trim)
                .filter(|reason| !reason.is_empty());
            if reason
                .is_none_or(|reason| reason.chars().count() > MAX_QUALIFY_NOT_CHECKED_REASON_CHARS)
            {
                return invalid("not-checked qualification needs a bounded reason");
            }
        }
    }
    Ok(())
}

fn validate_observed_value(value: Option<&Value>) -> Result<(), QualifyError> {
    match value {
        Some(Value::String(text))
            if !text.trim().is_empty() && text.chars().count() <= MAX_QUALIFY_VALUE_CHARS =>
        {
            Ok(())
        }
        Some(Value::Number(_)) => Ok(()),
        _ => invalid("observed qualification needs a bounded text or numeric value"),
    }
}

fn validate_evidence_url(value: &str) -> Result<(), QualifyError> {
    if value.chars().count() > MAX_QUALIFY_EVIDENCE_URL_CHARS {
        return invalid("qualification evidence URL is too long");
    }
    let parsed = Url::parse(value)
        .map_err(|_| QualifyError::Invalid("invalid qualification evidence URL".into()))?;
    if !matches!(parsed.scheme(), "http" | "https")
        || parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.port().is_some_and(|port| port != 80 && port != 443)
    {
        return invalid("qualification evidence URL must be public HTTP or HTTPS");
    }
    Ok(())
}

fn validate_event_id(value: &str, field: &str) -> Result<(), QualifyError> {
    if value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        Ok(())
    } else {
        invalid(format!("{field} must be a 64 character lowercase hex id"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const EVENT_ID: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    fn observed(signal: QualifySignal) -> QualifyObservation {
        QualifyObservation {
            signal,
            state: QualifyObservationState::Observed,
            value: Some(Value::String("found".into())),
            confidence: 0.9,
            evidence_urls: vec!["https://example.test/".into()],
            observed_at: 1_762_000_000,
            run_id: Uuid::from_u128(2),
            not_checked_reason: None,
            personal_data: false,
        }
    }

    fn action() -> QualifyObservationAction {
        QualifyObservationAction {
            schema_version: BUSINESS_RECORD_SCHEMA_VERSION,
            lead_id: Uuid::from_u128(1),
            run_id: Uuid::from_u128(2),
            expected_head_event_id: None,
            checked_signals: vec![QualifySignal::HasWhatsappLink],
            observations: vec![observed(QualifySignal::HasWhatsappLink)],
        }
    }

    #[test]
    fn observed_facts_require_a_supported_value_and_evidence() {
        assert!(validate_qualify_observation_action(&action()).is_ok());

        let mut missing_evidence = action();
        missing_evidence.observations[0].evidence_urls.clear();
        assert!(validate_qualify_observation_action(&missing_evidence).is_err());

        let mut no_website = action();
        no_website.checked_signals = vec![QualifySignal::NoWebsite];
        no_website.observations[0] = observed(QualifySignal::NoWebsite);
        no_website.observations[0].evidence_urls.clear();
        assert!(validate_qualify_observation_action(&no_website).is_ok());
    }

    #[test]
    fn not_checked_rows_cannot_be_misread_as_negative_claims() {
        let mut record = action();
        record.checked_signals = vec![QualifySignal::NoOnlineBooking];
        record.observations[0] = QualifyObservation {
            signal: QualifySignal::NoOnlineBooking,
            state: QualifyObservationState::NotChecked,
            value: None,
            confidence: 0.0,
            evidence_urls: Vec::new(),
            observed_at: 1_762_000_000,
            run_id: record.run_id,
            not_checked_reason: Some("blocked_by_site".into()),
            personal_data: false,
        };
        assert!(validate_qualify_observation_action(&record).is_ok());

        record.observations[0].value = Some(Value::String("no booking found".into()));
        assert!(validate_qualify_observation_action(&record).is_err());
    }

    #[test]
    fn action_rejects_duplicate_signals_and_mismatched_run_ids() {
        let mut record = action();
        record
            .observations
            .push(observed(QualifySignal::HasWhatsappLink));
        assert!(validate_qualify_observation_action(&record).is_err());

        let mut mismatch = action();
        mismatch.observations[0].run_id = Uuid::from_u128(3);
        assert!(validate_qualify_observation_action(&mismatch).is_err());
    }

    #[test]
    fn snapshot_can_prove_a_signal_was_checked_without_finding_a_fact() {
        let mut record = action();
        record.observations.clear();
        assert!(validate_qualify_observation_action(&record).is_ok());

        record.checked_signals.push(QualifySignal::HasWhatsappLink);
        assert!(validate_qualify_observation_action(&record).is_err());
    }

    #[test]
    fn public_email_is_the_only_personal_data_signal() {
        let mut record = action();
        record.observations[0].personal_data = true;
        assert!(validate_qualify_observation_action(&record).is_err());

        record.observations[0].signal = QualifySignal::PublicEmail;
        record.checked_signals = vec![QualifySignal::PublicEmail];
        assert!(validate_qualify_observation_action(&record).is_ok());
    }

    #[test]
    fn negative_and_incumbent_signal_confidence_contracts_are_enforced() {
        let mut booking = action();
        booking.checked_signals = vec![QualifySignal::NoOnlineBooking];
        booking.observations[0] = observed(QualifySignal::NoOnlineBooking);
        booking.observations[0].confidence = 0.61;
        assert!(validate_qualify_observation_action(&booking).is_err());
        booking.observations[0].confidence = 0.6;
        assert!(validate_qualify_observation_action(&booking).is_ok());

        let mut whatsapp = action();
        whatsapp.checked_signals = vec![QualifySignal::NoWhatsappLink];
        whatsapp.observations[0] = observed(QualifySignal::NoWhatsappLink);
        whatsapp.observations[0].confidence = 0.71;
        assert!(validate_qualify_observation_action(&whatsapp).is_err());
        whatsapp.observations[0].confidence = 0.7;
        assert!(validate_qualify_observation_action(&whatsapp).is_ok());

        let mut incumbent = action();
        incumbent.checked_signals = vec![QualifySignal::IncumbentBuilder];
        incumbent.observations[0] = observed(QualifySignal::IncumbentBuilder);
        incumbent.observations[0].confidence = 0.74;
        assert!(validate_qualify_observation_action(&incumbent).is_err());
        incumbent.observations[0].confidence = 0.75;
        assert!(validate_qualify_observation_action(&incumbent).is_ok());
    }

    #[test]
    fn head_derives_a_complete_snapshot_from_a_valid_action() {
        let head = qualify_observation_head_from_action(&action(), 1_762_000_001, EVENT_ID.into())
            .expect("valid head");
        assert_eq!(head.lead_id, Uuid::from_u128(1));
        assert_eq!(head.source_action_event_id, EVENT_ID);
        assert!(validate_qualify_observation_head(&head).is_ok());
    }

    #[test]
    fn d_tag_is_scoped_to_the_community_and_lead() {
        assert_eq!(
            qualify_observation_d_tag(Uuid::from_u128(7), Uuid::from_u128(8)),
            "business:00000000-0000-0000-0000-000000000007:qualify_observation:00000000-0000-0000-0000-000000000008"
        );
    }
}
