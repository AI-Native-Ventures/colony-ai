//! Agent-first commands for the co-founder initiative records: the business
//! brief and onboarding progress.
//!
//! Scout reads what Colony knows, proposes a brief with `colony brief propose`,
//! asks one onboarding question at a time with `colony onboarding ask` and
//! proposes the company map. The owner answers in the app; `answer`,
//! `approve-map` and `reject-map` exist so an owner or admin can do the same
//! from the command line. Every write reads the current head first and sends it
//! as the expected head, so a concurrent change is a write conflict (exit code 5).

use buzz_core::company_brief::{
    validate_brief_head, BriefAction, BriefActionKind, BriefContent, BriefHead, BRIEF_D_TAG,
};
use buzz_core::company_cofounder::{ApprovalSwitches, CofounderSettings, MoneyPreference};
use buzz_core::company_functions::CompanyFunction;
use buzz_core::company_onboarding::{
    validate_onboarding_head, AccountRequest, MapEntry, MapPlacement, MapProposalInput,
    OnboardingAction, OnboardingActionKind, OnboardingHead, OnboardingStep, ONBOARDING_D_TAG,
};
use buzz_core::company_records::COMPANY_RECORD_SCHEMA_VERSION;
use buzz_core::kind::{KIND_BRIEF_HEAD, KIND_ONBOARDING_HEAD};
use nostr::{Event, EventBuilder};
use serde_json::{json, Value};

use crate::client::{normalize_write_response, BuzzClient};
use crate::commands::cofounder::{map_write_error, query_company_heads};
use crate::commands::parse_write_response;
use crate::error::CliError;
use crate::validate::sdk_err;
use crate::{BriefCmd, BriefFields, MoneyArg, OnboardingCmd, OnboardingStepArg, PlacementSpec};

pub async fn dispatch_brief(command: BriefCmd, client: &BuzzClient) -> Result<(), CliError> {
    let current = current_brief(client).await?;
    match command {
        BriefCmd::Get => {
            println!(
                "{}",
                brief_output(current.as_ref().map(|(event, head)| (event, head)))
            );
            Ok(())
        }
        BriefCmd::Propose(fields) => {
            let action = brief_action(
                BriefActionKind::Propose,
                Some(fields.into_content()),
                &current,
            );
            submit_brief(client, &action).await
        }
        BriefCmd::Edit(fields) => {
            let action = brief_action(BriefActionKind::Edit, Some(fields.into_content()), &current);
            submit_brief(client, &action).await
        }
        BriefCmd::Confirm => {
            submit_brief(
                client,
                &brief_action(BriefActionKind::Confirm, None, &current),
            )
            .await
        }
        BriefCmd::Discard => {
            submit_brief(
                client,
                &brief_action(BriefActionKind::Discard, None, &current),
            )
            .await
        }
    }
}

pub async fn dispatch_onboarding(
    command: OnboardingCmd,
    client: &BuzzClient,
) -> Result<(), CliError> {
    let current = current_onboarding(client).await?;
    let expected = current.as_ref().map(|(event, _)| event.id.to_hex());
    let mut action = blank_action(OnboardingActionKind::Start, expected);
    match command {
        OnboardingCmd::Get => {
            println!(
                "{}",
                onboarding_output(current.as_ref().map(|(event, head)| (event, head)))
            );
            return Ok(());
        }
        OnboardingCmd::Start { lead } => {
            action.lead_pubkey = lead;
        }
        OnboardingCmd::Ask {
            step,
            text,
            account_id,
            account_label,
            account_url,
        } => {
            action.kind = OnboardingActionKind::Ask;
            action.step = Some(step.into());
            action.text = Some(text);
            action.account = account_request(account_id, account_label, account_url)?;
        }
        OnboardingCmd::Withdraw => action.kind = OnboardingActionKind::Withdraw,
        OnboardingCmd::ProposeMap {
            first,
            sales,
            operations,
            customer_success,
            finance,
            brand,
        } => {
            action.kind = OnboardingActionKind::ProposeMap;
            action.map = Some(map_input(
                first,
                [sales, operations, customer_success, finance, brand],
            ));
        }
        OnboardingCmd::Answer {
            step,
            skipped,
            money,
            approve_every_hire,
            approve_playbook_changes,
            approve_every_discovery_campaign,
        } => {
            action.kind = OnboardingActionKind::Answer;
            action.skipped = skipped;
            let step = OnboardingStep::from(step);
            action.step = Some(step);
            if !skipped {
                let saved = saved_settings(client).await?;
                match step {
                    OnboardingStep::Money => {
                        action.money_preference =
                            Some(money.map_or(saved.money_preference, MoneyPreference::from));
                    }
                    OnboardingStep::Approvals => {
                        action.approval_switches = Some(ApprovalSwitches {
                            approve_every_hire: approve_every_hire
                                .unwrap_or(saved.approval_switches.approve_every_hire),
                            approve_playbook_changes: approve_playbook_changes
                                .unwrap_or(saved.approval_switches.approve_playbook_changes),
                            approve_every_discovery_campaign: approve_every_discovery_campaign
                                .unwrap_or(
                                    saved.approval_switches.approve_every_discovery_campaign,
                                ),
                        });
                    }
                    _ => {}
                }
            }
        }
        OnboardingCmd::ApproveMap => action.kind = OnboardingActionKind::ApproveMap,
        OnboardingCmd::RejectMap => action.kind = OnboardingActionKind::RejectMap,
        OnboardingCmd::Complete => action.kind = OnboardingActionKind::Complete,
    }
    let builder =
        buzz_sdk::company_initiative::build_onboarding_action(&action).map_err(sdk_err)?;
    submit(client, builder, "onboarding changed before it was saved").await
}

impl BriefFields {
    fn into_content(self) -> BriefContent {
        BriefContent {
            what_you_sell: self.what_you_sell,
            who_buys: self.who_buys,
            prices: self.prices,
            how_you_talk: self.how_you_talk,
            sources: self.sources,
        }
    }
}

impl From<OnboardingStepArg> for OnboardingStep {
    fn from(value: OnboardingStepArg) -> Self {
        match value {
            OnboardingStepArg::Brief => OnboardingStep::Brief,
            OnboardingStepArg::Money => OnboardingStep::Money,
            OnboardingStepArg::Approvals => OnboardingStep::Approvals,
            OnboardingStepArg::Accounts => OnboardingStep::Accounts,
        }
    }
}

impl From<MoneyArg> for MoneyPreference {
    fn from(value: MoneyArg) -> Self {
        match value {
            MoneyArg::CheapestFirst => MoneyPreference::CheapestFirst,
            MoneyArg::BestOption => MoneyPreference::BestOption,
        }
    }
}

/// Parses `scout`, `empty` or `agent:<64 hex>` for `propose-map`.
pub(crate) fn parse_placement(value: &str) -> Result<PlacementSpec, String> {
    let trimmed = value.trim();
    match trimmed {
        "scout" => Ok(PlacementSpec {
            placement: MapPlacement::Scout,
            lead_pubkey: None,
        }),
        "empty" => Ok(PlacementSpec {
            placement: MapPlacement::Empty,
            lead_pubkey: None,
        }),
        other => match other.strip_prefix("agent:") {
            Some(pubkey)
                if pubkey.len() == 64
                    && pubkey
                        .chars()
                        .all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c)) =>
            {
                Ok(PlacementSpec {
                    placement: MapPlacement::ExistingAgent,
                    lead_pubkey: Some(pubkey.to_owned()),
                })
            }
            _ => Err(format!(
                "'{value}' is not a placement; use scout, empty or agent:<64 hex public key>"
            )),
        },
    }
}

/// The map Scout proposes: the five functions in order, one placement each.
pub(crate) fn map_input(
    first: CompanyFunction,
    placements: [PlacementSpec; 5],
) -> MapProposalInput {
    MapProposalInput {
        entries: CompanyFunction::ALL
            .into_iter()
            .zip(placements)
            .map(|(function, spec)| MapEntry {
                function,
                placement: spec.placement,
                lead_pubkey: spec.lead_pubkey,
            })
            .collect(),
        first_function: first,
    }
}

/// An account question needs all three flags or none.
fn account_request(
    id: Option<String>,
    label: Option<String>,
    url: Option<String>,
) -> Result<Option<AccountRequest>, CliError> {
    match (id, label) {
        (None, None) => {
            if url.is_some() {
                return Err(CliError::Usage(
                    "--account-url needs --account-id and --account-label".into(),
                ));
            }
            Ok(None)
        }
        (Some(id), Some(label)) => Ok(Some(AccountRequest { id, label, url })),
        _ => Err(CliError::Usage(
            "--account-id and --account-label go together".into(),
        )),
    }
}

fn blank_action(kind: OnboardingActionKind, expected: Option<String>) -> OnboardingAction {
    OnboardingAction {
        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
        kind,
        step: None,
        text: None,
        account: None,
        map: None,
        skipped: false,
        money_preference: None,
        approval_switches: None,
        lead_pubkey: None,
        expected_head_event_id: expected,
    }
}

fn brief_action(
    kind: BriefActionKind,
    content: Option<BriefContent>,
    current: &Option<(Event, BriefHead)>,
) -> BriefAction {
    BriefAction {
        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
        kind,
        content,
        expected_head_event_id: current.as_ref().map(|(event, _)| event.id.to_hex()),
    }
}

async fn submit_brief(client: &BuzzClient, action: &BriefAction) -> Result<(), CliError> {
    let builder = buzz_sdk::company_initiative::build_brief_action(action).map_err(sdk_err)?;
    submit(
        client,
        builder,
        "business brief changed before it was saved",
    )
    .await
}

async fn submit(
    client: &BuzzClient,
    builder: EventBuilder,
    conflict_message: &str,
) -> Result<(), CliError> {
    let event = client.sign_event(builder)?;
    let response = client.submit_event(event).await.map_err(map_write_error)?;
    parse_write_response(&response, conflict_message)?;
    println!("{}", normalize_write_response(&response));
    Ok(())
}

/// The JSON `colony brief get` prints.
pub(crate) fn brief_output(current: Option<(&Event, &BriefHead)>) -> Value {
    match current {
        Some((event, head)) => json!({
            "exists": true,
            "headEventId": event.id.to_hex(),
            "brief": head,
        }),
        None => json!({ "exists": false }),
    }
}

/// The JSON `colony onboarding get` prints.
pub(crate) fn onboarding_output(current: Option<(&Event, &OnboardingHead)>) -> Value {
    match current {
        Some((event, head)) => json!({
            "exists": true,
            "headEventId": event.id.to_hex(),
            "onboarding": head,
        }),
        None => json!({ "exists": false }),
    }
}

async fn current_brief(client: &BuzzClient) -> Result<Option<(Event, BriefHead)>, CliError> {
    let events = query_company_heads(client, KIND_BRIEF_HEAD, &[BRIEF_D_TAG.to_owned()]).await?;
    let Some(event) = events.into_iter().next() else {
        return Ok(None);
    };
    let head = serde_json::from_str::<BriefHead>(&event.content)
        .map_err(|error| CliError::Other(format!("brief head content is invalid: {error}")))?;
    validate_brief_head(&head)
        .map_err(|error| CliError::Other(format!("brief head is invalid: {error}")))?;
    Ok(Some((event, head)))
}

async fn current_onboarding(
    client: &BuzzClient,
) -> Result<Option<(Event, OnboardingHead)>, CliError> {
    let events =
        query_company_heads(client, KIND_ONBOARDING_HEAD, &[ONBOARDING_D_TAG.to_owned()]).await?;
    let Some(event) = events.into_iter().next() else {
        return Ok(None);
    };
    let head = serde_json::from_str::<OnboardingHead>(&event.content)
        .map_err(|error| CliError::Other(format!("onboarding head content is invalid: {error}")))?;
    validate_onboarding_head(&head)
        .map_err(|error| CliError::Other(format!("onboarding head is invalid: {error}")))?;
    Ok(Some((event, head)))
}

/// The saved co-founder settings (defaults while none are saved), so an answer
/// names the value the owner already saved.
async fn saved_settings(client: &BuzzClient) -> Result<CofounderSettings, CliError> {
    Ok(crate::commands::cofounder::current_head(client)
        .await?
        .map_or_else(CofounderSettings::default, |(_, head)| head.settings))
}

#[cfg(test)]
mod tests {
    use buzz_core::company_onboarding::{
        validate_onboarding_action, OnboardingStatus, StepState, StepStatus,
    };
    use clap::Parser;
    use nostr::{Keys, Kind, Tag};

    use super::*;
    use crate::{Cli, Cmd};

    const AGENT: &str = "3333333333333333333333333333333333333333333333333333333333333333";

    fn parse(args: &[&str]) -> Result<Cli, clap::Error> {
        let mut full = vec!["colony"];
        full.extend_from_slice(args);
        Cli::try_parse_from(full)
    }

    fn head_event(kind: u32, d_tag: &str, content: String) -> Event {
        EventBuilder::new(Kind::Custom(kind as u16), content)
            .tag(Tag::parse(["d", d_tag]).expect("d tag"))
            .sign_with_keys(&Keys::generate())
            .expect("sign head")
    }

    #[test]
    fn brief_propose_needs_the_three_texts() {
        assert!(parse(&["brief", "propose"]).is_err());
        assert!(parse(&["brief", "propose", "--what-you-sell", "Websites"]).is_err());
        let ok = parse(&[
            "brief",
            "propose",
            "--what-you-sell",
            "Websites",
            "--who-buys",
            "Guesthouses",
            "--how-you-talk",
            "Friendly",
            "--source",
            "Your website",
            "--source",
            "38 leads",
        ])
        .expect("parse");
        let Cmd::Brief(BriefCmd::Propose(fields)) = ok.command else {
            panic!("expected brief propose");
        };
        let content = fields.into_content();
        assert_eq!(content.sources, vec!["Your website", "38 leads"]);
        assert!(content.prices.is_none());
    }

    #[test]
    fn brief_confirm_and_discard_take_no_text() {
        assert!(matches!(
            parse(&["brief", "confirm"]).expect("parse").command,
            Cmd::Brief(BriefCmd::Confirm)
        ));
        assert!(matches!(
            parse(&["brief", "discard"]).expect("parse").command,
            Cmd::Brief(BriefCmd::Discard)
        ));
        assert!(parse(&["brief", "confirm", "--who-buys", "x"]).is_err());
    }

    #[test]
    fn brief_get_without_a_head_says_it_does_not_exist() {
        assert_eq!(brief_output(None), json!({ "exists": false }));
    }

    #[test]
    fn brief_get_with_a_head_prints_it() {
        let head = BriefHead {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            revision: 1,
            confirmed: None,
            pending: Some(BriefContent {
                what_you_sell: "Websites".into(),
                who_buys: "Guesthouses".into(),
                prices: None,
                how_you_talk: "Friendly".into(),
                sources: vec![],
            }),
            confirmed_by_pubkey: None,
            confirmed_at: None,
            updated_by_pubkey: AGENT.into(),
            updated_at: 10,
        };
        let event = head_event(
            KIND_BRIEF_HEAD,
            BRIEF_D_TAG,
            serde_json::to_string(&head).expect("serialize"),
        );
        let output = brief_output(Some((&event, &head)));
        assert_eq!(output["exists"], json!(true));
        assert_eq!(output["headEventId"], json!(event.id.to_hex()));
        assert_eq!(output["brief"]["pending"]["whatYouSell"], json!("Websites"));
        assert!(output["brief"].get("confirmed").is_none());
    }

    #[test]
    fn onboarding_ask_takes_one_step_and_a_question() {
        assert!(parse(&["onboarding", "ask"]).is_err());
        assert!(parse(&["onboarding", "ask", "--step", "map", "--text", "x"]).is_err());
        let ok = parse(&[
            "onboarding",
            "ask",
            "--step",
            "money",
            "--text",
            "How should I spend money?",
        ])
        .expect("parse");
        assert!(matches!(
            ok.command,
            Cmd::Onboarding(OnboardingCmd::Ask {
                step: OnboardingStepArg::Money,
                ..
            })
        ));
    }

    #[test]
    fn an_account_question_needs_its_id_and_label_together() {
        assert!(account_request(None, None, None).expect("none").is_none());
        assert!(account_request(Some("pinterest".into()), None, None).is_err());
        assert!(account_request(None, Some("Pinterest".into()), None).is_err());
        assert!(account_request(None, None, Some("https://x.test".into())).is_err());
        let account = account_request(
            Some("pinterest".into()),
            Some("Pinterest".into()),
            Some("https://www.pinterest.com/login/".into()),
        )
        .expect("account")
        .expect("some");
        assert_eq!(account.id, "pinterest");
    }

    #[test]
    fn placements_parse_scout_empty_and_an_agent() {
        assert_eq!(
            parse_placement("scout").expect("scout").placement,
            MapPlacement::Scout
        );
        assert_eq!(
            parse_placement("empty").expect("empty").placement,
            MapPlacement::Empty
        );
        let agent = parse_placement(&format!("agent:{AGENT}")).expect("agent");
        assert_eq!(agent.placement, MapPlacement::ExistingAgent);
        assert_eq!(agent.lead_pubkey.as_deref(), Some(AGENT));
        assert!(parse_placement("agent:abc").is_err());
        assert!(parse_placement("nobody").is_err());
        assert!(parse_placement("agent:ZZZZ").is_err());
    }

    #[test]
    fn propose_map_builds_the_five_functions_in_order() {
        let cli = parse(&[
            "onboarding",
            "propose-map",
            "--first",
            "sales",
            "--sales",
            &format!("agent:{AGENT}"),
            "--operations",
            "scout",
            "--customer-success",
            "empty",
            "--finance",
            "empty",
            "--brand",
            "empty",
        ])
        .expect("parse");
        let Cmd::Onboarding(OnboardingCmd::ProposeMap {
            first,
            sales,
            operations,
            customer_success,
            finance,
            brand,
        }) = cli.command
        else {
            panic!("expected propose-map");
        };
        let map = map_input(first, [sales, operations, customer_success, finance, brand]);
        assert_eq!(map.entries.len(), 5);
        assert_eq!(map.entries[0].function, CompanyFunction::Sales);
        assert_eq!(map.entries[0].placement, MapPlacement::ExistingAgent);
        assert_eq!(map.entries[1].placement, MapPlacement::Scout);
        assert_eq!(map.entries[4].function, CompanyFunction::Brand);
        let mut action = blank_action(OnboardingActionKind::ProposeMap, None);
        action.map = Some(map);
        assert!(validate_onboarding_action(&action).is_ok());
    }

    #[test]
    fn propose_map_needs_every_function() {
        assert!(parse(&[
            "onboarding",
            "propose-map",
            "--first",
            "sales",
            "--sales",
            "scout",
        ])
        .is_err());
    }

    #[test]
    fn answer_names_a_step_and_can_be_skipped() {
        assert!(parse(&["onboarding", "answer"]).is_err());
        assert!(parse(&["onboarding", "answer", "--step", "map"]).is_err());
        let skipped =
            parse(&["onboarding", "answer", "--step", "accounts", "--skipped"]).expect("parse");
        assert!(matches!(
            skipped.command,
            Cmd::Onboarding(OnboardingCmd::Answer { skipped: true, .. })
        ));
    }

    #[test]
    fn onboarding_get_prints_the_head_or_says_it_does_not_exist() {
        assert_eq!(onboarding_output(None), json!({ "exists": false }));
        let head = OnboardingHead {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            revision: 1,
            status: OnboardingStatus::InProgress,
            lead_pubkey: AGENT.into(),
            steps: OnboardingStep::ALL
                .into_iter()
                .map(|step| StepStatus {
                    step,
                    state: StepState::Todo,
                })
                .collect(),
            question: None,
            accounts: vec![],
            map: None,
            started_at: 1,
            resumed_at: None,
            resume_count: 0,
            completed_at: None,
            updated_by_pubkey: AGENT.into(),
            updated_at: 1,
        };
        let event = head_event(
            KIND_ONBOARDING_HEAD,
            ONBOARDING_D_TAG,
            serde_json::to_string(&head).expect("serialize"),
        );
        let output = onboarding_output(Some((&event, &head)));
        assert_eq!(output["exists"], json!(true));
        assert_eq!(output["onboarding"]["status"], json!("in_progress"));
        assert_eq!(output["onboarding"]["steps"][0]["step"], json!("brief"));
    }

    #[test]
    fn a_stale_head_rejection_maps_to_a_write_conflict() {
        let stale = CliError::Relay {
            status: 400,
            body: "conflict: onboarding changed; current head is abc".into(),
        };
        assert!(matches!(map_write_error(stale), CliError::Conflict(_)));
    }
}
