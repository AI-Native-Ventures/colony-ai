//! Read the company business profile.

use buzz_core::company_profile::{
    validate_business_profile, BusinessProfile, BUSINESS_PROFILE_D_TAG,
    BUSINESS_PROFILE_REVISION_TAG,
};
use buzz_core::kind::KIND_BUSINESS_PROFILE_HEAD;
use serde_json::Value;

use crate::client::{normalize_events, BuzzClient};
use crate::error::CliError;
use crate::validate::validate_hex64;

/// Run a command for reading the company business profile.
pub async fn dispatch(cmd: crate::ProfileCmd, client: &BuzzClient) -> Result<(), CliError> {
    use crate::ProfileCmd;
    match cmd {
        ProfileCmd::Show => cmd_show(client).await,
    }
}

async fn cmd_show(client: &BuzzClient) -> Result<(), CliError> {
    let relay_self = relay_self_pubkey(client).await?;
    let events = client
        .query_all_bounded(
            serde_json::json!({
                "kinds": [KIND_BUSINESS_PROFILE_HEAD],
                "authors": [relay_self],
                "#d": [BUSINESS_PROFILE_D_TAG],
            }),
            1,
        )
        .await?;
    let event = events
        .into_iter()
        .next()
        .ok_or_else(|| CliError::NotFound("this company has no business profile yet".into()))?;
    verify_business_profile_head_event(&event, &relay_self)?;
    println!("{}", normalize_events(std::slice::from_ref(&event)));
    Ok(())
}

async fn relay_self_pubkey(client: &BuzzClient) -> Result<String, CliError> {
    let nip11_raw = client.get_public("/").await?;
    let nip11: Value = serde_json::from_str(&nip11_raw).map_err(|error| {
        CliError::Other(format!("relay info document is not valid JSON: {error}"))
    })?;
    let relay_self = nip11
        .get("self")
        .and_then(Value::as_str)
        .ok_or_else(|| CliError::Other("relay info document missing 'self' field".into()))?
        .trim();
    validate_hex64(relay_self).map_err(|error| {
        CliError::Other(format!(
            "relay info document has invalid 'self' field: {error}"
        ))
    })?;
    Ok(relay_self.to_lowercase())
}

fn verify_business_profile_head_event(
    event: &Value,
    relay_self: &str,
) -> Result<BusinessProfile, CliError> {
    let signed: nostr::Event = serde_json::from_value(event.clone()).map_err(|error| {
        CliError::Other(format!("business profile event is malformed: {error}"))
    })?;
    if signed.kind != nostr::Kind::Custom(KIND_BUSINESS_PROFILE_HEAD as u16) {
        return Err(CliError::Other(
            "business profile event has the wrong kind".into(),
        ));
    }
    if signed.pubkey.to_hex() != relay_self {
        return Err(CliError::Other(
            "business profile event author does not match the relay self key".into(),
        ));
    }
    signed.verify().map_err(|error| {
        CliError::Other(format!("business profile signature is invalid: {error}"))
    })?;
    let d_tags = signed
        .tags
        .iter()
        .filter(|tag| tag.kind().to_string() == "d")
        .collect::<Vec<_>>();
    if d_tags.len() != 1 || d_tags[0].content() != Some(BUSINESS_PROFILE_D_TAG) {
        return Err(CliError::Other(
            "business profile head must have exactly one business-profile d tag".into(),
        ));
    }
    let revision = signed
        .tags
        .iter()
        .find(|tag| tag.kind().to_string() == BUSINESS_PROFILE_REVISION_TAG)
        .and_then(|tag| tag.content())
        .and_then(|value| value.parse::<u32>().ok());
    if !matches!(revision, Some(revision) if revision > 0) {
        return Err(CliError::Other(
            "business profile head has no valid revision tag".into(),
        ));
    }
    let profile: BusinessProfile = serde_json::from_str(&signed.content).map_err(|error| {
        CliError::Other(format!("business profile content is invalid: {error}"))
    })?;
    validate_business_profile(&profile)
        .map_err(|error| CliError::Other(format!("business profile is invalid: {error}")))?;
    Ok(profile)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    use axum::{http::StatusCode, routing::get, Router};
    use nostr::{EventBuilder, Keys, Kind, Tag};

    use crate::error::exit_code;

    fn profile_json() -> String {
        serde_json::json!({
            "schemaVersion": 1,
            "name": "Lerato Designs",
            "timeZone": "Africa/Johannesburg"
        })
        .to_string()
    }

    fn head(relay: &Keys, d_tag: &str, revision: Option<&str>, content: String) -> Value {
        let mut builder =
            EventBuilder::new(Kind::Custom(KIND_BUSINESS_PROFILE_HEAD as u16), content)
                .tag(Tag::parse(["d", d_tag]).expect("d tag"));
        if let Some(revision) = revision {
            builder = builder.tag(Tag::parse(["revision", revision]).expect("revision tag"));
        }
        serde_json::to_value(builder.sign_with_keys(relay).expect("sign head")).expect("head JSON")
    }

    #[test]
    fn profile_head_verification_binds_author_coordinate_revision_and_content() {
        let relay = Keys::generate();
        let relay_self = relay.public_key().to_hex();
        let valid = head(&relay, BUSINESS_PROFILE_D_TAG, Some("3"), profile_json());
        let profile = verify_business_profile_head_event(&valid, &relay_self).expect("valid head");
        assert_eq!(profile.name, "Lerato Designs");

        assert!(verify_business_profile_head_event(
            &valid,
            &Keys::generate().public_key().to_hex()
        )
        .is_err());
        assert!(verify_business_profile_head_event(
            &head(&relay, "company:profile", Some("3"), profile_json()),
            &relay_self
        )
        .is_err());
        assert!(verify_business_profile_head_event(
            &head(&relay, BUSINESS_PROFILE_D_TAG, None, profile_json()),
            &relay_self
        )
        .is_err());
        assert!(verify_business_profile_head_event(
            &head(&relay, BUSINESS_PROFILE_D_TAG, Some("0"), profile_json()),
            &relay_self
        )
        .is_err());
        assert!(verify_business_profile_head_event(
            &head(
                &relay,
                BUSINESS_PROFILE_D_TAG,
                Some("3"),
                serde_json::json!({ "schemaVersion": 1, "name": "No zone" }).to_string()
            ),
            &relay_self
        )
        .is_err());

        let extra_d_tag = EventBuilder::new(
            Kind::Custom(KIND_BUSINESS_PROFILE_HEAD as u16),
            profile_json(),
        )
        .tags([
            Tag::parse(["d", BUSINESS_PROFILE_D_TAG]).expect("fixed d tag"),
            Tag::parse(["d"]).expect("valueless d tag"),
            Tag::parse(["revision", "3"]).expect("revision tag"),
        ])
        .sign_with_keys(&relay)
        .expect("sign head with extra d tag");
        let extra_d_tag = serde_json::to_value(extra_d_tag).expect("head JSON");
        let error = verify_business_profile_head_event(&extra_d_tag, &relay_self)
            .expect_err("an extra valueless d tag must be rejected");
        assert_eq!(exit_code(&error), 4);
        assert!(error.to_string().contains("exactly one"));

        let mut wrong_kind = valid.clone();
        wrong_kind["kind"] = serde_json::json!(1);
        let error = verify_business_profile_head_event(&wrong_kind, &relay_self)
            .expect_err("wrong head kind");
        assert_eq!(exit_code(&error), 4);
        assert!(error.to_string().contains("wrong kind"));

        let mut bad_signature = valid.clone();
        bad_signature["sig"] = serde_json::json!("0".repeat(128));
        let error = verify_business_profile_head_event(&bad_signature, &relay_self)
            .expect_err("invalid head signature");
        assert_eq!(exit_code(&error), 4);
        assert!(error.to_string().contains("signature is invalid"));
    }

    async fn relay_info_error(status: StatusCode, body: &'static str) -> CliError {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind loopback relay info fixture");
        let address = listener.local_addr().expect("relay info fixture address");
        let client = BuzzClient::new(format!("http://{address}"), Keys::generate(), None, None)
            .expect("relay info fixture client");
        let app = Router::new().route("/", get(move || async move { (status, body) }));
        let server = tokio::spawn(async move {
            axum::serve(listener, app)
                .await
                .expect("serve relay info fixture");
        });
        let result = tokio::time::timeout(Duration::from_secs(5), relay_self_pubkey(&client)).await;
        server.abort();
        result
            .expect("relay info request must finish within its deadline")
            .expect_err("relay info fixture must return an error")
    }

    #[tokio::test]
    async fn relay_self_pubkey_preserves_relay_failure_exit_code() {
        let error = relay_info_error(StatusCode::SERVICE_UNAVAILABLE, "unavailable").await;
        assert_eq!(exit_code(&error), 2);
        assert!(matches!(error, CliError::Relay { status: 503, .. }));
    }

    #[tokio::test]
    async fn relay_self_pubkey_preserves_connection_failure_exit_code() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("reserve closed loopback port");
        let address = listener.local_addr().expect("closed loopback address");
        drop(listener);
        let client = BuzzClient::new(format!("http://{address}"), Keys::generate(), None, None)
            .expect("closed loopback client");
        let error = tokio::time::timeout(Duration::from_secs(5), relay_self_pubkey(&client))
            .await
            .expect("connection failure must finish within its deadline")
            .expect_err("closed loopback port must fail");
        assert_eq!(exit_code(&error), 2);
        assert!(matches!(error, CliError::Network(_)));
    }

    #[tokio::test]
    async fn relay_self_pubkey_rejects_invalid_self_metadata_with_exit_four() {
        let error = relay_info_error(StatusCode::OK, r#"{"self":"not-a-public-key"}"#).await;
        assert_eq!(exit_code(&error), 4);
        assert!(matches!(error, CliError::Other(_)));
    }
}
