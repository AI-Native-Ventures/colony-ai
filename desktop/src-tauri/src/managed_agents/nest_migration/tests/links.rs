//! Links and pointers keep their meaning, or the entry that holds them stays.

use super::*;

fn aborted_with(report: &Report, prefix: &str) {
    match &report.outcome {
        Outcome::Aborted(reason) => {
            assert!(
                reason.starts_with(prefix),
                "{reason} does not start with {prefix}"
            )
        }
        other => panic!("expected an abort starting {prefix}, got {other:?}"),
    }
}

fn skipped_repos_with(report: &Report, prefix: &str) {
    assert_eq!(report.outcome, Outcome::Migrated);
    assert_eq!(report.skipped.len(), 1, "{:?}", report.skipped);
    assert_eq!(report.skipped[0].0, "REPOS");
    assert!(
        report.skipped[0].1.starts_with(prefix),
        "{} does not start with {prefix}",
        report.skipped[0].1
    );
}

#[test]
fn links_inside_repos_keep_their_meaning() {
    // REPOS/rel is relative and stays inside REPOS; REPOS/ext is absolute and
    // leaves the old folder.
    let env = Env::owner_shaped();
    let before = manifest(&env.old());

    assert_eq!(env.run().outcome, Outcome::Migrated);

    // The manifest compares every link target verbatim.
    assert_moved_intact(&env, &before, &owned_in(&before));
    assert!(env.new_dir().join("REPOS/rel/README.md").exists());
    assert!(env.new_dir().join("REPOS/ext/README.md").exists());
}

#[test]
fn a_symlinked_repos_folder_moves_as_a_symlink_and_its_target_is_untouched() {
    let env = Env::new();
    write(&env.old().join("RESEARCH/a.md"), b"a");
    let external = env.home.join("Dev");
    write(&external.join("repo/file.rs"), b"fn main() {}");
    symlink(&external, env.old().join("REPOS")).unwrap();
    let external_before = manifest(&external);
    let before = manifest(&env.old());

    assert_eq!(env.run().outcome, Outcome::Migrated);

    assert_eq!(
        fs::read_link(env.new_dir().join("REPOS")).unwrap(),
        external
    );
    assert_eq!(manifest(&external), external_before);
    assert!(!entry_exists(&env.old().join("REPOS")));
    assert_moved_intact(
        &env,
        &before,
        &["RESEARCH".to_string(), "REPOS".to_string()],
    );
}

#[test]
fn an_absolute_link_into_the_old_folder_holds_the_whole_migration_back() {
    let env = Env::owner_shaped();
    symlink(
        env.old().join("REPOS/proj"),
        env.old().join("RESEARCH/proj-link"),
    )
    .unwrap();
    let before = manifest(&env.home);

    let report = env.run();

    aborted_with(&report, "would-break-link:absolute-link:RESEARCH/proj-link");
    assert_eq!(manifest(&env.home), before);
    assert!(!env.journal_file().exists(), "nothing was journaled");
}

#[test]
fn the_canonical_spelling_of_the_old_folder_is_recognised_too() {
    let env = Env::owner_shaped();
    let canonical = fs::canonicalize(env.old()).unwrap();
    symlink(
        canonical.join("REPOS/proj"),
        env.old().join("PLANS/proj-link"),
    )
    .unwrap();
    let before = manifest(&env.home);

    aborted_with(&env.run(), "would-break-link:absolute-link:PLANS/proj-link");
    assert_eq!(manifest(&env.home), before);
}

#[test]
fn a_link_into_the_old_folder_inside_repos_holds_only_repos_back() {
    let env = Env::owner_shaped();
    symlink(
        env.old().join("models"),
        env.old().join("REPOS/proj/models-link"),
    )
    .unwrap();
    let before = manifest(&env.old());

    let report = env.run();

    skipped_repos_with(
        &report,
        "would-break-link:absolute-link:REPOS/proj/models-link",
    );
    let moved: Vec<String> = owned_in(&before)
        .into_iter()
        .filter(|name| name != "REPOS")
        .collect();
    assert_moved_intact(&env, &before, &moved);
}

#[test]
fn a_relative_link_to_an_entry_that_stays_behind_holds_the_migration_back() {
    let env = Env::owner_shaped();
    symlink("../.venv-tts/bin/python", env.old().join("RESEARCH/py")).unwrap();
    let before = manifest(&env.home);

    aborted_with(&env.run(), "would-break-link:relative-link:RESEARCH/py");
    assert_eq!(manifest(&env.home), before);
}

#[test]
fn relative_links_between_entries_that_move_together_stay_valid() {
    let env = Env::owner_shaped();
    write(&env.home.join("outside.txt"), b"o");
    symlink("../PLANS/plan.md", env.old().join("RESEARCH/plan-link")).unwrap();
    // Leaves the folder: the new folder sits at the same depth, so it resolves
    // to the same file.
    symlink("../../outside.txt", env.old().join("RESEARCH/escapes")).unwrap();
    let before = manifest(&env.old());

    assert_eq!(env.run().outcome, Outcome::Migrated);

    assert_moved_intact(&env, &before, &owned_in(&before));
    assert!(env.new_dir().join("RESEARCH/plan-link").exists());
    assert!(env.new_dir().join("RESEARCH/escapes").exists());
}

#[test]
fn a_linked_worktree_pointer_holds_repos_back() {
    let env = Env::owner_shaped();
    write(
        &env.old().join("REPOS/wt/.git"),
        format!(
            "gitdir: {}/REPOS/proj/.git/worktrees/wt\n",
            env.old().display()
        )
        .as_bytes(),
    );
    let before = manifest(&env.old());

    let report = env.run();

    skipped_repos_with(&report, "would-break-link:git-pointer:REPOS/wt/.git");
    let moved: Vec<String> = owned_in(&before)
        .into_iter()
        .filter(|name| name != "REPOS")
        .collect();
    assert_moved_intact(&env, &before, &moved);
}

#[test]
fn a_repository_with_linked_worktrees_holds_repos_back() {
    let env = Env::owner_shaped();
    write(
        &env.old().join("REPOS/proj/.git/worktrees/wt/gitdir"),
        b"/elsewhere/wt/.git\n",
    );

    let report = env.run();

    skipped_repos_with(&report, "would-break-link:git-worktrees:REPOS/proj/.git");
}

#[test]
fn a_repos_dir_that_points_into_the_old_folder_holds_the_migration_back() {
    let env = Env::owner_shaped();
    fs::write(
        env.old().join(".repos-dir"),
        format!("{}\n", env.old().join("REPOS/proj").display()),
    )
    .unwrap();
    let before = manifest(&env.home);

    let report = env.run();

    assert_eq!(
        report.outcome,
        Outcome::Aborted("repos-dir-inside-old-folder".to_string())
    );
    assert_eq!(manifest(&env.home), before);
}

#[test]
fn old_generated_skill_entries_stay_put_and_keep_resolving() {
    let env = Env::owner_shaped();
    let before = manifest(&env.old());

    assert_eq!(env.run().outcome, Outcome::Migrated);

    let after = manifest(&env.old());
    for name in [".agents", ".claude", ".codex", ".goose"] {
        assert_eq!(subtree(&after, name), subtree(&before, name), "{name}");
    }
    assert!(env.old().join(".claude/skills/buzz-cli/SKILL.md").exists());
    // The new folder gets its own skill links from the nest setup, not these.
    assert!(!env.new_dir().join(".agents").exists());
    assert!(!env.new_dir().join(".claude").exists());
}
