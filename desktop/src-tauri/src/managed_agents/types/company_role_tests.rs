//! Role pack v2 on the desktop company role: the camelCase wire shape a hire
//! copies into its role pack, its bounds, and parity with the core hire
//! validator the relay runs on that same role pack.

use super::{
    validate_company_role_metadata, CompanyRoleMetadata, CompanyRoleTool, CompanyToolRisk,
    RoleDutyTemplate, RoleOnHire,
};
use serde_json::json;

fn v2_role() -> CompanyRoleMetadata {
    CompanyRoleMetadata {
        job: "Post one short note a day".to_string(),
        skills: vec!["Writing short updates".to_string()],
        tools: vec![CompanyRoleTool {
            name: "notes".to_string(),
            risk: CompanyToolRisk::Low,
        }],
        worker_menu: vec!["claude".to_string(), "codex".to_string()],
        default_allowance: Some("2".to_string()),
        owns: Some("One short note in the home channel every day".to_string()),
        channel: Some("test-employee".to_string()),
        duties: vec![RoleDutyTemplate {
            title: "Daily note".to_string(),
            schedule_text: "Every day at 09:00".to_string(),
            instructions: "Post one short note.".to_string(),
        }],
        on_hire: Some(RoleOnHire {
            sources: vec!["business profile".to_string()],
            plan_horizon_days: 14,
        }),
        ask_before: vec!["anything public outside this channel".to_string()],
        home: Some("test.note".to_string()),
    }
}

fn on_hire(sources: Vec<String>, plan_horizon_days: u8) -> Option<RoleOnHire> {
    Some(RoleOnHire {
        sources,
        plan_horizon_days,
    })
}

/// One mutation per v2 rule. The name must appear in the desktop error so the
/// person editing the role sees which field is wrong.
type Mutation = (&'static str, fn(&mut CompanyRoleMetadata));

fn invalid_v2_mutations() -> Vec<Mutation> {
    vec![
        ("owns", |role| role.owns = Some("   ".to_string())),
        ("owns", |role| role.owns = Some("o".repeat(501))),
        ("channel", |role| role.channel = Some(String::new())),
        ("channel", |role| {
            role.channel = Some("Team Room".to_string())
        }),
        ("channel", |role| role.channel = Some("e".repeat(81))),
        ("duties", |role| {
            role.duties = vec![role.duties[0].clone(); 9]
        }),
        ("duty title", |role| role.duties[0].title = " ".to_string()),
        ("duty title", |role| role.duties[0].title = "t".repeat(121)),
        ("duty schedule", |role| {
            role.duties[0].schedule_text = "Tomorrow at 08:00".to_string()
        }),
        ("duty instructions", |role| {
            role.duties[0].instructions = String::new()
        }),
        ("duty instructions", |role| {
            role.duties[0].instructions = "i".repeat(2_001)
        }),
        ("on-hire sources", |role| {
            role.on_hire = on_hire(vec!["s".to_string(); 9], 14)
        }),
        ("on-hire sources", |role| {
            role.on_hire = on_hire(vec![" ".to_string()], 14)
        }),
        ("on-hire sources", |role| {
            role.on_hire = on_hire(vec!["s".repeat(201)], 14)
        }),
        ("plan horizon", |role| role.on_hire = on_hire(Vec::new(), 0)),
        ("plan horizon", |role| {
            role.on_hire = on_hire(Vec::new(), 31)
        }),
        ("ask-before", |role| {
            role.ask_before = vec!["a".to_string(); 17]
        }),
        ("ask-before", |role| role.ask_before = vec![String::new()]),
        ("ask-before", |role| role.ask_before = vec!["a".repeat(121)]),
        ("home", |role| role.home = Some(" ".to_string())),
        ("home", |role| role.home = Some("h".repeat(81))),
    ]
}

#[test]
fn v2_role_reads_the_camel_case_wire_shape_and_v1_roles_keep_their_bytes() {
    let role: CompanyRoleMetadata = serde_json::from_value(json!({
        "job": "Post one short note a day",
        "skills": [],
        "tools": [],
        "workerMenu": ["claude"],
        "owns": "One short note a day",
        "channel": "test-employee",
        "duties": [{
            "title": "Daily note",
            "scheduleText": "Every day at 09:00",
            "instructions": "Post one short note."
        }],
        "onHire": { "sources": ["business profile"] },
        "askBefore": ["anything public"],
        "home": "test.note"
    }))
    .expect("a v2 role parses");
    assert_eq!(role.duties[0].schedule_text, "Every day at 09:00");
    assert_eq!(
        role.on_hire
            .as_ref()
            .map(|on_hire| on_hire.plan_horizon_days),
        Some(14),
        "the plan horizon defaults to 14 days"
    );
    validate_company_role_metadata(&role).expect("the v2 role is valid");

    let v1 = json!({
        "job": "Review work",
        "skills": [],
        "tools": [],
        "workerMenu": ["claude"]
    });
    let parsed: CompanyRoleMetadata =
        serde_json::from_value(v1.clone()).expect("a v1 role still parses");
    assert_eq!(serde_json::to_value(&parsed).expect("role serializes"), v1);
}

#[test]
fn v2_role_bounds_reject_each_rule_by_name() {
    validate_company_role_metadata(&v2_role()).expect("the base v2 role is valid");
    for (rule, mutate) in invalid_v2_mutations() {
        let mut role = v2_role();
        mutate(&mut role);
        let Err(error) = validate_company_role_metadata(&role) else {
            panic!("{rule} must be rejected");
        };
        assert!(error.contains(rule), "{rule}: unexpected error {error}");
    }
}

/// A hire copies a persona's company role into the proposal's role pack and
/// the relay validates it with buzz-core. Every role the desktop accepts must
/// be a pack core accepts, and every v2 rule the desktop enforces must be one
/// core enforces too.
#[test]
fn desktop_role_rules_match_the_core_hire_validator() {
    fn core_accepts(role: &CompanyRoleMetadata) -> bool {
        let mut pack = serde_json::to_value(role).expect("role serializes");
        pack["personaId"] = json!("builtin:test-employee");
        pack["title"] = json!("Test Employee");
        let proposal = json!({
            "hireId": "6f1d6a8e-3c1b-4c5e-9a57-3f5c2b8d9e10",
            "rolePack": pack,
            "displayName": "Gate Tester",
            "title": "Test Employee",
            "introductionChannelId": "0b8f2a4c-6d1e-4f3a-8b9c-1d2e3f4a5b6c",
            "runtimeId": "claude"
        });
        serde_json::from_value::<buzz_core_pkg::company_records::HireProposal>(proposal).is_ok_and(
            |proposal| buzz_core_pkg::company_records::validate_hire_proposal(&proposal).is_ok(),
        )
    }

    assert!(
        core_accepts(&v2_role()),
        "a valid desktop role is a valid core role pack"
    );
    for (rule, mutate) in invalid_v2_mutations() {
        let mut role = v2_role();
        mutate(&mut role);
        assert!(
            validate_company_role_metadata(&role).is_err(),
            "desktop rejects {rule}"
        );
        assert!(!core_accepts(&role), "core rejects {rule} too");
    }
}
