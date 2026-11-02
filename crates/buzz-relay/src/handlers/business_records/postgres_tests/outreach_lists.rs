//! Outreach lists (kind 47075) and Discovery campaigns (kind 47076) through the production
//! business handler: who may change them, the lifecycle, agent access, replay and the head the
//! relay signs. Run with the other Postgres tests (`BUZZ_TEST_DATABASE_URL`).

use super::*;
use buzz_core::channel::MemberRole;
use buzz_core::outreach_lists::{
    discovery_campaign_d_tag, outreach_list_d_tag, CampaignAudience, CampaignOp, CampaignStatus,
    DiscoveryCampaignAction, DiscoveryCampaignHead, ListOp, ListSource, ListSourceKind, ListStatus,
    OutreachListAction, OutreachListHead, TemplateRef,
};

fn community(fixture: &Fixture) -> Uuid {
    *fixture.tenant.community().as_uuid()
}

async fn add_channel_member(
    fixture: &Fixture,
    owner: &Keys,
    keys: &Keys,
    role: MemberRole,
    channel_id: Uuid,
) {
    let bytes = keys.public_key().to_bytes();
    fixture
        .state
        .db
        .ensure_user(fixture.tenant.community(), &bytes)
        .await
        .expect("ensure test user");
    fixture
        .state
        .db
        .add_member(
            fixture.tenant.community(),
            channel_id,
            &bytes,
            role,
            Some(&owner.public_key().to_bytes()),
        )
        .await
        .expect("add channel member");
}

fn lead_action(prospect_id: Uuid, name: &str) -> ProspectAction {
    ProspectAction {
        schema_version: BUSINESS_RECORD_SCHEMA_VERSION,
        prospect_id,
        action: RecordAction::Create,
        expected_head_event_id: None,
        prospect: buzz_core::business_records::ProspectRecordInput {
            prospect_id,
            party: buzz_core::business_records::PartyRecord {
                party_id: prospect_id,
                party_type: "organization".into(),
                display_name: name.into(),
                external_ids: Vec::new(),
            },
            industry: "Tourism".into(),
            vertical: "Guesthouses".into(),
            fit_score: Some(80),
            origin: Some(buzz_core::business_records::ProspectOrigin::Discovery),
            discovery_tags: Vec::new(),
            potential_monthly_value_minor: None,
            website: Some("https://example.test".into()),
            contact_name: None,
            location: Some("Melville".into()),
            email: None,
            phone: Some("+27 82 000 0000".into()),
            evidence: Vec::new(),
            last_verified_at: None,
            qualification: buzz_core::business_records::ProspectQualification::Unreviewed,
            saved: false,
            stage: ProspectStage::Qualified,
            lost_reason: None,
        },
        activity: None,
    }
}

async fn create_lead(fixture: &Fixture, owner: &Keys, channel_id: Uuid, name: &str) -> Uuid {
    let prospect_id = Uuid::new_v4();
    let d_tag = prospect_d_tag(community(fixture), prospect_id);
    let event = signed_command(
        owner,
        KIND_PROSPECT_ACTION,
        channel_id,
        &d_tag,
        &lead_action(prospect_id, name),
    );
    let result = handle(&fixture.tenant, &fixture.state, event, auth(owner))
        .await
        .expect("create lead through the production handler");
    assert!(result.accepted);
    prospect_id
}

fn list_action(list_id: Uuid, op: ListOp) -> OutreachListAction {
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

fn create_list_action(list_id: Uuid, name: &str, leads: &[Uuid]) -> OutreachListAction {
    OutreachListAction {
        name: Some(name.into()),
        lead_ids: leads.to_vec(),
        source: Some(ListSource {
            kind: ListSourceKind::Manual,
            campaign_id: None,
        }),
        ..list_action(list_id, ListOp::Create)
    }
}

fn list_event(
    fixture: &Fixture,
    keys: &Keys,
    channel_id: Uuid,
    action: &OutreachListAction,
) -> Event {
    signed_command(
        keys,
        KIND_OUTREACH_LIST_ACTION,
        channel_id,
        &outreach_list_d_tag(community(fixture), action.list_id),
        action,
    )
}

async fn send(
    fixture: &Fixture,
    keys: &Keys,
    event: Event,
) -> Result<crate::handlers::ingest::IngestResult, IngestError> {
    handle(&fixture.tenant, &fixture.state, event, auth(keys)).await
}

async fn send_list(
    fixture: &Fixture,
    keys: &Keys,
    channel_id: Uuid,
    action: &OutreachListAction,
) -> Result<crate::handlers::ingest::IngestResult, IngestError> {
    send(fixture, keys, list_event(fixture, keys, channel_id, action)).await
}

async fn list_head(fixture: &Fixture, list_id: Uuid) -> Option<(StoredEvent, OutreachListHead)> {
    let stored = current_head::<OutreachListHead>(
        &fixture.state,
        fixture.tenant.community(),
        KIND_OUTREACH_LIST_HEAD,
        &outreach_list_d_tag(community(fixture), list_id),
    )
    .await
    .expect("read list head")?;
    let head = serde_json::from_str(&stored.event.content).expect("list head content");
    Some((stored, head))
}

fn member_ids(head: &OutreachListHead) -> Vec<Uuid> {
    head.members.iter().map(|member| member.lead_id).collect()
}

/// A business with a registered Sales channel (the first lead registers it), the owner, one
/// member, one agent and one guest, and three leads.
struct Business {
    channel_id: Uuid,
    owner: Keys,
    member: Keys,
    agent: Keys,
    guest: Keys,
    leads: Vec<Uuid>,
}

async fn business(fixture: &Fixture) -> Business {
    let owner = Keys::generate();
    let channel_id = business_stream(fixture, &owner).await;
    let first = create_lead(fixture, &owner, channel_id, "Rosebank Guest House").await;
    let second = create_lead(fixture, &owner, channel_id, "Parkview Lodge").await;
    let third = create_lead(fixture, &owner, channel_id, "Melville Manor").await;
    let (member, agent, guest) = (Keys::generate(), Keys::generate(), Keys::generate());
    add_channel_member(fixture, &owner, &member, MemberRole::Member, channel_id).await;
    add_channel_member(fixture, &owner, &agent, MemberRole::Bot, channel_id).await;
    add_channel_member(fixture, &owner, &guest, MemberRole::Guest, channel_id).await;
    Business {
        channel_id,
        owner,
        member,
        agent,
        guest,
        leads: vec![first, second, third],
    }
}

#[tokio::test]
#[ignore = "requires disposable Postgres and Redis"]
async fn a_member_creates_a_list_and_the_relay_signs_the_head() {
    let fixture = fixture().await;
    let b = business(&fixture).await;
    let list_id = Uuid::new_v4();
    let mut action = create_list_action(list_id, "Melville guesthouses, Nov", &b.leads[..2]);
    action.note = Some("Warm leads".into());
    action.default_template = Some(TemplateRef {
        name: "built_a_site".into(),
        language: "en".into(),
    });
    let event = list_event(&fixture, &b.member, b.channel_id, &action);
    let result = send(&fixture, &b.member, event.clone())
        .await
        .expect("create list");
    assert!(result.accepted);

    let (stored, head) = list_head(&fixture, list_id).await.expect("head exists");
    assert_eq!(stored.event.kind.as_u16() as u32, KIND_OUTREACH_LIST_HEAD);
    assert_eq!(
        stored.event.pubkey,
        fixture.state.relay_keypair.public_key()
    );
    assert_eq!(stored.channel_id, Some(b.channel_id));
    assert_eq!(head.name, "Melville guesthouses, Nov");
    assert_eq!(head.note.as_deref(), Some("Warm leads"));
    assert_eq!(head.status, ListStatus::Active);
    assert_eq!(member_ids(&head), b.leads[..2].to_vec());
    assert!(!head.created_by_agent);
    assert_eq!(head.created_by, b.member.public_key().to_hex());
    assert_eq!(head.default_template.as_ref().unwrap().name, "built_a_site");
    assert_eq!(head.source_action_event_id, event.id.to_hex());
}

#[tokio::test]
#[ignore = "requires disposable Postgres and Redis"]
async fn an_agent_creates_edits_and_reads_a_list_but_cannot_archive_it() {
    let fixture = fixture().await;
    let b = business(&fixture).await;
    let list_id = Uuid::new_v4();

    let created = create_list_action(list_id, "Best fits", &b.leads[..1]);
    send_list(&fixture, &b.agent, b.channel_id, &created)
        .await
        .expect("an agent creates a list");
    let (_, head) = list_head(&fixture, list_id).await.expect("head");
    assert!(head.created_by_agent);
    assert!(head.members[0].added_by_agent);

    let mut add = list_action(list_id, ListOp::AddMembers);
    add.lead_ids = vec![b.leads[1], b.leads[2]];
    send_list(&fixture, &b.agent, b.channel_id, &add)
        .await
        .expect("an agent adds leads");
    let mut rename = list_action(list_id, ListOp::Rename);
    rename.name = Some("Best fits, Nov".into());
    send_list(&fixture, &b.agent, b.channel_id, &rename)
        .await
        .expect("an agent renames");
    let mut remove = list_action(list_id, ListOp::RemoveMembers);
    remove.lead_ids = vec![b.leads[0]];
    send_list(&fixture, &b.agent, b.channel_id, &remove)
        .await
        .expect("an agent removes a lead");
    let (_, head) = list_head(&fixture, list_id).await.expect("head");
    assert_eq!(head.name, "Best fits, Nov");
    assert_eq!(member_ids(&head), vec![b.leads[1], b.leads[2]]);
    assert_eq!(head.updated_by, b.agent.public_key().to_hex());

    for op in [ListOp::Archive, ListOp::Unarchive] {
        let result = send_list(&fixture, &b.agent, b.channel_id, &list_action(list_id, op)).await;
        assert!(
            matches!(&result, Err(IngestError::AuthFailed(message)) if message.contains("only people")),
            "{op:?}"
        );
    }
    let (_, head) = list_head(&fixture, list_id).await.expect("head");
    assert_eq!(head.status, ListStatus::Active);
}

#[tokio::test]
#[ignore = "requires disposable Postgres and Redis"]
async fn people_archive_and_restore_and_an_archived_list_refuses_edits() {
    let fixture = fixture().await;
    let b = business(&fixture).await;
    let list_id = Uuid::new_v4();
    send_list(
        &fixture,
        &b.owner,
        b.channel_id,
        &create_list_action(list_id, "Old list", &b.leads),
    )
    .await
    .expect("create");

    send_list(
        &fixture,
        &b.member,
        b.channel_id,
        &list_action(list_id, ListOp::Archive),
    )
    .await
    .expect("a member archives");
    let (_, head) = list_head(&fixture, list_id).await.expect("head");
    assert_eq!(head.status, ListStatus::Archived);

    let mut add = list_action(list_id, ListOp::AddMembers);
    add.lead_ids = vec![b.leads[0]];
    let result = send_list(&fixture, &b.agent, b.channel_id, &add).await;
    assert!(
        matches!(&result, Err(IngestError::Rejected(message)) if message.starts_with("conflict:") && message.contains("archived")),
        "an archived list refuses edits"
    );

    send_list(
        &fixture,
        &b.owner,
        b.channel_id,
        &list_action(list_id, ListOp::Unarchive),
    )
    .await
    .expect("the owner restores");
    let (_, head) = list_head(&fixture, list_id).await.expect("head");
    assert_eq!(head.status, ListStatus::Active);
    assert_eq!(member_ids(&head), b.leads);
}

#[tokio::test]
#[ignore = "requires disposable Postgres and Redis"]
async fn guests_and_outsiders_cannot_change_lists_and_nothing_is_stored() {
    let fixture = fixture().await;
    let b = business(&fixture).await;
    let list_id = Uuid::new_v4();
    send_list(
        &fixture,
        &b.owner,
        b.channel_id,
        &create_list_action(list_id, "Private list", &b.leads[..1]),
    )
    .await
    .expect("create");

    let outsider = Keys::generate();
    for keys in [&b.guest, &outsider] {
        let attempt = create_list_action(Uuid::new_v4(), "Not allowed", &[]);
        let event = list_event(&fixture, keys, b.channel_id, &attempt);
        let result = send(&fixture, keys, event.clone()).await;
        assert!(matches!(result, Err(IngestError::AuthFailed(_))));
        expect_event_missing(&fixture, &event).await;
        assert!(list_head(&fixture, attempt.list_id).await.is_none());

        let mut add = list_action(list_id, ListOp::AddMembers);
        add.lead_ids = vec![b.leads[1]];
        let result = send_list(&fixture, keys, b.channel_id, &add).await;
        assert!(matches!(result, Err(IngestError::AuthFailed(_))));
    }
    let (_, head) = list_head(&fixture, list_id).await.expect("head");
    assert_eq!(member_ids(&head), b.leads[..1].to_vec());
}

#[tokio::test]
#[ignore = "requires disposable Postgres and Redis"]
async fn an_unknown_lead_is_refused_whole_and_stores_nothing() {
    let fixture = fixture().await;
    let b = business(&fixture).await;
    let list_id = Uuid::new_v4();
    let stranger = Uuid::new_v4();

    let action = create_list_action(list_id, "Typo list", &[b.leads[0], stranger]);
    let event = list_event(&fixture, &b.member, b.channel_id, &action);
    let result = send(&fixture, &b.member, event.clone()).await;
    assert!(
        matches!(&result, Err(IngestError::Rejected(message)) if message.contains(&format!("unknown lead {stranger}"))),
    );
    expect_event_missing(&fixture, &event).await;
    assert!(list_head(&fixture, list_id).await.is_none());

    send_list(
        &fixture,
        &b.member,
        b.channel_id,
        &create_list_action(list_id, "Typo list", &b.leads[..1]),
    )
    .await
    .expect("create with a real lead");
    let mut add = list_action(list_id, ListOp::AddMembers);
    add.lead_ids = vec![b.leads[1], stranger];
    let result = send_list(&fixture, &b.member, b.channel_id, &add).await;
    assert!(
        matches!(&result, Err(IngestError::Rejected(message)) if message.contains("unknown lead"))
    );
    let (_, head) = list_head(&fixture, list_id).await.expect("head");
    assert_eq!(member_ids(&head), b.leads[..1].to_vec());
}

#[tokio::test]
#[ignore = "requires disposable Postgres and Redis"]
async fn replays_stale_heads_and_second_creates_are_handled() {
    let fixture = fixture().await;
    let b = business(&fixture).await;
    let list_id = Uuid::new_v4();
    let create = create_list_action(list_id, "Replay list", &b.leads[..1]);
    let event = list_event(&fixture, &b.member, b.channel_id, &create);
    send(&fixture, &b.member, event.clone())
        .await
        .expect("create");
    expect_duplicate(&fixture, &b.member, b.channel_id, &event).await;

    // A different create for the same list is a conflict, not an overwrite.
    let again = create_list_action(list_id, "Second try", &b.leads[1..2]);
    let result = send_list(&fixture, &b.member, b.channel_id, &again).await;
    assert!(
        matches!(&result, Err(IngestError::Rejected(message)) if message.starts_with("conflict:"))
    );

    // An edit that names an old head is refused; one that names the current head applies.
    let (first_head, _) = list_head(&fixture, list_id).await.expect("head");
    let mut rename = list_action(list_id, ListOp::Rename);
    rename.name = Some("Renamed".into());
    send_list(&fixture, &b.member, b.channel_id, &rename)
        .await
        .expect("rename without a fence");
    let mut stale = list_action(list_id, ListOp::AddMembers);
    stale.lead_ids = vec![b.leads[2]];
    stale.expected_head_event_id = Some(first_head.event.id.to_hex());
    let result = send_list(&fixture, &b.member, b.channel_id, &stale).await;
    assert!(
        matches!(&result, Err(IngestError::Rejected(message)) if message.contains("expected head")),
        "a stale expected head is a conflict"
    );
    let (current, _) = list_head(&fixture, list_id).await.expect("head");
    let mut fenced = list_action(list_id, ListOp::AddMembers);
    fenced.lead_ids = vec![b.leads[2]];
    fenced.expected_head_event_id = Some(current.event.id.to_hex());
    send_list(&fixture, &b.member, b.channel_id, &fenced)
        .await
        .expect("the current head applies");
    let (_, head) = list_head(&fixture, list_id).await.expect("head");
    assert_eq!(head.name, "Renamed");
    assert_eq!(member_ids(&head), vec![b.leads[0], b.leads[2]]);
}

#[tokio::test]
#[ignore = "requires disposable Postgres and Redis"]
async fn list_commands_must_use_the_business_channel_and_their_own_coordinate() {
    let fixture = fixture().await;
    let b = business(&fixture).await;
    let client_channel = private_stream(&fixture, "client", &b.member).await;

    let list_id = Uuid::new_v4();
    let create = create_list_action(list_id, "Wrong channel", &[]);
    let event = list_event(&fixture, &b.member, client_channel, &create);
    let result = send(&fixture, &b.member, event.clone()).await;
    assert!(
        matches!(&result, Err(IngestError::AuthFailed(message)) if message.contains("registered business channel"))
    );
    expect_event_missing(&fixture, &event).await;

    // The d tag of another list is not this list's coordinate.
    let wrong = signed_command(
        &b.member,
        KIND_OUTREACH_LIST_ACTION,
        b.channel_id,
        &outreach_list_d_tag(community(&fixture), Uuid::new_v4()),
        &create,
    );
    let result = send(&fixture, &b.member, wrong).await;
    assert!(matches!(&result, Err(IngestError::Rejected(message)) if message.contains("scope")));

    // A token scoped to another channel cannot write here.
    let scoped = handle(
        &fixture.tenant,
        &fixture.state,
        list_event(&fixture, &b.member, b.channel_id, &create),
        scoped_nip42_auth(&b.member, vec![client_channel]),
    )
    .await;
    assert!(
        matches!(&scoped, Err(IngestError::AuthFailed(message)) if message.contains("not scoped to this channel"))
    );
    assert!(list_head(&fixture, list_id).await.is_none());
}

#[tokio::test]
#[ignore = "requires disposable Postgres and Redis"]
async fn a_list_can_hold_a_default_template_by_name_and_clear_it() {
    let fixture = fixture().await;
    let b = business(&fixture).await;
    let list_id = Uuid::new_v4();
    send_list(
        &fixture,
        &b.member,
        b.channel_id,
        &create_list_action(list_id, "Templated", &b.leads[..1]),
    )
    .await
    .expect("create");
    let mut set = list_action(list_id, ListOp::SetDefaultTemplate);
    set.default_template = Some(TemplateRef {
        name: "built_a_site".into(),
        language: "en".into(),
    });
    send_list(&fixture, &b.agent, b.channel_id, &set)
        .await
        .expect("an agent sets the default template");
    let (_, head) = list_head(&fixture, list_id).await.expect("head");
    assert_eq!(head.default_template.as_ref().unwrap().name, "built_a_site");
    send_list(
        &fixture,
        &b.member,
        b.channel_id,
        &list_action(list_id, ListOp::SetDefaultTemplate),
    )
    .await
    .expect("clear");
    let (_, head) = list_head(&fixture, list_id).await.expect("head");
    assert!(head.default_template.is_none());
}

fn campaign_create(campaign_id: Uuid) -> DiscoveryCampaignAction {
    DiscoveryCampaignAction {
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
        found: None,
        skipped_duplicates: None,
        status: Some(CampaignStatus::Running),
        end_note: None,
        run_by: None,
    }
}

fn campaign_op(campaign_id: Uuid, op: CampaignOp) -> DiscoveryCampaignAction {
    DiscoveryCampaignAction {
        op,
        name: None,
        audience: None,
        industry_name: None,
        vertical_id: None,
        vertical_name: None,
        picked_tags: None,
        area: None,
        target: None,
        status: None,
        ..campaign_create(campaign_id)
    }
}

async fn send_campaign(
    fixture: &Fixture,
    keys: &Keys,
    channel_id: Uuid,
    action: &DiscoveryCampaignAction,
) -> Result<crate::handlers::ingest::IngestResult, IngestError> {
    let event = signed_command(
        keys,
        KIND_DISCOVERY_CAMPAIGN_ACTION,
        channel_id,
        &discovery_campaign_d_tag(community(fixture), action.campaign_id),
        action,
    );
    send(fixture, keys, event).await
}

async fn campaign_head(
    fixture: &Fixture,
    campaign_id: Uuid,
) -> Option<(StoredEvent, DiscoveryCampaignHead)> {
    let stored = current_head::<DiscoveryCampaignHead>(
        &fixture.state,
        fixture.tenant.community(),
        KIND_DISCOVERY_CAMPAIGN_HEAD,
        &discovery_campaign_d_tag(community(fixture), campaign_id),
    )
    .await
    .expect("read campaign head")?;
    let head = serde_json::from_str(&stored.event.content).expect("campaign head content");
    Some((stored, head))
}

#[tokio::test]
#[ignore = "requires disposable Postgres and Redis"]
async fn a_campaign_is_shared_with_agents_and_runs_through_its_lifecycle() {
    let fixture = fixture().await;
    let b = business(&fixture).await;
    let campaign_id = Uuid::new_v4();

    send_campaign(
        &fixture,
        &b.member,
        b.channel_id,
        &campaign_create(campaign_id),
    )
    .await
    .expect("a person records the campaign");
    let (stored, head) = campaign_head(&fixture, campaign_id).await.expect("head");
    assert_eq!(
        stored.event.kind.as_u16() as u32,
        KIND_DISCOVERY_CAMPAIGN_HEAD
    );
    assert_eq!(
        stored.event.pubkey,
        fixture.state.relay_keypair.public_key()
    );
    assert_eq!(head.name, "Guesthouses, Melville");
    assert_eq!(head.picked_tags, vec!["boutique".to_string()]);
    assert_eq!(head.status, CampaignStatus::Running);
    assert_eq!(head.found, 0);

    let mut progress = campaign_op(campaign_id, CampaignOp::Progress);
    progress.found = Some(12);
    progress.skipped_duplicates = Some(3);
    send_campaign(&fixture, &b.agent, b.channel_id, &progress)
        .await
        .expect("an agent reports progress");
    progress.found = Some(5);
    send_campaign(&fixture, &b.member, b.channel_id, &progress)
        .await
        .expect("a late update is accepted but never lowers the count");
    let (_, head) = campaign_head(&fixture, campaign_id).await.expect("head");
    assert_eq!((head.found, head.skipped_duplicates), (12, 3));

    let mut finish = campaign_op(campaign_id, CampaignOp::Finish);
    finish.found = Some(30);
    finish.skipped_duplicates = Some(4);
    finish.status = Some(CampaignStatus::Complete);
    send_campaign(&fixture, &b.member, b.channel_id, &finish)
        .await
        .expect("finish");
    let result = send_campaign(&fixture, &b.member, b.channel_id, &progress).await;
    assert!(
        matches!(&result, Err(IngestError::Rejected(message)) if message.starts_with("conflict:"))
    );
    let (_, head) = campaign_head(&fixture, campaign_id).await.expect("head");
    assert_eq!((head.found, head.status), (30, CampaignStatus::Complete));

    let archive = campaign_op(campaign_id, CampaignOp::Archive);
    let result = send_campaign(&fixture, &b.agent, b.channel_id, &archive).await;
    assert!(
        matches!(&result, Err(IngestError::AuthFailed(message)) if message.contains("only people"))
    );
    send_campaign(&fixture, &b.owner, b.channel_id, &archive)
        .await
        .expect("a person archives");
    let (_, head) = campaign_head(&fixture, campaign_id).await.expect("head");
    assert!(head.archived);
}

#[tokio::test]
#[ignore = "requires disposable Postgres and Redis"]
async fn campaigns_are_refused_to_guests_and_outsiders_and_cannot_be_created_twice() {
    let fixture = fixture().await;
    let b = business(&fixture).await;
    let campaign_id = Uuid::new_v4();
    let outsider = Keys::generate();
    for keys in [&b.guest, &outsider] {
        let result =
            send_campaign(&fixture, keys, b.channel_id, &campaign_create(campaign_id)).await;
        assert!(matches!(result, Err(IngestError::AuthFailed(_))));
    }
    assert!(campaign_head(&fixture, campaign_id).await.is_none());

    send_campaign(
        &fixture,
        &b.agent,
        b.channel_id,
        &campaign_create(campaign_id),
    )
    .await
    .expect("an agent records a campaign it ran");
    let (_, head) = campaign_head(&fixture, campaign_id).await.expect("head");
    assert!(head.created_by_agent);
    let result = send_campaign(
        &fixture,
        &b.member,
        b.channel_id,
        &campaign_create(campaign_id),
    )
    .await;
    assert!(
        matches!(&result, Err(IngestError::Rejected(message)) if message.starts_with("conflict:"))
    );
}
