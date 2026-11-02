//! Regression tests for the visual design workflow in the generated agent skill.

use super::*;

#[test]
fn visual_work_skill_requires_a_claude_design_board_and_owner_review() {
    assert!(
        NEST_SKILL_VERSION >= 25,
        "adding the visual workflow must refresh existing nests"
    );
    let skill = COLONY_CLI_SKILL_MD;
    let start = skill
        .find("## Visual work")
        .expect("the visual work section exists");
    let section = &skill[start..];
    let end = section
        .find("\n## Conversational Agent Management")
        .expect("visual work section ends");
    let section = &section[..end];
    for line in [
        "crawl the relevant public pages in the built-in browser",
        "Claude Design tools are available",
        "start with a Claude Design canvas",
        "share its review link in the current Colony chat",
        "ask the owner to approve the board before implementation",
        "Do not use `publish_version`",
        "use a Colony-managed OpenDesign board only when an isolated instance is provided for this run",
        "prepare a private local draft, render it for review",
        "wait for owner approval before continuing",
        "publishing or sending the finished work still needs the owner's approval",
    ] {
        assert!(section.contains(line), "visual workflow lacks: {line}");
    }
    assert!(
        !section.contains('\u{2014}'),
        "no em dash in agent-facing copy"
    );
}

#[test]
fn visual_work_skill_teaches_both_viewports_for_every_runtime() {
    let skill = COLONY_CLI_SKILL_MD;
    let start = skill
        .find("## Visual work")
        .expect("the visual work section exists");
    let section = &skill[start..];
    for line in [
        "For non-Claude runtimes",
        "render and review loop without Claude Design",
        "capture screenshots at 1440px and 390px widths",
        "compare both against the intended design and brand",
        "Claude runtimes must use this same screenshot loop",
        "Do not claim visual verification unless you inspected the screenshots",
    ] {
        assert!(section.contains(line), "visual workflow lacks: {line}");
    }
}

#[test]
fn previous_nest_skill_is_refreshed_with_the_visual_workflow() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join(".colony");
    ensure_nest_at(&root).unwrap();

    let skill_dir = root.join(CANONICAL_SKILL_DIR);
    fs::write(skill_dir.join("SKILL.md"), "old visual workflow").unwrap();
    fs::write(skill_dir.join(".skill-version"), "24\n").unwrap();

    ensure_nest_at(&root).unwrap();

    let refreshed = fs::read_to_string(skill_dir.join("SKILL.md")).unwrap();
    assert!(refreshed.contains("## Visual work"));
    assert_eq!(
        fs::read_to_string(skill_dir.join(".skill-version")).unwrap(),
        "25\n"
    );
}
