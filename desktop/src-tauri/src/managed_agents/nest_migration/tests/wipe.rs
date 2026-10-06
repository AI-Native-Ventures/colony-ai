//! Reset: only what Colony owns is removed from the chosen folder.

use super::*;

#[test]
fn reset_removes_only_what_colony_owns() {
    let env = Env::owner_shaped();
    let before = manifest(&env.old());

    wipe_owned_entries(&env.old()).unwrap();

    let after = manifest(&env.old());
    for name in owned_entries() {
        assert!(!after.contains_key(Path::new(name)), "{name} must be wiped");
    }
    // The generated skill links go, and so do the folders that held only them.
    for name in [".agents", ".codex", ".goose"] {
        assert!(
            !after.contains_key(Path::new(name)),
            "{name} held only links"
        );
    }
    assert!(!after.contains_key(Path::new(".claude/skills")));
    // Another tool's file in a shared folder stays, byte for byte.
    assert_eq!(
        subtree(&after, ".claude/settings.local.json"),
        subtree(&before, ".claude/settings.local.json")
    );
    // Everything that is not Colony's is untouched.
    for name in FOREIGN_TOP_LEVEL {
        assert_eq!(subtree(&after, name), subtree(&before, name), "{name}");
    }
    assert!(env.old().is_dir(), "the folder still holds other entries");
    // A link inside REPOS pointed at the person's own checkouts: untouched.
    assert!(env.home.join("Development/tools/README.md").exists());
}

#[test]
fn reset_removes_the_folder_when_nothing_else_is_in_it() {
    let env = Env::new();
    write(&env.old().join("RESEARCH/a.md"), b"a");
    write(&env.old().join("AGENTS.md"), b"nest");
    write(
        &env.old().join(".agents/skills/colony-cli/SKILL.md"),
        b"skill",
    );

    wipe_owned_entries(&env.old()).unwrap();

    assert!(!env.old().exists());
}

#[test]
fn reset_never_follows_a_symlinked_repos_folder() {
    let env = Env::new();
    write(&env.home.join("Dev/repo/file"), b"data");
    fs::create_dir_all(env.old()).unwrap();
    symlink(env.home.join("Dev"), env.old().join("REPOS")).unwrap();
    let dev_before = manifest(&env.home.join("Dev"));

    wipe_owned_entries(&env.old()).unwrap();

    assert_eq!(manifest(&env.home.join("Dev")), dev_before);
    assert!(!env.old().exists());
}

#[test]
fn reset_leaves_a_symlinked_folder_root_alone() {
    let env = Env::new();
    write(&env.home.join("elsewhere/RESEARCH/a.md"), b"a");
    symlink(env.home.join("elsewhere"), env.old()).unwrap();
    let before = manifest(&env.home.join("elsewhere"));

    wipe_owned_entries(&env.old()).unwrap();

    assert_eq!(manifest(&env.home.join("elsewhere")), before);
}

#[test]
fn a_missing_folder_is_already_wiped() {
    let env = Env::new();
    wipe_owned_entries(&env.old()).unwrap();
    assert!(!owned_entries_remain(&env.old()));
}

#[test]
fn owned_entries_remain_sees_entries_and_generated_links() {
    let env = Env::new();
    fs::create_dir_all(env.old()).unwrap();
    assert!(!owned_entries_remain(&env.old()));
    write(&env.old().join("notes.md"), b"not ours");
    assert!(!owned_entries_remain(&env.old()));
    write(&env.old().join(".claude/skills/buzz-cli"), b"link stand-in");
    assert!(owned_entries_remain(&env.old()));
    wipe_owned_entries(&env.old()).unwrap();
    assert!(!owned_entries_remain(&env.old()));
    assert!(env.old().join("notes.md").exists());
}
