//! Agent-first commands for the per-company co-founder settings record.
//!
//! `colony cofounder get` prints the current settings (or the defaults when
//! none are saved). `colony cofounder set` reads the current head and writes
//! the change against it, so a concurrent change is a write conflict.

use buzz_core::company_cofounder::{
    validate_cofounder_head, ApprovalSwitches, CofounderHead, CofounderSettings, MoneyPreference,
    COFOUNDER_D_TAG,
};
use buzz_core::kind::KIND_COFOUNDER_HEAD;
use nostr::Event;
use serde_json::{json, Value};

use crate::client::{normalize_write_response, BuzzClient};
use crate::commands::parse_write_response;
use crate::error::CliError;
use crate::validate::sdk_err;
use crate::{CofounderCmd, MoneyArg};

/// Upper bound on company head events one query may return.
const COMPANY_HEAD_QUERY_BOUND: u32 = 100;

pub async fn dispatch(command: CofounderCmd, client: &BuzzClient) -> Result<(), CliError> {
    match command {
        CofounderCmd::Get => {
            let current = current_head(client).await?;
            let output = settings_output(current.as_ref().map(|(event, head)| (event, head)));
            println!("{output}");
            Ok(())
        }
        CofounderCmd::Set {
            enabled,
            money,
            approve_every_hire,
            approve_playbook_changes,
            approve_every_discovery_campaign,
        } => {
            let current = current_head(client).await?;
            let base = current
                .as_ref()
                .map_or_else(CofounderSettings::default, |(_, head)| head.settings);
            let settings = apply_set(
                base,
                enabled,
                money,
                approve_every_hire,
                approve_playbook_changes,
                approve_every_discovery_campaign,
            );
            let expected = current.as_ref().map(|(event, _)| event.id.to_hex());
            let builder =
                buzz_sdk::company_records::build_cofounder_action(&settings, expected.as_deref())
                    .map_err(sdk_err)?;
            let event = client.sign_event(builder)?;
            let response = client.submit_event(event).await.map_err(map_write_error)?;
            parse_write_response(
                &response,
                "co-founder settings changed before they were saved",
            )?;
            println!("{}", normalize_write_response(&response));
            Ok(())
        }
    }
}

/// Applies the flags of `colony cofounder set` to the current settings.
/// Flags that are not given keep their current value.
pub(crate) fn apply_set(
    current: CofounderSettings,
    enabled: bool,
    money: Option<MoneyArg>,
    approve_every_hire: Option<bool>,
    approve_playbook_changes: Option<bool>,
    approve_every_discovery_campaign: Option<bool>,
) -> CofounderSettings {
    CofounderSettings {
        enabled,
        money_preference: money.map_or(current.money_preference, |value| match value {
            MoneyArg::CheapestFirst => MoneyPreference::CheapestFirst,
            MoneyArg::BestOption => MoneyPreference::BestOption,
        }),
        approval_switches: ApprovalSwitches {
            approve_every_hire: approve_every_hire
                .unwrap_or(current.approval_switches.approve_every_hire),
            approve_playbook_changes: approve_playbook_changes
                .unwrap_or(current.approval_switches.approve_playbook_changes),
            approve_every_discovery_campaign: approve_every_discovery_campaign
                .unwrap_or(current.approval_switches.approve_every_discovery_campaign),
        },
    }
}

/// The JSON `colony cofounder get` prints. With no head it prints the
/// defaults and `"exists": false`.
pub(crate) fn settings_output(current: Option<(&Event, &CofounderHead)>) -> Value {
    match current {
        Some((event, head)) => json!({
            "exists": true,
            "headEventId": event.id.to_hex(),
            "settings": head.settings,
            "updatedByPubkey": head.updated_by_pubkey,
            "updatedAt": head.updated_at,
        }),
        None => json!({
            "exists": false,
            "settings": CofounderSettings::default(),
        }),
    }
}

/// A stale `expectedHeadEventId` comes back as a relay rejection that names a
/// conflict; the CLI reports it as a write conflict (exit code 5).
pub(crate) fn map_write_error(error: CliError) -> CliError {
    match error {
        CliError::Relay { status: 400, body } if body.contains("conflict:") => {
            CliError::Conflict(body)
        }
        other => other,
    }
}

pub(crate) async fn current_head(
    client: &BuzzClient,
) -> Result<Option<(Event, CofounderHead)>, CliError> {
    let events =
        query_company_heads(client, KIND_COFOUNDER_HEAD, &[COFOUNDER_D_TAG.to_owned()]).await?;
    let Some(event) = events.into_iter().next() else {
        return Ok(None);
    };
    let head = serde_json::from_str::<CofounderHead>(&event.content)
        .map_err(|error| CliError::Other(format!("co-founder head content is invalid: {error}")))?;
    validate_cofounder_head(&head)
        .map_err(|error| CliError::Other(format!("co-founder head is invalid: {error}")))?;
    Ok(Some((event, head)))
}

/// Loads the relay-signed heads of one kind for the given d-tags, verifying the
/// author, signature and exact tags. At most one head per d-tag is returned.
pub(crate) async fn query_company_heads(
    client: &BuzzClient,
    kind: u32,
    d_tags: &[String],
) -> Result<Vec<Event>, CliError> {
    let relay_self = relay_self(client).await?;
    let raw = client
        .query_all_bounded(
            json!({"kinds": [kind], "authors": [relay_self], "#d": d_tags}),
            COMPANY_HEAD_QUERY_BOUND,
        )
        .await?;
    let mut events: Vec<Event> = Vec::with_capacity(raw.len());
    for value in raw {
        let event = serde_json::from_value::<Event>(value)
            .map_err(|error| CliError::Other(format!("company head is malformed: {error}")))?;
        verify_head(&event, kind, &relay_self, d_tags)?;
        let d_tag = head_d_tag(&event);
        if events.iter().any(|seen| head_d_tag(seen) == d_tag) {
            return Err(CliError::Other(
                "relay returned duplicate company record heads".into(),
            ));
        }
        events.push(event);
    }
    Ok(events)
}

/// The `d` tag value of a head event, or an empty string when it has none.
pub(crate) fn head_d_tag(event: &Event) -> String {
    event
        .tags
        .iter()
        .find(|tag| tag.kind().to_string() == "d")
        .and_then(|tag| tag.content())
        .unwrap_or_default()
        .to_owned()
}

fn verify_head(
    event: &Event,
    kind: u32,
    relay_self: &str,
    d_tags: &[String],
) -> Result<(), CliError> {
    if u32::from(event.kind.as_u16()) != kind || event.pubkey.to_hex() != relay_self {
        return Err(CliError::Other(
            "company record head has an unexpected kind or author".into(),
        ));
    }
    event.verify().map_err(|error| {
        CliError::Other(format!("company record head signature is invalid: {error}"))
    })?;
    let d_count = event
        .tags
        .iter()
        .filter(|tag| tag.kind().to_string() == "d")
        .count();
    if event.tags.len() != 1 || d_count != 1 || !d_tags.contains(&head_d_tag(event)) {
        return Err(CliError::Other(
            "company record head tags do not match its d-tag".into(),
        ));
    }
    Ok(())
}

async fn relay_self(client: &BuzzClient) -> Result<String, CliError> {
    let raw = client.get_public("/").await?;
    let nip11: Value = serde_json::from_str(&raw)
        .map_err(|error| CliError::Other(format!("relay info is not valid JSON: {error}")))?;
    let value = nip11
        .get("self")
        .and_then(Value::as_str)
        .ok_or_else(|| CliError::Other("relay info document is missing self".into()))?;
    nostr::PublicKey::from_hex(value)
        .map(|pubkey| pubkey.to_hex())
        .map_err(|_| CliError::Other("relay self key is invalid".into()))
}

#[cfg(test)]
mod tests {
    use buzz_core::company_records::COMPANY_RECORD_SCHEMA_VERSION;
    use clap::Parser;
    use nostr::{EventBuilder, Keys, Kind, Tag};

    use super::*;
    use crate::{Cli, Cmd};

    fn parse(args: &[&str]) -> Result<Cli, clap::Error> {
        let mut full = vec!["colony"];
        full.extend_from_slice(args);
        Cli::try_parse_from(full)
    }

    fn head_event(settings: CofounderSettings) -> (Event, CofounderHead) {
        let head = CofounderHead {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            settings,
            updated_by_pubkey: "a".repeat(64),
            updated_at: 1_700_000_000,
        };
        let event = EventBuilder::new(
            Kind::Custom(KIND_COFOUNDER_HEAD as u16),
            serde_json::to_string(&head).expect("serialize head"),
        )
        .tag(Tag::parse(["d", COFOUNDER_D_TAG]).expect("d tag"))
        .sign_with_keys(&Keys::generate())
        .expect("sign head");
        (event, head)
    }

    #[test]
    fn cofounder_set_requires_enabled_flag() {
        assert!(parse(&["cofounder", "set"]).is_err());
        assert!(parse(&["cofounder", "set", "--money", "best-option"]).is_err());
        let ok = parse(&["cofounder", "set", "--enabled", "true"]).expect("parse");
        assert!(matches!(
            ok.command,
            Cmd::Cofounder(CofounderCmd::Set { enabled: true, .. })
        ));
        let off = parse(&["cofounder", "set", "--enabled", "false"]).expect("parse");
        assert!(matches!(
            off.command,
            Cmd::Cofounder(CofounderCmd::Set { enabled: false, .. })
        ));
        assert!(parse(&["cofounder", "set", "--enabled", "maybe"]).is_err());
    }

    #[test]
    fn cofounder_get_without_head_prints_defaults() {
        let output = settings_output(None);
        assert_eq!(output["exists"], json!(false));
        assert_eq!(output["settings"]["enabled"], json!(false));
        assert_eq!(
            output["settings"]["moneyPreference"],
            json!("cheapest_first")
        );
        assert_eq!(
            output["settings"]["approvalSwitches"]["approveEveryHire"],
            json!(false)
        );
        assert!(output.get("headEventId").is_none());
    }

    #[test]
    fn cofounder_get_with_head_prints_the_head() {
        let settings = CofounderSettings {
            enabled: true,
            money_preference: MoneyPreference::BestOption,
            ..CofounderSettings::default()
        };
        let (event, head) = head_event(settings);
        let output = settings_output(Some((&event, &head)));
        assert_eq!(output["exists"], json!(true));
        assert_eq!(output["headEventId"], json!(event.id.to_hex()));
        assert_eq!(output["settings"]["enabled"], json!(true));
        assert_eq!(output["settings"]["moneyPreference"], json!("best_option"));
        assert_eq!(output["updatedAt"], json!(1_700_000_000));
    }

    #[test]
    fn cofounder_set_keeps_settings_it_was_not_asked_to_change() {
        let current = CofounderSettings {
            enabled: true,
            money_preference: MoneyPreference::BestOption,
            approval_switches: ApprovalSwitches {
                approve_every_hire: true,
                approve_playbook_changes: false,
                approve_every_discovery_campaign: false,
            },
        };
        let changed = apply_set(current, false, None, None, Some(true), None);
        assert!(!changed.enabled);
        assert_eq!(changed.money_preference, MoneyPreference::BestOption);
        assert!(changed.approval_switches.approve_every_hire);
        assert!(changed.approval_switches.approve_playbook_changes);
        assert!(!changed.approval_switches.approve_every_discovery_campaign);
        let cheapest = apply_set(
            current,
            true,
            Some(MoneyArg::CheapestFirst),
            None,
            None,
            None,
        );
        assert_eq!(cheapest.money_preference, MoneyPreference::CheapestFirst);
    }

    #[test]
    fn stale_head_rejection_maps_to_write_conflict_exit_code() {
        let stale = CliError::Relay {
            status: 400,
            body: "conflict: co-founder settings changed; current head is abc".into(),
        };
        let mapped = map_write_error(stale);
        assert!(matches!(mapped, CliError::Conflict(_)));
        assert_eq!(crate::error::exit_code(&mapped), 5);
        // Other relay rejections keep their own category.
        let denied = CliError::Relay {
            status: 400,
            body: "restricted: only the owner or an admin can change co-founder mode".into(),
        };
        let mapped = map_write_error(denied);
        assert!(matches!(mapped, CliError::Relay { .. }));
        assert_eq!(crate::error::exit_code(&mapped), 2);
    }

    #[test]
    fn head_verification_rejects_a_foreign_author_and_extra_tags() {
        let (event, _) = head_event(CofounderSettings::default());
        let author = event.pubkey.to_hex();
        let d_tags = [COFOUNDER_D_TAG.to_owned()];
        assert!(verify_head(&event, KIND_COFOUNDER_HEAD, &author, &d_tags).is_ok());
        assert!(verify_head(&event, KIND_COFOUNDER_HEAD, &"b".repeat(64), &d_tags).is_err());
        assert!(verify_head(&event, KIND_COFOUNDER_HEAD, &author, &["other".to_owned()]).is_err());
        let keys = Keys::generate();
        let extra = EventBuilder::new(Kind::Custom(KIND_COFOUNDER_HEAD as u16), "{}")
            .tags([
                Tag::parse(["d", COFOUNDER_D_TAG]).expect("d tag"),
                Tag::parse(["t", "x"]).expect("t tag"),
            ])
            .sign_with_keys(&keys)
            .expect("sign");
        assert!(verify_head(
            &extra,
            KIND_COFOUNDER_HEAD,
            &keys.public_key().to_hex(),
            &d_tags
        )
        .is_err());
    }
}
