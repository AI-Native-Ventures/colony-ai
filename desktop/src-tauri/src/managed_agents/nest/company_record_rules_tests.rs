//! GATE-329-COF: Scout was asked for a plan, a playbook change, a goal and the
//! weekly review, saved each one as a file in `PLANS/`, `GUIDES/` or `OUTBOX/`
//! (the nest folders its `AGENTS.md` presented as the place for them) and said
//! it had created them. The company record rules have one copy,
//! `company_records.md` in buzz-acp, exported as
//! [`buzz_acp::COMPANY_RECORD_RULES`]. These tests go through the real writers
//! ([`ensure_nest_at`], [`render_dynamic_section`], [`upsert_managed_section`])
//! so dropping the rules, or the commands in the skill, from any of them fails
//! here.

use super::*;
use std::collections::HashSet;

fn rules() -> &'static str {
    buzz_acp::COMPANY_RECORD_RULES.trim_end()
}

const GUIDELINE: &str = "**Company records are commands, not files**";

#[test]
fn managed_agents_md_section_carries_the_company_record_rules_once() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join(".colony");
    ensure_nest_at(&root).unwrap();
    let agents_md = root.join("AGENTS.md");

    let managed = render_dynamic_section(&[], &[], &HashSet::new(), "wss://relay.example.com");
    upsert_managed_section(&agents_md, &managed).unwrap();

    let written = fs::read_to_string(&agents_md).unwrap();
    let begin = written.find(BEGIN_LINE).expect("managed section opens");
    let end = written.find(END_MARKER).expect("managed section closes");
    assert!(
        written[begin..end].contains(rules()),
        "the rules live in the managed section, which every launch rewrites"
    );
    assert_eq!(written.matches("## Company Records").count(), 1);
}

#[test]
fn fresh_agents_md_no_longer_presents_the_folders_as_the_home_of_company_records() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join(".colony");
    ensure_nest_at(&root).unwrap();

    let written = fs::read_to_string(root.join("AGENTS.md")).unwrap();
    assert!(written.contains(GUIDELINE));
    assert!(
        !written.contains("| `PLANS/` | Planning documents for work in progress |"),
        "PLANS/ is not described as where plans go"
    );
    assert!(written.contains("Never a plan, goal, playbook or weekly review"));
}

#[test]
fn agents_md_written_by_the_previous_release_gets_the_guideline_and_keeps_its_notes() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join(".colony");
    ensure_nest_at(&root).unwrap();
    let agents_md = root.join("AGENTS.md");

    // What 3.0.29 left on disk: the old folder table, no guideline, version 7,
    // the owner's own note below the managed section.
    let current = fs::read_to_string(&agents_md).unwrap();
    let old = current
        .lines()
        .filter(|line| !line.contains(GUIDELINE))
        .collect::<Vec<_>>()
        .join("\n")
        + "\n\n## Local Notes\n\nKeep me.\n";
    fs::write(&agents_md, old).unwrap();
    fs::write(root.join(".nest-agents-version"), "7\n").unwrap();

    ensure_nest_at(&root).unwrap();

    let refreshed = fs::read_to_string(&agents_md).unwrap();
    assert!(
        refreshed.contains(GUIDELINE),
        "adding the guideline must bump NEST_AGENTS_VERSION so existing nests pick it up"
    );
    assert!(refreshed.contains("Keep me."), "the owner's notes survive");
}

#[test]
fn cli_skill_teaches_goals_and_the_weekly_review() {
    for command in [
        "colony numbers goals propose --function sales --metric won",
        "colony numbers review list",
        "colony numbers review write 2026-10-30 --file review.json",
        "colony numbers scorecard",
    ] {
        assert!(
            COLONY_CLI_SKILL_MD.contains(command),
            "the skill is missing: {command}"
        );
    }
    assert_eq!(
        COLONY_CLI_SKILL_MD
            .matches("## Goals, scorecards and the weekly review")
            .count(),
        1
    );
    assert!(COLONY_CLI_SKILL_MD.contains("never files"));
    assert!(COLONY_CLI_SKILL_MD.contains("One request is one worker."));
    assert!(!COLONY_CLI_SKILL_MD.contains('\u{2014}'), "no em dashes");
}

#[test]
fn skill_written_by_the_previous_release_is_regenerated_with_goals_and_reviews() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join(".colony");
    ensure_nest_at(&root).unwrap();

    // What 3.0.29 left on disk: the skill without them, at version 22.
    let skill_dir = root.join(CANONICAL_SKILL_DIR);
    fs::write(
        skill_dir.join("SKILL.md"),
        "# old skill without numbers commands",
    )
    .unwrap();
    fs::write(skill_dir.join(".skill-version"), "22\n").unwrap();

    ensure_nest_at(&root).unwrap();

    let refreshed = fs::read_to_string(skill_dir.join("SKILL.md")).unwrap();
    assert!(
        refreshed.contains("colony numbers review write"),
        "adding the section must bump NEST_SKILL_VERSION so existing nests pick it up"
    );
}
