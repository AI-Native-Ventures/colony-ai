//! A run that stops anywhere resumes (or is rolled back) without losing or
//! duplicating a single entry.

use super::*;

/// Every Colony-owned entry that existed is in exactly one place.
fn assert_nothing_lost_or_duplicated(env: &Env, before: &BTreeMap<PathBuf, Item>) {
    for name in owned_in(before) {
        assert_eq!(
            env.locations(&name),
            1,
            "{name} must be in exactly one place"
        );
    }
}

#[test]
fn every_rename_is_preceded_by_its_journaled_intent() {
    for into_existing_folder in [false, true] {
        let env = Env::owner_shaped();
        if into_existing_folder {
            write(&env.new_dir().join("unrelated.txt"), b"x");
        }
        let probe = JournalFirstFs {
            state: &env.state,
            renames: RefCell::new(Vec::new()),
        };

        let report = env.run_with(&probe);

        assert_eq!(report.outcome, Outcome::Migrated);
        let renames = probe.renames.borrow();
        let markers = ["AGENTS.md", ".nest-agents-version"];
        if into_existing_folder {
            // 11 into staging, 11 into place; the markers go last.
            assert_eq!(renames.len(), 22);
            assert_eq!(&renames[renames.len() - 2..], &markers);
        } else {
            // 11 into staging, then the staging folder itself.
            assert_eq!(renames.len(), 12);
            assert_eq!(renames[11], format!("{NEW}.staging"));
            assert_eq!(&renames[9..11], &markers);
        }
    }
}

#[test]
fn a_run_cut_short_after_any_operation_resumes_without_loss_or_duplication() {
    let total = count_operations(&Env::owner_shaped());
    // The staging folder, 11 entries, and the publish.
    assert_eq!(total, 13);
    for at in 1..=total {
        for before_op in [true, false] {
            let env = Env::owner_shaped();
            let before = manifest(&env.old());
            let owned = owned_in(&before);
            assert!(
                run_until_crash(&env, at, before_op),
                "operation {at} must exist"
            );

            assert_nothing_lost_or_duplicated(&env, &before);
            if env.new_dir().exists() {
                // The new folder appears all at once, never half populated.
                assert!(!env.staging().exists(), "op {at} before={before_op}");
                for name in &owned {
                    assert!(entry_exists(&env.new_dir().join(name)), "{name}");
                }
            }

            let report = env.run();

            assert_eq!(
                report.outcome,
                Outcome::Migrated,
                "resume after op {at} (before={before_op})"
            );
            assert!(report.skipped.is_empty(), "{:?}", report.skipped);
            assert_moved_intact(&env, &before, &owned);
            assert_eq!(env.journal().phase, Phase::Done);
            assert!(!env.staging().exists());

            // One more launch changes nothing.
            let settled = manifest(&env.home);
            assert_eq!(env.run().outcome, Outcome::AlreadyMigrated);
            assert_eq!(manifest(&env.home), settled);
        }
    }
}

#[test]
fn a_run_cut_short_twice_still_resumes_cleanly() {
    for (first, second) in [(2usize, 1usize), (6, 3), (10, 2), (12, 1), (13, 1)] {
        let env = Env::owner_shaped();
        let before = manifest(&env.old());
        let owned = owned_in(&before);
        assert!(run_until_crash(&env, first, false), "first cut at {first}");
        // The resume is cut short as well (it may have nothing left to cut).
        let _ = run_until_crash(&env, second, true);
        assert_nothing_lost_or_duplicated(&env, &before);

        let report = env.run();

        assert!(
            matches!(report.outcome, Outcome::Migrated | Outcome::AlreadyMigrated),
            "{first}/{second}: {:?}",
            report.outcome
        );
        assert_moved_intact(&env, &before, &owned);
        assert!(!env.staging().exists());
    }
}

#[test]
fn the_kill_switch_turns_an_interrupted_run_back_into_the_original_folder() {
    let total = count_operations(&Env::owner_shaped());
    for at in 1..=total {
        for before_op in [true, false] {
            let env = Env::owner_shaped();
            let original = manifest(&env.home);
            let owned = owned_in(&manifest(&env.old()));
            assert!(run_until_crash(&env, at, before_op));
            let committed = env.new_dir().exists() && !env.staging().exists();

            let report = run_migration(&env.input(false, &[]), &RealFs);

            if committed {
                // Past the commit point the move is whole; the switch only
                // stops new work, it never tears a finished move apart.
                assert_eq!(report.outcome, Outcome::Migrated, "op {at}");
                for name in &owned {
                    assert!(entry_exists(&env.new_dir().join(name)));
                }
                continue;
            }
            assert!(
                matches!(&report.outcome, Outcome::RolledBack(reason) if reason == "kill-switch"),
                "op {at} before={before_op}: {:?}",
                report.outcome
            );
            assert_eq!(manifest(&env.home), original, "op {at} before={before_op}");
            assert_eq!(env.journal().phase, Phase::Aborted);

            // Back on, the next launch starts over and finishes.
            assert_eq!(env.run().outcome, Outcome::Migrated);
        }
    }
}

#[test]
fn a_lost_journal_does_not_strand_staged_entries() {
    let env = Env::owner_shaped();
    let original = manifest(&env.home);
    assert!(run_until_crash(&env, 7, false));
    assert!(env.staging().exists());
    fs::remove_dir_all(&env.state).unwrap();

    // Even with the switch off, entries in staging are handed back.
    let report = env.run_disabled();

    assert_eq!(report.outcome, Outcome::Disabled);
    assert_eq!(manifest(&env.home), original);
    assert!(!env.staging().exists());
    assert_eq!(env.run().outcome, Outcome::Migrated);
}

#[test]
fn an_unreadable_journal_is_set_aside_and_not_trusted() {
    let env = Env::owner_shaped();
    fs::create_dir_all(&env.state).unwrap();
    fs::write(env.journal_file(), b"{ not json").unwrap();
    let before = manifest(&env.old());

    let report = env.run();

    assert_eq!(report.outcome, Outcome::Migrated);
    assert!(env.state.join("journal.json.unreadable").exists());
    assert_moved_intact(&env, &before, &owned_in(&before));
}

#[test]
fn without_a_durable_journal_nothing_moves() {
    let env = Env::owner_shaped();
    // The state folder's path is taken by a file, so no journal can be written.
    write(&env.state, b"in the way");
    let before = manifest(&env.home);

    let report = env.run();

    assert!(
        matches!(&report.outcome, Outcome::Aborted(reason) if reason.starts_with("journal-unwritable")),
        "{:?}",
        report.outcome
    );
    assert_eq!(manifest(&env.home), before);
}
