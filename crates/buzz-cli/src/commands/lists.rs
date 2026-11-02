//! Agent tools for outreach lists and shared Discovery campaigns.
//!
//! Reads come from the relay-signed heads in the business channel the caller can see: lists
//! (kind 30684) and campaigns (kind 30685). Writes are ordinary signed actions (kinds 47075 and
//! 47076) that the relay checks with the same rules as the desktop: a list holds lead ids only,
//! every added lead must exist, and only people archive. Nothing here sends a message; a batch
//! for a list still waits for the owner. Contract: `docs/outreach-lists-contract.md`.

use std::collections::{HashMap, HashSet};

use buzz_core::business_records::BUSINESS_RECORD_SCHEMA_VERSION;
use buzz_core::kind::{KIND_DISCOVERY_CAMPAIGN_HEAD, KIND_OUTREACH_LIST_HEAD};
use buzz_core::outreach_lists::{
    DiscoveryCampaignHead, ListOp, ListSource, ListSourceKind, ListStatus, OutreachListAction,
    OutreachListHead, TemplateRef, MAX_LIST_MEMBERS,
};
use buzz_sdk::business_records::build_outreach_list_action;
use serde::de::DeserializeOwned;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::client::{normalize_write_response, BuzzClient};
use crate::commands::discovery::{resolve_save_target, SaveTarget};
use crate::commands::leads::{load_leads, normalize_relay_self_hex, CurrentLead};
use crate::commands::whatsapp::{fetch_templates, resolve_template, WHATSAPP_QUERY_PATH};
use crate::error::CliError;
use crate::links::{
    campaign_link, lead_link, list_link, parse_campaign_reference, parse_lead_reference,
    parse_list_reference, parse_template_reference, template_link,
};
use crate::validate::sdk_err;

const HEAD_QUERY_BOUND: u32 = 10_000;
const DEFAULT_LIST_LIMIT: usize = 50;
const MAX_LIST_LIMIT: usize = 500;
/// Most times one change is re-sent when another writer changed the record at the same moment.
const MAX_ATTEMPTS: usize = 3;
/// The relay's answer when two writers race for the same head.
const RACE_MARKER: &str = "changed before the command committed";
/// The WhatsApp contacts query returns at most this many contacts.
const CONTACT_WINDOW: u32 = 200;

pub async fn dispatch(cmd: crate::ListsCmd, client: &BuzzClient) -> Result<(), CliError> {
    use crate::ListsCmd;
    match cmd {
        ListsCmd::List {
            query,
            archived,
            limit,
        } => cmd_list(client, query.as_deref(), archived, limit).await,
        ListsCmd::Get { list } => cmd_get(client, &list).await,
        ListsCmd::Create {
            name,
            lead,
            from_campaign,
            note,
            template,
            language,
        } => {
            cmd_create(
                client,
                &name,
                &lead,
                from_campaign.as_deref(),
                note.as_deref(),
                template.as_deref(),
                language.as_deref(),
            )
            .await
        }
        ListsCmd::Add { list, lead } => cmd_members(client, &list, &lead, ListOp::AddMembers).await,
        ListsCmd::Remove { list, lead } => {
            cmd_members(client, &list, &lead, ListOp::RemoveMembers).await
        }
        ListsCmd::Rename { list, name, note } => {
            cmd_rename(client, &list, name.as_deref(), note.as_deref()).await
        }
    }
}

pub async fn dispatch_campaigns(
    cmd: crate::CampaignsCmd,
    client: &BuzzClient,
) -> Result<(), CliError> {
    use crate::CampaignsCmd;
    match cmd {
        CampaignsCmd::List {
            query,
            archived,
            limit,
        } => cmd_campaigns_list(client, query.as_deref(), archived, limit).await,
        CampaignsCmd::Get { campaign } => cmd_campaigns_get(client, &campaign).await,
    }
}

/// A verified current head and the coordinates needed to replace it.
#[derive(Debug, Clone)]
pub(crate) struct Stored<T> {
    pub(crate) record_id: Uuid,
    pub(crate) event_id: String,
    pub(crate) channel_id: Uuid,
    pub(crate) community_id: Uuid,
    pub(crate) created_at: u64,
    pub(crate) head: T,
}

pub(crate) type StoredList = Stored<OutreachListHead>;
pub(crate) type StoredCampaign = Stored<DiscoveryCampaignHead>;

/// Split `business:<community>:<record_type>:<id>`.
fn parse_coordinate(d_tag: &str, record_type: &str) -> Option<(Uuid, Uuid)> {
    let mut parts = d_tag.split(':');
    if parts.next()? != "business" {
        return None;
    }
    let community_id = Uuid::parse_str(parts.next()?).ok()?;
    if parts.next()? != record_type {
        return None;
    }
    let record_id = Uuid::parse_str(parts.next()?).ok()?;
    if parts.next().is_some() {
        return None;
    }
    Some((community_id, record_id))
}

/// Check that a head is relay-signed, well formed and consistent with its coordinate.
fn parse_head_event<T: DeserializeOwned>(
    event: &Value,
    relay_self: &str,
    kind: u32,
    record_type: &str,
) -> Result<Stored<T>, CliError> {
    let signed: nostr::Event = serde_json::from_value(event.clone())
        .map_err(|error| CliError::Other(format!("{record_type} head is malformed: {error}")))?;
    if signed.kind != nostr::Kind::Custom(kind as u16) {
        return Err(CliError::Other(format!(
            "{record_type} head has wrong kind: {}",
            signed.kind.as_u16()
        )));
    }
    if signed.pubkey.to_hex() != relay_self {
        return Err(CliError::Other(format!(
            "{record_type} head author does not match the relay self key"
        )));
    }
    signed.verify().map_err(|error| {
        CliError::Other(format!("{record_type} head signature is invalid: {error}"))
    })?;
    let tag_values = |name: &str| -> Vec<String> {
        signed
            .tags
            .iter()
            .filter(|tag| tag.kind().to_string() == name)
            .filter_map(|tag| tag.content().map(str::to_owned))
            .collect()
    };
    let (d_tags, h_tags) = (tag_values("d"), tag_values("h"));
    let ([d_tag], [h_tag]) = (d_tags.as_slice(), h_tags.as_slice()) else {
        return Err(CliError::Other(format!(
            "{record_type} head must have exactly one d tag and one h tag"
        )));
    };
    let (community_id, record_id) = parse_coordinate(d_tag, record_type).ok_or_else(|| {
        CliError::Other(format!(
            "{record_type} head d-tag is not a {record_type} coordinate"
        ))
    })?;
    let channel_id = Uuid::parse_str(h_tag)
        .map_err(|_| CliError::Other(format!("{record_type} head h-tag is not a channel UUID")))?;
    let head: T = serde_json::from_str(&signed.content).map_err(|error| {
        CliError::Other(format!("{record_type} head content is invalid: {error}"))
    })?;
    Ok(Stored {
        record_id,
        event_id: signed.id.to_hex(),
        channel_id,
        community_id,
        created_at: signed.created_at.as_secs(),
        head,
    })
}

/// The relay's own public key, from its NIP-11 document.
async fn relay_self(client: &BuzzClient) -> Result<String, CliError> {
    let raw = client.get_public("/").await.map_err(|error| {
        CliError::Other(format!("failed to fetch relay info document: {error}"))
    })?;
    let document: Value = serde_json::from_str(&raw).map_err(|error| {
        CliError::Other(format!("relay info document is not valid JSON: {error}"))
    })?;
    let relay_self = document
        .get("self")
        .and_then(Value::as_str)
        .ok_or_else(|| CliError::Other("relay info document missing 'self' field".into()))?;
    normalize_relay_self_hex(relay_self)
}

/// Every current head of one kind, newest first, one per record.
async fn load_heads<T: DeserializeOwned>(
    client: &BuzzClient,
    kind: u32,
    record_type: &str,
) -> Result<Vec<Stored<T>>, CliError> {
    let relay_self = relay_self(client).await?;
    let events = client
        .query_all_bounded(
            json!({ "kinds": [kind], "authors": [relay_self] }),
            HEAD_QUERY_BOUND,
        )
        .await?;
    let mut latest: HashMap<Uuid, Stored<T>> = HashMap::new();
    for event in &events {
        let stored = parse_head_event::<T>(event, &relay_self, kind, record_type)?;
        let newer = latest.get(&stored.record_id).is_none_or(|existing| {
            (stored.created_at, &stored.event_id) > (existing.created_at, &existing.event_id)
        });
        if newer {
            latest.insert(stored.record_id, stored);
        }
    }
    let mut heads: Vec<Stored<T>> = latest.into_values().collect();
    heads.sort_by(|left, right| {
        right
            .created_at
            .cmp(&left.created_at)
            .then_with(|| left.record_id.cmp(&right.record_id))
    });
    Ok(heads)
}

/// Every current outreach list, newest change first.
pub(crate) async fn load_lists(client: &BuzzClient) -> Result<Vec<StoredList>, CliError> {
    let lists =
        load_heads::<OutreachListHead>(client, KIND_OUTREACH_LIST_HEAD, "outreach_list").await?;
    if lists.iter().any(|list| list.head.list_id != list.record_id) {
        return Err(CliError::Other(
            "a list head d-tag does not match its content".into(),
        ));
    }
    Ok(lists)
}

async fn load_campaigns(client: &BuzzClient) -> Result<Vec<StoredCampaign>, CliError> {
    let campaigns = load_heads::<DiscoveryCampaignHead>(
        client,
        KIND_DISCOVERY_CAMPAIGN_HEAD,
        "discovery_campaign",
    )
    .await?;
    if campaigns
        .iter()
        .any(|campaign| campaign.head.campaign_id != campaign.record_id)
    {
        return Err(CliError::Other(
            "a campaign head d-tag does not match its content".into(),
        ));
    }
    Ok(campaigns)
}

/// Find one list by id, saying exactly why when it is not usable.
pub(crate) fn find_list(lists: &[StoredList], list_id: Uuid) -> Result<&StoredList, CliError> {
    lists
        .iter()
        .find(|list| list.record_id == list_id)
        .ok_or_else(|| CliError::NotFound(format!("list {list_id} not found")))
}

fn snake<T: serde::Serialize>(value: &T) -> String {
    serde_json::to_value(value)
        .ok()
        .and_then(|value| value.as_str().map(str::to_owned))
        .unwrap_or_default()
}

fn clamp_limit(limit: Option<u32>) -> Result<usize, CliError> {
    let limit = limit.map_or(DEFAULT_LIST_LIMIT, |limit| limit as usize);
    if limit == 0 || limit > MAX_LIST_LIMIT {
        return Err(CliError::Usage(format!(
            "limit must be 1 through {MAX_LIST_LIMIT}"
        )));
    }
    Ok(limit)
}

fn query_matches(query: &Option<String>, fields: &[Option<&str>]) -> bool {
    match query {
        None => true,
        Some(query) => fields
            .iter()
            .flatten()
            .any(|field| field.to_lowercase().contains(query.as_str())),
    }
}

fn normalized_query(query: Option<&str>) -> Option<String> {
    query
        .map(|query| query.trim().to_lowercase())
        .filter(|query| !query.is_empty())
}

fn template_json(template: &TemplateRef, title: Option<&str>) -> Value {
    json!({
        "name": template.name,
        "language": template.language,
        "title": title,
        "reference": template_link(&template.name, &template.language),
    })
}

fn list_source_json(source: &ListSource) -> Value {
    json!({
        "kind": snake(&source.kind),
        "campaignId": source.campaign_id.map(|id| id.to_string()),
        "campaignReference": source.campaign_id.map(campaign_link),
    })
}

/// One row of `lists list`.
fn list_summary(list: &StoredList) -> Value {
    let head = &list.head;
    json!({
        "listId": head.list_id.to_string(),
        "reference": list_link(head.list_id),
        "name": head.name,
        "note": head.note,
        "status": snake(&head.status),
        "size": head.members.len(),
        "source": list_source_json(&head.source),
        "defaultTemplate": head.default_template.as_ref().map(|t| template_json(t, None)),
        "createdByAgent": head.created_by_agent,
        "updatedAt": head.updated_at,
    })
}

/// What the WhatsApp desk knows about a lead's contact.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct WhatsappInfo {
    pub(crate) status: String,
    pub(crate) opted_out: bool,
}

/// One member of `lists get`, or `None` when the lead no longer exists.
fn member_json(
    lead_id: Uuid,
    lead: Option<&CurrentLead>,
    whatsapp: Option<&WhatsappInfo>,
    added_by_agent: bool,
    added_at: i64,
) -> Option<Value> {
    let lead = lead?;
    let prospect = &lead.head.prospect;
    Some(json!({
        "leadId": lead_id.to_string(),
        "reference": lead_link(lead_id),
        "name": prospect.party.display_name,
        "stage": snake(&prospect.stage),
        "status": lead.head.status,
        "phone": prospect.phone,
        "website": prospect.website,
        "contactName": prospect.contact_name,
        "whatsapp": whatsapp.map(|info| json!({
            "status": info.status,
            "optedOut": info.opted_out,
        })),
        "addedByAgent": added_by_agent,
        "addedAt": added_at,
    }))
}

/// The full `lists get` answer.
pub(crate) fn list_detail(
    list: &StoredList,
    leads: &HashMap<Uuid, &CurrentLead>,
    whatsapp: &HashMap<Uuid, WhatsappInfo>,
    default_template_title: Option<&str>,
) -> Value {
    let head = &list.head;
    let mut members = Vec::new();
    let mut missing = Vec::new();
    for member in &head.members {
        match member_json(
            member.lead_id,
            leads.get(&member.lead_id).copied(),
            whatsapp.get(&member.lead_id),
            member.added_by_agent,
            member.added_at,
        ) {
            Some(row) => members.push(row),
            None => missing.push(member.lead_id.to_string()),
        }
    }
    let mut detail = list_summary(list);
    if let Some(object) = detail.as_object_mut() {
        object.insert(
            "defaultTemplate".into(),
            json!(head
                .default_template
                .as_ref()
                .map(|t| template_json(t, default_template_title))),
        );
        object.insert("members".into(), Value::Array(members));
        object.insert("missing".into(), json!(missing));
        object.insert("headEventId".into(), json!(list.event_id));
        object.insert("createdAt".into(), json!(head.created_at));
    }
    detail
}

/// Best effort: what WhatsApp knows about each lead's contact, from the 200 most recent
/// contacts. A lead that is not among them has no entry; that is not proof it was never
/// contacted, and every batch skips opted-out contacts regardless.
pub(crate) async fn load_whatsapp_by_lead(client: &BuzzClient) -> HashMap<Uuid, WhatsappInfo> {
    let mut by_lead = HashMap::new();
    let Ok(raw) = client
        .post_json_authed(
            WHATSAPP_QUERY_PATH,
            &json!({ "what": "contacts", "limit": CONTACT_WINDOW }),
        )
        .await
    else {
        return by_lead;
    };
    let Ok(value) = serde_json::from_str::<Value>(&raw) else {
        return by_lead;
    };
    for contact in value
        .get("contacts")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default()
    {
        let Some(lead_id) = contact
            .get("leadId")
            .and_then(Value::as_str)
            .and_then(|id| Uuid::parse_str(id).ok())
        else {
            continue;
        };
        let opted_out = contact
            .get("optedOut")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let status = contact
            .get("outreachStatus")
            .and_then(Value::as_str)
            .unwrap_or("none")
            .to_owned();
        by_lead.insert(lead_id, WhatsappInfo { status, opted_out });
    }
    by_lead
}

async fn cmd_list(
    client: &BuzzClient,
    query: Option<&str>,
    archived: bool,
    limit: Option<u32>,
) -> Result<(), CliError> {
    let limit = clamp_limit(limit)?;
    let query = normalized_query(query);
    let wanted = if archived {
        ListStatus::Archived
    } else {
        ListStatus::Active
    };
    let rows: Vec<Value> = load_lists(client)
        .await?
        .iter()
        .filter(|list| list.head.status == wanted)
        .filter(|list| {
            query_matches(
                &query,
                &[Some(list.head.name.as_str()), list.head.note.as_deref()],
            )
        })
        .take(limit)
        .map(list_summary)
        .collect();
    println!("{}", Value::Array(rows));
    Ok(())
}

async fn cmd_get(client: &BuzzClient, list: &str) -> Result<(), CliError> {
    let list_id = parse_list_reference(list)?;
    let lists = load_lists(client).await?;
    let list = find_list(&lists, list_id)?;
    let leads = load_leads(client).await?;
    let by_id: HashMap<Uuid, &CurrentLead> = leads
        .iter()
        .map(|lead| (lead.head.prospect_id, lead))
        .collect();
    let whatsapp = load_whatsapp_by_lead(client).await;
    let title = match list.head.default_template.as_ref() {
        Some(template) => template_title(client, template).await,
        None => None,
    };
    println!("{}", list_detail(list, &by_id, &whatsapp, title.as_deref()));
    Ok(())
}

/// The Colony title of a template, when the template list can be read.
async fn template_title(client: &BuzzClient, template: &TemplateRef) -> Option<String> {
    let templates = fetch_templates(client).await.ok()?;
    templates
        .iter()
        .find(|candidate| {
            candidate.get("name").and_then(Value::as_str) == Some(template.name.as_str())
                && candidate.get("language").and_then(Value::as_str)
                    == Some(template.language.as_str())
        })
        .and_then(|candidate| candidate.get("title").and_then(Value::as_str))
        .map(str::to_owned)
}

/// Parse lead references, drop repeats and keep the order given.
fn parse_leads(refs: &[String]) -> Result<Vec<Uuid>, CliError> {
    let mut seen = HashSet::new();
    let mut ids = Vec::new();
    for reference in refs {
        let id = parse_lead_reference(reference)?;
        if seen.insert(id) {
            ids.push(id);
        }
    }
    Ok(ids)
}

/// The leads a Discovery campaign found: those whose external ids carry `campaign:<id>`.
pub(crate) fn campaign_lead_ids(leads: &[CurrentLead], campaign_id: Uuid) -> Vec<Uuid> {
    let tag = format!("campaign:{campaign_id}");
    let mut ids: Vec<Uuid> = leads
        .iter()
        .filter(|lead| lead.head.status == "active")
        .filter(|lead| {
            lead.head
                .prospect
                .party
                .external_ids
                .iter()
                .any(|external| external == &tag)
        })
        .map(|lead| lead.head.prospect_id)
        .collect();
    ids.sort();
    ids
}

fn new_list_action(list_id: Uuid, op: ListOp) -> OutreachListAction {
    OutreachListAction {
        schema_version: BUSINESS_RECORD_SCHEMA_VERSION,
        list_id,
        op,
        expected_head_event_id: None,
        name: None,
        note: None,
        lead_ids: Vec::new(),
        source: None,
        default_template: None,
    }
}

/// The action for `lists create`.
fn create_action(
    list_id: Uuid,
    name: &str,
    note: Option<&str>,
    lead_ids: Vec<Uuid>,
    campaign_id: Option<Uuid>,
    default_template: Option<TemplateRef>,
) -> Result<OutreachListAction, CliError> {
    if lead_ids.len() > MAX_LIST_MEMBERS {
        return Err(CliError::Usage(format!(
            "a list holds at most {MAX_LIST_MEMBERS} leads"
        )));
    }
    let mut action = new_list_action(list_id, ListOp::Create);
    action.name = Some(name.to_owned());
    action.note = note.map(str::to_owned);
    action.lead_ids = lead_ids;
    action.source = Some(match campaign_id {
        Some(campaign_id) => ListSource {
            kind: ListSourceKind::Campaign,
            campaign_id: Some(campaign_id),
        },
        None => ListSource {
            kind: ListSourceKind::Agent,
            campaign_id: None,
        },
    });
    action.default_template = default_template;
    Ok(action)
}

async fn cmd_create(
    client: &BuzzClient,
    name: &str,
    lead_refs: &[String],
    from_campaign: Option<&str>,
    note: Option<&str>,
    template: Option<&str>,
    language: Option<&str>,
) -> Result<(), CliError> {
    let mut lead_ids = parse_leads(lead_refs)?;
    let leads = load_leads(client).await?;
    let campaign_id = from_campaign.map(parse_campaign_reference).transpose()?;
    if let Some(campaign_id) = campaign_id {
        let from_campaign = campaign_lead_ids(&leads, campaign_id);
        if from_campaign.is_empty() && lead_ids.is_empty() {
            return Err(CliError::NotFound(format!(
                "campaign {campaign_id} has no leads (or it does not exist)"
            )));
        }
        let mut seen: HashSet<Uuid> = lead_ids.iter().copied().collect();
        lead_ids.extend(from_campaign.into_iter().filter(|id| seen.insert(*id)));
    }
    let default_template = match template {
        Some(template) => Some(resolve_template_ref(client, template, language).await?),
        None => None,
    };
    let list_id = Uuid::new_v4();
    let action = create_action(list_id, name, note, lead_ids, campaign_id, default_template)?;
    let target = resolve_save_target(client, &leads).await?;
    let response = publish_list_action(client, target, &action).await?;
    println!("{}", write_output(&response, list_id));
    Ok(())
}

/// Resolve `--template` to the Meta name and language a list stores.
async fn resolve_template_ref(
    client: &BuzzClient,
    template: &str,
    language: Option<&str>,
) -> Result<TemplateRef, CliError> {
    let mut reference = parse_template_reference(template)?;
    if let Some(language) = language {
        reference.language = Some(language.trim().to_owned());
    }
    let templates = fetch_templates(client).await?;
    let found = resolve_template(&templates, &reference)?;
    let text = |key: &str| found.get(key).and_then(Value::as_str).map(str::to_owned);
    match (text("name"), text("language")) {
        (Some(name), Some(language)) => Ok(TemplateRef { name, language }),
        _ => Err(CliError::Other(
            "the template has no name or language".into(),
        )),
    }
}

async fn cmd_members(
    client: &BuzzClient,
    list: &str,
    lead_refs: &[String],
    op: ListOp,
) -> Result<(), CliError> {
    let list_id = parse_list_reference(list)?;
    let lead_ids = parse_leads(lead_refs)?;
    if lead_ids.is_empty() {
        return Err(CliError::Usage("give at least one --lead".into()));
    }
    let lists = load_lists(client).await?;
    let stored = find_list(&lists, list_id)?;
    let target = SaveTarget {
        channel_id: stored.channel_id,
        community_id: stored.community_id,
    };
    let mut action = new_list_action(list_id, op);
    action.lead_ids = lead_ids;
    let response = publish_list_action(client, target, &action).await?;
    println!("{}", write_output(&response, list_id));
    Ok(())
}

async fn cmd_rename(
    client: &BuzzClient,
    list: &str,
    name: Option<&str>,
    note: Option<&str>,
) -> Result<(), CliError> {
    if name.is_none() && note.is_none() {
        return Err(CliError::Usage("give --name, --note, or both".into()));
    }
    let list_id = parse_list_reference(list)?;
    let lists = load_lists(client).await?;
    let stored = find_list(&lists, list_id)?;
    let target = SaveTarget {
        channel_id: stored.channel_id,
        community_id: stored.community_id,
    };
    let mut action = new_list_action(list_id, ListOp::Rename);
    action.name = name.map(str::to_owned);
    action.note = note.map(str::to_owned);
    let response = publish_list_action(client, target, &action).await?;
    println!("{}", write_output(&response, list_id));
    Ok(())
}

/// The relay's refusal text, when its answer says `accepted: false`.
fn rejection(response: &str) -> Option<String> {
    let answer: Value = serde_json::from_str(response).ok()?;
    if answer.get("accepted").and_then(Value::as_bool) == Some(false) {
        Some(
            answer
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("the relay refused the change")
                .to_owned(),
        )
    } else {
        None
    }
}

/// Sign and send one list action. Another writer changing the same list at the same moment
/// is not an error for an add or remove (they commute), so those are re-sent a few times.
async fn publish_list_action(
    client: &BuzzClient,
    target: SaveTarget,
    action: &OutreachListAction,
) -> Result<String, CliError> {
    for attempt in 1..=MAX_ATTEMPTS {
        let builder = build_outreach_list_action(target.community_id, target.channel_id, action)
            .map_err(sdk_err)?;
        let event = client.sign_event(builder)?;
        let last = attempt == MAX_ATTEMPTS;
        match client.submit_event(event).await {
            Ok(response) => match rejection(&response) {
                None => return Ok(response),
                Some(message) if message.contains(RACE_MARKER) && !last => continue,
                Some(message) => {
                    return Err(CliError::Other(format!(
                        "the relay refused the list change: {message}"
                    )))
                }
            },
            Err(CliError::Relay { body, .. }) if body.contains(RACE_MARKER) && !last => continue,
            Err(error) => return Err(error),
        }
    }
    Err(CliError::Other(
        "the list kept changing at the same time; try again".into(),
    ))
}

/// The standard write response plus the list's id and reference link.
fn write_output(response: &str, list_id: Uuid) -> String {
    let normalized = normalize_write_response(response);
    let mut output = match serde_json::from_str::<Value>(&normalized) {
        Ok(Value::Object(object)) => object,
        _ => return normalized,
    };
    output.insert("list_id".into(), json!(list_id.to_string()));
    output.insert("reference".into(), json!(list_link(list_id)));
    Value::Object(output).to_string()
}

// ---------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------

fn campaign_summary(campaign: &StoredCampaign) -> Value {
    let head = &campaign.head;
    json!({
        "campaignId": head.campaign_id.to_string(),
        "reference": campaign_link(head.campaign_id),
        "name": head.name,
        "audience": snake(&head.audience),
        "industry": head.industry_name,
        "verticalId": head.vertical_id,
        "vertical": head.vertical_name,
        "pickedTags": head.picked_tags,
        "query": head.query,
        "area": head.area,
        "target": head.target,
        "found": head.found,
        "skippedDuplicates": head.skipped_duplicates,
        "status": snake(&head.status),
        "endNote": head.end_note,
        "archived": head.archived,
        "runBy": head.run_by.as_ref().map(|run_by| json!({
            "kind": snake(&run_by.kind),
            "pubkey": run_by.pubkey,
        })),
        "createdByAgent": head.created_by_agent,
        "createdAt": head.created_at,
        "updatedAt": head.updated_at,
    })
}

/// The full `campaigns get` answer: the campaign plus the leads it found.
pub(crate) fn campaign_detail(campaign: &StoredCampaign, leads: &[CurrentLead]) -> Value {
    let ids = campaign_lead_ids(leads, campaign.head.campaign_id);
    let by_id: HashMap<Uuid, &CurrentLead> = leads
        .iter()
        .map(|lead| (lead.head.prospect_id, lead))
        .collect();
    let rows: Vec<Value> = ids
        .iter()
        .filter_map(|id| by_id.get(id))
        .map(|lead| {
            let prospect = &lead.head.prospect;
            json!({
                "leadId": lead.head.prospect_id.to_string(),
                "reference": lead_link(lead.head.prospect_id),
                "name": prospect.party.display_name,
                "stage": snake(&prospect.stage),
                "phone": prospect.phone,
            })
        })
        .collect();
    let mut detail = campaign_summary(campaign);
    if let Some(object) = detail.as_object_mut() {
        object.insert("leadCount".into(), json!(rows.len()));
        object.insert("leads".into(), Value::Array(rows));
        object.insert("headEventId".into(), json!(campaign.event_id));
    }
    detail
}

async fn cmd_campaigns_list(
    client: &BuzzClient,
    query: Option<&str>,
    archived: bool,
    limit: Option<u32>,
) -> Result<(), CliError> {
    let limit = clamp_limit(limit)?;
    let query = normalized_query(query);
    let rows: Vec<Value> = load_campaigns(client)
        .await?
        .iter()
        .filter(|campaign| campaign.head.archived == archived)
        .filter(|campaign| {
            query_matches(
                &query,
                &[
                    Some(campaign.head.name.as_str()),
                    Some(campaign.head.vertical_name.as_str()),
                    Some(campaign.head.area.as_str()),
                    campaign.head.query.as_deref(),
                ],
            )
        })
        .take(limit)
        .map(campaign_summary)
        .collect();
    println!("{}", Value::Array(rows));
    Ok(())
}

async fn cmd_campaigns_get(client: &BuzzClient, campaign: &str) -> Result<(), CliError> {
    let campaign_id = parse_campaign_reference(campaign)?;
    let campaigns = load_campaigns(client).await?;
    let found = campaigns
        .iter()
        .find(|candidate| candidate.record_id == campaign_id)
        .ok_or_else(|| CliError::NotFound(format!("campaign {campaign_id} not found")))?;
    let leads = load_leads(client).await?;
    println!("{}", campaign_detail(found, &leads));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use buzz_core::business_records::{
        PartyRecord, ProspectHead, ProspectQualification, ProspectRecordInput, ProspectStage,
    };
    use buzz_core::outreach_lists::{
        apply_campaign_action, apply_list_action, CampaignAudience, CampaignOp, CampaignStatus,
        DiscoveryCampaignAction, ListActor,
    };

    const COMMUNITY: u128 = 1;
    const CHANNEL: u128 = 2;
    const ACTOR: &str = "aa00000000000000000000000000000000000000000000000000000000000001";
    const EVENT: &str = "0000000000000000000000000000000000000000000000000000000000000001";

    fn lead(n: u128, name: &str, phone: Option<&str>, campaign: Option<Uuid>) -> CurrentLead {
        let prospect_id = Uuid::from_u128(n);
        CurrentLead {
            event_id: format!("{n:064x}"),
            channel_id: Uuid::from_u128(CHANNEL),
            community_id: Uuid::from_u128(COMMUNITY),
            created_at: 1_800_000_000,
            head: ProspectHead {
                schema_version: BUSINESS_RECORD_SCHEMA_VERSION,
                prospect_id,
                status: "active".into(),
                prospect: ProspectRecordInput {
                    prospect_id,
                    party: PartyRecord {
                        party_id: prospect_id,
                        party_type: "organization".into(),
                        display_name: name.into(),
                        external_ids: campaign
                            .map(|id| vec![format!("campaign:{id}")])
                            .unwrap_or_default(),
                    },
                    industry: "Tourism".into(),
                    vertical: "Guesthouses".into(),
                    fit_score: None,
                    origin: None,
                    discovery_tags: Vec::new(),
                    potential_monthly_value_minor: None,
                    website: Some("https://example.test".into()),
                    contact_name: None,
                    location: None,
                    email: None,
                    phone: phone.map(str::to_owned),
                    whatsapp_phone: None,
                    evidence: Vec::new(),
                    last_verified_at: None,
                    qualification: ProspectQualification::Unreviewed,
                    saved: false,
                    stage: ProspectStage::Qualified,
                    lost_reason: None,
                },
                activities: Vec::new(),
                source_action_event_id: "0".repeat(64),
            },
        }
    }

    fn stored_list(members: &[u128]) -> StoredList {
        let mut action = create_action(
            Uuid::from_u128(900),
            "Melville guesthouses, Nov",
            None,
            members.iter().map(|n| Uuid::from_u128(*n)).collect(),
            None,
            Some(TemplateRef {
                name: "built_a_site".into(),
                language: "en".into(),
            }),
        )
        .expect("create action");
        action.note = Some("Warm leads".into());
        let head = apply_list_action(
            None,
            &action,
            &ListActor {
                pubkey: ACTOR.into(),
                is_agent: true,
            },
            1_800_000_100,
            EVENT,
        )
        .expect("head");
        Stored {
            record_id: head.list_id,
            event_id: EVENT.into(),
            channel_id: Uuid::from_u128(CHANNEL),
            community_id: Uuid::from_u128(COMMUNITY),
            created_at: 1_800_000_100,
            head,
        }
    }

    #[test]
    fn coordinate_parsing_requires_the_exact_record_type() {
        let community = Uuid::from_u128(COMMUNITY);
        let id = Uuid::from_u128(900);
        let tag = format!("business:{community}:outreach_list:{id}");
        assert_eq!(
            parse_coordinate(&tag, "outreach_list"),
            Some((community, id))
        );
        assert_eq!(parse_coordinate(&tag, "discovery_campaign"), None);
        assert_eq!(
            parse_coordinate(&format!("{tag}:extra"), "outreach_list"),
            None
        );
        assert_eq!(parse_coordinate("prospect:x", "outreach_list"), None);
    }

    #[test]
    fn list_summary_has_the_documented_fields() {
        let list = stored_list(&[1, 2]);
        let row = list_summary(&list);
        assert_eq!(row["listId"], Uuid::from_u128(900).to_string());
        assert_eq!(row["reference"], list_link(Uuid::from_u128(900)));
        assert_eq!(row["name"], "Melville guesthouses, Nov");
        assert_eq!(row["note"], "Warm leads");
        assert_eq!(row["status"], "active");
        assert_eq!(row["size"], 2);
        assert_eq!(row["source"]["kind"], "agent");
        assert_eq!(
            row["defaultTemplate"]["reference"],
            "buzz://template/built_a_site?lang=en"
        );
        assert_eq!(row["createdByAgent"], true);
    }

    #[test]
    fn list_detail_shows_members_with_phone_and_whatsapp_and_names_missing_leads() {
        let list = stored_list(&[1, 2, 3]);
        let one = lead(1, "Rosebank Guest House", Some("+27 82 000 0000"), None);
        let two = lead(2, "Parkview Lodge", None, None);
        let by_id: HashMap<Uuid, &CurrentLead> = [&one, &two]
            .into_iter()
            .map(|lead| (lead.head.prospect_id, lead))
            .collect();
        let mut whatsapp = HashMap::new();
        whatsapp.insert(
            Uuid::from_u128(1),
            WhatsappInfo {
                status: "opted_out".into(),
                opted_out: true,
            },
        );
        let detail = list_detail(&list, &by_id, &whatsapp, Some("Built a site for you"));
        assert_eq!(detail["size"], 3);
        let members = detail["members"].as_array().unwrap();
        assert_eq!(members.len(), 2);
        assert_eq!(members[0]["name"], "Rosebank Guest House");
        assert_eq!(members[0]["phone"], "+27 82 000 0000");
        assert_eq!(members[0]["stage"], "qualified");
        assert_eq!(members[0]["whatsapp"]["optedOut"], true);
        assert_eq!(members[0]["whatsapp"]["status"], "opted_out");
        assert!(members[1]["whatsapp"].is_null());
        assert!(members[1]["phone"].is_null());
        assert_eq!(detail["missing"], json!([Uuid::from_u128(3).to_string()]));
        assert_eq!(detail["defaultTemplate"]["title"], "Built a site for you");
    }

    #[test]
    fn campaign_leads_come_from_the_external_id_and_only_active_ones() {
        let campaign = Uuid::from_u128(50);
        let other = Uuid::from_u128(51);
        let mut archived = lead(4, "Archived", Some("1"), Some(campaign));
        archived.head.status = "archived".into();
        let leads = vec![
            lead(2, "B", Some("1"), Some(campaign)),
            lead(1, "A", None, Some(campaign)),
            lead(3, "C", None, Some(other)),
            lead(5, "D", None, None),
            archived,
        ];
        assert_eq!(
            campaign_lead_ids(&leads, campaign),
            vec![Uuid::from_u128(1), Uuid::from_u128(2)]
        );
    }

    #[test]
    fn campaign_detail_lists_the_found_leads() {
        let campaign_id = Uuid::from_u128(50);
        let action = DiscoveryCampaignAction {
            schema_version: BUSINESS_RECORD_SCHEMA_VERSION,
            campaign_id,
            op: CampaignOp::Create,
            expected_head_event_id: None,
            name: Some("Guesthouses, Melville".into()),
            audience: Some(CampaignAudience::Businesses),
            industry_name: Some("Tourism".into()),
            vertical_id: Some("guesthouses".into()),
            vertical_name: Some("Guesthouses".into()),
            picked_tags: Some(vec!["boutique".into()]),
            query: None,
            area: Some("Melville, Johannesburg".into()),
            target: Some(30),
            found: Some(2),
            skipped_duplicates: Some(1),
            status: Some(CampaignStatus::Complete),
            end_note: None,
            run_by: None,
        };
        let head = apply_campaign_action(
            None,
            &action,
            &ListActor {
                pubkey: ACTOR.into(),
                is_agent: false,
            },
            1_800_000_000,
            EVENT,
        )
        .expect("campaign head");
        let stored = Stored {
            record_id: campaign_id,
            event_id: EVENT.into(),
            channel_id: Uuid::from_u128(CHANNEL),
            community_id: Uuid::from_u128(COMMUNITY),
            created_at: 1_800_000_000,
            head,
        };
        let leads = vec![
            lead(1, "A", Some("+27 82 111 1111"), Some(campaign_id)),
            lead(2, "B", None, Some(campaign_id)),
            lead(3, "C", None, None),
        ];
        let detail = campaign_detail(&stored, &leads);
        assert_eq!(detail["reference"], campaign_link(campaign_id));
        assert_eq!(detail["status"], "complete");
        assert_eq!(detail["area"], "Melville, Johannesburg");
        assert_eq!(detail["pickedTags"], json!(["boutique"]));
        assert_eq!(detail["leadCount"], 2);
        assert_eq!(detail["leads"][0]["name"], "A");
        assert_eq!(detail["leads"][0]["phone"], "+27 82 111 1111");
    }

    #[test]
    fn create_action_marks_agent_or_campaign_source_and_caps_the_size() {
        let manual = create_action(Uuid::from_u128(1), "x", None, Vec::new(), None, None).unwrap();
        assert_eq!(manual.source.unwrap().kind, ListSourceKind::Agent);
        let campaign = Uuid::from_u128(7);
        let from = create_action(
            Uuid::from_u128(1),
            "x",
            Some("n"),
            vec![Uuid::from_u128(2)],
            Some(campaign),
            None,
        )
        .unwrap();
        let source = from.source.unwrap();
        assert_eq!(source.kind, ListSourceKind::Campaign);
        assert_eq!(source.campaign_id, Some(campaign));
        let too_many: Vec<Uuid> = (0..=MAX_LIST_MEMBERS as u128)
            .map(Uuid::from_u128)
            .collect();
        assert!(matches!(
            create_action(Uuid::from_u128(1), "x", None, too_many, None, None),
            Err(CliError::Usage(_))
        ));
    }

    #[test]
    fn leads_are_parsed_in_order_without_repeats() {
        let a = Uuid::from_u128(1);
        let b = Uuid::from_u128(2);
        let refs = vec![b.to_string(), lead_link(a), a.to_string(), lead_link(b)];
        assert_eq!(parse_leads(&refs).unwrap(), vec![b, a]);
        assert!(parse_leads(&["nonsense".to_owned()]).is_err());
    }

    #[test]
    fn a_rejected_answer_is_read_and_a_race_is_recognised() {
        assert_eq!(rejection(r#"{"accepted":true,"message":""}"#), None);
        assert_eq!(rejection("not json"), None);
        let message = rejection(
            r#"{"accepted":false,"message":"conflict: target business record changed before the command committed"}"#,
        )
        .expect("rejected");
        assert!(message.contains(RACE_MARKER));
    }

    #[test]
    fn write_output_adds_the_list_id_and_reference() {
        let id = Uuid::from_u128(900);
        let out: Value = serde_json::from_str(&write_output(
            r#"{"event_id":"ab","accepted":true,"message":""}"#,
            id,
        ))
        .unwrap();
        assert_eq!(out["accepted"], true);
        assert_eq!(out["list_id"], id.to_string());
        assert_eq!(out["reference"], list_link(id));
    }

    #[test]
    fn queries_match_case_insensitively_over_any_field() {
        let query = normalized_query(Some("  MELVILLE "));
        assert!(query_matches(
            &query,
            &[Some("Guesthouses in Melville"), None]
        ));
        assert!(!query_matches(&query, &[Some("Sandton"), None]));
        assert!(query_matches(&None, &[None]));
        assert_eq!(normalized_query(Some("   ")), None);
    }
}
