//! Typed event builder for the company business profile.
//!
//! The action is company-wide: it carries the fixed `d` coordinate and no
//! channel `h` tag.

use crate::SdkError;
use buzz_core::company_profile::{
    validate_business_profile, BusinessProfileAction, BUSINESS_PROFILE_D_TAG,
};
use buzz_core::kind::KIND_BUSINESS_PROFILE_ACTION;
use nostr::{EventBuilder, Kind, Tag};

/// Build an owner- or admin-signed business profile replacement.
pub fn build_business_profile_action(
    action: &BusinessProfileAction,
) -> Result<EventBuilder, SdkError> {
    validate_business_profile(&action.profile)
        .map_err(|error| SdkError::InvalidInput(format!("business profile is invalid: {error}")))?;
    let content = serde_json::to_string(action).map_err(|error| {
        SdkError::InvalidInput(format!(
            "business profile action serialization failed: {error}"
        ))
    })?;
    let d = Tag::parse(["d", BUSINESS_PROFILE_D_TAG])
        .map_err(|error| SdkError::InvalidTag(error.to_string()))?;
    Ok(EventBuilder::new(Kind::Custom(KIND_BUSINESS_PROFILE_ACTION as u16), content).tag(d))
}

#[cfg(test)]
mod tests {
    use super::*;
    use nostr::Keys;

    fn action() -> BusinessProfileAction {
        let profile = serde_json::from_value(serde_json::json!({
            "schemaVersion": 1,
            "name": "Lerato Designs",
            "timeZone": "Africa/Johannesburg"
        }))
        .expect("minimal profile");
        BusinessProfileAction {
            profile,
            expected_revision: None,
        }
    }

    #[test]
    fn profile_action_is_company_wide_with_the_fixed_coordinate() {
        let event = build_business_profile_action(&action())
            .expect("valid action")
            .sign_with_keys(&Keys::generate())
            .expect("sign action");
        assert_eq!(
            event.kind,
            Kind::Custom(KIND_BUSINESS_PROFILE_ACTION as u16)
        );
        let d_tags: Vec<_> = event
            .tags
            .iter()
            .filter(|tag| tag.kind().to_string() == "d")
            .filter_map(|tag| tag.content())
            .collect();
        assert_eq!(d_tags, vec![BUSINESS_PROFILE_D_TAG]);
        assert!(event.tags.iter().all(|tag| tag.kind().to_string() != "h"));
        let parsed: BusinessProfileAction =
            serde_json::from_str(&event.content).expect("content round-trips");
        assert_eq!(parsed, action());
    }

    #[test]
    fn invalid_profiles_are_refused_before_signing() {
        let mut invalid = action();
        invalid.profile.time_zone = "Mars/Olympus".into();
        assert!(build_business_profile_action(&invalid).is_err());
    }

    #[test]
    fn profile_card_fields_round_trip_and_are_validated_before_signing() {
        let mut complete = action();
        complete.profile.best_sellers = vec!["Linen dress".into()];
        complete.profile.price_range = Some("R500 to R1500".into());
        let event = build_business_profile_action(&complete)
            .expect("valid card fields")
            .sign_with_keys(&Keys::generate())
            .expect("sign action");
        let parsed: BusinessProfileAction =
            serde_json::from_str(&event.content).expect("card fields round-trip");
        assert_eq!(parsed, complete);

        let mut too_many = complete.clone();
        too_many.profile.best_sellers = vec!["Linen dress".into(); 4];
        assert!(build_business_profile_action(&too_many).is_err());
        complete.profile.price_range = Some("p".repeat(121));
        assert!(build_business_profile_action(&complete).is_err());
    }
}
