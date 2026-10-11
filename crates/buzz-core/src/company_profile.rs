//! Typed company business profile (kinds 30657 and 47046).
//!
//! The profile is the company-wide set of facts every employee works from.
//! The relay stores it as one relay-signed head with a `revision` tag. Owners
//! and admins replace it with a member-signed action that names the revision
//! it was based on, so two people saving at once cannot overwrite each other.

use serde::{Deserialize, Serialize};

use crate::company_records::CompanyRecordError;

/// The `d` coordinate of the single business profile head per company.
pub const BUSINESS_PROFILE_D_TAG: &str = "business-profile";
/// Tag on the head that carries its revision number.
pub const BUSINESS_PROFILE_REVISION_TAG: &str = "revision";
/// Profile schema version this build understands.
pub const BUSINESS_PROFILE_SCHEMA_VERSION: u8 = 1;
/// Maximum characters in the business name.
pub const MAX_PROFILE_NAME_CHARS: usize = 120;
/// Maximum characters in a general text field or list item.
pub const MAX_PROFILE_TEXT_CHARS: usize = 500;
/// Maximum items in a general list field.
pub const MAX_PROFILE_LIST_ITEMS: usize = 10;
/// Maximum best sellers listed in a business profile.
pub const MAX_PROFILE_BEST_SELLERS: usize = 3;
/// Maximum characters in a best seller or price range.
pub const MAX_PROFILE_SHORT_TEXT_CHARS: usize = 120;
/// Maximum serialized size of a profile in bytes.
pub const MAX_PROFILE_BYTES: usize = 16 * 1024;

/// Contact details shown to customers.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct BusinessProfileContact {
    /// Customer-facing email address.
    #[serde(default)]
    pub email: Option<String>,
    /// Customer-facing phone number.
    #[serde(default)]
    pub phone: Option<String>,
    /// WhatsApp number customers may use.
    #[serde(default)]
    pub whatsapp: Option<String>,
    /// Street or postal address; may span several lines.
    #[serde(default)]
    pub address: Option<String>,
}

/// Details printed on invoices and quotes.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct BusinessProfileInvoice {
    /// Registered business name.
    #[serde(default)]
    pub registered_name: Option<String>,
    /// Company registration number.
    #[serde(default)]
    pub registration_number: Option<String>,
    /// VAT number, when the business is registered for VAT.
    #[serde(default)]
    pub vat_number: Option<String>,
    /// Banking details printed on invoices.
    #[serde(default)]
    pub bank_details: Option<String>,
}

/// Social account names used to open the right app at posting time.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct BusinessProfileSocialAccounts {
    /// Instagram account name.
    #[serde(default)]
    pub instagram: Option<String>,
    /// Facebook page name.
    #[serde(default)]
    pub facebook: Option<String>,
    /// TikTok account name.
    #[serde(default)]
    pub tiktok: Option<String>,
    /// LinkedIn page name.
    #[serde(default)]
    pub linkedin: Option<String>,
    /// X account name.
    #[serde(default)]
    pub x: Option<String>,
}

/// Company-wide business profile: the content of head kind 30657.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct BusinessProfile {
    /// Profile schema version; must be [`BUSINESS_PROFILE_SCHEMA_VERSION`].
    pub schema_version: u8,
    /// Business name, also shown everywhere as the company name.
    pub name: String,
    /// What the business sells, in one or two sentences.
    #[serde(default)]
    pub what_you_sell: Option<String>,
    /// Up to three best-selling products or services, each at most 120 characters.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub best_sellers: Vec<String>,
    /// Typical prices, at most 120 characters; omitted when unknown.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub price_range: Option<String>,
    /// Who usually buys.
    #[serde(default)]
    pub who_buys: Option<String>,
    /// Where the business sells today.
    #[serde(default)]
    pub where_you_sell: Vec<String>,
    /// City the business is based in.
    #[serde(default)]
    pub city: Option<String>,
    /// Country the business is based in.
    #[serde(default)]
    pub country: Option<String>,
    /// IANA time zone every routine follows.
    pub time_zone: String,
    /// Website and social links employees may read.
    #[serde(default)]
    pub links: Vec<String>,
    /// How the business sounds, in a few words.
    #[serde(default)]
    pub voice_words: Vec<String>,
    /// Goals for the next three months.
    #[serde(default)]
    pub goals: Vec<String>,
    /// Contact details customers see.
    #[serde(default)]
    pub contact: BusinessProfileContact,
    /// Link customers use to pay or order.
    #[serde(default)]
    pub buy_link: Option<String>,
    /// Details printed on invoices and quotes.
    #[serde(default)]
    pub invoice: BusinessProfileInvoice,
    /// Social account names.
    #[serde(default)]
    pub social_accounts: BusinessProfileSocialAccounts,
}

/// Owner- or admin-signed replacement of the profile: the content of kind 47046.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct BusinessProfileAction {
    /// The complete new profile.
    pub profile: BusinessProfile,
    /// Revision the change was based on; `None` only for the first profile.
    pub expected_revision: Option<u32>,
}

/// Why a profile write was refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProfileRevisionConflict {
    /// A profile exists, so the write must name its current revision.
    ProfileExists {
        /// The head's current revision.
        current: u32,
    },
    /// The write named a revision, but no profile exists yet.
    ProfileMissing,
    /// The write was based on an older revision.
    Stale {
        /// The head's current revision.
        current: u32,
    },
}

/// Check every profile rule from the contract.
pub fn validate_business_profile(profile: &BusinessProfile) -> Result<(), CompanyRecordError> {
    if profile.schema_version != BUSINESS_PROFILE_SCHEMA_VERSION {
        return Err(CompanyRecordError::UnsupportedSchemaVersion);
    }
    if profile.name.trim().is_empty()
        || profile.name.chars().count() > MAX_PROFILE_NAME_CHARS
        || profile.name.chars().any(char::is_control)
    {
        return Err(CompanyRecordError::Invalid(
            "name must be 1 to 120 characters without control characters",
        ));
    }
    let texts = [
        &profile.what_you_sell,
        &profile.who_buys,
        &profile.city,
        &profile.country,
        &profile.buy_link,
        &profile.contact.email,
        &profile.contact.phone,
        &profile.contact.whatsapp,
        &profile.contact.address,
        &profile.invoice.registered_name,
        &profile.invoice.registration_number,
        &profile.invoice.vat_number,
        &profile.invoice.bank_details,
        &profile.social_accounts.instagram,
        &profile.social_accounts.facebook,
        &profile.social_accounts.tiktok,
        &profile.social_accounts.linkedin,
        &profile.social_accounts.x,
    ];
    for text in texts.into_iter().flatten() {
        check_text(text)?;
    }
    if profile.best_sellers.len() > MAX_PROFILE_BEST_SELLERS {
        return Err(CompanyRecordError::Invalid(
            "bestSellers holds at most 3 items",
        ));
    }
    for item in &profile.best_sellers {
        check_profile_card_text(item)?;
    }
    if let Some(price_range) = &profile.price_range {
        check_profile_card_text(price_range)?;
    }
    for list in [
        &profile.where_you_sell,
        &profile.links,
        &profile.voice_words,
        &profile.goals,
    ] {
        if list.len() > MAX_PROFILE_LIST_ITEMS {
            return Err(CompanyRecordError::Invalid("lists hold at most 10 items"));
        }
        for item in list {
            check_text(item)?;
        }
    }
    if profile.time_zone.parse::<chrono_tz::Tz>().is_err() {
        return Err(CompanyRecordError::Invalid(
            "timeZone must be an IANA time zone name",
        ));
    }
    let size = serde_json::to_vec(profile)
        .map_err(|_| CompanyRecordError::InvalidContent)?
        .len();
    if size > MAX_PROFILE_BYTES {
        return Err(CompanyRecordError::Invalid("profile must be at most 16 KB"));
    }
    Ok(())
}

/// Revision for a write based on `expected`, given the head's `current` revision.
pub fn next_profile_revision(
    current: Option<u32>,
    expected: Option<u32>,
) -> Result<u32, ProfileRevisionConflict> {
    match (current, expected) {
        (None, None) => Ok(1),
        (None, Some(_)) => Err(ProfileRevisionConflict::ProfileMissing),
        (Some(current), None) => Err(ProfileRevisionConflict::ProfileExists { current }),
        (Some(current), Some(expected)) if expected == current => current
            .checked_add(1)
            .ok_or(ProfileRevisionConflict::Stale { current }),
        (Some(current), Some(_)) => Err(ProfileRevisionConflict::Stale { current }),
    }
}

fn check_text(value: &str) -> Result<(), CompanyRecordError> {
    if value.chars().count() > MAX_PROFILE_TEXT_CHARS {
        return Err(CompanyRecordError::Invalid(
            "text fields hold at most 500 characters",
        ));
    }
    if value
        .chars()
        .any(|character| character.is_control() && character != '\n')
    {
        return Err(CompanyRecordError::Invalid(
            "text fields cannot contain control characters",
        ));
    }
    Ok(())
}

fn check_profile_card_text(value: &str) -> Result<(), CompanyRecordError> {
    if value.chars().count() > MAX_PROFILE_SHORT_TEXT_CHARS {
        return Err(CompanyRecordError::Invalid(
            "bestSellers items and priceRange hold at most 120 characters",
        ));
    }
    check_text(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn contract_json() -> serde_json::Value {
        serde_json::json!({
            "schemaVersion": 1,
            "name": "Lerato Designs",
            "whatYouSell": "Women's clothing in natural linen and cotton, made in Johannesburg.",
            "whoBuys": "Women aged 25 to 45 who like local, made-to-last clothing.",
            "whereYouSell": ["instagram", "website", "markets"],
            "city": "Johannesburg",
            "country": "South Africa",
            "timeZone": "Africa/Johannesburg",
            "links": ["https://leratodesigns.co.za", "https://instagram.com/leratodesigns"],
            "voiceWords": ["warm", "confident", "local"],
            "goals": ["More sales", "Bulk orders and stockists"],
            "contact": { "email": "hello@leratodesigns.co.za", "phone": null, "whatsapp": null, "address": null },
            "buyLink": null,
            "invoice": { "registeredName": null, "registrationNumber": null, "vatNumber": null, "bankDetails": null },
            "socialAccounts": { "instagram": "leratodesigns", "facebook": null, "tiktok": null, "linkedin": null, "x": null }
        })
    }

    fn sample() -> BusinessProfile {
        serde_json::from_value(contract_json()).expect("the overview's example profile parses")
    }

    #[test]
    fn contract_example_round_trips_with_the_same_field_names() {
        let profile = sample();
        validate_business_profile(&profile).expect("the contract example is valid");
        assert_eq!(
            serde_json::to_value(&profile).expect("serialize profile"),
            contract_json()
        );
    }

    #[test]
    fn unknown_keys_are_rejected_at_every_level() {
        let mut top = contract_json();
        top["mission"] = serde_json::json!("Dress the city");
        assert!(serde_json::from_value::<BusinessProfile>(top).is_err());
        let mut nested = contract_json();
        nested["contact"]["fax"] = serde_json::json!("011 555 0100");
        assert!(serde_json::from_value::<BusinessProfile>(nested).is_err());
    }

    #[test]
    fn name_schema_and_time_zone_are_checked() {
        let mut nameless = sample();
        nameless.name = "   ".into();
        assert!(validate_business_profile(&nameless).is_err());
        let mut long_name = sample();
        long_name.name = "n".repeat(MAX_PROFILE_NAME_CHARS + 1);
        assert!(validate_business_profile(&long_name).is_err());
        let mut bad_zone = sample();
        bad_zone.time_zone = "Mars/Olympus".into();
        assert!(validate_business_profile(&bad_zone).is_err());
        let mut missing_zone = contract_json();
        missing_zone
            .as_object_mut()
            .expect("profile object")
            .remove("timeZone");
        assert!(serde_json::from_value::<BusinessProfile>(missing_zone).is_err());
        let mut wrong_version = sample();
        wrong_version.schema_version = 2;
        assert_eq!(
            validate_business_profile(&wrong_version),
            Err(CompanyRecordError::UnsupportedSchemaVersion)
        );
    }

    #[test]
    fn text_lists_and_total_size_are_bounded() {
        let mut long_text = sample();
        long_text.what_you_sell = Some("w".repeat(MAX_PROFILE_TEXT_CHARS + 1));
        assert!(validate_business_profile(&long_text).is_err());
        let mut long_list = sample();
        long_list.goals = vec!["More sales".to_owned(); MAX_PROFILE_LIST_ITEMS + 1];
        assert!(validate_business_profile(&long_list).is_err());
        let mut control = sample();
        control.city = Some("Johannes\u{0007}burg".into());
        assert!(validate_business_profile(&control).is_err());

        let item = "x".repeat(MAX_PROFILE_TEXT_CHARS);
        let mut huge = sample();
        huge.where_you_sell = vec![item.clone(); MAX_PROFILE_LIST_ITEMS];
        huge.links = vec![item.clone(); MAX_PROFILE_LIST_ITEMS];
        huge.voice_words = vec![item.clone(); MAX_PROFILE_LIST_ITEMS];
        huge.goals = vec![item; MAX_PROFILE_LIST_ITEMS];
        assert_eq!(
            validate_business_profile(&huge),
            Err(CompanyRecordError::Invalid("profile must be at most 16 KB"))
        );

        let mut multi_line = sample();
        multi_line.contact.address = Some("12 Jan Smuts Avenue\nRosebank\nJohannesburg".into());
        validate_business_profile(&multi_line).expect("addresses may span lines");
    }

    #[test]
    fn revisions_start_at_one_and_must_match_the_current_head() {
        assert_eq!(next_profile_revision(None, None), Ok(1));
        assert_eq!(next_profile_revision(Some(3), Some(3)), Ok(4));
        assert_eq!(
            next_profile_revision(Some(3), None),
            Err(ProfileRevisionConflict::ProfileExists { current: 3 })
        );
        assert_eq!(
            next_profile_revision(Some(3), Some(2)),
            Err(ProfileRevisionConflict::Stale { current: 3 })
        );
        assert_eq!(
            next_profile_revision(None, Some(1)),
            Err(ProfileRevisionConflict::ProfileMissing)
        );
    }

    #[test]
    fn profile_card_fields_default_and_omit_empty_values_but_allow_a_null_price_range() {
        let omitted = sample();
        assert!(omitted.best_sellers.is_empty());
        assert_eq!(omitted.price_range, None);

        let mut explicit = contract_json();
        explicit["bestSellers"] = serde_json::json!([]);
        explicit["priceRange"] = serde_json::Value::Null;
        let profile: BusinessProfile = serde_json::from_value(explicit).expect("empty card fields");
        validate_business_profile(&profile).expect("empty card fields are optional");
        assert_eq!(
            serde_json::to_value(profile).expect("serialize profile"),
            contract_json()
        );

        let mut null_list = contract_json();
        null_list["bestSellers"] = serde_json::Value::Null;
        assert!(serde_json::from_value::<BusinessProfile>(null_list).is_err());
    }

    #[test]
    fn profile_card_fields_accept_three_items_and_120_unicode_characters() {
        let mut profile = sample();
        profile.best_sellers = vec!["é".repeat(120); 3];
        profile.price_range = Some("é".repeat(120));
        validate_business_profile(&profile).expect("card field boundaries count characters");
        let json = serde_json::to_value(&profile).expect("serialize card fields");
        assert_eq!(json["bestSellers"], serde_json::json!(profile.best_sellers));
        assert_eq!(json["priceRange"], serde_json::json!(profile.price_range));
        assert_eq!(
            serde_json::from_value::<BusinessProfile>(json).expect("card fields round-trip"),
            profile
        );
    }

    #[test]
    fn profile_card_fields_reject_a_fourth_item_and_121_characters() {
        let mut too_many = sample();
        too_many.best_sellers = vec!["Linen dress".into(); 4];
        assert!(validate_business_profile(&too_many).is_err());

        let mut long_best_seller = sample();
        long_best_seller.best_sellers = vec!["s".repeat(121)];
        assert!(validate_business_profile(&long_best_seller).is_err());

        let mut long_price_range = sample();
        long_price_range.price_range = Some("p".repeat(121));
        assert!(validate_business_profile(&long_price_range).is_err());
    }

    #[test]
    fn profile_card_fields_reject_control_characters() {
        let mut best_seller = sample();
        best_seller.best_sellers = vec!["Linen\u{0007}dress".into()];
        assert!(validate_business_profile(&best_seller).is_err());

        let mut price_range = sample();
        price_range.price_range = Some("R500\u{0007}to R1500".into());
        assert!(validate_business_profile(&price_range).is_err());
    }
}
