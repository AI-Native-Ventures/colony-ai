//! Fault-injection tests for the nest migration. Every test builds a real
//! throwaway home folder and runs the real code against it: nothing is mocked
//! except the two mutating operations behind [`Fs`], which tests fail or
//! interrupt on purpose. No test touches the real home folder.

use super::*;
use sha2::{Digest as _, Sha256};
use std::cell::RefCell;
use std::collections::BTreeMap;
use std::os::unix::fs::{symlink, PermissionsExt};
use std::panic::{self, AssertUnwindSafe};
use tempfile::TempDir;

mod agents;
mod basics;
mod crash;
mod faults;
mod links;
mod markers;
mod wipe;

pub(super) const OLD: &str = ".buzz";
pub(super) const NEW: &str = ".colony";
pub(super) const INSTANCE: &str = "xyz.block.buzz.app";
pub(super) const DB_ROWS: i64 = 40;

/// A throwaway home folder plus the app-data folder holding the journal.
pub(super) struct Env {
    _tmp: TempDir,
    pub(super) home: PathBuf,
    pub(super) data: PathBuf,
    pub(super) state: PathBuf,
}

impl Env {
    pub(super) fn new() -> Self {
        let tmp = TempDir::new().unwrap();
        let home = tmp.path().join("home");
        let data = tmp.path().join("app-data");
        fs::create_dir_all(&home).unwrap();
        fs::create_dir_all(&data).unwrap();
        Self {
            state: data.join(STATE_DIR),
            home,
            data,
            _tmp: tmp,
        }
    }

    /// A home seeded like an existing install's.
    pub(super) fn owner_shaped() -> Self {
        let env = Self::new();
        seed_owner_shaped(&env.home);
        env
    }

    pub(super) fn old(&self) -> PathBuf {
        self.home.join(OLD)
    }

    pub(super) fn new_dir(&self) -> PathBuf {
        self.home.join(NEW)
    }

    pub(super) fn staging(&self) -> PathBuf {
        self.home.join(format!("{NEW}.staging"))
    }

    pub(super) fn journal_file(&self) -> PathBuf {
        self.state.join(journal::JOURNAL_FILE)
    }

    pub(super) fn input<'a>(&'a self, enabled: bool, agents: &'a [u32]) -> MigrationInput<'a> {
        MigrationInput {
            home: &self.home,
            journal_dir: &self.state,
            from_name: OLD,
            to_name: NEW,
            enabled,
            live_agent_pids: agents,
            unreadable_agent_records: 0,
        }
    }

    pub(super) fn run(&self) -> Report {
        run_migration(&self.input(true, &[]), &RealFs)
    }

    pub(super) fn run_with(&self, fs_ops: &dyn Fs) -> Report {
        run_migration(&self.input(true, &[]), fs_ops)
    }

    pub(super) fn run_disabled(&self) -> Report {
        run_migration(&self.input(false, &[]), &RealFs)
    }

    pub(super) fn journal(&self) -> Journal {
        match journal::load(&self.state) {
            Loaded::Valid(journal) => *journal,
            _ => panic!("no valid journal in {}", self.state.display()),
        }
    }

    /// How many of old, staging and new hold `name`.
    pub(super) fn locations(&self, name: &str) -> usize {
        [self.old(), self.staging(), self.new_dir()]
            .iter()
            .filter(|root| entry_exists(&root.join(name)))
            .count()
    }
}

pub(super) fn write(path: &Path, bytes: &[u8]) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, bytes).unwrap();
}

pub(super) fn write_mode(path: &Path, bytes: &[u8], mode: u32) {
    write(path, bytes);
    fs::set_permissions(path, fs::Permissions::from_mode(mode)).unwrap();
}

/// A genuine WAL-mode SQLite database whose committed rows live only in the
/// `-wal` file, laid out the way a crashed app leaves it: `archive.db`,
/// `archive.db-wal` and `archive.db-shm` together.
pub(super) fn seed_wal_archive(dir: &Path) {
    let live = TempDir::new().unwrap();
    let live_db = live.path().join("archive.db");
    let conn = rusqlite::Connection::open(live_db).unwrap();
    let _mode: String = conn
        .query_row("PRAGMA journal_mode = WAL", [], |row| row.get(0))
        .unwrap();
    // Far fewer pages than the default auto-checkpoint threshold, so every row
    // stays in the -wal file.
    conn.execute(
        "CREATE TABLE history (id INTEGER PRIMARY KEY, body TEXT)",
        [],
    )
    .unwrap();
    for i in 0..DB_ROWS {
        conn.execute(
            "INSERT INTO history (body) VALUES (?1)",
            rusqlite::params![format!("message {i}")],
        )
        .unwrap();
    }
    // Snapshot the trio while the connection is still open.
    fs::create_dir_all(dir).unwrap();
    for suffix in ["", "-wal", "-shm"] {
        let name = format!("archive.db{suffix}");
        fs::copy(live.path().join(&name), dir.join(&name)).unwrap();
    }
    drop(conn);
    assert!(
        fs::metadata(dir.join("archive.db-wal")).unwrap().len() > 0,
        "the fixture must really carry rows in the -wal file"
    );
}

/// Row count of the archive database in `dir`, replaying its `-wal` file.
pub(super) fn archive_rows(dir: &Path) -> i64 {
    let conn = rusqlite::Connection::open(dir.join("archive.db")).unwrap();
    conn.query_row("SELECT COUNT(*) FROM history", [], |row| row.get(0))
        .unwrap()
}

/// Names of the top-level entries that are not Colony's: they must come out of
/// any migration or Reset exactly as they went in.
pub(super) const FOREIGN_TOP_LEVEL: [&str; 5] = [
    ".venv-tts",
    ".venv-chatterbox",
    ".scratch",
    "gate-check.md",
    "notes.md",
];

/// Everything an install's `~/.buzz` holds: the Colony-owned entries, the
/// generated skill links, and entries that are not Colony's.
pub(super) fn seed_owner_shaped(home: &Path) {
    let old = home.join(OLD);
    // The person's own checkouts, outside both folders.
    let dev = home.join("Development");
    write(&dev.join("tools/README.md"), b"external repos");

    write(
        &old.join("AGENTS.md"),
        b"# Nest\nstatic\n<!-- BEGIN BUZZ MANAGED -->\nmanaged\n<!-- END BUZZ MANAGED -->\nmine\n",
    );
    write(&old.join(".nest-agents-version"), b"6\n");
    write(&old.join("GUIDES/guide.md"), b"guide");
    write(&old.join("RESEARCH/market.md"), b"market notes");
    write(&old.join("RESEARCH/deep/more.md"), b"more");
    write(&old.join("PLANS/plan.md"), b"plan");
    write(&old.join("WORK_LOGS/log.md"), b"log");
    write(&old.join("OUTBOX/draft.md"), b"draft");
    seed_wal_archive(&old.join("archive"));
    write(
        &old.join(".repos-dir"),
        format!("{}\n", dev.display()).as_bytes(),
    );
    write(&old.join("REPOS/proj/README.md"), b"proj");
    write(&old.join("REPOS/proj/.git/HEAD"), b"ref: refs/heads/main\n");
    // Relative link that stays inside REPOS, absolute link that leaves the home
    // folder's old nest.
    symlink("proj", old.join("REPOS/rel")).unwrap();
    symlink(dev.join("tools"), old.join("REPOS/ext")).unwrap();
    write(&old.join("models/stt/model.bin"), &[7u8; 4096]);

    // Generated skill entries: links in folders shared with other tools.
    write(&old.join(".agents/skills/buzz-cli/SKILL.md"), b"skill");
    for harness in [".claude", ".codex", ".goose"] {
        fs::create_dir_all(old.join(harness).join("skills")).unwrap();
        symlink(
            "../../.agents/skills/buzz-cli",
            old.join(harness).join("skills/buzz-cli"),
        )
        .unwrap();
    }
    // Another tool's file sitting next to the generated links.
    write(&old.join(".claude/settings.local.json"), b"{\"a\":1}");

    // Entries Colony never wrote.
    let venv = old.join(".venv-tts");
    write_mode(
        &venv.join("bin/python"),
        format!("#!{}/bin/python3\n", venv.display()).as_bytes(),
        0o755,
    );
    write(
        &venv.join("pyvenv.cfg"),
        format!("home = {}\n", venv.display()).as_bytes(),
    );
    let chatter = old.join(".venv-chatterbox");
    write(
        &chatter.join("bin/activate"),
        format!("VIRTUAL_ENV={}\n", chatter.display()).as_bytes(),
    );
    write(&old.join(".scratch/tmp.txt"), b"scratch");
    write(&old.join("gate-check.md"), b"written by an agent");
    write_mode(&old.join("notes.md"), b"private", 0o600);
}

/// One manifest entry: what a file is, byte for byte, plus its mode.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum Item {
    File { mode: u32, sha: String },
    Dir { mode: u32 },
    Link { target: PathBuf },
}

/// Every path under `root` (relative), with kind, mode, content hash or link
/// target. Links are recorded, never followed.
pub(super) fn manifest(root: &Path) -> BTreeMap<PathBuf, Item> {
    fn walk(root: &Path, dir: &Path, out: &mut BTreeMap<PathBuf, Item>) {
        let mut entries: Vec<PathBuf> = fs::read_dir(dir)
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .collect();
        entries.sort();
        for path in entries {
            let meta = fs::symlink_metadata(&path).unwrap();
            let rel = path.strip_prefix(root).unwrap().to_path_buf();
            let mode = meta.permissions().mode() & 0o7777;
            if meta.file_type().is_symlink() {
                out.insert(
                    rel,
                    Item::Link {
                        target: fs::read_link(&path).unwrap(),
                    },
                );
            } else if meta.is_dir() {
                out.insert(rel, Item::Dir { mode });
                walk(root, &path, out);
            } else {
                let bytes = fs::read(&path).unwrap();
                out.insert(
                    rel,
                    Item::File {
                        mode,
                        sha: hex::encode(Sha256::digest(&bytes)),
                    },
                );
            }
        }
    }
    let mut out = BTreeMap::new();
    if fs::symlink_metadata(root).is_ok() {
        walk(root, root, &mut out);
    }
    out
}

/// The part of a manifest under one top-level name, with the name stripped
/// (the entry itself is the empty path).
pub(super) fn subtree(m: &BTreeMap<PathBuf, Item>, name: &str) -> BTreeMap<PathBuf, Item> {
    m.iter()
        .filter_map(|(path, item)| {
            path.strip_prefix(name)
                .ok()
                .map(|rest| (rest.to_path_buf(), item.clone()))
        })
        .collect()
}

pub(super) fn top_name(path: &Path) -> String {
    path.components()
        .next()
        .unwrap()
        .as_os_str()
        .to_string_lossy()
        .into_owned()
}

/// Colony-owned top-level names present in a manifest.
pub(super) fn owned_in(m: &BTreeMap<PathBuf, Item>) -> Vec<String> {
    owned_entries()
        .filter(|name| m.contains_key(Path::new(name)))
        .map(str::to_string)
        .collect()
}

/// After a run that moved `moved`: each moved tree is byte, path and mode
/// identical in the new folder and gone from the old one; everything else in
/// the old folder is exactly as it was and nothing new appeared there.
pub(super) fn assert_moved_intact(env: &Env, before: &BTreeMap<PathBuf, Item>, moved: &[String]) {
    let after_old = manifest(&env.old());
    let after_new = manifest(&env.new_dir());
    for name in moved {
        assert_eq!(
            subtree(&after_new, name),
            subtree(before, name),
            "{name} changed while moving"
        );
        assert!(
            !after_old.contains_key(Path::new(name)),
            "{name} is still in the old folder"
        );
    }
    for (path, item) in before {
        if moved.contains(&top_name(path)) {
            continue;
        }
        assert_eq!(
            after_old.get(path),
            Some(item),
            "{path:?} changed in the old folder"
        );
    }
    for path in after_old.keys() {
        assert!(
            before.contains_key(path),
            "{path:?} appeared in the old folder"
        );
    }
}

/// A crash that unwinds the test instead of ending the process.
pub(super) struct SimulatedCrash;

pub(super) fn simulated_crash() -> ! {
    panic::resume_unwind(Box::new(SimulatedCrash))
}

/// Run until the `at`-th operation is hit (before or after it), as if the app
/// died there. `true` when the run was cut short.
pub(super) fn run_until_crash(env: &Env, at: usize, before: bool) -> bool {
    let fs_ops = CrashAtFs::new(at, before, simulated_crash);
    match panic::catch_unwind(AssertUnwindSafe(|| env.run_with(&fs_ops))) {
        Ok(_) => false,
        Err(payload) => {
            assert!(payload.is::<SimulatedCrash>(), "unexpected panic");
            true
        }
    }
}

/// How many filesystem operations a clean run of `env` performs.
pub(super) fn count_operations(env: &Env) -> usize {
    let counter = CrashAtFs::new(usize::MAX, false, simulated_crash);
    let report = env.run_with(&counter);
    assert_eq!(report.outcome, Outcome::Migrated);
    counter.ops.get()
}

/// Picks the renames that fail: `Some(error)` for `(from, to)` makes it fail.
pub(super) type RenameRule = Box<dyn Fn(&Path, &Path) -> Option<io::Error>>;

/// Fails the renames and directory creations a rule selects; everything else is
/// the real filesystem.
pub(super) struct FailFs {
    pub(super) rename_error: RenameRule,
    pub(super) create_dir_error: bool,
}

impl FailFs {
    pub(super) fn on_rename(rule: impl Fn(&Path, &Path) -> Option<io::Error> + 'static) -> Self {
        Self {
            rename_error: Box::new(rule),
            create_dir_error: false,
        }
    }
}

impl Fs for FailFs {
    fn create_dir(&self, path: &Path) -> io::Result<()> {
        if self.create_dir_error {
            return Err(io::Error::from_raw_os_error(13));
        }
        RealFs.create_dir(path)
    }

    fn rename(&self, from: &Path, to: &Path) -> io::Result<()> {
        if let Some(error) = (self.rename_error)(from, to) {
            return Err(error);
        }
        RealFs.rename(from, to)
    }
}

/// A rename from the old folder into the staging folder of the entry `name`
/// fails the way moving across volumes does (EXDEV).
pub(super) fn exdev_when_staging(name: &'static str) -> FailFs {
    FailFs::on_rename(move |from, to| {
        let into_staging = to
            .parent()
            .and_then(Path::file_name)
            .is_some_and(|dir| dir.to_string_lossy().ends_with(".staging"));
        let is_entry = from.file_name().is_some_and(|n| n == name);
        (into_staging && is_entry).then(|| io::Error::from_raw_os_error(18))
    })
}

pub(super) fn is_staging_path(path: &Path) -> bool {
    path.file_name()
        .is_some_and(|name| name.to_string_lossy().ends_with(".staging"))
}

/// Checks, at the instant of every rename, that the journal already says the
/// move is coming. This is the journal-before-move rule, enforced per operation.
pub(super) struct JournalFirstFs<'a> {
    pub(super) state: &'a Path,
    pub(super) renames: RefCell<Vec<String>>,
}

impl Fs for JournalFirstFs<'_> {
    fn create_dir(&self, path: &Path) -> io::Result<()> {
        RealFs.create_dir(path)
    }

    fn rename(&self, from: &Path, to: &Path) -> io::Result<()> {
        let journal = match journal::load(self.state) {
            Loaded::Valid(journal) => *journal,
            _ => panic!("rename {from:?} -> {to:?} happened without a journal"),
        };
        let name = from.file_name().unwrap().to_string_lossy().into_owned();
        self.renames.borrow_mut().push(name.clone());
        if journal.phase == Phase::RollingBack {
            return RealFs.rename(from, to);
        }
        if is_staging_path(from) {
            // The whole-folder publish.
            assert!(
                journal.publish_whole && journal.phase == Phase::Publishing,
                "whole-folder publish without a journaled intent"
            );
        } else {
            let step = journal
                .steps
                .iter()
                .find(|step| step.name == name)
                .unwrap_or_else(|| panic!("{name} moved but is not in the journal"));
            let expected = if to.parent().is_some_and(is_staging_path) {
                StepStatus::Moving
            } else {
                StepStatus::Publishing
            };
            assert_eq!(
                step.status, expected,
                "{name} was renamed before its intent was journaled"
            );
        }
        RealFs.rename(from, to)
    }
}
