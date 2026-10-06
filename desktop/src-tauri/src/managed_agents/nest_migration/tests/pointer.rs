//! A held-back `REPOS` stays in use: the new folder points at it.

use super::*;
use crate::managed_agents::{
    effective_repos_dir, ensure_repos_symlink, resolve_repos_at_boot, write_persisted_repos_dir,
};

/// An owner-shaped home whose `REPOS` is held back (a link inside it names the
/// old folder) and which has no repositories pointer of its own, so the host
/// would start the new nest with an empty `REPOS`.
fn held_env() -> Env {
    let env = Env::owner_shaped();
    fs::remove_file(env.old().join(".repos-dir")).unwrap();
    symlink(
        env.old().join("models"),
        env.old().join("REPOS/proj/models-link"),
    )
    .unwrap();
    env
}

fn old_repos_target(env: &Env) -> String {
    fs::canonicalize(env.old().join("REPOS"))
        .unwrap()
        .to_str()
        .unwrap()
        .to_string()
}

fn moved_names(before: &BTreeMap<PathBuf, Item>) -> Vec<String> {
    owned_in(before)
        .into_iter()
        .filter(|name| name != "REPOS")
        .collect()
}

#[test]
fn a_held_back_repos_stays_in_use_through_a_pointer_the_host_honours() {
    let env = held_env();
    let before = manifest(&env.old());

    let report = env.run();

    assert_eq!(report.outcome, Outcome::Migrated);
    assert!(report.repos_in_place);
    assert_eq!(report.skipped.len(), 1, "{:?}", report.skipped);
    assert_eq!(report.skipped[0].0, "REPOS");
    assert_eq!(report.moved.len(), 9, "{:?}", report.moved);
    // The old clones are byte, path and mode identical where they were.
    assert_moved_intact(&env, &before, &moved_names(&before));
    // The pointer names the old REPOS, written the way the host writes it.
    assert_eq!(
        fs::read_to_string(env.new_dir().join(".repos-dir")).unwrap(),
        format!("{}\n", old_repos_target(&env))
    );

    // The production seam: the host's own boot code turns the new nest's REPOS
    // into the old clones, and agent restore stays allowed.
    assert!(resolve_repos_at_boot(&env.new_dir()));
    let repos = env.new_dir().join("REPOS");
    assert!(fs::symlink_metadata(&repos)
        .unwrap()
        .file_type()
        .is_symlink());
    assert_eq!(
        fs::canonicalize(&repos).unwrap(),
        fs::canonicalize(env.old().join("REPOS")).unwrap()
    );
    assert!(repos.join("proj/README.md").exists());
}

#[test]
fn the_pointer_is_one_journaled_step_that_publishes_before_the_markers() {
    let env = held_env();
    env.run();

    let journal = env.journal();
    assert_eq!(journal.phase, Phase::Done);
    assert_eq!(journal.repos_pointer, Some(old_repos_target(&env)));
    let names: Vec<&str> = journal.steps.iter().map(|s| s.name.as_str()).collect();
    let pointer = journal.steps.iter().find(|s| s.generated).unwrap();
    assert_eq!(pointer.name, ".repos-dir");
    assert_eq!(pointer.status, StepStatus::Published);
    let at = names.iter().position(|n| *n == ".repos-dir").unwrap();
    assert_eq!(&names[at + 1..], &["AGENTS.md", ".nest-agents-version"]);
}

#[test]
fn every_write_and_rename_of_a_held_back_run_is_preceded_by_its_journaled_intent() {
    for into_existing_folder in [false, true] {
        let env = held_env();
        if into_existing_folder {
            write(&env.new_dir().join("unrelated.txt"), b"x");
        }
        let probe = JournalFirstFs {
            state: &env.state,
            renames: RefCell::new(Vec::new()),
        };

        let report = env.run_with(&probe);

        assert_eq!(report.outcome, Outcome::Migrated);
        assert!(report.repos_in_place);
        assert!(env.new_dir().join(".repos-dir").exists());
    }
}

#[test]
fn a_run_cut_short_at_any_operation_resumes_with_a_valid_pointer_and_no_loss() {
    let total = count_operations(&held_env());
    // The staging folder, 9 renames, the pointer write, and the publish.
    assert_eq!(total, 12);
    for at in 1..=total {
        for before_op in [true, false] {
            let env = held_env();
            let before = manifest(&env.old());
            assert!(
                run_until_crash(&env, at, before_op),
                "operation {at} must exist"
            );

            // A pointer in the new folder always names a folder that exists,
            // and the new folder never appears without it.
            if let Ok(text) = fs::read_to_string(env.new_dir().join(".repos-dir")) {
                assert!(Path::new(text.trim()).is_dir(), "op {at}: {text}");
            }
            if env.new_dir().exists() {
                assert!(!env.staging().exists(), "op {at} before={before_op}");
                assert!(
                    env.new_dir().join(".repos-dir").exists(),
                    "op {at} before={before_op}: new folder without its pointer"
                );
            }
            for name in owned_in(&before) {
                assert_eq!(env.locations(&name), 1, "{name} at op {at}");
            }

            let report = env.run();

            assert_eq!(report.outcome, Outcome::Migrated, "op {at} {before_op}");
            assert!(report.repos_in_place, "op {at} {before_op}");
            assert_moved_intact(&env, &before, &moved_names(&before));
            assert_eq!(
                fs::read_to_string(env.new_dir().join(".repos-dir")).unwrap(),
                format!("{}\n", old_repos_target(&env))
            );
            assert!(!env.staging().exists());

            // A second launch is a no-op.
            let settled = manifest(&env.home);
            let journal = fs::read(env.journal_file()).unwrap();
            assert_eq!(env.run().outcome, Outcome::AlreadyMigrated);
            assert_eq!(manifest(&env.home), settled);
            assert_eq!(fs::read(env.journal_file()).unwrap(), journal);
        }
    }
}

#[test]
fn the_kill_switch_after_any_operation_never_leaves_a_stray_pointer_in_the_old_folder() {
    let total = count_operations(&held_env());
    for at in 1..=total {
        for before_op in [true, false] {
            let env = held_env();
            let original = manifest(&env.home);
            assert!(run_until_crash(&env, at, before_op));
            let committed = env.new_dir().exists() && !env.staging().exists();

            let report = run_migration(&env.input(false, &[]), &RealFs);

            if committed {
                assert_eq!(report.outcome, Outcome::Migrated, "op {at}");
                continue;
            }
            assert!(
                matches!(report.outcome, Outcome::RolledBack(_)),
                "op {at}: {:?}",
                report.outcome
            );
            assert_eq!(manifest(&env.home), original, "op {at} before={before_op}");
            assert!(!env.old().join(".repos-dir").exists());
            assert!(!env.staging().exists());
        }
    }
}

#[test]
fn a_lost_journal_removes_a_staged_pointer_instead_of_handing_it_back() {
    let env = held_env();
    let original = manifest(&env.home);
    // Operation 9 is the pointer write (staging folder, 7 renames, then it).
    assert!(run_until_crash(&env, 9, false));
    assert!(env.staging().join(".repos-dir").exists());
    fs::remove_dir_all(&env.state).unwrap();

    env.run_disabled();

    assert_eq!(manifest(&env.home), original);
    assert!(!env.staging().exists());
    assert!(!env.old().join(".repos-dir").exists());
}

#[test]
fn a_pointer_that_cannot_be_written_aborts_and_moves_nothing() {
    let env = held_env();
    let original = manifest(&env.home);
    let mut fs_ops = FailFs::on_rename(|_, _| None);
    fs_ops.write_fault = WriteFault::Fail;

    let report = env.run_with(&fs_ops);

    match &report.outcome {
        Outcome::Aborted(reason) => {
            assert!(reason.starts_with("repos-pointer-write-failed"), "{reason}")
        }
        other => panic!("{other:?}"),
    }
    assert_eq!(manifest(&env.home), original);
    assert!(!env.new_dir().exists());
    assert!(!env.staging().exists());
    assert_eq!(env.journal().phase, Phase::Aborted);
    let notice = pending_notice(&env.state).unwrap();
    assert!(notice.key.starts_with("aborted:repos-pointer-write-failed"));
}

#[test]
fn removing_the_pointer_write_is_caught_the_run_aborts_instead_of_publishing_without_it() {
    // A write that reports success and writes nothing is what a deleted pointer
    // write looks like to the rest of the run. Publishing anyway would end in
    // the split state (new nest with an empty REPOS, clones left behind).
    let env = held_env();
    let original = manifest(&env.home);
    let mut fs_ops = FailFs::on_rename(|_, _| None);
    fs_ops.write_fault = WriteFault::Swallow;

    let report = env.run_with(&fs_ops);

    assert_eq!(
        report.outcome,
        Outcome::Aborted("repos-pointer-unverified".to_string())
    );
    assert_eq!(manifest(&env.home), original);
    assert!(!env.new_dir().exists());
}

#[test]
fn a_target_that_cannot_be_validated_at_plan_time_aborts_before_anything_is_journaled() {
    let env = held_env();
    // REPOS is a dangling link into the old folder: held back, and not a folder
    // the host could ever validate.
    fs::remove_dir_all(env.old().join("REPOS")).unwrap();
    symlink(env.old().join("nowhere"), env.old().join("REPOS")).unwrap();
    let original = manifest(&env.home);

    let report = env.run();

    match &report.outcome {
        Outcome::Aborted(reason) => assert!(
            reason.starts_with("repos-pointer-target-unreadable"),
            "{reason}"
        ),
        other => panic!("{other:?}"),
    }
    assert_eq!(manifest(&env.home), original);
    assert!(!env.journal_file().exists());
}

#[test]
fn a_target_that_vanishes_between_staging_and_publish_sends_everything_back() {
    let env = held_env();
    let original = manifest(&env.home);
    let old_repos = env.old().join("REPOS");
    let aside = env.home.join("moved-away");
    let moved_aside = aside.clone();
    let fs_ops = FailFs::on_rename(move |from, to| {
        // After every other entry is staged, the person moves their clones.
        let last = from
            .file_name()
            .is_some_and(|name| name == ".nest-agents-version");
        if last && to.parent().is_some_and(is_staging_path) {
            fs::rename(&old_repos, &moved_aside).unwrap();
        }
        None
    });

    let report = env.run_with(&fs_ops);

    match &report.outcome {
        Outcome::Aborted(reason) => {
            assert!(reason.starts_with("repos-pointer-invalid"), "{reason}")
        }
        other => panic!("{other:?}"),
    }
    fs::rename(&aside, env.old().join("REPOS")).unwrap();
    assert_eq!(manifest(&env.home), original);
    assert!(!env.new_dir().exists());
    assert!(!env.old().join(".repos-dir").exists());
}

#[test]
fn a_failed_publish_into_an_existing_folder_removes_the_pointer_it_already_placed() {
    let env = held_env();
    write(&env.new_dir().join("unrelated.txt"), b"keep");
    let original = manifest(&env.home);
    let fs_ops = FailFs::on_rename(|from, to| {
        let into_new = to
            .parent()
            .and_then(Path::file_name)
            .is_some_and(|name| name == NEW);
        let is_marker = from.file_name().is_some_and(|name| name == "AGENTS.md");
        (into_new && is_marker && from.parent().is_some_and(is_staging_path))
            .then(|| io::Error::from_raw_os_error(18))
    });

    let report = env.run_with(&fs_ops);

    assert!(matches!(report.outcome, Outcome::Aborted(_)), "{report:?}");
    assert_eq!(manifest(&env.home), original);
}

#[test]
fn the_notice_says_the_repositories_stayed_and_are_still_used() {
    let env = held_env();
    env.run();

    let notice = pending_notice(&env.state).unwrap();

    assert_eq!(notice.key, "migrated-repos-in-place");
    assert_eq!(notice.message, MSG_MIGRATED_REPOS_IN_PLACE);
    assert!(notice.message.contains("repositories folder stayed"));
    assert!(notice.message.contains("agents still use it"));
    assert!(!notice.message.contains("Everything keeps working"));
}

#[test]
fn another_held_back_entry_gets_its_own_notice_key() {
    let env = held_env();
    // models holds a link into the old folder too, so it stays behind as well.
    symlink(
        env.old().join("REPOS"),
        env.old().join("models/stt/back-link"),
    )
    .unwrap();

    let report = env.run();

    assert_eq!(report.outcome, Outcome::Migrated);
    assert!(report.repos_in_place);
    let notice = pending_notice(&env.state).unwrap();
    assert_eq!(notice.key, "migrated-repos-in-place:left:models");
    assert_eq!(notice.message, MSG_MIGRATED_REPOS_IN_PLACE_WITH_SKIPS);
}

#[test]
fn a_repos_that_stays_because_the_new_folder_has_its_own_gets_no_pointer_and_the_old_notice() {
    let env = held_env();
    write(&env.new_dir().join("AGENTS.md"), b"colony nest");
    write(&env.new_dir().join("REPOS/mine/file"), b"x");

    let report = env.run();

    assert_eq!(report.outcome, Outcome::Migrated);
    assert!(!report.repos_in_place);
    assert!(!env.new_dir().join(".repos-dir").exists());
    // The destination wins for AGENTS.md and REPOS; the old notice applies.
    assert_eq!(
        pending_notice(&env.state).unwrap().key,
        "left:AGENTS.md,REPOS"
    );
}

#[test]
fn a_repositories_pointer_the_person_already_had_decides_and_no_second_one_is_written() {
    // Not held back: the old `.repos-dir` (outside the old folder) moves as it is.
    let env = Env::owner_shaped();
    let original_pointer = fs::read(env.old().join(".repos-dir")).unwrap();

    let report = env.run();

    assert_eq!(report.outcome, Outcome::Migrated);
    assert!(!report.repos_in_place);
    assert_eq!(
        fs::read(env.new_dir().join(".repos-dir")).unwrap(),
        original_pointer
    );
    assert!(env.journal().repos_pointer.is_none());
}

#[test]
fn a_workspace_apply_with_no_chosen_folder_keeps_the_pointer() {
    let env = held_env();
    env.run();
    assert!(resolve_repos_at_boot(&env.new_dir()));
    let target = old_repos_target(&env);

    // What `apply_workspace` does with the workspace's repositories folder,
    // which is empty for a person who never chose one.
    let candidate = effective_candidate(&env.new_dir(), &env.state, None);
    assert_eq!(candidate.as_deref(), Some(target.as_str()));
    let effective = effective_repos_dir(&env.new_dir(), candidate.as_deref()).unwrap();
    write_persisted_repos_dir(&env.new_dir(), effective.as_deref()).unwrap();
    ensure_repos_symlink(&env.new_dir(), effective.as_deref()).unwrap();

    assert!(env.new_dir().join("REPOS/proj/README.md").exists());
    assert_eq!(
        fs::read_to_string(env.new_dir().join(".repos-dir")).unwrap(),
        format!("{target}\n")
    );
}

#[test]
fn without_the_substitution_a_workspace_apply_erases_the_pointer() {
    // The control: the apply path as it was before. It is why the substitution
    // exists.
    let env = held_env();
    env.run();
    assert!(resolve_repos_at_boot(&env.new_dir()));

    let effective = effective_repos_dir(&env.new_dir(), None).unwrap();
    write_persisted_repos_dir(&env.new_dir(), effective.as_deref()).unwrap();
    ensure_repos_symlink(&env.new_dir(), effective.as_deref()).unwrap();

    assert!(!env.new_dir().join(".repos-dir").exists());
    assert!(!env.new_dir().join("REPOS/proj/README.md").exists());
}

#[test]
fn a_folder_the_person_chooses_replaces_the_pointer() {
    let env = held_env();
    env.run();
    let own = env.home.join("Development");

    let candidate = effective_candidate(&env.new_dir(), &env.state, Some(own.to_str().unwrap()));

    assert_eq!(candidate.as_deref(), own.to_str());
}

#[test]
fn a_pointer_whose_folder_was_moved_away_is_removed_so_boot_falls_back_to_a_default_repos() {
    let env = held_env();
    env.run();
    assert!(resolve_repos_at_boot(&env.new_dir()));
    // The person moves their clones somewhere else.
    fs::rename(env.old().join("REPOS"), env.home.join("my-clones")).unwrap();
    // Control: untouched, the host skips agent restore at every launch.
    assert!(!resolve_repos_at_boot(&env.new_dir()));

    heal_repos_pointer(&env.new_dir(), &env.state);

    assert!(!env.new_dir().join(".repos-dir").exists());
    assert!(
        resolve_repos_at_boot(&env.new_dir()),
        "restore is allowed again"
    );
    let repos = env.new_dir().join("REPOS");
    assert!(fs::symlink_metadata(&repos).unwrap().is_dir());
    assert!(env.home.join("my-clones/proj/README.md").exists());
}

#[test]
fn healing_never_touches_a_valid_pointer_a_pointer_of_the_persons_or_a_home_without_a_journal() {
    // Valid pointer: untouched.
    let env = held_env();
    env.run();
    let before = manifest(&env.new_dir());
    heal_repos_pointer(&env.new_dir(), &env.state);
    assert_eq!(manifest(&env.new_dir()), before);

    // A pointer the person chose later differs from the journal's: untouched,
    // even when it no longer validates.
    fs::write(env.new_dir().join(".repos-dir"), "/gone/for/now\n").unwrap();
    heal_repos_pointer(&env.new_dir(), &env.state);
    assert_eq!(
        fs::read_to_string(env.new_dir().join(".repos-dir")).unwrap(),
        "/gone/for/now\n"
    );

    // No journal at all: untouched, no panic.
    let bare = Env::new();
    write(&bare.new_dir().join(".repos-dir"), b"/gone\n");
    heal_repos_pointer(&bare.new_dir(), &bare.state);
    assert!(bare.new_dir().join(".repos-dir").exists());
}

#[test]
fn reset_removes_the_pointer_and_the_link_but_never_the_clones() {
    let env = held_env();
    env.run();
    assert!(resolve_repos_at_boot(&env.new_dir()));
    let clones_before = manifest(&env.old().join("REPOS"));

    wipe_owned_entries(&env.new_dir()).unwrap();

    assert!(!env.new_dir().join(".repos-dir").exists());
    assert!(!entry_exists(&env.new_dir().join("REPOS")));
    assert_eq!(manifest(&env.old().join("REPOS")), clones_before);
}
