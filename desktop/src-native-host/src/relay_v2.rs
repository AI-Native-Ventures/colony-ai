//! Frozen RelayV2 contract validation.
//!
//! This module is deliberately a carrier/validator only.  It does not open a
//! socket, select a launch mode, sign events, or hold identity custody.  The
//! canonical JSON is native-owned and is exposed through a read-only file for
//! a future JavaScript mirror.

use std::collections::{BTreeSet, HashSet};

use serde::de::{self, DeserializeSeed, Deserializer, MapAccess, SeqAccess, Visitor};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};

pub const PROTOCOL_VERSION: u64 = 2;
pub const PROFILE_ID: &str = "relay-v2";
pub const REGISTRY_DIGEST: &str =
    "bfc07c1c89d19e7c0a8426c5dbb8927d51cd38884d8443361742fc32667f3d65";
pub const CANONICAL_REGISTRY_BYTES: usize = 15_522;
pub const MAX_REGISTRY_BYTES: usize = 16_384;
pub const MAX_RELAY_FRAME_BYTES: usize = 524_288;
pub const MAX_FILTER_BYTES: usize = 32_768;

pub const REGISTRY_JSON: &str = include_str!("../relay_v2_registry.json");

const ROOT_KEYS: &[&str] = &[
    "protocolVersion",
    "profile",
    "capabilities",
    "authority",
    "entries",
    "errors",
    "redactedCodes",
    "filterKinds",
    "inbound",
    "limits",
    "requestSchemas",
    "schemas",
    "signing",
];
const ENTRY_KEYS: &[&str] = &[
    "authorization",
    "binary",
    "capability",
    "deadlineClass",
    "deadlineMs",
    "direction",
    "eventSchema",
    "requestSchema",
    "responseSchema",
    "sideEffect",
];
const ENTRY_NAMES: &[&str] = &[
    "relay-transport/connect",
    "relay-transport/authenticate",
    "relay-transport/subscribe",
    "relay-transport/close_subscription",
    "relay-transport/publish",
    "relay-transport/close",
    "identity-sign/sign_message",
    "identity-sign/sign_presence",
    "identity-sign/sign_typing",
    "identity-sign/sign_user_status",
];
const AUTHORITY_RENDERER_KEYS: &[&str] = &[
    "name",
    "type",
    "minBytes",
    "maxBytes",
    "meaning",
    "maySelectUrl",
    "maySelectProfile",
    "maySelectDigest",
];
const AUTHORITY_MAIN_KEYS: &[&str] = &[
    "name",
    "format",
    "bytes",
    "pattern",
    "rendererMayProvide",
    "meaning",
];
const SIGNING_KEYS: &[&str] = &["message", "presence", "typing", "user_status"];
const MESSAGE_SIGNING_KEYS: &[&str] = &[
    "contentBytes",
    "kind",
    "baseTags",
    "mentionTag",
    "extraTagNames",
    "extraTagMaxItems",
    "extraTagRules",
];
const ALLOWED_SCHEMA_KEYS: &[&str] = &[
    "type",
    "required",
    "properties",
    "enum",
    "const",
    "pattern",
    "minBytes",
    "maxBytes",
    "maxItems",
    "minimum",
    "maximum",
    "items",
    "payloadVariants",
    "$ref",
    "additionalProperties",
];
const ALLOWED_SCHEMA_TYPES: &[&str] = &[
    "array",
    "boolean",
    "integer",
    "number",
    "object",
    "string",
    "uint",
    "nullable-uint",
    "nullable-event-id",
];
const EXPECTED_FILTER_KINDS: &[u64] = &[
    5, 7, 9, 20_001, 20_002, 30_315, 39_005, 40_001, 40_002, 40_003, 40_008, 40_099, 48_100,
    48_101, 48_102, 48_103, 9_005,
];
const OK_CODES: &[&str] = &[
    "accepted",
    "rejected",
    "duplicate",
    "invalid_event",
    "not_authorized",
    "rate_limited",
    "server_error",
    "unknown",
];
const CLOSED_CODES: &[&str] = &[
    "auth_required",
    "invalid_request",
    "not_authorized",
    "rate_limited",
    "server_error",
    "timeout",
    "unknown",
];
const NOTICE_CODES: &[&str] = &[
    "invalid_request",
    "not_authorized",
    "rate_limited",
    "server_error",
    "maintenance",
    "unknown",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ContractError {
    RegistryTooLarge,
    InvalidJson,
    DuplicateField,
    InvalidRegistry,
    UnknownRegistryField,
    UnknownSchemaKeyword,
    UnresolvedReference,
    RegistryDigestMismatch,
    WrongProtocol,
    WrongProfile,
    WrongDigest,
    InvalidContext,
    UnknownOperation,
    WrongCapability,
    InvalidPayload,
    InvalidAuthority,
    InvalidFilter,
    InvalidKind,
    InvalidTags,
    InvalidCode,
    Oversized,
    UnsupportedMessageType,
}

impl ContractError {
    /// Return only a finite, redacted public code.  No input value or relay
    /// prose is retained in the error.
    pub const fn code(self) -> &'static str {
        match self {
            Self::RegistryTooLarge | Self::Oversized => "oversized_frame",
            Self::InvalidJson | Self::DuplicateField => "invalid_payload",
            Self::InvalidRegistry
            | Self::UnknownRegistryField
            | Self::UnknownSchemaKeyword
            | Self::UnresolvedReference
            | Self::RegistryDigestMismatch => "invalid_registry",
            Self::WrongProtocol => "wrong_protocol",
            Self::WrongProfile => "wrong_context",
            Self::WrongDigest => "wrong_digest",
            Self::InvalidContext => "invalid_context",
            Self::UnknownOperation | Self::WrongCapability => "invalid_operation",
            Self::InvalidPayload => "invalid_payload",
            Self::InvalidAuthority => "wrong_authority",
            Self::InvalidFilter => "invalid_filter",
            Self::InvalidKind => "invalid_kind",
            Self::InvalidTags => "invalid_tags",
            Self::InvalidCode => "invalid_code",
            Self::UnsupportedMessageType => "invalid_payload",
        }
    }
}

pub type ContractResult<T> = Result<T, ContractError>;

#[derive(Debug, Clone, Copy)]
pub struct RequestContext<'a> {
    pub protocol_version: u64,
    pub profile: &'a str,
    pub registry_digest: &'a str,
    pub operation: &'a str,
    pub capability: &'a str,
    pub authority_ref: Option<&'a str>,
    pub connection_id: Option<&'a str>,
}

pub fn registry_json() -> &'static str {
    REGISTRY_JSON
}

pub fn registry_document() -> ContractResult<Value> {
    if REGISTRY_JSON.len() > MAX_REGISTRY_BYTES {
        return Err(ContractError::RegistryTooLarge);
    }
    reject_duplicate_keys(REGISTRY_JSON.as_bytes())?;
    serde_json::from_str(REGISTRY_JSON).map_err(|_| ContractError::InvalidJson)
}

pub fn validate_registry() -> ContractResult<()> {
    let document = registry_document()?;
    validate_registry_document(&document)?;
    let canonical = canonicalize(&document)?;
    if canonical.len() != CANONICAL_REGISTRY_BYTES
        || digest_bytes(canonical.as_bytes()) != REGISTRY_DIGEST
    {
        return Err(ContractError::RegistryDigestMismatch);
    }
    Ok(())
}

pub fn validate_registry_document(document: &Value) -> ContractResult<()> {
    let root = object(document)?;
    ensure_keys(root, ROOT_KEYS)?;
    expect_u64(root, "protocolVersion", PROTOCOL_VERSION)?;
    expect_string(root, "profile", PROFILE_ID)?;
    validate_capabilities(
        root.get("capabilities")
            .ok_or(ContractError::InvalidRegistry)?,
    )?;
    validate_authority(
        root.get("authority")
            .ok_or(ContractError::InvalidRegistry)?,
    )?;
    validate_entries(
        root.get("entries").ok_or(ContractError::InvalidRegistry)?,
        root.get("schemas").ok_or(ContractError::InvalidRegistry)?,
    )?;
    validate_errors(root.get("errors").ok_or(ContractError::InvalidRegistry)?)?;
    validate_redacted_codes(
        root.get("redactedCodes")
            .ok_or(ContractError::InvalidRegistry)?,
    )?;
    validate_filter_kinds(
        root.get("filterKinds")
            .ok_or(ContractError::InvalidRegistry)?,
    )?;
    validate_inbound(root.get("inbound").ok_or(ContractError::InvalidRegistry)?)?;
    validate_limits(root.get("limits").ok_or(ContractError::InvalidRegistry)?)?;
    validate_request_schemas(
        root.get("requestSchemas")
            .ok_or(ContractError::InvalidRegistry)?,
    )?;
    validate_signing(root.get("signing").ok_or(ContractError::InvalidRegistry)?)?;

    let schemas = object(root.get("schemas").ok_or(ContractError::InvalidRegistry)?)?;
    if schemas.len() != 21 {
        return Err(if schemas.len() < 21 {
            ContractError::UnresolvedReference
        } else {
            ContractError::InvalidRegistry
        });
    }
    let mut references = BTreeSet::new();
    for schema in schemas.values() {
        validate_schema_descriptor(schema, schemas, &mut references, true)?;
    }
    if references
        .iter()
        .any(|reference| !schemas.contains_key(reference))
    {
        return Err(ContractError::UnresolvedReference);
    }

    let entries = object(root.get("entries").ok_or(ContractError::InvalidRegistry)?)?;
    for entry in entries.values() {
        let entry = object(entry)?;
        for field in ["requestSchema", "responseSchema", "eventSchema"] {
            let schema = string_field(entry, field)?;
            if !schemas.contains_key(schema) {
                return Err(ContractError::UnresolvedReference);
            }
            references.insert(schema.to_string());
        }
    }
    let schema_names = schemas.keys().cloned().collect::<BTreeSet<_>>();
    if references != schema_names {
        return Err(ContractError::UnresolvedReference);
    }
    Ok(())
}

pub fn canonical_registry_json() -> ContractResult<String> {
    let document = registry_document()?;
    canonicalize(&document)
}

pub fn digest_for_document(document: &Value) -> ContractResult<String> {
    Ok(digest_bytes(canonicalize(document)?.as_bytes()))
}

pub fn validate_context(context: &RequestContext<'_>) -> ContractResult<()> {
    if context.protocol_version != PROTOCOL_VERSION {
        return Err(ContractError::WrongProtocol);
    }
    if context.profile != PROFILE_ID {
        return Err(ContractError::WrongProfile);
    }
    if context.registry_digest != REGISTRY_DIGEST {
        return Err(ContractError::WrongDigest);
    }
    let authority = context.authority_ref.ok_or(ContractError::InvalidContext)?;
    validate_authority_ref(authority)?;
    if let Some(connection_id) = context.connection_id {
        validate_connection_id(connection_id)?;
    }
    Ok(())
}

pub fn validate_authority_ref(value: &str) -> ContractResult<()> {
    if is_lower_hex(value, 64) {
        Ok(())
    } else {
        Err(ContractError::InvalidAuthority)
    }
}

pub fn validate_connection_id(value: &str) -> ContractResult<()> {
    if is_uuid(value) {
        Ok(())
    } else {
        Err(ContractError::InvalidPayload)
    }
}

pub fn validate_request(context: &RequestContext<'_>, payload: &Value) -> ContractResult<()> {
    validate_registry()?;
    validate_context(context)?;
    let payload_bytes = serde_json::to_vec(payload).map_err(|_| ContractError::InvalidJson)?;
    if payload_bytes.len() > MAX_RELAY_FRAME_BYTES {
        return Err(ContractError::Oversized);
    }
    let document = registry_document()?;
    let root = object(&document)?;
    let schemas = object(root.get("schemas").ok_or(ContractError::InvalidRegistry)?)?;
    let entries = object(root.get("entries").ok_or(ContractError::InvalidRegistry)?)?;
    let entry = object(
        entries
            .get(context.operation)
            .ok_or(ContractError::UnknownOperation)?,
    )?;
    let capability = string_field(entry, "capability")?;
    if capability != context.capability {
        return Err(ContractError::WrongCapability);
    }
    let schema_name = string_field(entry, "requestSchema")?;
    let schema = schemas
        .get(schema_name)
        .ok_or(ContractError::UnresolvedReference)?;
    validate_instance(schema, payload, schemas, &mut HashSet::new())?;

    if context.operation != "relay-transport/connect" && context.connection_id.is_none() {
        return Err(ContractError::InvalidContext);
    }
    if let Some(connection_id) = context.connection_id {
        if let Some(payload_connection_id) = payload
            .as_object()
            .and_then(|object| object.get("connectionId"))
            .and_then(Value::as_str)
        {
            if payload_connection_id != connection_id {
                return Err(ContractError::InvalidContext);
            }
        }
    }

    match context.operation {
        "relay-transport/connect" => {
            let authority_ref = field_string(payload, "authorityRef")?;
            if context.authority_ref != Some(authority_ref) {
                return Err(ContractError::InvalidAuthority);
            }
        }
        "relay-transport/subscribe" => validate_subscribe(payload, root, schemas)?,
        "identity-sign/sign_message" => validate_message_signing(payload, root)?,
        "identity-sign/sign_presence" => {
            validate_operation_kind(context.operation, signing_kind(root, "presence")?)?;
        }
        "identity-sign/sign_typing" => validate_typing_signing(payload, root)?,
        "identity-sign/sign_user_status" => {
            validate_operation_kind(context.operation, signing_kind(root, "user_status")?)?;
        }
        "relay-transport/authenticate"
        | "relay-transport/close_subscription"
        | "relay-transport/publish"
        | "relay-transport/close" => {}
        _ => return Err(ContractError::UnknownOperation),
    }
    Ok(())
}

pub fn validate_operation_kind(operation: &str, kind: u64) -> ContractResult<()> {
    let document = registry_document()?;
    let root = object(&document)?;
    let policy_name = match operation {
        "identity-sign/sign_message" => "message",
        "identity-sign/sign_presence" => "presence",
        "identity-sign/sign_typing" => "typing",
        "identity-sign/sign_user_status" => "user_status",
        _ => return Err(ContractError::InvalidKind),
    };
    if signing_kind(root, policy_name)? == kind {
        Ok(())
    } else {
        Err(ContractError::InvalidKind)
    }
}

pub fn validate_inbound_message(message_type: &str, payload: &Value) -> ContractResult<()> {
    validate_registry()?;
    let document = registry_document()?;
    let root = object(&document)?;
    let schemas = object(root.get("schemas").ok_or(ContractError::InvalidRegistry)?)?;
    let schema = schemas
        .get("relay-message-event")
        .ok_or(ContractError::UnresolvedReference)?;
    let payload_schema = object(
        object(
            schema
                .get("properties")
                .ok_or(ContractError::InvalidRegistry)?,
        )?
        .get("payload")
        .ok_or(ContractError::InvalidRegistry)?,
    )?;
    let variants = object(
        payload_schema
            .get("payloadVariants")
            .ok_or(ContractError::InvalidRegistry)?,
    )?;
    let variant = variants
        .get(message_type)
        .ok_or(ContractError::UnsupportedMessageType)?;
    validate_instance(variant, payload, schemas, &mut HashSet::new())?;
    Ok(())
}

pub fn validate_inbound_event(frame: &Value) -> ContractResult<()> {
    validate_registry()?;
    let document = registry_document()?;
    let root = object(&document)?;
    let schemas = object(root.get("schemas").ok_or(ContractError::InvalidRegistry)?)?;
    let schema = schemas
        .get("relay-message-event")
        .ok_or(ContractError::UnresolvedReference)?;
    validate_instance(schema, frame, schemas, &mut HashSet::new())
}

pub fn validate_inbound_frame(frame: &[u8]) -> ContractResult<Value> {
    if frame.len() > MAX_RELAY_FRAME_BYTES {
        return Err(ContractError::Oversized);
    }
    reject_duplicate_keys(frame)?;
    let frame: Value = serde_json::from_slice(frame).map_err(|_| ContractError::InvalidJson)?;
    validate_inbound_event(&frame)?;
    Ok(frame)
}

fn validate_subscribe(
    payload: &Value,
    root: &Map<String, Value>,
    schemas: &Map<String, Value>,
) -> ContractResult<()> {
    let filter = field(payload, "filter")?;
    validate_instance(
        schemas
            .get("relay-filter")
            .ok_or(ContractError::UnresolvedReference)?,
        filter,
        schemas,
        &mut HashSet::new(),
    )?;
    let serialized = canonicalize(filter)?;
    let max_filter_bytes = field_u64(
        object(root.get("limits").ok_or(ContractError::InvalidRegistry)?)?,
        "maxFilterBytes",
    )? as usize;
    if serialized.len() > max_filter_bytes || serialized.len() > MAX_FILTER_BYTES {
        return Err(ContractError::InvalidFilter);
    }
    let filter_object = object(filter)?;
    if let Some(kinds) = filter_object.get("kinds") {
        let has_status = array(kinds)?
            .iter()
            .any(|kind| kind.as_u64() == Some(30_315));
        if has_status {
            if kinds != &Value::Array(vec![Value::from(30_315)])
                || filter_object.len() != 2
                || filter_object.get("#d")
                    != Some(&Value::Array(vec![Value::String("general".to_string())]))
            {
                return Err(ContractError::InvalidFilter);
            }
        }
    }
    Ok(())
}

fn validate_message_signing(payload: &Value, root: &Map<String, Value>) -> ContractResult<()> {
    let policy = object(
        object(root.get("signing").ok_or(ContractError::InvalidRegistry)?)?
            .get("message")
            .ok_or(ContractError::InvalidRegistry)?,
    )?;
    validate_operation_kind("identity-sign/sign_message", field_u64(policy, "kind")?)?;
    let content_limit = field_u64(policy, "contentBytes")? as usize;
    if field_string(payload, "content")?.as_bytes().len() > content_limit {
        return Err(ContractError::Oversized);
    }
    let channel_id = field_string(payload, "channelId")?;
    let max_tag_items = field_u64(policy, "extraTagMaxItems")? as usize;
    let allowed_names = field_string_array(policy, "extraTagNames")?;
    let rules = object(
        policy
            .get("extraTagRules")
            .ok_or(ContractError::InvalidRegistry)?,
    )?;
    let tags = array(field(payload, "extraTags")?)?;
    let mut h_count = 0usize;
    let mut broadcast_count = 0usize;
    for tag in tags {
        let tag = array(tag)?;
        if tag.is_empty() || tag.len() > max_tag_items {
            return Err(ContractError::InvalidTags);
        }
        let name = tag[0].as_str().ok_or(ContractError::InvalidTags)?;
        if !allowed_names.iter().any(|value| value == name) || !rules.contains_key(name) {
            return Err(ContractError::InvalidTags);
        }
        match name {
            "e" => {
                if tag.len() != 4
                    || !tag[2].as_str().is_some_and(str::is_empty)
                    || !matches!(tag[3].as_str(), Some("root" | "reply"))
                    || !tag[1].as_str().is_some_and(|value| is_lower_hex(value, 64))
                {
                    return Err(ContractError::InvalidTags);
                }
            }
            "h" => {
                h_count += 1;
                if h_count > 1 || tag.len() != 2 || tag[1].as_str() != Some(channel_id) {
                    return Err(ContractError::InvalidTags);
                }
            }
            "p" => {
                if tag.len() != 2 || !tag[1].as_str().is_some_and(|value| is_lower_hex(value, 64)) {
                    return Err(ContractError::InvalidTags);
                }
            }
            "q" => {
                if tag.len() != 2 || !tag[1].as_str().is_some_and(|value| is_lower_hex(value, 64)) {
                    return Err(ContractError::InvalidTags);
                }
            }
            "broadcast" => {
                broadcast_count += 1;
                if broadcast_count > 1
                    || tag.as_slice()
                        != [
                            Value::String("broadcast".to_string()),
                            Value::String("1".to_string()),
                        ]
                {
                    return Err(ContractError::InvalidTags);
                }
            }
            _ => return Err(ContractError::InvalidTags),
        }
    }
    Ok(())
}

fn validate_typing_signing(payload: &Value, root: &Map<String, Value>) -> ContractResult<()> {
    validate_operation_kind("identity-sign/sign_typing", signing_kind(root, "typing")?)?;
    let object = object(payload)?;
    let parent = object
        .get("parentEventId")
        .ok_or(ContractError::InvalidPayload)?;
    let root_event = object
        .get("rootEventId")
        .ok_or(ContractError::InvalidPayload)?;
    if root_event.is_string() && parent.is_null() {
        return Err(ContractError::InvalidTags);
    }
    Ok(())
}

fn signing_kind(root: &Map<String, Value>, policy_name: &str) -> ContractResult<u64> {
    let signing = object(root.get("signing").ok_or(ContractError::InvalidRegistry)?)?;
    let policy = object(
        signing
            .get(policy_name)
            .ok_or(ContractError::InvalidRegistry)?,
    )?;
    field_u64(policy, "kind")
}

fn validate_capabilities(value: &Value) -> ContractResult<()> {
    let object = object(value)?;
    ensure_keys(object, &["ready"])?;
    let ready = field_string_array(object, "ready")?;
    if !string_array_matches(&ready, &["relay-transport", "identity-sign"]) {
        return Err(ContractError::InvalidRegistry);
    }
    Ok(())
}

fn validate_authority(value: &Value) -> ContractResult<()> {
    let map = object(value)?;
    ensure_keys(
        map,
        &["rendererInput", "mainIssued", "resolution", "unknown"],
    )?;
    let renderer = object(
        map.get("rendererInput")
            .ok_or(ContractError::InvalidRegistry)?,
    )?;
    ensure_keys(renderer, AUTHORITY_RENDERER_KEYS)?;
    expect_string(renderer, "name", "communityId")?;
    expect_string(renderer, "type", "string")?;
    expect_u64(renderer, "minBytes", 1)?;
    expect_u64(renderer, "maxBytes", 128)?;
    expect_bool(renderer, "maySelectUrl", false)?;
    expect_bool(renderer, "maySelectProfile", false)?;
    expect_bool(renderer, "maySelectDigest", false)?;
    let _ = string_field(renderer, "meaning")?;

    let main_issued = object(
        map.get("mainIssued")
            .ok_or(ContractError::InvalidRegistry)?,
    )?;
    ensure_keys(main_issued, AUTHORITY_MAIN_KEYS)?;
    expect_string(main_issued, "name", "authorityRef")?;
    expect_string(main_issued, "format", "lowercase-hex-32-byte")?;
    expect_u64(main_issued, "bytes", 32)?;
    expect_string(main_issued, "pattern", "^[0-9a-f]{64}$")?;
    expect_bool(main_issued, "rendererMayProvide", false)?;
    let _ = string_field(main_issued, "meaning")?;
    expect_string(map, "unknown", "wrong_authority")?;
    let _ = string_field(map, "resolution")?;
    Ok(())
}

fn validate_entries(value: &Value, schemas_value: &Value) -> ContractResult<()> {
    let entries = object(value)?;
    ensure_keys(entries, ENTRY_NAMES)?;
    let schemas = object(schemas_value)?;
    for (name, value) in entries {
        let entry = object(value)?;
        ensure_keys(entry, ENTRY_KEYS)?;
        if !name.contains('/') {
            return Err(ContractError::InvalidRegistry);
        }
        let _ = string_field(entry, "authorization")?;
        expect_bool(entry, "binary", false)?;
        let _ = string_field(entry, "capability")?;
        let _ = string_field(entry, "deadlineClass")?;
        if field_u64(entry, "deadlineMs")? == 0 {
            return Err(ContractError::InvalidRegistry);
        }
        let _ = string_field(entry, "direction")?;
        let _ = string_field(entry, "sideEffect")?;
        for field in ["requestSchema", "responseSchema", "eventSchema"] {
            if !schemas.contains_key(string_field(entry, field)?) {
                return Err(ContractError::UnresolvedReference);
            }
        }
    }
    Ok(())
}

fn validate_errors(value: &Value) -> ContractResult<()> {
    let errors = field_string_array_value(value)?;
    if errors.is_empty() || has_duplicates(&errors) {
        return Err(ContractError::InvalidRegistry);
    }
    let expected = [
        "invalid_payload",
        "invalid_connection",
        "stale_generation",
        "future_generation",
        "wrong_authority",
        "auth_required",
        "auth_timeout",
        "auth_rejected",
        "connect_timeout",
        "request_timeout",
        "oversized_frame",
        "malformed_frame",
        "queue_full",
        "relay_closed",
        "publish_rejected",
        "host_unavailable",
        "renderer_rebound",
        "shutdown",
    ];
    if !string_array_matches(&errors, &expected) {
        return Err(ContractError::InvalidRegistry);
    }
    Ok(())
}

fn validate_redacted_codes(value: &Value) -> ContractResult<()> {
    let object = object(value)?;
    ensure_keys(object, &["ok", "closed", "notice"])?;
    if !string_array_matches(&field_string_array(object, "ok")?, OK_CODES)
        || !string_array_matches(&field_string_array(object, "closed")?, CLOSED_CODES)
        || !string_array_matches(&field_string_array(object, "notice")?, NOTICE_CODES)
    {
        return Err(ContractError::InvalidRegistry);
    }
    Ok(())
}

fn validate_filter_kinds(value: &Value) -> ContractResult<()> {
    let kinds = array(value)?;
    if kinds.len() != EXPECTED_FILTER_KINDS.len()
        || kinds
            .iter()
            .zip(EXPECTED_FILTER_KINDS)
            .any(|(actual, expected)| actual.as_u64() != Some(*expected))
    {
        return Err(ContractError::InvalidRegistry);
    }
    Ok(())
}

fn validate_inbound(value: &Value) -> ContractResult<()> {
    let object = object(value)?;
    ensure_keys(object, &["classes", "eventKeys"])?;
    let classes = field_string_array(object, "classes")?;
    if !string_array_matches(
        &classes,
        &["AUTH", "OK", "EVENT", "EOSE", "CLOSED", "NOTICE"],
    ) {
        return Err(ContractError::InvalidRegistry);
    }
    let event_keys = field_string_array(object, "eventKeys")?;
    if !string_array_matches(
        &event_keys,
        &[
            "id",
            "pubkey",
            "created_at",
            "kind",
            "tags",
            "content",
            "sig",
        ],
    ) {
        return Err(ContractError::InvalidRegistry);
    }
    Ok(())
}

fn validate_limits(value: &Value) -> ContractResult<()> {
    let object = object(value)?;
    let expected = [
        "authBudgetMode",
        "authBudgetStart",
        "authDeadlineMs",
        "closeDeadlineMs",
        "connectDeadlineMs",
        "maxChallengeBytes",
        "maxConnectionIdBytes",
        "maxContentBytes",
        "maxFilterBytes",
        "maxFilterCount",
        "maxFilterKinds",
        "maxFilterValueBytes",
        "maxFilterValues",
        "maxInboundFrames",
        "maxReasonBytes",
        "maxRelayUrlBytes",
        "maxSignedEventBytes",
        "maxSubscriptionIdBytes",
        "maxSubscriptions",
        "maxTagCount",
        "maxTagItemBytes",
        "maxTagItems",
        "outboundQueueLimit",
        "publishOkDeadlineMs",
        "relayFrameBytes",
        "requestDeadlineMs",
        "shutdownGraceMs",
    ];
    ensure_keys(object, &expected)?;
    expect_string(object, "authBudgetMode", "single-absolute")?;
    expect_string(object, "authBudgetStart", "connection-created")?;
    for field in expected {
        if field != "authBudgetMode" && field != "authBudgetStart" && field_u64(object, field)? == 0
        {
            return Err(ContractError::InvalidRegistry);
        }
    }
    if field_u64(object, "maxFilterBytes")? as usize != MAX_FILTER_BYTES
        || field_u64(object, "relayFrameBytes")? as usize != MAX_RELAY_FRAME_BYTES
    {
        return Err(ContractError::InvalidRegistry);
    }
    Ok(())
}

fn validate_request_schemas(value: &Value) -> ContractResult<()> {
    let object = object(value)?;
    let expected = [
        "authenticate",
        "close",
        "close_subscription",
        "connect",
        "publish",
        "sign_message",
        "sign_presence",
        "sign_typing",
        "sign_user_status",
        "subscribe",
    ];
    ensure_keys(object, &expected)?;
    for value in object.values() {
        let fields = array(value)?;
        let mut names = BTreeSet::new();
        for field in fields {
            let field = field.as_str().ok_or(ContractError::InvalidRegistry)?;
            if !names.insert(field) {
                return Err(ContractError::InvalidRegistry);
            }
        }
    }
    Ok(())
}

fn validate_signing(value: &Value) -> ContractResult<()> {
    let map = object(value)?;
    ensure_keys(map, SIGNING_KEYS)?;
    let message = object(map.get("message").ok_or(ContractError::InvalidRegistry)?)?;
    ensure_keys(message, MESSAGE_SIGNING_KEYS)?;
    expect_u64(message, "contentBytes", 262_144)?;
    expect_u64(message, "kind", 9)?;
    expect_u64(message, "extraTagMaxItems", 4)?;
    if !string_array_matches(
        &field_string_array(message, "extraTagNames")?,
        &["e", "h", "p", "q", "broadcast"],
    ) {
        return Err(ContractError::InvalidRegistry);
    }
    let base_tags = array(
        message
            .get("baseTags")
            .ok_or(ContractError::InvalidRegistry)?,
    )?;
    if base_tags.len() != 1 {
        return Err(ContractError::InvalidRegistry);
    }
    let base_tag = object(base_tags.first().ok_or(ContractError::InvalidRegistry)?)?;
    ensure_keys(base_tag, &["name", "source", "arity", "required"])?;
    expect_string(base_tag, "name", "h")?;
    expect_string(base_tag, "source", "channelId")?;
    expect_u64(base_tag, "arity", 2)?;
    expect_bool(base_tag, "required", true)?;
    let mention_tag = object(
        message
            .get("mentionTag")
            .ok_or(ContractError::InvalidRegistry)?,
    )?;
    ensure_keys(mention_tag, &["name", "source", "arity"])?;
    let _ = string_field(mention_tag, "name")?;
    let _ = string_field(mention_tag, "source")?;
    if field_u64(mention_tag, "arity")? != 2 {
        return Err(ContractError::InvalidRegistry);
    }
    let rules = object(
        message
            .get("extraTagRules")
            .ok_or(ContractError::InvalidRegistry)?,
    )?;
    ensure_keys(rules, &["e", "h", "p", "q", "broadcast"])?;
    if rules.get("e") != Some(&serde_json::json!(["eventId64", "", "root|reply"]))
        || rules.get("h") != Some(&serde_json::json!(["channelId"]))
        || rules.get("p") != Some(&serde_json::json!(["pubkey64"]))
        || rules.get("q") != Some(&serde_json::json!(["eventId64"]))
        || rules.get("broadcast") != Some(&serde_json::json!(["1"]))
    {
        return Err(ContractError::InvalidRegistry);
    }

    let presence = object(map.get("presence").ok_or(ContractError::InvalidRegistry)?)?;
    ensure_keys(presence, &["contentBytes", "kind", "exactTags"])?;
    expect_u64(presence, "contentBytes", 128)?;
    expect_u64(presence, "kind", 20_001)?;
    if !array(
        presence
            .get("exactTags")
            .ok_or(ContractError::InvalidRegistry)?,
    )?
    .is_empty()
    {
        return Err(ContractError::InvalidRegistry);
    }

    let typing = object(map.get("typing").ok_or(ContractError::InvalidRegistry)?)?;
    ensure_keys(
        typing,
        &["contentBytes", "kind", "tagNames", "tagConstruction"],
    )?;
    expect_u64(typing, "contentBytes", 0)?;
    expect_u64(typing, "kind", 20_002)?;
    if !string_array_matches(&field_string_array(typing, "tagNames")?, &["e", "h"]) {
        return Err(ContractError::InvalidRegistry);
    }
    if typing.get("tagConstruction")
        != Some(&serde_json::json!({
            "required": [["h", "channelId"]],
            "reply": [["e", "parentEventId", "", "reply"]],
            "thread": [
                ["e", "rootEventId", "", "root"],
                ["e", "parentEventId", "", "reply"]
            ]
        }))
    {
        return Err(ContractError::InvalidRegistry);
    }

    let user_status = object(
        map.get("user_status")
            .ok_or(ContractError::InvalidRegistry)?,
    )?;
    ensure_keys(
        user_status,
        &["contentBytes", "kind", "tagNames", "tagConstruction"],
    )?;
    expect_u64(user_status, "contentBytes", 1024)?;
    expect_u64(user_status, "kind", 30_315)?;
    if !string_array_matches(
        &field_string_array(user_status, "tagNames")?,
        &["d", "emoji", "expiration"],
    ) {
        return Err(ContractError::InvalidRegistry);
    }
    if user_status.get("tagConstruction")
        != Some(&serde_json::json!({
            "required": [["d", "general"]],
            "optional": [
                ["emoji", "status.emoji"],
                ["expiration", "decimal(status.expiresAt)"]
            ]
        }))
    {
        return Err(ContractError::InvalidRegistry);
    }

    for policy_name in ["presence", "typing", "user_status"] {
        let policy = object(map.get(policy_name).ok_or(ContractError::InvalidRegistry)?)?;
        let _ = field_u64(policy, "kind")?;
        if policy_name == "presence" && field_u64(policy, "kind")? != 20_001 {
            return Err(ContractError::InvalidRegistry);
        }
        if policy_name == "typing" && field_u64(policy, "kind")? != 20_002 {
            return Err(ContractError::InvalidRegistry);
        }
        if policy_name == "user_status" && field_u64(policy, "kind")? != 30_315 {
            return Err(ContractError::InvalidRegistry);
        }
    }
    Ok(())
}

fn validate_schema_descriptor(
    value: &Value,
    schemas: &Map<String, Value>,
    references: &mut BTreeSet<String>,
    root_schema: bool,
) -> ContractResult<()> {
    let map = object(value)?;
    if map
        .keys()
        .any(|key| !ALLOWED_SCHEMA_KEYS.contains(&key.as_str()))
    {
        return Err(ContractError::UnknownSchemaKeyword);
    }
    if let Some(reference) = map.get("$ref") {
        if map.len() != 1 {
            return Err(ContractError::InvalidRegistry);
        }
        let reference = reference.as_str().ok_or(ContractError::InvalidRegistry)?;
        references.insert(reference.to_string());
        return Ok(());
    }
    if map.contains_key("const") && !map.contains_key("type") {
        if map.len() != 1 {
            return Err(ContractError::InvalidRegistry);
        }
        return Ok(());
    }
    let schema_type = string_field(map, "type")?;
    if !ALLOWED_SCHEMA_TYPES.contains(&schema_type) {
        return Err(ContractError::InvalidRegistry);
    }
    if root_schema && schema_type != "object" {
        return Err(ContractError::InvalidRegistry);
    }
    if let Some(additional) = map.get("additionalProperties") {
        if additional.as_bool() != Some(false) {
            return Err(ContractError::InvalidRegistry);
        }
    }
    if let Some(required) = map.get("required") {
        let required = field_string_array_value(required)?;
        if has_duplicates(&required) {
            return Err(ContractError::InvalidRegistry);
        }
        if let Some(properties) = map.get("properties").and_then(Value::as_object) {
            if required.iter().any(|field| !properties.contains_key(field)) {
                return Err(ContractError::InvalidRegistry);
            }
        }
    }
    if let Some(properties) = map.get("properties") {
        let properties = object(properties)?;
        for descriptor in properties.values() {
            validate_schema_descriptor(descriptor, schemas, references, false)?;
        }
    }
    if let Some(items) = map.get("items") {
        validate_schema_descriptor(items, schemas, references, false)?;
    }
    if let Some(variants) = map.get("payloadVariants") {
        let variants = object(variants)?;
        for descriptor in variants.values() {
            validate_schema_descriptor(descriptor, schemas, references, false)?;
        }
    }
    if let Some(enums) = map.get("enum") {
        let enums = array(enums)?;
        if enums.is_empty() || values_have_duplicates(enums) {
            return Err(ContractError::InvalidRegistry);
        }
    }
    if let Some(pattern) = map.get("pattern") {
        let pattern = pattern.as_str().ok_or(ContractError::InvalidRegistry)?;
        if !matches!(
            pattern,
            "^[0-9a-f]{64}$"
                | "^[0-9a-f]{128}$"
                | "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
        ) {
            return Err(ContractError::InvalidRegistry);
        }
    }
    for field in ["minBytes", "maxBytes", "maxItems", "minimum", "maximum"] {
        if let Some(value) = map.get(field) {
            if value.as_u64().is_none() {
                return Err(ContractError::InvalidRegistry);
            }
        }
    }
    if let (Some(min), Some(max)) = (
        map.get("minBytes").and_then(Value::as_u64),
        map.get("maxBytes").and_then(Value::as_u64),
    ) {
        if min > max {
            return Err(ContractError::InvalidRegistry);
        }
    }
    if let (Some(min), Some(max)) = (
        map.get("minimum").and_then(Value::as_u64),
        map.get("maximum").and_then(Value::as_u64),
    ) {
        if min > max {
            return Err(ContractError::InvalidRegistry);
        }
    }
    Ok(())
}

fn validate_instance(
    schema: &Value,
    value: &Value,
    schemas: &Map<String, Value>,
    stack: &mut HashSet<String>,
) -> ContractResult<()> {
    let schema = if let Some(reference) = schema.get("$ref").and_then(Value::as_str) {
        if !stack.insert(reference.to_string()) {
            return Err(ContractError::InvalidRegistry);
        }
        let resolved = schemas
            .get(reference)
            .ok_or(ContractError::UnresolvedReference)?;
        let result = validate_instance(resolved, value, schemas, stack);
        stack.remove(reference);
        return result;
    } else {
        object(schema)?
    };

    if let Some(constant) = schema.get("const") {
        if value != constant {
            return Err(ContractError::InvalidPayload);
        }
    }
    if let Some(enums) = schema.get("enum") {
        if !array(enums)?.iter().any(|candidate| candidate == value) {
            return Err(ContractError::InvalidPayload);
        }
    }
    if schema.get("const").is_some() && !schema.contains_key("type") {
        return Ok(());
    }

    let schema_type = string_field(schema, "type")?;
    match schema_type {
        "array" => {
            let values = array(value)?;
            if let Some(max_items) = schema.get("maxItems").and_then(Value::as_u64) {
                if values.len() > max_items as usize {
                    return Err(ContractError::Oversized);
                }
            }
            if let Some(items) = schema.get("items") {
                for value in values {
                    validate_instance(items, value, schemas, stack)?;
                }
            }
        }
        "boolean" => {
            if !value.is_boolean() {
                return Err(ContractError::InvalidPayload);
            }
        }
        "integer" => {
            if value.as_i64().is_none() && value.as_u64().is_none() {
                return Err(ContractError::InvalidPayload);
            }
        }
        "number" => {
            if value.as_f64().is_none() {
                return Err(ContractError::InvalidPayload);
            }
        }
        "object" => {
            let values = object(value)?;
            let properties = schema.get("properties").map(object).transpose()?;
            if schema.get("additionalProperties").and_then(Value::as_bool) != Some(false) {
                return Err(ContractError::InvalidRegistry);
            }
            if let Some(properties) = properties {
                if values.keys().any(|key| !properties.contains_key(key)) {
                    return Err(ContractError::InvalidPayload);
                }
            } else if !values.is_empty() && !schema.contains_key("payloadVariants") {
                return Err(ContractError::InvalidPayload);
            }
            if let Some(required) = schema.get("required") {
                for field in field_string_array_value(required)? {
                    if !values.contains_key(&field) {
                        return Err(ContractError::InvalidPayload);
                    }
                }
            }
            if let Some(properties) = properties {
                for (field, descriptor) in properties {
                    if let Some(value) = values.get(field) {
                        validate_instance(descriptor, value, schemas, stack)?;
                    }
                }
            }
            if let Some(variants) = schema.get("payloadVariants") {
                let variants = object(variants)?;
                let message_type = values
                    .get("messageType")
                    .and_then(Value::as_str)
                    .ok_or(ContractError::InvalidPayload)?;
                let payload = values.get("payload").ok_or(ContractError::InvalidPayload)?;
                let variant = variants
                    .get(message_type)
                    .ok_or(ContractError::UnsupportedMessageType)?;
                validate_instance(variant, payload, schemas, stack)?;
            }
        }
        "string" => {
            let string = value.as_str().ok_or(ContractError::InvalidPayload)?;
            validate_string_constraints(schema, string)?;
        }
        "uint" => {
            if value.as_u64().is_none() {
                return Err(ContractError::InvalidPayload);
            }
        }
        "nullable-uint" => {
            if !value.is_null() && value.as_u64().is_none() {
                return Err(ContractError::InvalidPayload);
            }
        }
        "nullable-event-id" => {
            if !value.is_null() && !value.as_str().is_some_and(|value| is_lower_hex(value, 64)) {
                return Err(ContractError::InvalidPayload);
            }
        }
        _ => return Err(ContractError::InvalidRegistry),
    }

    if let Some(max_items) = schema.get("maxItems").and_then(Value::as_u64) {
        if let Some(values) = value.as_array() {
            if values.len() > max_items as usize {
                return Err(ContractError::Oversized);
            }
        }
    }
    if let Some(minimum) = schema.get("minimum").and_then(Value::as_u64) {
        if value.as_u64().is_some_and(|number| number < minimum) {
            return Err(ContractError::InvalidPayload);
        }
    }
    if let Some(maximum) = schema.get("maximum").and_then(Value::as_u64) {
        if value.as_u64().is_some_and(|number| number > maximum) {
            return Err(ContractError::InvalidPayload);
        }
    }
    Ok(())
}

fn validate_string_constraints(schema: &Map<String, Value>, value: &str) -> ContractResult<()> {
    let bytes = value.as_bytes().len() as u64;
    if schema
        .get("minBytes")
        .and_then(Value::as_u64)
        .is_some_and(|minimum| bytes < minimum)
    {
        return Err(ContractError::InvalidPayload);
    }
    if schema
        .get("maxBytes")
        .and_then(Value::as_u64)
        .is_some_and(|maximum| bytes > maximum)
    {
        return Err(ContractError::Oversized);
    }
    if let Some(pattern) = schema.get("pattern").and_then(Value::as_str) {
        let matches = match pattern {
            "^[0-9a-f]{64}$" => is_lower_hex(value, 64),
            "^[0-9a-f]{128}$" => is_lower_hex(value, 128),
            "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$" => is_uuid(value),
            _ => false,
        };
        if !matches {
            return Err(ContractError::InvalidPayload);
        }
    }
    Ok(())
}

fn validate_code(code_class: &str, code: &str) -> ContractResult<()> {
    let accepted = match code_class {
        "ok" => OK_CODES,
        "closed" => CLOSED_CODES,
        "notice" => NOTICE_CODES,
        _ => return Err(ContractError::InvalidCode),
    };
    if accepted.contains(&code) {
        Ok(())
    } else {
        Err(ContractError::InvalidCode)
    }
}

fn object(value: &Value) -> ContractResult<&Map<String, Value>> {
    value.as_object().ok_or(ContractError::InvalidPayload)
}

fn array(value: &Value) -> ContractResult<&Vec<Value>> {
    value.as_array().ok_or(ContractError::InvalidPayload)
}

fn field<'a>(value: &'a Value, name: &str) -> ContractResult<&'a Value> {
    object(value)?
        .get(name)
        .ok_or(ContractError::InvalidPayload)
}

fn string_field<'a>(object: &'a Map<String, Value>, name: &str) -> ContractResult<&'a str> {
    object
        .get(name)
        .and_then(Value::as_str)
        .ok_or(ContractError::InvalidRegistry)
}

fn field_string<'a>(value: &'a Value, name: &str) -> ContractResult<&'a str> {
    field(value, name)?
        .as_str()
        .ok_or(ContractError::InvalidPayload)
}

fn field_u64(object: &Map<String, Value>, name: &str) -> ContractResult<u64> {
    object
        .get(name)
        .and_then(Value::as_u64)
        .ok_or(ContractError::InvalidRegistry)
}

fn expect_string(object: &Map<String, Value>, name: &str, expected: &str) -> ContractResult<()> {
    if string_field(object, name)? == expected {
        Ok(())
    } else {
        Err(ContractError::InvalidRegistry)
    }
}

fn expect_u64(object: &Map<String, Value>, name: &str, expected: u64) -> ContractResult<()> {
    if field_u64(object, name)? == expected {
        Ok(())
    } else {
        Err(ContractError::InvalidRegistry)
    }
}

fn expect_bool(object: &Map<String, Value>, name: &str, expected: bool) -> ContractResult<()> {
    if object.get(name).and_then(Value::as_bool) == Some(expected) {
        Ok(())
    } else {
        Err(ContractError::InvalidRegistry)
    }
}

fn field_string_array(object: &Map<String, Value>, name: &str) -> ContractResult<Vec<String>> {
    field_string_array_value(object.get(name).ok_or(ContractError::InvalidRegistry)?)
}

fn field_string_array_value(value: &Value) -> ContractResult<Vec<String>> {
    let values = array(value)?;
    values
        .iter()
        .map(|value| {
            value
                .as_str()
                .map(str::to_string)
                .ok_or(ContractError::InvalidRegistry)
        })
        .collect()
}

fn ensure_keys(object: &Map<String, Value>, expected: &[&str]) -> ContractResult<()> {
    if object.len() != expected.len() || expected.iter().any(|key| !object.contains_key(*key)) {
        return Err(ContractError::UnknownRegistryField);
    }
    Ok(())
}

fn has_duplicates(values: &[String]) -> bool {
    let mut seen = HashSet::new();
    values.iter().any(|value| !seen.insert(value))
}

fn string_array_matches(values: &[String], expected: &[&str]) -> bool {
    values.len() == expected.len()
        && values
            .iter()
            .zip(expected)
            .all(|(actual, expected)| actual == expected)
}

fn values_have_duplicates(values: &[Value]) -> bool {
    (0..values.len()).any(|index| values[index + 1..].contains(&values[index]))
}

fn is_lower_hex(value: &str, length: usize) -> bool {
    value.len() == length
        && value
            .bytes()
            .all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
}

fn is_uuid(value: &str) -> bool {
    value.len() == 36
        && value.as_bytes().iter().enumerate().all(|(index, byte)| {
            if matches!(index, 8 | 13 | 18 | 23) {
                *byte == b'-'
            } else {
                matches!(byte, b'0'..=b'9' | b'a'..=b'f')
            }
        })
}

fn digest_bytes(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

fn canonicalize(value: &Value) -> ContractResult<String> {
    match value {
        Value::Null => Ok("null".to_string()),
        Value::Bool(value) => Ok(value.to_string()),
        Value::Number(value) => Ok(value.to_string()),
        Value::String(value) => {
            serde_json::to_string(value).map_err(|_| ContractError::InvalidJson)
        }
        Value::Array(values) => {
            let values = values
                .iter()
                .map(canonicalize)
                .collect::<ContractResult<Vec<_>>>()?;
            Ok(format!("[{}]", values.join(",")))
        }
        Value::Object(values) => {
            let mut entries = values.iter().collect::<Vec<_>>();
            entries.sort_by(|(left, _), (right, _)| left.cmp(right));
            let mut canonical = String::from("{");
            for (index, (key, value)) in entries.into_iter().enumerate() {
                if index != 0 {
                    canonical.push(',');
                }
                canonical
                    .push_str(&serde_json::to_string(key).map_err(|_| ContractError::InvalidJson)?);
                canonical.push(':');
                canonical.push_str(&canonicalize(value)?);
            }
            canonical.push('}');
            Ok(canonical)
        }
    }
}

fn reject_duplicate_keys(raw: &[u8]) -> ContractResult<()> {
    let mut deserializer = serde_json::Deserializer::from_slice(raw);
    DuplicateSeed
        .deserialize(&mut deserializer)
        .map_err(|_| ContractError::InvalidJson)?;
    deserializer.end().map_err(|_| ContractError::InvalidJson)?;
    Ok(())
}

struct DuplicateSeed;

impl<'de> DeserializeSeed<'de> for DuplicateSeed {
    type Value = ();

    fn deserialize<D>(self, deserializer: D) -> Result<Self::Value, D::Error>
    where
        D: Deserializer<'de>,
    {
        deserializer.deserialize_any(DuplicateVisitor)
    }
}

struct DuplicateVisitor;

impl<'de> Visitor<'de> for DuplicateVisitor {
    type Value = ();

    fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("JSON without duplicate object keys")
    }

    fn visit_map<A>(self, mut map: A) -> Result<Self::Value, A::Error>
    where
        A: MapAccess<'de>,
    {
        let mut keys = HashSet::new();
        while let Some(key) = map.next_key::<String>()? {
            if !keys.insert(key) {
                return Err(de::Error::custom("duplicate object key"));
            }
            map.next_value_seed(DuplicateSeed)?;
        }
        Ok(())
    }

    fn visit_seq<A>(self, mut sequence: A) -> Result<Self::Value, A::Error>
    where
        A: SeqAccess<'de>,
    {
        while sequence.next_element_seed(DuplicateSeed)?.is_some() {}
        Ok(())
    }

    fn visit_bool<E>(self, _value: bool) -> Result<Self::Value, E>
    where
        E: de::Error,
    {
        Ok(())
    }

    fn visit_i64<E>(self, _value: i64) -> Result<Self::Value, E>
    where
        E: de::Error,
    {
        Ok(())
    }

    fn visit_u64<E>(self, _value: u64) -> Result<Self::Value, E>
    where
        E: de::Error,
    {
        Ok(())
    }

    fn visit_f64<E>(self, _value: f64) -> Result<Self::Value, E>
    where
        E: de::Error,
    {
        Ok(())
    }

    fn visit_str<E>(self, _value: &str) -> Result<Self::Value, E>
    where
        E: de::Error,
    {
        Ok(())
    }

    fn visit_string<E>(self, _value: String) -> Result<Self::Value, E>
    where
        E: de::Error,
    {
        Ok(())
    }

    fn visit_none<E>(self) -> Result<Self::Value, E>
    where
        E: de::Error,
    {
        Ok(())
    }

    fn visit_unit<E>(self) -> Result<Self::Value, E>
    where
        E: de::Error,
    {
        Ok(())
    }

    fn visit_some<D>(self, deserializer: D) -> Result<Self::Value, D::Error>
    where
        D: Deserializer<'de>,
    {
        DuplicateSeed.deserialize(deserializer)
    }
}

#[cfg(test)]
mod tests {
    use super::{
        canonical_registry_json, digest_for_document, registry_document, validate_inbound_event,
        validate_inbound_frame, validate_inbound_message, validate_operation_kind,
        validate_registry, validate_registry_document, validate_request, ContractError,
        RequestContext, CANONICAL_REGISTRY_BYTES, PROFILE_ID, REGISTRY_DIGEST,
    };
    use crate::protocol::EXPECTED_REGISTRY_DIGEST;
    use crate::v2::{
        PRODUCTION_REGISTRY_DIGEST as IDENTITY_V2_PRODUCTION_REGISTRY_DIGEST,
        REGISTRY_DIGEST as IDENTITY_V2_REGISTRY_DIGEST,
    };
    use serde_json::{json, Value};

    const AUTHORITY: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const CONNECTION: &str = "01234567-89ab-cdef-0123-456789abcdef";

    fn context<'a>(
        operation: &'a str,
        capability: &'a str,
        connection_id: Option<&'a str>,
    ) -> RequestContext<'a> {
        RequestContext {
            protocol_version: super::PROTOCOL_VERSION,
            profile: PROFILE_ID,
            registry_digest: REGISTRY_DIGEST,
            operation,
            capability,
            authority_ref: Some(AUTHORITY),
            connection_id,
        }
    }

    fn connection_payload() -> Value {
        json!({
            "connectionId": CONNECTION,
        })
    }

    #[test]
    fn frozen_vector_hash_and_reference_closure_are_stable() {
        validate_registry().expect("frozen RelayV2 vector should validate");
        let document = registry_document().expect("frozen JSON should parse");
        let canonical = canonical_registry_json().expect("canonical JSON should serialize");
        assert_eq!(canonical.len(), CANONICAL_REGISTRY_BYTES);
        assert_eq!(
            digest_for_document(&document).expect("digest should compute"),
            REGISTRY_DIGEST
        );
    }

    #[test]
    fn registry_closes_unknown_keywords_fields_and_references() {
        let mut unknown_keyword = registry_document().expect("fixture");
        unknown_keyword["schemas"]["relay-connect"]["unknownKeyword"] = json!(true);
        assert_eq!(
            validate_registry_document(&unknown_keyword),
            Err(ContractError::UnknownSchemaKeyword)
        );

        let mut unknown_root_field = registry_document().expect("fixture");
        unknown_root_field["unexpected"] = json!(true);
        assert_eq!(
            validate_registry_document(&unknown_root_field),
            Err(ContractError::UnknownRegistryField)
        );

        let mut unresolved = registry_document().expect("fixture");
        unresolved["schemas"]["relay-subscribe"]["properties"]["filter"]["$ref"] =
            json!("missing-schema");
        assert_eq!(
            validate_registry_document(&unresolved),
            Err(ContractError::UnresolvedReference)
        );

        let mut missing_schema = registry_document().expect("fixture");
        missing_schema["schemas"]
            .as_object_mut()
            .expect("schema map")
            .remove("relay-filter");
        assert_eq!(
            validate_registry_document(&missing_schema),
            Err(ContractError::UnresolvedReference)
        );
    }

    #[test]
    fn context_and_authority_are_checked_before_operation_semantics() {
        let payload = json!({"authorityRef": AUTHORITY});
        validate_request(
            &context("relay-transport/connect", "relay-transport", None),
            &payload,
        )
        .expect("valid connect should pass");

        let mut wrong_authority = payload.clone();
        wrong_authority["authorityRef"] = json!("f".repeat(64));
        assert_eq!(
            validate_request(
                &context("relay-transport/connect", "relay-transport", None),
                &wrong_authority
            ),
            Err(ContractError::InvalidAuthority)
        );

        let mut wrong_protocol = context("relay-transport/connect", "relay-transport", None);
        wrong_protocol.protocol_version = 1;
        assert_eq!(
            validate_request(&wrong_protocol, &payload),
            Err(ContractError::WrongProtocol)
        );

        let mut wrong_digest = context("relay-transport/connect", "relay-transport", None);
        wrong_digest.registry_digest =
            "0000000000000000000000000000000000000000000000000000000000000000";
        assert_eq!(
            validate_request(&wrong_digest, &payload),
            Err(ContractError::WrongDigest)
        );

        let mut wrong_capability = context("relay-transport/connect", "identity-sign", None);
        assert_eq!(
            validate_request(&wrong_capability, &payload),
            Err(ContractError::WrongCapability)
        );
        wrong_capability.operation = "relay-transport/missing";
        assert_eq!(
            validate_request(&wrong_capability, &payload),
            Err(ContractError::UnknownOperation)
        );
    }

    #[test]
    fn valid_requests_and_inbound_messages_use_the_production_seams() {
        let mut subscribe = connection_payload();
        subscribe["subscriptionId"] = json!("sub-1");
        subscribe["filter"] = json!({
            "#h": ["channel-1"],
            "limit": 20,
        });
        validate_request(
            &context(
                "relay-transport/subscribe",
                "relay-transport",
                Some(CONNECTION),
            ),
            &subscribe,
        )
        .expect("bounded filter should pass");

        let mut sign_message = connection_payload();
        sign_message["channelId"] = json!("channel-1");
        sign_message["content"] = json!("hello");
        sign_message["mentionPubkeys"] = json!([]);
        sign_message["extraTags"] = json!([]);
        validate_request(
            &context(
                "identity-sign/sign_message",
                "identity-sign",
                Some(CONNECTION),
            ),
            &sign_message,
        )
        .expect("valid message signing request should pass");

        let mut sign_presence = connection_payload();
        sign_presence["status"] = json!("online");
        validate_request(
            &context(
                "identity-sign/sign_presence",
                "identity-sign",
                Some(CONNECTION),
            ),
            &sign_presence,
        )
        .expect("valid presence signing request should pass");

        let mut sign_typing = connection_payload();
        sign_typing["channelId"] = json!("channel-1");
        sign_typing["parentEventId"] = Value::Null;
        sign_typing["rootEventId"] = Value::Null;
        validate_request(
            &context(
                "identity-sign/sign_typing",
                "identity-sign",
                Some(CONNECTION),
            ),
            &sign_typing,
        )
        .expect("valid typing signing request should pass");

        let mut sign_status = connection_payload();
        sign_status["text"] = json!("working");
        sign_status["emoji"] = json!("bee");
        sign_status["expiresAt"] = Value::Null;
        validate_request(
            &context(
                "identity-sign/sign_user_status",
                "identity-sign",
                Some(CONNECTION),
            ),
            &sign_status,
        )
        .expect("valid user-status signing request should pass");

        validate_inbound_message(
            "OK",
            &json!({
                "eventId": "a".repeat(64),
                "accepted": true,
                "messageCode": "accepted",
            }),
        )
        .expect("finite OK code should pass");
        validate_inbound_message(
            "EVENT",
            &json!({
                "subscriptionId": "sub-1",
                "event": {
                    "id": "a".repeat(64),
                    "pubkey": "b".repeat(64),
                    "created_at": 1,
                    "kind": 9,
                    "tags": [],
                    "content": "hello",
                    "sig": "c".repeat(128),
                },
            }),
        )
        .expect("typed EVENT should pass");
        validate_inbound_event(&json!({
            "connectionId": CONNECTION,
            "generation": 1,
            "messageType": "EOSE",
            "payload": {"subscriptionId": "sub-1"},
        }))
        .expect("typed message event should pass");
    }

    #[test]
    fn bounds_context_filter_kind_tag_and_code_mutations_fail_closed() {
        let mut status = connection_payload();
        status["subscriptionId"] = json!("sub-1");
        status["filter"] = json!({"kinds": [30315]});
        assert_eq!(
            validate_request(
                &context(
                    "relay-transport/subscribe",
                    "relay-transport",
                    Some(CONNECTION)
                ),
                &status
            ),
            Err(ContractError::InvalidFilter)
        );

        let mut invalid_filter_id = connection_payload();
        invalid_filter_id["subscriptionId"] = json!("sub-1");
        invalid_filter_id["filter"] = json!({"ids": ["A"]});
        assert_eq!(
            validate_request(
                &context(
                    "relay-transport/subscribe",
                    "relay-transport",
                    Some(CONNECTION)
                ),
                &invalid_filter_id
            ),
            Err(ContractError::InvalidPayload)
        );

        let mut oversized_filter = connection_payload();
        oversized_filter["subscriptionId"] = json!("sub-1");
        oversized_filter["filter"] = json!({"#h": ["x".repeat(32_800)]});
        assert_eq!(
            validate_request(
                &context(
                    "relay-transport/subscribe",
                    "relay-transport",
                    Some(CONNECTION)
                ),
                &oversized_filter
            ),
            Err(ContractError::Oversized)
        );

        let mut bad_tags = connection_payload();
        bad_tags["channelId"] = json!("channel-1");
        bad_tags["content"] = json!("hello");
        bad_tags["mentionPubkeys"] = json!([]);
        bad_tags["extraTags"] = json!([["broadcast", "0"]]);
        assert_eq!(
            validate_request(
                &context(
                    "identity-sign/sign_message",
                    "identity-sign",
                    Some(CONNECTION)
                ),
                &bad_tags
            ),
            Err(ContractError::InvalidTags)
        );

        assert_eq!(
            validate_operation_kind("identity-sign/sign_message", 10),
            Err(ContractError::InvalidKind)
        );
        assert_eq!(
            validate_inbound_message(
                "OK",
                &json!({
                    "eventId": "a".repeat(64),
                    "accepted": true,
                    "messageCode": "raw relay prose",
                })
            ),
            Err(ContractError::InvalidPayload)
        );
        assert_eq!(
            validate_inbound_message("COUNT", &json!({})),
            Err(ContractError::UnsupportedMessageType)
        );
        assert_eq!(
            validate_inbound_frame(&vec![b'x'; super::MAX_RELAY_FRAME_BYTES + 1]),
            Err(ContractError::Oversized)
        );
    }

    #[test]
    fn old_v1_and_identity_v2_registry_digests_remain_unchanged() {
        assert_eq!(
            EXPECTED_REGISTRY_DIGEST,
            "1242953f4a5baf1995ee18bac140ca16178a06205771d8a65ab0a9a39bb0ac49"
        );
        assert_eq!(
            IDENTITY_V2_REGISTRY_DIGEST,
            "1032c9f29dee5495099ebf951133bf3cf80c144e39476af39bb67fe62dee3565"
        );
        assert_eq!(
            IDENTITY_V2_PRODUCTION_REGISTRY_DIGEST,
            "452990462a124746a15d6ba7cdd0353e0183e7a3aa300e5b8b596e0439692204"
        );
    }
}
