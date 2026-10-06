//! The flag, fresh installs, the plain move, conflicts and the notice.

use super::*;

#[test]
fn flag_off_does_nothing() {
    let env = Env::owner_shaped();
    let before = manifest(&env.home);
    let report = env.run_disabled();
    assert_eq!(report.outcome, Outcome::Disabled);
    assert_eq!(manifest(&env.home), before);
    assert!(!env.state.exists(), "a disabled run must not create state");
    assert!(!env.staging().exists());
}

#[test]
fn fresh_install_does_nothing() {
    let env = Env::new();
    let report = env.run();
    assert_eq!(
        report.outcome,
        Outcome::NotApplicable("legacy-folder-absent")
    );
    assert!(manifest(&env.home).is_empty(), "nothing may be created");
    assert!(!env.state.exists());
}

#[test]
fn a_new_folder_with_no_old_one_is_left_alone() {
    let env = Env::new();
    write(&env.new_dir().join("AGENTS.md"), b"nest");
    let before = manifest(&env.home);
    let report = env.run();
    assert_eq!(
        report.outcome,
        Outcome::NotApplicable("legacy-folder-absent")
    );
    assert_eq!(manifest(&env.home), before);
}

#[test]
fn an_old_folder_with_nothing_of_colonys_is_left_alone() {
    let env = Env::new();
    write(&env.old().join(".venv-tts/pyvenv.cfg"), b"venv");
    write(&env.old().join("notes.md"), b"mine");
    // Generated skill leftovers are not Colony data.
    write(
        &env.old().join(".agents/skills/buzz-cli/SKILL.md"),
        b"skill",
    );
    let before = manifest(&env.home);
    let report = env.run();
    assert_eq!(report.outcome, Outcome::NothingToMigrate);
    assert_eq!(manifest(&env.home), before);
    assert!(!env.state.exists());
}

#[test]
fn an_old_folder_that_is_a_symlink_or_a_file_is_never_touched() {
    let env = Env::new();
    write(&env.home.join("elsewhere/RESEARCH/a.md"), b"a");
    symlink(env.home.join("elsewhere"), env.old()).unwrap();
    let before = manifest(&env.home);
    assert_eq!(
        env.run().outcome,
        Outcome::NotApplicable("legacy-folder-not-a-directory")
    );
    assert_eq!(manifest(&env.home), before);

    let env = Env::new();
    write(&env.old(), b"a file");
    let before = manifest(&env.home);
    assert_eq!(
        env.run().outcome,
        Outcome::NotApplicable("legacy-folder-not-a-directory")
    );
    assert_eq!(manifest(&env.home), before);
}

#[test]
fn a_new_folder_that_is_a_file_is_never_touched() {
    let env = Env::owner_shaped();
    write(&env.new_dir(), b"a file");
    let before = manifest(&env.home);
    assert_eq!(
        env.run().outcome,
        Outcome::NotApplicable("target-not-a-directory")
    );
    assert_eq!(manifest(&env.home), before);
}

#[test]
fn owner_shaped_home_moves_every_owned_entry_and_nothing_else() {
    let env = Env::owner_shaped();
    let before = manifest(&env.old());
    let owned = owned_in(&before);
    assert_eq!(owned.len(), 11, "the fixture holds every allow-listed name");

    let report = env.run();

    assert_eq!(report.outcome, Outcome::Migrated);
    assert!(report.skipped.is_empty(), "{:?}", report.skipped);
    let mut moved = report.moved.clone();
    moved.sort();
    let mut expected = owned.clone();
    expected.sort();
    assert_eq!(moved, expected);
    assert_moved_intact(&env, &before, &owned);

    // Entries that are not Colony's: byte, path and mode identical.
    let after = manifest(&env.old());
    for name in FOREIGN_TOP_LEVEL {
        assert_eq!(
            subtree(&after, name),
            subtree(&before, name),
            "{name} is not Colony's and must not change"
        );
    }
    assert_eq!(env.journal().phase, Phase::Done);
    assert!(!env.staging().exists());
    let mode = fs::metadata(env.new_dir()).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode, 0o700, "the new folder is owner-only");
    // History arrived whole.
    assert_eq!(archive_rows(&env.new_dir().join("archive")), DB_ROWS);
}

#[test]
fn after_the_move_the_new_folder_is_the_nest() {
    if crate::build_identity::is_demo_build() {
        return;
    }
    let env = Env::owner_shaped();
    assert_eq!(env.run().outcome, Outcome::Migrated);
    let choice = nest_folder::choose_nest_folder(&env.home, false);
    assert_eq!(choice.name, NEW);
    assert_eq!(
        choice.reason,
        nest_folder::NestFolderReason::BothColonyHasNest
    );
}

#[test]
fn a_second_run_is_a_no_op() {
    let env = Env::owner_shaped();
    assert_eq!(env.run().outcome, Outcome::Migrated);
    let home_before = manifest(&env.home);
    let state_before = manifest(&env.data);
    let journal_before = fs::read(env.journal_file()).unwrap();

    let report = env.run();

    assert_eq!(report.outcome, Outcome::AlreadyMigrated);
    assert_eq!(manifest(&env.home), home_before);
    assert_eq!(manifest(&env.data), state_before);
    assert_eq!(fs::read(env.journal_file()).unwrap(), journal_before);
}

#[test]
fn an_existing_nest_in_the_new_folder_wins_and_the_old_copy_stays() {
    let env = Env::owner_shaped();
    write(&env.new_dir().join("AGENTS.md"), b"colony nest");
    write(&env.new_dir().join(".nest-agents-version"), b"7\n");
    write(&env.new_dir().join("archive/archive.db"), b"colony history");
    let before_old = manifest(&env.old());
    let before_new = manifest(&env.new_dir());

    let report = env.run();

    assert_eq!(report.outcome, Outcome::Migrated);
    let mut skipped: Vec<&str> = report.skipped.iter().map(|(n, _)| n.as_str()).collect();
    skipped.sort_unstable();
    assert_eq!(
        skipped,
        vec![".nest-agents-version", "AGENTS.md", "archive"]
    );
    assert!(report.skipped.iter().all(|(_, why)| why == "target-exists"));
    // The destination is byte identical; the sources that lost never moved.
    let after_new = manifest(&env.new_dir());
    for name in ["AGENTS.md", ".nest-agents-version", "archive"] {
        assert_eq!(subtree(&after_new, name), subtree(&before_new, name));
    }
    assert_moved_intact(&env, &before_old, &report.moved);
    assert_eq!(report.moved.len(), 8);
}

#[test]
fn a_collision_in_a_new_folder_that_is_not_a_nest_moves_nothing() {
    let env = Env::owner_shaped();
    write(&env.new_dir().join("archive/other.db"), b"not ours");
    let before = manifest(&env.home);

    let report = env.run();

    assert_eq!(
        report.outcome,
        Outcome::Aborted("target-exists:archive".to_string())
    );
    assert_eq!(manifest(&env.home), before);
    assert!(!env.journal_file().exists(), "nothing was journaled");
    let notice = pending_notice(&env.state).expect("the person is told");
    assert_eq!(notice.key, "aborted:target-exists:archive");
}

#[test]
fn empty_placeholder_folders_in_the_new_folder_give_way_to_the_real_ones() {
    let env = Env::owner_shaped();
    for name in ["GUIDES", "RESEARCH", "REPOS"] {
        fs::create_dir_all(env.new_dir().join(name)).unwrap();
    }
    write(&env.new_dir().join("unrelated.txt"), b"keep");
    let before = manifest(&env.old());

    let report = env.run();

    assert_eq!(report.outcome, Outcome::Migrated);
    assert!(report.skipped.is_empty(), "{:?}", report.skipped);
    assert_moved_intact(&env, &before, &owned_in(&before));
    assert_eq!(
        fs::read(env.new_dir().join("unrelated.txt")).unwrap(),
        b"keep"
    );
}

#[test]
fn the_notice_is_shown_once_and_never_again() {
    let env = Env::owner_shaped();
    env.run();
    let notice = pending_notice(&env.state).expect("a finished move is announced");
    assert_eq!(notice.key, "migrated");
    acknowledge_notice(&env.state).unwrap();
    assert!(pending_notice(&env.state).is_none());
    env.run();
    assert!(pending_notice(&env.state).is_none());
}

#[test]
fn a_run_that_only_leaves_things_in_place_repeats_without_change_or_noise() {
    let env = Env::new();
    write(&env.old().join("RESEARCH/a.md"), b"old");
    write(&env.new_dir().join("RESEARCH/b.md"), b"new");
    write(&env.new_dir().join("AGENTS.md"), b"nest");
    let before = manifest(&env.home);

    let first = env.run();
    assert_eq!(first.outcome, Outcome::LeftInPlace);
    assert_eq!(
        first.skipped,
        vec![("RESEARCH".to_string(), "target-exists".to_string())]
    );
    let notice = pending_notice(&env.state).expect("the person is told once");
    assert_eq!(notice.key, "left:RESEARCH");
    acknowledge_notice(&env.state).unwrap();
    let state_before = manifest(&env.data);

    let second = env.run();

    assert_eq!(second.outcome, Outcome::LeftInPlace);
    assert_eq!(manifest(&env.home), before);
    assert_eq!(manifest(&env.data), state_before);
    assert!(pending_notice(&env.state).is_none());
}

#[test]
fn notices_never_name_the_old_folder_and_use_no_em_dash() {
    for message in [
        MSG_MIGRATED,
        MSG_MIGRATED_WITH_SKIPS,
        MSG_LEFT_IN_PLACE,
        MSG_ABORTED,
        MSG_FAILED,
    ] {
        assert!(!message.to_lowercase().contains("buzz"), "{message}");
        assert!(!message.contains('\u{2014}'), "{message}");
    }
}

#[test]
fn the_flag_reads_every_documented_spelling() {
    for on in ["1", "true", "TRUE", " on ", "yes"] {
        assert!(migration_enabled(Some(on)), "{on}");
    }
    for off in ["0", "false", "off", "No"] {
        assert!(!migration_enabled(Some(off)), "{off}");
    }
    for unknown in ["", "maybe", "2"] {
        assert_eq!(
            migration_enabled(Some(unknown)),
            DEFAULT_ENABLED,
            "{unknown}"
        );
    }
    assert_eq!(migration_enabled(None), DEFAULT_ENABLED);
}

#[test]
fn the_crash_seam_value_is_parsed_strictly() {
    assert_eq!(parse_crash_at("3:after"), Some((3, false)));
    assert_eq!(parse_crash_at(" 1 : before "), Some((1, true)));
    for bad in ["", "0:after", "x:after", "3", "3:during", "-1:after"] {
        assert_eq!(parse_crash_at(bad), None, "{bad}");
    }
}

#[test]
fn the_allow_list_is_closed_and_the_markers_move_last() {
    let order = plan_order();
    let names: Vec<&str> = order.iter().map(|(name, _)| *name).collect();
    let mut owned: Vec<&str> = owned_entries().collect();
    assert_eq!(names.len(), owned.len());
    owned.sort_unstable();
    let mut sorted = names.clone();
    sorted.sort_unstable();
    assert_eq!(sorted, owned);
    assert_eq!(
        &names[names.len() - 2..],
        &["AGENTS.md", ".nest-agents-version"]
    );
    for never in [
        ".scratch",
        ".agents",
        ".claude",
        ".codex",
        ".goose",
        ".venv-tts",
        ".venv-chatterbox",
    ] {
        assert!(!names.contains(&never), "{never} is not Colony's to move");
    }
    for (name, kind) in order {
        let expected = if name == "REPOS" || name == "models" {
            StepKind::BestEffort
        } else {
            StepKind::Atomic
        };
        assert_eq!(kind, expected, "{name}");
    }
}

#[test]
fn the_state_folder_sits_in_the_app_data_folder_not_in_the_home_folder() {
    let env = Env::new();
    assert_eq!(boot::state_dir(&env.data), env.data.join("nest-migration"));
    assert!(!boot::state_dir(&env.data).starts_with(&env.home));
}

#[test]
fn a_launch_only_has_work_when_there_is_an_old_folder_or_an_unfinished_run() {
    // Fresh install: nothing to look at.
    let env = Env::new();
    let skip = |env: &Env| boot::skip_reason(&env.home, OLD, &env.data, &env.state);
    assert_eq!(skip(&env), Some(boot::SKIP_NOTHING_TO_DO));
    // An old folder is work.
    fs::create_dir_all(env.old()).unwrap();
    assert_eq!(skip(&env), None);
    // So is an unfinished run, even if the old folder is gone.
    fs::remove_dir_all(env.old()).unwrap();
    write(&env.journal_file(), b"{}");
    assert_eq!(skip(&env), None);
}

#[test]
fn a_pending_reset_skips_the_migration_before_anything_is_read() {
    let env = Env::owner_shaped();
    crate::reset::write_sentinel(&env.data).unwrap();
    assert_eq!(
        boot::skip_reason(&env.home, OLD, &env.data, &env.state),
        Some(boot::SKIP_RESET_PENDING)
    );
}
