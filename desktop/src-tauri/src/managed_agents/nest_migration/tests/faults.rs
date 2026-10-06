//! Injected failures: moves that fail, a staging folder that cannot be made, a
//! read-only home, and the SQLite trio.

use super::*;

const ATOMIC_NAMES: [&str; 9] = [
    "archive",
    "GUIDES",
    "RESEARCH",
    "PLANS",
    "WORK_LOGS",
    "OUTBOX",
    ".repos-dir",
    "AGENTS.md",
    ".nest-agents-version",
];

#[test]
fn a_failed_move_of_a_small_entry_sends_everything_back() {
    for name in ATOMIC_NAMES {
        let env = Env::owner_shaped();
        let original = manifest(&env.home);

        // Moving across volumes fails with EXDEV.
        let report = env.run_with(&exdev_when_staging(name));

        match &report.outcome {
            Outcome::Aborted(reason) => assert!(
                reason.starts_with(&format!("move-failed:{name}:")),
                "{name}: {reason}"
            ),
            other => panic!("{name}: {other:?}"),
        }
        assert_eq!(manifest(&env.home), original, "{name}: everything is back");
        assert!(!env.staging().exists());
        assert!(!env.new_dir().exists());
        assert_eq!(env.journal().phase, Phase::Aborted);
        assert!(
            pending_notice(&env.state).is_some(),
            "{name}: the person is told"
        );

        // The app keeps working on the old folder, and once the problem is gone
        // a later launch moves it.
        assert_eq!(env.run().outcome, Outcome::Migrated, "{name}");
    }
}

#[test]
fn a_failed_move_of_a_big_entry_leaves_just_that_entry_behind() {
    for name in ["REPOS", "models"] {
        let env = Env::owner_shaped();
        let before = manifest(&env.old());

        let report = env.run_with(&exdev_when_staging(name));

        assert_eq!(report.outcome, Outcome::Migrated, "{name}");
        assert_eq!(report.skipped.len(), 1, "{name}");
        assert_eq!(report.skipped[0].0, name);
        assert!(report.skipped[0].1.starts_with("move-failed:"));
        let moved: Vec<String> = owned_in(&before)
            .into_iter()
            .filter(|entry| entry != name)
            .collect();
        assert_moved_intact(&env, &before, &moved);
        assert_eq!(
            subtree(&manifest(&env.old()), name),
            subtree(&before, name),
            "{name} stays exactly as it was"
        );

        // The new nest has made its own empty placeholder since; the next
        // launch, with the problem gone, replaces it with the real entry.
        fs::create_dir_all(env.new_dir().join(name)).unwrap();
        let retry = env.run();
        assert_eq!(retry.outcome, Outcome::Migrated, "{name}");
        assert_eq!(retry.moved, vec![name.to_string()]);
        assert_moved_intact(&env, &before, &owned_in(&before));
    }
}

#[test]
fn a_staging_folder_that_cannot_be_created_moves_nothing() {
    let env = Env::owner_shaped();
    let original = manifest(&env.home);
    let mut fs_ops = FailFs::on_rename(|_, _| None);
    fs_ops.create_dir_error = true;

    let report = env.run_with(&fs_ops);

    assert!(
        matches!(&report.outcome, Outcome::Aborted(reason) if reason.starts_with("staging-unavailable")),
        "{:?}",
        report.outcome
    );
    assert_eq!(manifest(&env.home), original);
}

#[test]
fn a_read_only_home_folder_moves_nothing_and_changes_nothing() {
    let env = Env::owner_shaped();
    let original = manifest(&env.home);
    fs::set_permissions(&env.home, fs::Permissions::from_mode(0o555)).unwrap();
    // Root ignores the mode; only assert where it bites.
    let probe = env.home.join("probe");
    let bites = fs::create_dir(&probe).is_err();
    if !bites {
        let _ = fs::remove_dir(&probe);
    }

    let report = env.run();

    fs::set_permissions(&env.home, fs::Permissions::from_mode(0o755)).unwrap();
    if !bites {
        return;
    }
    assert!(
        matches!(&report.outcome, Outcome::Aborted(reason) if reason.starts_with("staging-unavailable")),
        "{:?}",
        report.outcome
    );
    assert_eq!(manifest(&env.home), original);
}

#[test]
fn a_failed_publish_sends_everything_back_from_the_staging_folder() {
    let env = Env::owner_shaped();
    let original = manifest(&env.home);
    let fs_ops = FailFs::on_rename(|from, to| {
        let whole = is_staging_path(from) && to.file_name().is_some_and(|name| name == NEW);
        whole.then(|| io::Error::from_raw_os_error(18))
    });

    let report = env.run_with(&fs_ops);

    assert!(
        matches!(&report.outcome, Outcome::Aborted(reason) if reason.starts_with("publish-failed")),
        "{:?}",
        report.outcome
    );
    assert_eq!(manifest(&env.home), original);
    assert!(!env.staging().exists());
    assert!(!env.new_dir().exists());
}

#[test]
fn a_failed_publish_into_an_existing_folder_puts_back_what_it_already_placed() {
    let env = Env::owner_shaped();
    write(&env.new_dir().join("unrelated.txt"), b"keep");
    let original = manifest(&env.home);
    let fs_ops = FailFs::on_rename(|from, to| {
        let publishing = from.parent().is_some_and(is_staging_path)
            && to
                .parent()
                .and_then(Path::file_name)
                .is_some_and(|name| name == NEW);
        let is_plans = from.file_name().is_some_and(|name| name == "PLANS");
        (publishing && is_plans).then(|| io::Error::from_raw_os_error(18))
    });

    let report = env.run_with(&fs_ops);

    assert!(
        matches!(&report.outcome, Outcome::Aborted(reason) if reason.starts_with("publish-failed:PLANS")),
        "{:?}",
        report.outcome
    );
    assert_eq!(manifest(&env.home), original);
}

#[test]
fn the_archive_database_moves_with_its_wal_and_shm_or_not_at_all() {
    // Moved: all three files arrive together and every row is there.
    let env = Env::owner_shaped();
    for suffix in ["", "-wal", "-shm"] {
        assert!(env
            .old()
            .join(format!("archive/archive.db{suffix}"))
            .exists());
    }
    assert_eq!(env.run().outcome, Outcome::Migrated);
    for suffix in ["", "-wal", "-shm"] {
        assert!(
            env.new_dir()
                .join(format!("archive/archive.db{suffix}"))
                .exists(),
            "{suffix}"
        );
    }
    assert!(!env.old().join("archive").exists());
    assert_eq!(archive_rows(&env.new_dir().join("archive")), DB_ROWS);

    // Not moved: the trio is untouched and still opens with every row.
    let env = Env::owner_shaped();
    let trio_before = manifest(&env.old().join("archive"));
    let report = env.run_with(&exdev_when_staging("archive"));
    assert!(matches!(report.outcome, Outcome::Aborted(_)));
    assert_eq!(manifest(&env.old().join("archive")), trio_before);
    assert_eq!(archive_rows(&env.old().join("archive")), DB_ROWS);
}
