//! Moves an existing install's agent home from `~/.buzz` to `~/.colony`.
//!
//! New installs start on `~/.colony` (see [`super::nest_folder`]). An install
//! that already has `~/.buzz` keeps using it until this module moves it. The
//! old folder also holds things Colony never wrote (other tools' virtual
//! environments, scratch folders, loose notes), so this is not a folder rename:
//! it is a closed allow-list of Colony-owned names, moved one by one.
//!
//! # Rules
//!
//! * **Move only.** Each allow-listed entry is renamed within the home folder,
//!   which is atomic and instant on one volume. Nothing is copied, nothing is
//!   deleted, nothing off the list is touched. A name that cannot be renamed is
//!   left where it is.
//! * **Journal first.** Before each rename the intent is written durably (see
//!   [`journal`]). A run that stops anywhere resumes from the real folders, or
//!   is rolled back by renaming entries home again.
//! * **Stage, then publish.** Entries are renamed into `~/.colony.staging`
//!   first. When all of them are there, the staging folder is renamed to
//!   `~/.colony` in one step. If `~/.colony` already exists, staged entries are
//!   renamed into it one at a time, and the two files that mark a nest
//!   (`AGENTS.md`, `.nest-agents-version`) go last.
//! * **All or nothing for the small, stateful set** (history, knowledge,
//!   markers): one failure sends every moved entry home and the old folder stays
//!   the nest for this launch. **Best effort for the big set** (`REPOS`,
//!   `models`): a failure leaves just that entry in the old folder.
//! * **Never overwrite.** When the destination already holds an entry, the
//!   destination wins and the source stays. When `~/.colony` does not hold a
//!   nest yet and a small-set entry would collide, nothing moves at all: moving
//!   the rest would split history from the data it belongs to.
//! * **Links keep their meaning.** An entry that holds a link or pointer that
//!   names the old folder (see [`scan`]) is held back, not rewritten.
//! * **Never under a running agent.** The caller passes the pids of live
//!   agents; while any is alive nothing moves forward.
//! * **Kill switch.** Off by default. [`ENV_FLAG`] turns it on or off without a
//!   rebuild; [`DEFAULT_ENABLED`] is the compiled default. Turning it off never
//!   strands a half-done run: an interrupted run is rolled back, not resumed.
//!
//! Foreign entries (everything not on the list, including `.scratch` and the
//! generated skill links under `.agents`, `.claude`, `.codex`, `.goose`) keep
//! their bytes, path and mode. The new folder regenerates its own skill links.

use super::nest_folder;
use std::cell::Cell;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

mod boot;
mod journal;
mod scan;
#[cfg(all(test, unix))]
mod tests;

pub(crate) use boot::{run_at_boot, state_dir};
pub(crate) use journal::{acknowledge_notice, pending_notice, NestMigrationNotice};
use journal::{Journal, Loaded, Phase, Step, StepKind, StepStatus};

/// Environment variable that overrides [`DEFAULT_ENABLED`]: `1`, `true`, `on`
/// or `yes` enables; `0`, `false`, `off` or `no` disables.
pub(crate) const ENV_FLAG: &str = "COLONY_NEST_MIGRATION";

/// Test seam for packaged-app proofs: `<n>:<before|after>` ends the process
/// just before or after the n-th filesystem operation of a run.
pub(crate) const ENV_CRASH_AT: &str = "COLONY_NEST_MIGRATION_CRASH_AT";

/// Whether the migration runs when [`ENV_FLAG`] is not set. The release commit
/// flips this once the packaged-app gate has passed.
pub(crate) const DEFAULT_ENABLED: bool = false;

/// Stable prefix of the log lines a packaged-app harness greps.
pub(crate) const LOG_PREFIX: &str = "buzz-desktop: nest-migration:";

/// Folder name (under the app-data directory) holding the journal and notice.
pub(crate) const STATE_DIR: &str = "nest-migration";

/// Small, stateful entries moved all or nothing, in move order.
static DATA_ENTRIES: [&str; 7] = [
    "archive",
    "GUIDES",
    "RESEARCH",
    "PLANS",
    "WORK_LOGS",
    "OUTBOX",
    ".repos-dir",
];

/// Large or re-creatable entries moved best effort.
static BEST_EFFORT_ENTRIES: [&str; 2] = ["REPOS", "models"];

/// Files whose presence marks a folder as a nest. Moved last so a half-merged
/// folder never looks like a nest.
static MARKER_ENTRIES: [&str; 2] = ["AGENTS.md", ".nest-agents-version"];

/// Skill names Colony has generated under the skill folders of a nest.
const GENERATED_SKILL_NAMES: [&str; 2] = ["buzz-cli", "colony-cli"];

/// Canonical skill folder (relative to a nest) besides the per-harness ones.
const CANONICAL_SKILLS_DIR: &str = ".agents/skills";

const MSG_MIGRATED: &str = "Colony moved your agents' files to a new folder, ~/.colony. \
Other files and tools in your old folder were left exactly as they were.";
const MSG_MIGRATED_WITH_SKIPS: &str = "Colony moved your agents' files to ~/.colony. \
Some items stayed where they were because moving them was not safe. Everything keeps working.";
const MSG_LEFT_IN_PLACE: &str = "Colony left some of your agents' files where they were \
because moving them was not safe. Everything keeps working.";
const MSG_ABORTED: &str = "Colony could not move your agents' files to the new folder yet, \
so it is still using the existing folder. Nothing was changed and everything keeps working.";
const MSG_FAILED: &str = "Colony could not finish moving your agents' files. \
They are safe, and Colony will try again the next time it starts.";

/// Whether the migration is enabled given the value of [`ENV_FLAG`], if set.
pub(crate) fn migration_enabled(env_value: Option<&str>) -> bool {
    env_value
        .and_then(|raw| match raw.trim().to_ascii_lowercase().as_str() {
            "1" | "true" | "on" | "yes" => Some(true),
            "0" | "false" | "off" | "no" => Some(false),
            _ => None,
        })
        .unwrap_or(DEFAULT_ENABLED)
}

/// Every top-level name Colony owns inside a nest folder.
pub(crate) fn owned_entries() -> impl Iterator<Item = &'static str> {
    DATA_ENTRIES
        .iter()
        .chain(BEST_EFFORT_ENTRIES.iter())
        .chain(MARKER_ENTRIES.iter())
        .copied()
}

fn plan_order() -> Vec<(&'static str, StepKind)> {
    DATA_ENTRIES
        .iter()
        .map(|name| (*name, StepKind::Atomic))
        .chain(
            BEST_EFFORT_ENTRIES
                .iter()
                .map(|name| (*name, StepKind::BestEffort)),
        )
        .chain(MARKER_ENTRIES.iter().map(|name| (*name, StepKind::Atomic)))
        .collect()
}

/// True when `path` may exist. Anything but a clean "not found" counts, so an
/// unreadable entry is never mistaken for an absent one.
fn entry_exists(path: &Path) -> bool {
    !matches!(
        fs::symlink_metadata(path),
        Err(error) if error.kind() == io::ErrorKind::NotFound
    )
}

fn dir_is_empty(path: &Path) -> bool {
    fs::read_dir(path)
        .map(|mut entries| entries.next().is_none())
        .unwrap_or(false)
}

/// True when `folder` holds at least one Colony-owned entry.
pub(crate) fn holds_colony_data(folder: &Path) -> bool {
    owned_entries().any(|name| entry_exists(&folder.join(name)))
}

fn generated_skill_paths(folder: &Path) -> Vec<PathBuf> {
    let skill_dirs =
        std::iter::once(CANONICAL_SKILLS_DIR).chain(super::discovery::known_skill_dirs());
    let mut paths = Vec::new();
    for dir in skill_dirs {
        for name in GENERATED_SKILL_NAMES {
            paths.push(folder.join(dir).join(name));
        }
    }
    paths
}

/// True when `folder` still holds anything Colony owns: an allow-listed entry
/// or a generated skill link. Used to verify a Reset.
pub(crate) fn owned_entries_remain(folder: &Path) -> bool {
    // A symlinked or missing root holds nothing Colony wrote: Reset leaves it
    // alone, so verifying it must not look through it.
    if !fs::symlink_metadata(folder).is_ok_and(|meta| meta.is_dir()) {
        return false;
    }
    holds_colony_data(folder)
        || generated_skill_paths(folder)
            .iter()
            .any(|path| entry_exists(path))
}

fn remove_entry(path: &Path) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("stat {}: {error}", path.display())),
        // `is_dir` is false for a symlink, so a link is removed, never followed.
        Ok(meta) if meta.is_dir() => {
            fs::remove_dir_all(path).map_err(|error| format!("remove {}: {error}", path.display()))
        }
        Ok(_) => {
            fs::remove_file(path).map_err(|error| format!("remove {}: {error}", path.display()))
        }
    }
}

/// Reset: remove exactly the entries Colony owns inside a production nest
/// folder and nothing else. Foreign entries keep their bytes, path and mode.
/// The folder itself is removed only when that leaves it empty.
///
/// Returns the first failure, after trying every entry.
pub(crate) fn wipe_owned_entries(folder: &Path) -> Result<(), String> {
    match fs::symlink_metadata(folder) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(format!("stat {}: {error}", folder.display())),
        // A symlinked or non-directory root is never used as a nest, so it
        // holds nothing Colony wrote.
        Ok(meta) if !meta.is_dir() => return Ok(()),
        Ok(_) => {}
    }
    let mut first_error: Option<String> = None;
    for name in owned_entries() {
        if let Err(error) = remove_entry(&folder.join(name)) {
            first_error.get_or_insert(error);
        }
    }
    for path in generated_skill_paths(folder) {
        let existed = entry_exists(&path);
        if let Err(error) = remove_entry(&path) {
            first_error.get_or_insert(error);
        }
        if !existed {
            continue;
        }
        // Prune the folders the link sat in, innermost first, but only while
        // they are empty: `remove_dir` refuses anything that holds an entry.
        let mut dir = path.parent().map(Path::to_path_buf);
        while let Some(current) = dir {
            if current == folder
                || !current.starts_with(folder)
                || fs::remove_dir(&current).is_err()
            {
                break;
            }
            dir = current.parent().map(Path::to_path_buf);
        }
    }
    let _ = fs::remove_dir(folder);
    match first_error {
        Some(error) => Err(error),
        None => Ok(()),
    }
}

// ── Filesystem seam ─────────────────────────────────────────────────────────

/// The two mutating filesystem operations a run performs, behind a seam so
/// tests can fail or interrupt exactly one of them.
pub(crate) trait Fs {
    /// Create the staging folder (owner-only on Unix).
    fn create_dir(&self, path: &Path) -> io::Result<()>;
    /// Rename `from` to `to` (a move within one volume; never a copy).
    fn rename(&self, from: &Path, to: &Path) -> io::Result<()>;
}

/// The real filesystem.
pub(crate) struct RealFs;

impl Fs for RealFs {
    fn create_dir(&self, path: &Path) -> io::Result<()> {
        fs::create_dir(path)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
        }
        Ok(())
    }

    fn rename(&self, from: &Path, to: &Path) -> io::Result<()> {
        fs::rename(from, to)
    }
}

/// Interrupts a run at a chosen operation: `die` is called just before or just
/// after the `at`-th (1-based) operation. In the app `die` ends the process,
/// which is how a packaged-app proof simulates a crash mid-move; unit tests
/// unwind instead.
pub(crate) struct CrashAtFs {
    at: usize,
    before: bool,
    ops: Cell<usize>,
    die: fn() -> !,
}

impl CrashAtFs {
    pub(crate) fn new(at: usize, before: bool, die: fn() -> !) -> Self {
        Self {
            at,
            before,
            ops: Cell::new(0),
            die,
        }
    }

    fn step<T>(&self, op: impl FnOnce() -> io::Result<T>) -> io::Result<T> {
        let number = self.ops.get() + 1;
        self.ops.set(number);
        if number == self.at && self.before {
            (self.die)();
        }
        let result = op();
        if number == self.at && !self.before {
            (self.die)();
        }
        result
    }
}

impl Fs for CrashAtFs {
    fn create_dir(&self, path: &Path) -> io::Result<()> {
        self.step(|| RealFs.create_dir(path))
    }

    fn rename(&self, from: &Path, to: &Path) -> io::Result<()> {
        self.step(|| RealFs.rename(from, to))
    }
}

/// Parse the value of [`ENV_CRASH_AT`]: `<n>:<before|after>`, n at least 1.
pub(crate) fn parse_crash_at(raw: &str) -> Option<(usize, bool)> {
    let (count, when) = raw.trim().split_once(':')?;
    let count = count.trim().parse::<usize>().ok().filter(|n| *n >= 1)?;
    match when.trim() {
        "before" => Some((count, true)),
        "after" => Some((count, false)),
        _ => None,
    }
}

// ── Public run types ────────────────────────────────────────────────────────

/// What a run needs to know.
pub(crate) struct MigrationInput<'a> {
    /// The home directory holding both folders.
    pub(crate) home: &'a Path,
    /// Where the journal and notice live (outside both nest folders).
    pub(crate) journal_dir: &'a Path,
    /// Old folder name, for example `.buzz`.
    pub(crate) from_name: &'a str,
    /// New folder name, for example `.colony`.
    pub(crate) to_name: &'a str,
    /// The kill switch, already resolved.
    pub(crate) enabled: bool,
    /// Pids of Colony-managed agents that are alive right now.
    pub(crate) live_agent_pids: &'a [u32],
    /// Agent records that could not be read at all, so whether an agent is
    /// alive is unknown. Treated like a live agent: nothing moves forward.
    pub(crate) unreadable_agent_records: usize,
}

/// How a run ended.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Outcome {
    /// The kill switch is off.
    Disabled,
    /// The migration does not apply to this home folder.
    NotApplicable(&'static str),
    /// There is no old folder, or it holds nothing Colony owns.
    NothingToMigrate,
    /// An earlier run finished and nothing is left to move.
    AlreadyMigrated,
    /// Live agents were found; nothing moved. Tried again next launch.
    DeferredRunningAgents,
    /// Entries moved; skipped ones are listed in the report.
    Migrated,
    /// Nothing moved: every candidate was held back, see the report.
    LeftInPlace,
    /// Nothing is moved: a check or move failed and everything is back.
    Aborted(String),
    /// An interrupted run was rolled back (kill switch or live agents).
    RolledBack(String),
    /// A rollback could not finish; the next launch resumes it.
    Failed(String),
}

impl Outcome {
    /// Stable kebab-case spelling used in the log line.
    pub(crate) fn as_str(&self) -> &'static str {
        match self {
            Self::Disabled => "disabled",
            Self::NotApplicable(_) => "not-applicable",
            Self::NothingToMigrate => "nothing-to-migrate",
            Self::AlreadyMigrated => "already-migrated",
            Self::DeferredRunningAgents => "deferred-running-agents",
            Self::Migrated => "migrated",
            Self::LeftInPlace => "left-in-place",
            Self::Aborted(_) => "aborted",
            Self::RolledBack(_) => "rolled-back",
            Self::Failed(_) => "failed",
        }
    }
}

/// The result of one run.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Report {
    pub(crate) outcome: Outcome,
    /// Names now in the new folder because of this or an interrupted run.
    pub(crate) moved: Vec<String>,
    /// Names left in the old folder on purpose, with the reason.
    pub(crate) skipped: Vec<(String, String)>,
}

impl Report {
    fn of(outcome: Outcome) -> Self {
        Self {
            outcome,
            moved: Vec::new(),
            skipped: Vec::new(),
        }
    }

    /// One greppable line: `<prefix> outcome=<o> moved=<n> skipped=<n> detail=<text>`.
    pub(crate) fn log_line(&self) -> String {
        let detail = match &self.outcome {
            Outcome::NotApplicable(reason) => (*reason).to_string(),
            Outcome::Aborted(reason) | Outcome::RolledBack(reason) | Outcome::Failed(reason) => {
                reason.clone()
            }
            Outcome::Migrated => self.moved.join(","),
            Outcome::LeftInPlace => self
                .skipped
                .iter()
                .map(|(name, why)| format!("{name}({why})"))
                .collect::<Vec<_>>()
                .join(","),
            _ => "-".to_string(),
        };
        format!(
            "{LOG_PREFIX} outcome={} moved={} skipped={} detail={}",
            self.outcome.as_str(),
            self.moved.len(),
            self.skipped.len(),
            detail.replace(['\n', '\r'], " ")
        )
    }
}

fn notice_for(report: &Report) -> Option<(String, &'static str)> {
    let mut skipped: Vec<&str> = report.skipped.iter().map(|(n, _)| n.as_str()).collect();
    skipped.sort_unstable();
    let skipped = skipped.join(",");
    match &report.outcome {
        Outcome::Migrated if report.skipped.is_empty() => {
            Some(("migrated".to_string(), MSG_MIGRATED))
        }
        Outcome::Migrated => Some((format!("left:{skipped}"), MSG_MIGRATED_WITH_SKIPS)),
        Outcome::LeftInPlace => Some((format!("left:{skipped}"), MSG_LEFT_IN_PLACE)),
        Outcome::Aborted(reason) => Some((format!("aborted:{reason}"), MSG_ABORTED)),
        Outcome::Failed(_) => Some(("failed".to_string(), MSG_FAILED)),
        _ => None,
    }
}

/// Run the migration once. Safe to call on every launch: it does nothing when
/// there is nothing to do, and never moves anything it cannot move back.
pub(crate) fn run_migration(input: &MigrationInput<'_>, fs_ops: &dyn Fs) -> Report {
    let run = Run {
        input,
        fs: fs_ops,
        from: input.home.join(input.from_name),
        to: input.home.join(input.to_name),
        staging_name: format!("{}.staging", input.to_name),
        staging: input.home.join(format!("{}.staging", input.to_name)),
    };
    let report = run.run();
    if let Some((key, message)) = notice_for(&report) {
        if let Err(error) = journal::record_notice(input.journal_dir, &key, message) {
            eprintln!("{LOG_PREFIX} could not record the notice: {error}");
        }
    }
    report
}

// ── The run ─────────────────────────────────────────────────────────────────

struct Run<'a> {
    input: &'a MigrationInput<'a>,
    fs: &'a dyn Fs,
    from: PathBuf,
    to: PathBuf,
    staging: PathBuf,
    staging_name: String,
}

/// True when `placed` is free for `staged`: it does not exist, or both are real
/// directories and the destination is empty (a placeholder that `ensure_nest`
/// created). `rename` over an empty directory is atomic and, by the OS's own
/// rule, fails rather than replace a directory that holds anything.
fn can_place(staged: &Path, placed: &Path) -> bool {
    match fs::symlink_metadata(placed) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => true,
        Err(_) => false,
        Ok(dst) => fs::symlink_metadata(staged)
            .map(|src| src.is_dir() && dst.is_dir() && dir_is_empty(placed))
            .unwrap_or(false),
    }
}

fn mark_published(journal: &mut Journal) {
    for step in &mut journal.steps {
        if matches!(step.status, StepStatus::Staged | StepStatus::Publishing) {
            step.status = StepStatus::Published;
        }
    }
}

fn skipped_of(steps: &[Step]) -> Vec<(String, String)> {
    steps
        .iter()
        .filter(|step| step.status == StepStatus::Skipped)
        .map(|step| (step.name.clone(), step.detail.clone().unwrap_or_default()))
        .collect()
}

impl Run<'_> {
    fn save(&self, journal: &Journal) -> Result<(), String> {
        journal::save(self.input.journal_dir, journal)
    }

    fn run(&self) -> Report {
        let mut finished_before = false;
        match journal::load(self.input.journal_dir) {
            Loaded::Valid(journal) => {
                if journal.phase.is_in_flight() {
                    return self.resume(*journal);
                }
                finished_before = journal.phase == Phase::Done;
                self.recover_orphan_staging();
            }
            Loaded::Missing => self.recover_orphan_staging(),
            Loaded::Corrupt(why) => {
                eprintln!("{LOG_PREFIX} unreadable journal set aside: {why}");
                journal::set_aside_corrupt(self.input.journal_dir);
                self.recover_orphan_staging();
            }
        }
        self.fresh_run(finished_before)
    }

    /// A staging folder with no journal (the journal was lost): hand every
    /// allow-listed entry in it back to the old folder. Anything else in it is
    /// not ours and stays.
    fn recover_orphan_staging(&self) {
        let Ok(read) = fs::read_dir(&self.staging) else {
            return;
        };
        let mut names: Vec<String> = read
            .flatten()
            .filter_map(|entry| entry.file_name().into_string().ok())
            .collect();
        names.sort();
        for name in names {
            if !owned_entries().any(|owned| owned == name) {
                continue;
            }
            let home = self.from.join(&name);
            if entry_exists(&home) {
                continue;
            }
            if let Err(error) = self.fs.rename(&self.staging.join(&name), &home) {
                eprintln!("{LOG_PREFIX} could not hand {name} back: {error}");
            }
        }
        // Succeeds only when empty.
        let _ = fs::remove_dir(&self.staging);
    }

    fn fresh_run(&self, finished_before: bool) -> Report {
        if !self.input.enabled {
            return Report::of(Outcome::Disabled);
        }
        match fs::symlink_metadata(&self.from) {
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                return Report::of(Outcome::NotApplicable("legacy-folder-absent"));
            }
            Err(_) => return Report::of(Outcome::NotApplicable("legacy-folder-unreadable")),
            Ok(meta) if !meta.is_dir() => {
                return Report::of(Outcome::NotApplicable("legacy-folder-not-a-directory"));
            }
            Ok(_) => {}
        }
        if let Ok(meta) = fs::symlink_metadata(&self.to) {
            if !meta.is_dir() {
                return Report::of(Outcome::NotApplicable("target-not-a-directory"));
            }
        }
        if !holds_colony_data(&self.from) {
            return Report::of(if finished_before {
                Outcome::AlreadyMigrated
            } else {
                Outcome::NothingToMigrate
            });
        }
        if entry_exists(&self.staging) {
            // Recovery above hands back what is ours; anything left in there
            // (or a file in its place) is not something to publish as a nest.
            return Report::of(Outcome::NotApplicable("staging-exists"));
        }
        if self.agents_alive() {
            return Report::of(Outcome::DeferredRunningAgents);
        }
        let steps = match self.plan() {
            Ok(steps) => steps,
            Err(reason) => return Report::of(Outcome::Aborted(reason)),
        };
        if !steps.iter().any(|step| step.status == StepStatus::Pending) {
            let skipped = skipped_of(&steps);
            if skipped.is_empty() {
                return Report::of(Outcome::NothingToMigrate);
            }
            return Report {
                outcome: Outcome::LeftInPlace,
                moved: Vec::new(),
                skipped,
            };
        }
        let mut journal = Journal::new(
            self.input.from_name,
            self.input.to_name,
            &self.staging_name,
            steps,
        );
        // Fail closed: without a durable journal nothing is moved.
        if let Err(error) = self.save(&journal) {
            return Report::of(Outcome::Aborted(format!("journal-unwritable:{error}")));
        }
        self.drive(&mut journal)
    }

    /// Decide, before anything moves, which entries go and which stay.
    /// `Err(reason)` means the whole migration must wait.
    fn plan(&self) -> Result<Vec<Step>, String> {
        let colony_has_nest = nest_folder::holds_nest_marker(&self.to);
        // (name, kind, why it stays) in move order, for entries that exist.
        let mut entries: Vec<(&'static str, StepKind, Option<String>)> = Vec::new();
        for (name, kind) in plan_order() {
            let src = self.from.join(name);
            if !entry_exists(&src) {
                continue;
            }
            if !can_place(&src, &self.to.join(name)) {
                // The destination wins. If the new folder is not a nest yet,
                // moving the rest would split data from what belongs with it.
                if kind == StepKind::Atomic && !colony_has_nest {
                    return Err(format!("target-exists:{name}"));
                }
                entries.push((name, kind, Some("target-exists".to_string())));
                continue;
            }
            if name == ".repos-dir" && self.repos_dir_points_inside(&src) {
                return Err("repos-dir-inside-old-folder".to_string());
            }
            entries.push((name, kind, None));
        }
        // Look inside what will move. An entry held back no longer moves, so
        // links into it from entries that do move are checked again.
        loop {
            let moving: Vec<String> = entries
                .iter()
                .filter(|(_, _, stays)| stays.is_none())
                .map(|(name, _, _)| (*name).to_string())
                .collect();
            let mut changed = false;
            for entry in entries.iter_mut() {
                if entry.2.is_some() {
                    continue;
                }
                let (name, kind) = (entry.0, entry.1);
                let limits = if name == "REPOS" {
                    &scan::SHALLOW
                } else {
                    &scan::FULL
                };
                let src = self.from.join(name);
                let Some(found) =
                    scan::find_broken_reference(&src, &self.from, name, &moving, limits)
                else {
                    continue;
                };
                let reason = format!("would-break-link:{found}");
                if kind == StepKind::Atomic {
                    return Err(reason);
                }
                entry.2 = Some(reason);
                changed = true;
            }
            if !changed {
                break;
            }
        }
        Ok(entries
            .into_iter()
            .map(|(name, kind, stays)| match stays {
                Some(why) => Step::skipped(name, kind, &why),
                None => Step::pending(name, kind),
            })
            .collect())
    }

    /// A live agent, or an agent record too unreadable to rule one out.
    fn agents_alive(&self) -> bool {
        !self.input.live_agent_pids.is_empty() || self.input.unreadable_agent_records > 0
    }

    /// `.repos-dir` holds one absolute path. If it names a place inside the old
    /// folder it would dangle after the move, and Colony does not rewrite it.
    fn repos_dir_points_inside(&self, file: &Path) -> bool {
        let Ok(text) = fs::read_to_string(file) else {
            return false;
        };
        let target = Path::new(text.trim());
        if !target.is_absolute() {
            return false;
        }
        target.starts_with(&self.from)
            || self
                .from
                .canonicalize()
                .map(|canonical| target.starts_with(canonical))
                .unwrap_or(false)
    }

    fn drive(&self, journal: &mut Journal) -> Report {
        if journal.phase == Phase::Staging {
            if let Err(reason) = self.stage(journal) {
                return self.rollback(journal, &reason);
            }
        }
        if let Err(reason) = self.publish(journal) {
            return self.rollback(journal, &reason);
        }
        self.complete(journal)
    }

    /// Rename each pending entry into the staging folder, journal first.
    fn stage(&self, journal: &mut Journal) -> Result<(), String> {
        if !entry_exists(&self.staging) {
            self.fs
                .create_dir(&self.staging)
                .map_err(|error| format!("staging-unavailable:{error}"))?;
        }
        for index in 0..journal.steps.len() {
            if !matches!(
                journal.steps[index].status,
                StepStatus::Pending | StepStatus::Moving
            ) {
                continue;
            }
            let name = journal.steps[index].name.clone();
            let kind = journal.steps[index].kind;
            let src = self.from.join(&name);
            let dst = self.staging.join(&name);
            match (entry_exists(&src), entry_exists(&dst)) {
                (false, true) => {
                    // Stopped after the rename, before it was recorded.
                    journal.steps[index].status = StepStatus::Staged;
                    self.save(journal)?;
                    continue;
                }
                (false, false) => {
                    journal.steps[index].skip("vanished");
                    self.save(journal)?;
                    continue;
                }
                (true, true) => {
                    if kind == StepKind::Atomic {
                        return Err(format!("both-present:{name}"));
                    }
                    journal.steps[index].skip("both-present");
                    self.save(journal)?;
                    continue;
                }
                (true, false) => {}
            }
            journal.steps[index].status = StepStatus::Moving;
            self.save(journal)?;
            match self.fs.rename(&src, &dst) {
                Ok(()) => {
                    journal.steps[index].status = StepStatus::Staged;
                    self.save(journal)?;
                }
                Err(error) => {
                    let reason = format!("move-failed:{name}:{error}");
                    if kind == StepKind::Atomic {
                        return Err(reason);
                    }
                    journal.steps[index].skip(&reason);
                    self.save(journal)?;
                }
            }
        }
        Ok(())
    }

    /// Put the staged entries into the new folder: in one rename when the new
    /// folder does not exist yet, otherwise entry by entry.
    fn publish(&self, journal: &mut Journal) -> Result<(), String> {
        journal.phase = Phase::Publishing;
        self.save(journal)?;
        if !entry_exists(&self.staging) {
            // The whole-folder rename already happened (the run stopped before
            // recording it), or nothing was left to publish.
            mark_published(journal);
            return Ok(());
        }
        if !journal
            .steps
            .iter()
            .any(|step| matches!(step.status, StepStatus::Staged | StepStatus::Publishing))
        {
            // Nothing was staged (every entry was held back): do not leave an
            // empty new folder behind. Succeeds only when empty.
            let _ = fs::remove_dir(&self.staging);
            return Ok(());
        }
        if !entry_exists(&self.to) {
            journal.publish_whole = true;
            self.save(journal)?;
            if let Err(error) = self.fs.rename(&self.staging, &self.to) {
                journal.publish_whole = false;
                let _ = self.save(journal);
                return Err(format!("publish-failed:{error}"));
            }
            mark_published(journal);
            return Ok(());
        }
        self.merge_into_existing(journal)
    }

    fn merge_into_existing(&self, journal: &mut Journal) -> Result<(), String> {
        for index in 0..journal.steps.len() {
            if !matches!(
                journal.steps[index].status,
                StepStatus::Staged | StepStatus::Publishing
            ) {
                continue;
            }
            let name = journal.steps[index].name.clone();
            let kind = journal.steps[index].kind;
            let staged = self.staging.join(&name);
            let placed = self.to.join(&name);
            let home = self.from.join(&name);
            if !entry_exists(&staged) {
                if entry_exists(&placed) {
                    journal.steps[index].status = StepStatus::Published;
                } else {
                    journal.steps[index].skip("vanished");
                }
                self.save(journal)?;
                continue;
            }
            if !can_place(&staged, &placed) {
                if kind == StepKind::Atomic {
                    return Err(format!("target-exists:{name}"));
                }
                if entry_exists(&home) {
                    return Err(format!("both-present:{name}"));
                }
                self.fs
                    .rename(&staged, &home)
                    .map_err(|error| format!("hand-back-failed:{name}:{error}"))?;
                journal.steps[index].skip("target-exists");
                self.save(journal)?;
                continue;
            }
            journal.steps[index].status = StepStatus::Publishing;
            self.save(journal)?;
            self.fs
                .rename(&staged, &placed)
                .map_err(|error| format!("publish-failed:{name}:{error}"))?;
            journal.steps[index].status = StepStatus::Published;
            self.save(journal)?;
        }
        // Succeeds only when empty.
        let _ = fs::remove_dir(&self.staging);
        Ok(())
    }

    fn complete(&self, journal: &mut Journal) -> Report {
        journal.finish(Phase::Done);
        if let Err(error) = self.save(journal) {
            // The folders are already in their final state; a later launch
            // reconciles the stale journal from them.
            eprintln!("{LOG_PREFIX} could not record completion: {error}");
        }
        let moved: Vec<String> = journal
            .steps
            .iter()
            .filter(|step| step.status == StepStatus::Published)
            .map(|step| step.name.clone())
            .collect();
        let skipped = skipped_of(&journal.steps);
        // A run that moved nothing and held everything back did not migrate.
        let outcome = if moved.is_empty() && !skipped.is_empty() {
            Outcome::LeftInPlace
        } else {
            Outcome::Migrated
        };
        Report {
            outcome,
            moved,
            skipped,
        }
    }

    /// Send every entry this run moved back to the old folder, newest first.
    fn rollback(&self, journal: &mut Journal, reason: &str) -> Report {
        journal.phase = Phase::RollingBack;
        journal.reason = Some(reason.to_string());
        // A rollback is never a finished whole-folder publish.
        journal.publish_whole = false;
        let _ = self.save(journal);
        let mut stuck: Vec<String> = Vec::new();
        for index in (0..journal.steps.len()).rev() {
            let status = journal.steps[index].status;
            if matches!(status, StepStatus::Skipped | StepStatus::RolledBack) {
                continue;
            }
            let name = journal.steps[index].name.clone();
            let home = self.from.join(&name);
            let staged = self.staging.join(&name);
            let placed = self.to.join(&name);
            let ours_in_place = matches!(status, StepStatus::Publishing | StepStatus::Published);
            let current = if entry_exists(&staged) {
                Some(staged)
            } else if ours_in_place && entry_exists(&placed) {
                Some(placed)
            } else {
                None
            };
            match current {
                // It never left, is already back, or has nothing left to return.
                None => journal.steps[index].status = StepStatus::RolledBack,
                Some(path) => {
                    // Something may sit at home now (a placeholder an older
                    // build created). Only an empty folder gives way; a file or
                    // a folder with content is never overwritten.
                    if !can_place(&path, &home) {
                        stuck.push(format!("{name}:target-exists"));
                    } else {
                        match self.fs.rename(&path, &home) {
                            Ok(()) => journal.steps[index].status = StepStatus::RolledBack,
                            Err(error) => stuck.push(format!("{name}:{error}")),
                        }
                    }
                }
            }
            let _ = self.save(journal);
        }
        if !stuck.is_empty() {
            // The phase stays `rolling_back`: the next launch finishes it.
            let _ = self.save(journal);
            return Report::of(Outcome::Failed(format!(
                "rollback-incomplete:{}",
                stuck.join(";")
            )));
        }
        // Succeeds only when empty.
        let _ = fs::remove_dir(&self.staging);
        journal.finish(Phase::Aborted);
        let _ = self.save(journal);
        Report::of(Outcome::Aborted(reason.to_string()))
    }

    fn resume(&self, mut journal: Journal) -> Report {
        if journal.publish_whole && !entry_exists(&self.staging) && entry_exists(&self.to) {
            // The whole-folder rename happened; only the journal is behind.
            mark_published(&mut journal);
            return self.complete(&mut journal);
        }
        let drained = !entry_exists(&self.staging) || dir_is_empty(&self.staging);
        if journal.phase == Phase::Publishing
            && drained
            && journal
                .steps
                .iter()
                .all(|step| matches!(step.status, StepStatus::Published | StepStatus::Skipped))
        {
            // Every entry is in place; only the journal is behind. Succeeds
            // only when empty.
            let _ = fs::remove_dir(&self.staging);
            return self.complete(&mut journal);
        }
        let agents_alive = self.agents_alive();
        if journal.phase == Phase::RollingBack || !self.input.enabled || agents_alive {
            let reason = journal.reason.clone().unwrap_or_else(|| {
                if !self.input.enabled {
                    "kill-switch".to_string()
                } else if agents_alive {
                    "running-agents".to_string()
                } else {
                    "interrupted".to_string()
                }
            });
            let report = self.rollback(&mut journal, &reason);
            return match report.outcome {
                Outcome::Aborted(reason) => Report::of(Outcome::RolledBack(reason)),
                _ => report,
            };
        }
        self.drive(&mut journal)
    }
}
