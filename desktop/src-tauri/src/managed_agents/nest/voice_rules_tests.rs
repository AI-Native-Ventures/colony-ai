//! The voice rules reach every file Colony writes for employees to read.
//!
//! One copy, `voice.md` in buzz-acp ([`buzz_acp::VOICE_RULES`]); these tests
//! go through the real writers, so dropping the rules from any of them fails.

use super::*;
use std::collections::HashSet;

fn voice() -> &'static str {
    buzz_acp::VOICE_RULES.trim_end()
}

#[test]
fn the_skill_carries_the_voice_rules_once_before_the_web_task_rules() {
    let voice_at = COLONY_CLI_SKILL_MD
        .find(voice())
        .expect("the skill carries the voice rules");
    let web_at = COLONY_CLI_SKILL_MD
        .find("## Web Tasks")
        .expect("the skill carries the web task rules");
    assert!(voice_at < web_at);
    assert_eq!(COLONY_CLI_SKILL_MD.matches("## Voice").count(), 1);
    assert!(COLONY_CLI_SKILL_MD.ends_with(buzz_acp::WEB_TASK_RULES));
}

#[test]
fn message_formatting_points_at_the_voice_rules() {
    let section = COLONY_CLI_SKILL_MD
        .split("## Message Formatting")
        .nth(1)
        .and_then(|rest| rest.split("\n## ").next())
        .expect("the formatting section");
    assert!(section.contains("Voice rules"));
    assert!(
        !section.contains("headings: standard GFM"),
        "chat is not a report"
    );
    assert!(section.contains("plain `@name`"), "mentions still alert");
}

#[test]
fn a_skill_written_by_the_previous_release_is_regenerated_with_the_voice_rules() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join(".colony");
    ensure_nest_at(&root).unwrap();

    // What 1.0.7 left on disk: the skill without the voice rules, version 8.
    let skill_dir = root.join(CANONICAL_SKILL_DIR);
    fs::write(skill_dir.join("SKILL.md"), include_str!("../nest_skill.md")).unwrap();
    fs::write(skill_dir.join(".skill-version"), "8\n").unwrap();

    ensure_nest_at(&root).unwrap();

    let refreshed = fs::read_to_string(skill_dir.join("SKILL.md")).unwrap();
    assert!(
        refreshed.contains(voice()),
        "adding the voice rules must bump NEST_SKILL_VERSION so existing nests pick them up"
    );
}

#[test]
fn the_managed_agents_md_section_carries_the_voice_rules() {
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
    let voice_at = section
        .find(voice())
        .expect("the voice rules live in the managed section");
    let web_at = section
        .find("## Web Tasks")
        .expect("so do the web task rules");
    assert!(voice_at < web_at);
    assert_eq!(written.matches("## Voice").count(), 1);
}
