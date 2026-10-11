//! The web task rules reach every file Colony writes for agents to read.
//!
//! The rules have one copy, `web_tasks.md` in buzz-acp, exported as
//! [`buzz_acp::WEB_TASK_RULES`]. These tests go through the real writers
//! ([`ensure_nest_at`], [`render_dynamic_section`], [`upsert_managed_section`])
//! so dropping the rules from any of them fails here.

use super::*;
use std::collections::HashSet;

fn rules() -> &'static str {
    buzz_acp::WEB_TASK_RULES.trim_end()
}

#[test]
fn cli_skill_ends_with_the_shared_rules() {
    assert!(
        COLONY_CLI_SKILL_MD.ends_with(buzz_acp::WEB_TASK_RULES),
        "the skill includes the same file the base prompt ends with"
    );
    assert_eq!(COLONY_CLI_SKILL_MD.matches("## Web Tasks").count(), 1);
}

#[test]
fn fresh_nest_skill_carries_the_rules_in_every_harness_folder() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join(".colony");
    ensure_nest_at(&root).unwrap();

    let canonical = fs::read_to_string(root.join(CANONICAL_SKILL_DIR).join("SKILL.md")).unwrap();
    assert!(canonical.contains(rules()));

    // Harness folders link to the canonical skill on Unix.
    #[cfg(unix)]
    {
        for skill_dir in known_skill_dirs() {
            let linked = root.join(skill_dir).join(SKILL_NAME).join("SKILL.md");
            let content = fs::read_to_string(&linked)
                .unwrap_or_else(|e| panic!("read {}: {e}", linked.display()));
            assert!(content.contains(rules()), "{skill_dir}");
        }
    }
}

#[test]
fn skill_written_by_the_previous_release_is_regenerated_with_the_rules() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join(".colony");
    ensure_nest_at(&root).unwrap();

    // What 1.0.6 left on disk: the skill without the rules, at version 7.
    let skill_dir = root.join(CANONICAL_SKILL_DIR);
    fs::write(skill_dir.join("SKILL.md"), include_str!("../nest_skill.md")).unwrap();
    fs::write(skill_dir.join(".skill-version"), "7\n").unwrap();

    ensure_nest_at(&root).unwrap();

    let refreshed = fs::read_to_string(skill_dir.join("SKILL.md")).unwrap();
    assert!(
        refreshed.contains(rules()),
        "adding the rules must bump NEST_SKILL_VERSION so existing nests pick them up"
    );
}

#[test]
fn managed_agents_md_section_carries_the_rules() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join(".colony");
    ensure_nest_at(&root).unwrap();
    let agents_md = root.join("AGENTS.md");

    let managed = render_dynamic_section(&[], &[], &HashSet::new(), "wss://relay.example.com");
    upsert_managed_section(&agents_md, &managed).unwrap();

    let written = fs::read_to_string(&agents_md).unwrap();
    let begin = written.find(BEGIN_LINE).expect("managed section opens");
    let end = written.find(END_MARKER).expect("managed section closes");
    let section = &written[begin..end];
    assert!(
        section.contains(rules()),
        "the rules live in the managed section"
    );
    assert_eq!(written.matches("## Web Tasks").count(), 1);
}
