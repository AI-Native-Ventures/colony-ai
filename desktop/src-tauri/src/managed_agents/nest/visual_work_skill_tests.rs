//! Regression tests for the visual design workflow in the generated agent skill.

use super::*;

#[test]
fn visual_work_skill_makes_open_design_default_and_claude_design_optional() {
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
        "Open Design is the default design engine for every Colony user and every runtime, including Start free through Colony's free AI gateway.",
        "The owner reviews the preview and thumbnails in the Colony Work Area",
        "An approved design is the source for implementation and export.",
        "Claude Design is an optional extra only when the user's Claude account exposes it",
        "It never replaces Open Design as Colony's default.",
        "Keep Claude Design drafts private.",
        "Do not export until approval",
    ] {
        assert!(section.contains(line), "visual workflow lacks: {line}");
    }
    for stale in [
        "start with a Claude Design canvas",
        "share its review link in the current Colony chat",
        "use a Colony-managed OpenDesign board only when an isolated instance is provided",
    ] {
        assert!(
            !section.contains(stale),
            "stale visual workflow remains: {stale}"
        );
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
        "Before asking the owner to review, render and inspect the result at 1440px and 390px widths.",
        "Compare both screenshots against the brief and brand",
        "fix visible differences, and capture both sizes again.",
    ] {
        assert!(section.contains(line), "visual workflow lacks: {line}");
    }
    assert!(!section.contains("For non-Claude runtimes"));
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
        "26\n"
    );
}
