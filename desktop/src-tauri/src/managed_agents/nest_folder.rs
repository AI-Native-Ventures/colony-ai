//! Which folder is this install's agent home (the "nest").
//!
//! Production builds name the folder `~/.colony` for new installs. An install
//! that already has `~/.buzz` keeps using it. This module only reads the
//! filesystem: it never creates, moves, renames or deletes anything. Moving an
//! existing `.buzz` folder over to `.colony` is a separate, gated change.
//!
//! # Rule
//!
//! | `~/.colony`          | `~/.buzz`                  | chosen    | reason                       |
//! |----------------------|----------------------------|-----------|------------------------------|
//! | absent               | absent                     | `.colony` | `fresh-install`              |
//! | present              | absent                     | `.colony` | `colony-folder-only`         |
//! | absent               | holds Colony data          | `.buzz`   | `legacy-folder-kept`         |
//! | absent               | foreign entries only       | `.colony` | `legacy-folder-foreign-only` |
//! | present, has a nest  | present                    | `.colony` | `both-colony-has-nest`       |
//! | present, no nest     | holds Colony data          | `.buzz`   | `both-legacy-kept`           |
//! | present, no nest     | foreign entries only       | `.colony` | `legacy-folder-foreign-only` |
//!
//! "Colony data" is any entry on the migration allow-list
//! (`nest_migration::owned_entries`). A `~/.buzz` that holds only things Colony
//! never wrote (other tools' environments, loose notes), as it does after a
//! migration or a Reset, must not capture a new install.
//!
//! Dev and demo builds were always namespaced (`.buzz-dev`, `.buzz-demo-<slug>`)
//! and are never probed (`build-scoped`).
//!
//! "Has a nest" means the folder holds one of [`NEST_MARKERS`], written by
//! `ensure_nest` on first init. A `.colony` that holds a nest always wins, so a
//! stray empty `.buzz` (for example from running an older build once) can never
//! pull a working install back. A `.colony` without a nest never wins over an
//! existing `.buzz`, so an unrelated `~/.colony` cannot strand an old install.
//!
//! # Paths that follow the chosen folder, and paths that stay
//!
//! Follow the chosen folder (they all derive from `nest_dir()`): the agent
//! working directory, `REPOS`, the archive database, `models/` (huddle voice
//! models), the nest `AGENTS.md` and generated skills, the Files tab root, and
//! Reset (it wipes exactly `nest_dir()`).
//!
//! Stay as they are, on purpose:
//! - `migration::migrate_dev_nest` and the dev `.repos-dir` import read the
//!   shared `~/.buzz` of an installed pre-namespacing app. That source is
//!   legacy by definition and only dev builds import it.
//! - `huddle/latency_bench.rs` is an ignored ad-hoc benchmark that points at a
//!   developer's own `~/.buzz/models`.
//! - The read-only `REPOS` fallback used to find already-cloned repositories
//!   searches every production name (see
//!   `build_identity::production_nest_names`), not just the chosen one.
//!
//! The choice is made once per process in `init_nest_dir`, before anything is
//! created, and logged on one line a packaged-app harness can grep (see
//! [`NestFolderChoice::log_line`]).

use std::borrow::Cow;
use std::io;
use std::path::{Path, PathBuf};

/// Files whose presence marks a folder as an initialised Colony nest. Either one
/// is enough, so a run that stopped between the two writes still counts.
const NEST_MARKERS: [&str; 2] = [".nest-agents-version", "AGENTS.md"];

/// Stable prefix of the one-line record of the choice.
pub(crate) const LOG_PREFIX: &str = "buzz-desktop: nest-folder:";

/// Why a folder was chosen. The kebab-case strings are part of the log line a
/// packaged-app harness reads, so changing one is a harness change.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum NestFolderReason {
    /// Dev and demo builds have a fixed, namespaced folder; nothing is probed.
    BuildScoped,
    /// Neither folder exists: a new install takes the new name.
    FreshInstall,
    /// Only the new folder exists.
    ColonyFolderOnly,
    /// Only the legacy folder exists: an existing install keeps it.
    LegacyFolderKept,
    /// Both exist and the new folder already holds a nest.
    BothColonyHasNest,
    /// Both exist but the new folder holds no nest: the legacy one is kept.
    BothLegacyKept,
    /// The legacy folder holds only things Colony never wrote, so it cannot be
    /// an install's nest and does not capture this one.
    LegacyFolderForeignOnly,
}

impl NestFolderReason {
    /// Stable kebab-case spelling used in the log line.
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::BuildScoped => "build-scoped",
            Self::FreshInstall => "fresh-install",
            Self::ColonyFolderOnly => "colony-folder-only",
            Self::LegacyFolderKept => "legacy-folder-kept",
            Self::BothColonyHasNest => "both-colony-has-nest",
            Self::BothLegacyKept => "both-legacy-kept",
            Self::LegacyFolderForeignOnly => "legacy-folder-foreign-only",
        }
    }
}

/// The folder name chosen for this process and the reason it was chosen.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct NestFolderChoice {
    pub(crate) name: Cow<'static, str>,
    pub(crate) reason: NestFolderReason,
}

impl NestFolderChoice {
    /// One greppable line: `<prefix> chosen=<name> reason=<reason> path=<abs>`.
    /// `path=` comes last because the home folder may contain spaces.
    pub(crate) fn log_line(&self, home: &Path) -> String {
        format!(
            "{LOG_PREFIX} chosen={} reason={} path={}",
            self.name,
            self.reason.as_str(),
            home.join(self.name.as_ref()).display()
        )
    }
}

/// What the filesystem says about one candidate folder.
enum Presence {
    Absent,
    Present {
        /// Holds one of [`NEST_MARKERS`].
        holds_nest: bool,
        /// Holds any Colony-owned entry (see `nest_migration::owned_entries`).
        holds_data: bool,
    },
}

/// True when `folder` holds one of [`NEST_MARKERS`].
pub(crate) fn holds_nest_marker(folder: &Path) -> bool {
    NEST_MARKERS
        .iter()
        .any(|marker| folder.join(marker).symlink_metadata().is_ok())
}

fn probe(folder: &Path) -> Presence {
    match folder.symlink_metadata() {
        Err(error) if error.kind() == io::ErrorKind::NotFound => Presence::Absent,
        // Present but unreadable, or a symlink that may point at data we cannot
        // see: guessing "no data" could pick a new folder next to data this
        // install already has.
        Err(_) => Presence::Present {
            holds_nest: false,
            holds_data: true,
        },
        Ok(meta) if meta.file_type().is_symlink() => Presence::Present {
            holds_nest: holds_nest_marker(folder),
            holds_data: true,
        },
        Ok(_) => Presence::Present {
            holds_nest: holds_nest_marker(folder),
            holds_data: super::nest_migration::holds_colony_data(folder),
        },
    }
}

/// Choose this build's nest folder under `home`. Read-only.
pub(crate) fn choose_nest_folder(home: &Path, is_dev: bool) -> NestFolderChoice {
    choose_nest_folder_for(
        home,
        crate::build_identity::nest_name(is_dev),
        crate::build_identity::legacy_nest_name(is_dev),
    )
}

/// The nest path under `home` for this build, plus the choice behind it.
/// `init_nest_dir` and the uninitialised `nest_dir` fallback both go through
/// here, so the folder a process uses is always the one that was logged.
pub(crate) fn resolve_nest_dir(home: &Path, is_dev: bool) -> (PathBuf, NestFolderChoice) {
    let choice = choose_nest_folder(home, is_dev);
    (home.join(choice.name.as_ref()), choice)
}

fn choose_nest_folder_for(
    home: &Path,
    preferred: Cow<'static, str>,
    legacy: Option<&'static str>,
) -> NestFolderChoice {
    let Some(legacy) = legacy else {
        return NestFolderChoice {
            name: preferred,
            reason: NestFolderReason::BuildScoped,
        };
    };
    let preferred_state = probe(&home.join(preferred.as_ref()));
    let legacy_state = probe(&home.join(legacy));
    let (name, reason) = match (preferred_state, legacy_state) {
        (Presence::Absent, Presence::Absent) => (preferred, NestFolderReason::FreshInstall),
        (Presence::Present { .. }, Presence::Absent) => {
            (preferred, NestFolderReason::ColonyFolderOnly)
        }
        (
            Presence::Present {
                holds_nest: true, ..
            },
            Presence::Present { .. },
        ) => (preferred, NestFolderReason::BothColonyHasNest),
        (
            _,
            Presence::Present {
                holds_data: false, ..
            },
        ) => (preferred, NestFolderReason::LegacyFolderForeignOnly),
        (Presence::Absent, Presence::Present { .. }) => {
            (Cow::Borrowed(legacy), NestFolderReason::LegacyFolderKept)
        }
        (
            Presence::Present {
                holds_nest: false, ..
            },
            Presence::Present { .. },
        ) => (Cow::Borrowed(legacy), NestFolderReason::BothLegacyKept),
    };
    NestFolderChoice { name, reason }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    const NEW: &str = ".colony";
    const OLD: &str = ".buzz";

    fn choose(home: &Path) -> NestFolderChoice {
        choose_nest_folder_for(home, Cow::Borrowed(NEW), Some(OLD))
    }

    fn assert_chose(home: &Path, name: &str, reason: NestFolderReason) {
        let choice = choose(home);
        assert_eq!(
            (&*choice.name, choice.reason),
            (name, reason),
            "unexpected choice for {home:?}"
        );
    }

    /// Every entry under `root` with its size, sorted, so a test can prove a
    /// call left a real directory tree exactly as it found it.
    fn tree(root: &Path) -> Vec<(PathBuf, u64)> {
        fn walk(dir: &Path, out: &mut Vec<(PathBuf, u64)>) {
            let mut entries: Vec<_> = fs::read_dir(dir)
                .expect("read dir")
                .map(|entry| entry.expect("entry").path())
                .collect();
            entries.sort();
            for path in entries {
                let meta = fs::symlink_metadata(&path).expect("metadata");
                out.push((path.clone(), meta.len()));
                if meta.is_dir() {
                    walk(&path, out);
                }
            }
        }
        let mut out = Vec::new();
        walk(root, &mut out);
        out
    }

    fn seed_nest(folder: &Path) {
        fs::create_dir_all(folder.join("RESEARCH")).unwrap();
        fs::write(folder.join("AGENTS.md"), "nest").unwrap();
        fs::write(folder.join(".nest-agents-version"), "6").unwrap();
    }

    #[test]
    fn no_folder_exists_new_install_takes_the_new_name() {
        let home = TempDir::new().unwrap();
        assert_chose(home.path(), NEW, NestFolderReason::FreshInstall);
    }

    #[test]
    fn only_legacy_folder_exists_it_is_kept() {
        let home = TempDir::new().unwrap();
        seed_nest(&home.path().join(OLD));
        assert_chose(home.path(), OLD, NestFolderReason::LegacyFolderKept);
    }

    #[test]
    fn empty_legacy_folder_does_not_capture_a_new_install() {
        // An empty `.buzz` holds nothing of Colony's, so it cannot be an
        // install's nest. Keeping it would pin a fresh install to the old name.
        let home = TempDir::new().unwrap();
        fs::create_dir(home.path().join(OLD)).unwrap();
        assert_chose(home.path(), NEW, NestFolderReason::LegacyFolderForeignOnly);
    }

    #[test]
    fn legacy_folder_with_only_foreign_entries_does_not_capture_a_new_install() {
        // What is left after a migration or a Reset: other tools' folders.
        let home = TempDir::new().unwrap();
        fs::create_dir_all(home.path().join(OLD).join(".venv-tts")).unwrap();
        fs::write(home.path().join(OLD).join("notes.md"), "mine").unwrap();
        assert_chose(home.path(), NEW, NestFolderReason::LegacyFolderForeignOnly);
        // The same holds when an unrelated `.colony` is already there.
        fs::create_dir(home.path().join(NEW)).unwrap();
        assert_chose(home.path(), NEW, NestFolderReason::LegacyFolderForeignOnly);
    }

    #[test]
    fn any_owned_entry_makes_the_legacy_folder_an_install() {
        for name in crate::managed_agents::nest_migration::owned_entries() {
            let home = TempDir::new().unwrap();
            fs::create_dir_all(home.path().join(OLD).join(name)).unwrap();
            assert_chose(home.path(), OLD, NestFolderReason::LegacyFolderKept);
        }
    }

    #[test]
    fn only_new_folder_exists_it_is_used() {
        let home = TempDir::new().unwrap();
        seed_nest(&home.path().join(NEW));
        assert_chose(home.path(), NEW, NestFolderReason::ColonyFolderOnly);
    }

    #[test]
    fn empty_new_folder_alone_is_used() {
        let home = TempDir::new().unwrap();
        fs::create_dir(home.path().join(NEW)).unwrap();
        assert_chose(home.path(), NEW, NestFolderReason::ColonyFolderOnly);
    }

    #[test]
    fn both_exist_and_new_holds_a_nest_new_wins() {
        let home = TempDir::new().unwrap();
        seed_nest(&home.path().join(NEW));
        fs::create_dir(home.path().join(OLD)).unwrap();
        assert_chose(home.path(), NEW, NestFolderReason::BothColonyHasNest);
    }

    #[test]
    fn both_exist_either_marker_alone_marks_a_nest() {
        for marker in NEST_MARKERS {
            let home = TempDir::new().unwrap();
            fs::create_dir_all(home.path().join(NEW)).unwrap();
            fs::write(home.path().join(NEW).join(marker), "x").unwrap();
            seed_nest(&home.path().join(OLD));
            assert_chose(home.path(), NEW, NestFolderReason::BothColonyHasNest);
        }
    }

    #[test]
    fn both_exist_and_new_holds_no_nest_legacy_is_kept() {
        let home = TempDir::new().unwrap();
        fs::create_dir_all(home.path().join(NEW).join("unrelated")).unwrap();
        seed_nest(&home.path().join(OLD));
        assert_chose(home.path(), OLD, NestFolderReason::BothLegacyKept);
    }

    #[test]
    fn a_marker_in_the_legacy_folder_never_makes_the_new_folder_win() {
        let home = TempDir::new().unwrap();
        fs::create_dir(home.path().join(NEW)).unwrap();
        seed_nest(&home.path().join(OLD));
        assert_chose(home.path(), OLD, NestFolderReason::BothLegacyKept);
    }

    #[cfg(unix)]
    #[test]
    fn a_dangling_legacy_symlink_still_counts_as_present() {
        // An old install may point `.buzz` somewhere that is gone for now.
        // Choosing a fresh folder would hide it, so it stays "present".
        let home = TempDir::new().unwrap();
        std::os::unix::fs::symlink(home.path().join("gone"), home.path().join(OLD)).unwrap();
        assert_chose(home.path(), OLD, NestFolderReason::LegacyFolderKept);
    }

    #[test]
    fn dev_and_demo_builds_are_never_probed() {
        let home = TempDir::new().unwrap();
        // Even with both production folders present, a namespaced build keeps
        // its own folder.
        seed_nest(&home.path().join(NEW));
        seed_nest(&home.path().join(OLD));
        for name in [".buzz-dev", ".buzz-demo-board-1234567812345678"] {
            let choice = choose_nest_folder_for(home.path(), Cow::Owned(name.to_string()), None);
            assert_eq!(choice.name, name);
            assert_eq!(choice.reason, NestFolderReason::BuildScoped);
        }
    }

    #[test]
    fn choosing_never_creates_moves_or_deletes_anything() {
        let cases: [(&[&str], &[&str]); 4] = [
            (&[], &[]),
            (&[OLD], &[]),
            (&[], &[NEW]),
            (&[OLD, NEW], &[OLD, NEW]),
        ];
        for (plain, nests) in cases {
            let home = TempDir::new().unwrap();
            for name in plain {
                fs::create_dir_all(home.path().join(name).join("foreign-tool")).unwrap();
            }
            for name in nests {
                seed_nest(&home.path().join(name));
            }
            fs::write(home.path().join("unrelated.txt"), "keep").unwrap();
            let before = tree(home.path());

            let _ = choose(home.path());
            let _ = choose(home.path());

            assert_eq!(
                tree(home.path()),
                before,
                "choose changed {plain:?}/{nests:?}"
            );
        }
    }

    #[test]
    fn the_choice_is_stable_across_calls() {
        let home = TempDir::new().unwrap();
        let first = choose(home.path());
        // Choosing does not create the folder, so a second call on the same
        // untouched home must agree. Once ensure_nest creates the folder with a
        // marker, the same name is chosen again via `colony-folder-only`.
        assert_eq!(choose(home.path()), first);
        seed_nest(&home.path().join(first.name.as_ref()));
        let after_create = choose(home.path());
        assert_eq!(after_create.name, first.name);
        assert_eq!(after_create.reason, NestFolderReason::ColonyFolderOnly);
    }

    #[test]
    fn log_line_is_one_stable_greppable_line() {
        let home = PathBuf::from("/tmp/seeded home");
        let fresh = NestFolderChoice {
            name: Cow::Borrowed(NEW),
            reason: NestFolderReason::FreshInstall,
        };
        // The path is built with `join`, so the separator is the platform's.
        assert_eq!(
            fresh.log_line(&home),
            format!(
                "buzz-desktop: nest-folder: chosen=.colony reason=fresh-install path={}",
                home.join(".colony").display()
            )
        );
        let kept = NestFolderChoice {
            name: Cow::Borrowed(OLD),
            reason: NestFolderReason::LegacyFolderKept,
        };
        assert_eq!(
            kept.log_line(&home),
            format!(
                "buzz-desktop: nest-folder: chosen=.buzz reason=legacy-folder-kept path={}",
                home.join(".buzz").display()
            )
        );
        assert!(fresh.log_line(&home).starts_with(LOG_PREFIX));
        assert!(!fresh.log_line(&home).contains('\n'));
    }

    #[test]
    fn every_reason_has_a_distinct_log_spelling() {
        let all = [
            NestFolderReason::BuildScoped,
            NestFolderReason::FreshInstall,
            NestFolderReason::ColonyFolderOnly,
            NestFolderReason::LegacyFolderKept,
            NestFolderReason::BothColonyHasNest,
            NestFolderReason::BothLegacyKept,
            NestFolderReason::LegacyFolderForeignOnly,
        ];
        let mut spellings: Vec<_> = all.iter().map(|reason| reason.as_str()).collect();
        spellings.sort_unstable();
        spellings.dedup();
        assert_eq!(spellings.len(), all.len());
    }

    #[test]
    fn resolve_nest_dir_joins_the_chosen_name_under_home() {
        if crate::build_identity::is_demo_build() {
            return;
        }
        let home = TempDir::new().unwrap();
        let (path, choice) = resolve_nest_dir(home.path(), false);
        assert_eq!(path, home.path().join(".colony"));
        assert_eq!(choice.reason, NestFolderReason::FreshInstall);

        seed_nest(&home.path().join(".buzz"));
        let (path, choice) = resolve_nest_dir(home.path(), false);
        assert_eq!(path, home.path().join(".buzz"));
        assert_eq!(choice.reason, NestFolderReason::LegacyFolderKept);
        // The log line names the very folder the path points at.
        assert!(choice
            .log_line(home.path())
            .ends_with(&format!("path={}", path.display())));

        let (dev_path, _) = resolve_nest_dir(home.path(), true);
        assert_eq!(dev_path, home.path().join(".buzz-dev"));
    }

    #[test]
    fn production_identity_chooses_between_colony_and_buzz() {
        if crate::build_identity::is_demo_build() {
            return;
        }
        let home = TempDir::new().unwrap();
        assert_eq!(choose_nest_folder(home.path(), false).name, ".colony");
        seed_nest(&home.path().join(".buzz"));
        assert_eq!(choose_nest_folder(home.path(), false).name, ".buzz");
        // A dev build ignores both production folders.
        let dev = choose_nest_folder(home.path(), true);
        assert_eq!(dev.name, ".buzz-dev");
        assert_eq!(dev.reason, NestFolderReason::BuildScoped);
    }
}
