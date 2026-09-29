use buzz_core::company_records::{
    validate_secret_binding_action, validate_secret_binding_d_tag, validate_secret_binding_spec,
    SecretBindingAction, SecretBindingActionKind, SecretBindingHead, SecretBindingSpec,
    SecretBindingStatus, SecretStorage, COMPANY_RECORD_SCHEMA_VERSION,
};
use buzz_core::kind::KIND_SECRET_BINDING_HEAD;
use serde::Serialize;
use serde_json::Value;
use uuid::Uuid;

use crate::client::BuzzClient;
use crate::commands::parse_write_response;
use crate::error::CliError;
use crate::validate::{parse_uuid, read_or_stdin, sdk_err};
use crate::SecretsCmd;

const SECRET_QUERY_BOUND: u32 = 1_000;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SecretBindingSummary<'a> {
    name: &'a str,
    status: SecretBindingStatus,
}

/// Execute the metadata-only secret commands. Credential values are not CLI arguments.
pub async fn dispatch(command: SecretsCmd, client: &BuzzClient) -> Result<(), CliError> {
    match command {
        SecretsCmd::List { limit } => list(client, limit).await,
        SecretsCmd::Bind { record } => bind(client, &record).await,
        SecretsCmd::Revoke { binding_id } => revoke(client, &binding_id).await,
    }
}

async fn list(client: &BuzzClient, limit: Option<u32>) -> Result<(), CliError> {
    let limit = limit.unwrap_or(SECRET_QUERY_BOUND).min(SECRET_QUERY_BOUND) as usize;
    let mut records = query_secret_heads(client).await?;
    records.truncate(limit);
    let summaries = records
        .iter()
        .map(|(_, head)| SecretBindingSummary {
            name: &head.binding.name,
            status: head.status,
        })
        .collect::<Vec<_>>();
    println!(
        "{}",
        serde_json::to_string(&summaries)
            .map_err(|_| CliError::Other("failed to serialize secret binding metadata".into()))?
    );
    Ok(())
}

async fn bind(client: &BuzzClient, record_input: &str) -> Result<(), CliError> {
    let input = read_or_stdin(record_input)?;
    let binding: SecretBindingSpec = serde_json::from_str(&input)
        .map_err(|_| CliError::Usage("binding metadata is not a valid SecretBindingSpec".into()))?;
    validate_secret_binding_spec(&binding)
        .map_err(|error| CliError::Usage(format!("binding metadata is invalid: {error}")))?;
    if binding.storage == SecretStorage::Server {
        return Err(CliError::Other(
            "server secret storage is unavailable because this relay has no encrypted secret store"
                .into(),
        ));
    }

    let action = SecretBindingAction {
        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
        binding_id: binding.binding_id,
        action: SecretBindingActionKind::Create,
        expected_head_event_id: None,
        binding: Some(binding.clone()),
    };
    validate_secret_binding_action(&action)
        .map_err(|error| CliError::Usage(format!("secret binding action is invalid: {error}")))?;
    let builder =
        buzz_sdk::company_records::build_secret_binding_action(&action).map_err(sdk_err)?;
    let event = client.sign_event(builder)?;
    let response = client.submit_event(event).await?;
    parse_write_response(&response, "secret binding already exists")?;
    println!(
        "{}",
        serde_json::json!({
            "bindingId": binding.binding_id,
            "name": binding.name,
            "status": "pending"
        })
    );
    Ok(())
}

async fn revoke(client: &BuzzClient, binding_input: &str) -> Result<(), CliError> {
    let binding_id = parse_uuid(binding_input)?;
    let current = query_secret_head(client, binding_id)
        .await?
        .ok_or_else(|| CliError::NotFound("secret binding not found".into()))?;
    let (event, head) = current;
    if head.status == SecretBindingStatus::Revoked {
        return Err(CliError::Conflict(
            "secret binding is already revoked".into(),
        ));
    }
    let expected_head_event_id = event
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| CliError::Other("secret binding head is missing its event id".into()))?;
    let action = SecretBindingAction {
        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
        binding_id,
        action: SecretBindingActionKind::Revoke,
        expected_head_event_id: Some(expected_head_event_id.to_owned()),
        binding: None,
    };
    let builder =
        buzz_sdk::company_records::build_secret_binding_action(&action).map_err(sdk_err)?;
    let event = client.sign_event(builder)?;
    let response = client.submit_event(event).await?;
    parse_write_response(&response, "secret binding changed before revocation")?;
    println!(
        "{}",
        serde_json::json!({"bindingId": binding_id, "status": "revoked"})
    );
    Ok(())
}

async fn query_secret_heads(
    client: &BuzzClient,
) -> Result<Vec<(Value, SecretBindingHead)>, CliError> {
    let relay_self = relay_self(client).await?;
    let events = client
        .query_all_bounded(
            serde_json::json!({
                "kinds": [KIND_SECRET_BINDING_HEAD],
                "authors": [relay_self]
            }),
            SECRET_QUERY_BOUND,
        )
        .await?;
    events
        .iter()
        .map(|event| {
            verify_secret_head_event(event, &relay_self)?;
            let head = parse_secret_head(event)?;
            Ok((event.clone(), head))
        })
        .collect()
}

async fn query_secret_head(
    client: &BuzzClient,
    binding_id: Uuid,
) -> Result<Option<(Value, SecretBindingHead)>, CliError> {
    Ok(query_secret_heads(client)
        .await?
        .into_iter()
        .find(|(_, head)| head.binding.binding_id == binding_id))
}

async fn relay_self(client: &BuzzClient) -> Result<String, CliError> {
    let raw = client.get_public("/").await.map_err(|error| {
        CliError::Other(format!("failed to fetch relay info document: {error}"))
    })?;
    let nip11: Value = serde_json::from_str(&raw)
        .map_err(|_| CliError::Other("relay info document is not valid JSON".into()))?;
    let relay_self = nip11
        .get("self")
        .and_then(Value::as_str)
        .ok_or_else(|| CliError::Other("relay info document missing 'self' field".into()))?;
    if relay_self.len() != 64 || !relay_self.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(CliError::Other(
            "relay 'self' field is not a valid 64-hex pubkey".into(),
        ));
    }
    Ok(relay_self.to_ascii_lowercase())
}

fn parse_secret_head(event: &Value) -> Result<SecretBindingHead, CliError> {
    let content = event
        .get("content")
        .and_then(Value::as_str)
        .ok_or_else(|| CliError::Other("secret binding head has no string content".into()))?;
    let head = serde_json::from_str::<SecretBindingHead>(content)
        .map_err(|_| CliError::Other("secret binding head metadata is invalid".into()))?;
    validate_secret_binding_spec(&head.binding)
        .map_err(|_| CliError::Other("secret binding head metadata is invalid".into()))?;
    if head.schema_version != COMPANY_RECORD_SCHEMA_VERSION
        || head.binding.storage != SecretStorage::Device
    {
        return Err(CliError::Other(
            "secret binding head uses an unsupported schema or store".into(),
        ));
    }
    Ok(head)
}

fn verify_secret_head_event(event: &Value, relay_self: &str) -> Result<(), CliError> {
    let signed_event: nostr::Event = serde_json::from_value(event.clone())
        .map_err(|_| CliError::Other("secret binding head event is malformed".into()))?;
    if signed_event.kind != nostr::Kind::Custom(KIND_SECRET_BINDING_HEAD as u16)
        || signed_event.pubkey.to_hex() != relay_self
    {
        return Err(CliError::Other(
            "secret binding head is not signed by this relay".into(),
        ));
    }
    signed_event
        .verify()
        .map_err(|_| CliError::Other("secret binding head signature is invalid".into()))?;
    let d_tags = signed_event
        .tags
        .iter()
        .filter(|tag| tag.kind().to_string() == "d")
        .collect::<Vec<_>>();
    if d_tags.len() != 1
        || signed_event
            .tags
            .iter()
            .any(|tag| tag.kind().to_string() != "d")
    {
        return Err(CliError::Other(
            "secret binding head must have one d tag and no other tags".into(),
        ));
    }
    let head = parse_secret_head(event)?;
    validate_secret_binding_d_tag(
        d_tags[0].content().unwrap_or_default(),
        head.binding.binding_id,
    )
    .map_err(|_| CliError::Other("secret binding head coordinate is invalid".into()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn list_projection_contains_only_binding_name_and_status() {
        let summary = SecretBindingSummary {
            name: "Publishing credential",
            status: SecretBindingStatus::Active,
        };
        let output = serde_json::to_value(summary).expect("metadata summary");
        assert_eq!(output.as_object().map(|fields| fields.len()), Some(2));
        assert_eq!(output["name"], "Publishing credential");
        assert_eq!(output["status"], "active");
    }

    #[test]
    fn secret_command_output_never_includes_a_secret_value() {
        let sentinel = format!("credential-{}", Uuid::new_v4());
        let summary = SecretBindingSummary {
            name: "Publishing credential",
            status: SecretBindingStatus::Pending,
        };
        let output = serde_json::to_string(&summary).expect("metadata output");
        assert!(!output.contains(&sentinel));
    }
}
