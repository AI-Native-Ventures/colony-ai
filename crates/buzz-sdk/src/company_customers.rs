//! Typed event builder for co-founder customer record actions (refresh,
//! conversion, milestones, emails and files).

use buzz_core::company_customers::{validate_customer_action, CustomerAction};
use buzz_core::kind::KIND_CUSTOMER_ACTION;
use nostr::{EventBuilder, Kind, Tag};

use crate::SdkError;

/// Build a member-signed customer record action with its community-wide d-tag
/// (`customer:<partyId>`) and no `h` or `p` tag.
pub fn build_customer_action(action: &CustomerAction) -> Result<EventBuilder, SdkError> {
    validate_customer_action(action)
        .map_err(|error| SdkError::InvalidInput(format!("customer action is invalid: {error}")))?;
    let d_value = action
        .d_tag()
        .map_err(|error| SdkError::InvalidInput(format!("customer d-tag is invalid: {error}")))?;
    let content = serde_json::to_string(action).map_err(|error| {
        SdkError::InvalidInput(format!("customer action serialization failed: {error}"))
    })?;
    let d_tag = Tag::parse(["d", d_value.as_str()])
        .map_err(|error| SdkError::InvalidTag(error.to_string()))?;
    Ok(EventBuilder::new(Kind::Custom(KIND_CUSTOMER_ACTION as u16), content).tag(d_tag))
}

#[cfg(test)]
mod tests {
    use super::*;
    use buzz_core::company_customers::CustomerOp;
    use buzz_core::company_records::COMPANY_RECORD_SCHEMA_VERSION;
    use nostr::Keys;

    const PARTY: &str = "7f0c3c1e-5b1e-4d52-9a55-3d1f2b6a8c10";

    fn refresh() -> CustomerAction {
        CustomerAction {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            party_id: PARTY.into(),
            op: CustomerOp::Refresh,
            milestone_kind: None,
            at: None,
            title: None,
            note: None,
            file_ref: None,
            from: None,
            subject: None,
            date: None,
            summary: None,
            file_refs: None,
            label: None,
            attachment_id: None,
            expected_head_event_id: None,
        }
    }

    #[test]
    fn a_refresh_carries_one_d_tag_and_signs() {
        let event = build_customer_action(&refresh())
            .expect("builder")
            .sign_with_keys(&Keys::generate())
            .expect("sign");
        assert_eq!(u32::from(event.kind.as_u16()), KIND_CUSTOMER_ACTION);
        assert_eq!(event.tags.len(), 1);
        assert!(event.tags.iter().any(|tag| {
            tag.kind().to_string() == "d"
                && tag.content() == Some(format!("customer:{PARTY}").as_str())
        }));
    }

    #[test]
    fn an_invalid_action_is_refused_before_signing() {
        let mut action = refresh();
        action.label = Some("not for a refresh".into());
        assert!(build_customer_action(&action).is_err());
    }
}
