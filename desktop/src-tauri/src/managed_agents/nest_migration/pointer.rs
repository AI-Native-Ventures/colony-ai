//! The `.repos-dir` pointer that keeps a held-back `REPOS` in use.
//!
//! When the migration cannot move `REPOS` (a link or pointer inside it names the
//! old folder), the new folder would otherwise start with an empty `REPOS` while
//! the person's clones stay behind in the old one. The host already knows how to
//! point `REPOS` somewhere else: `.repos-dir` names an absolute folder and boot
//! turns `REPOS` into a symlink to it (see `repos::resolve_repos_at_boot`). The
//! migration writes that file, naming the old `REPOS`, as one more journaled
//! step of the same publish, so the new folder never appears without it.
//!
//! The pointer is checked with the host's own `validate_repos_dir`, when it is
//! staged and again just before publish, and read back after it is written.
//! Anything that fails sends the whole run back (fail closed).
//!
//! Later launches must not undo or strand it:
//! * a workspace apply with no repositories folder chosen keeps the pointer
//!   ([`effective_candidate`]); a folder the person chooses replaces it;
//! * if the old `REPOS` is gone, [`heal_repos_pointer`] removes the file this
//!   migration wrote so the host falls back to a default `REPOS` instead of
//!   skipping agent restore for ever.

use super::journal::{self, Loaded, Phase};
use super::LOG_PREFIX;
use std::fs;
use std::path::Path;

/// File name of the pointer inside a nest folder (the host's own `.repos-dir`).
pub(super) const POINTER_NAME: &str = ".repos-dir";

/// Bytes of a pointer file naming `target`: one line, like the host writes it.
pub(super) fn pointer_bytes(target: &str) -> Vec<u8> {
    format!("{target}\n").into_bytes()
}

/// The check the host runs at boot on a persisted repositories folder.
pub(super) fn validate(new_nest: &Path, target: &str) -> Result<(), String> {
    crate::managed_agents::validate_repos_dir(new_nest, target)
        .map(|_| ())
        .map_err(|error| format!("repos-pointer-invalid:{error}"))
}

/// The absolute folder the pointer should name for the old `REPOS`, already
/// validated the way the host will validate it.
pub(super) fn target_for(old_repos: &Path, new_nest: &Path) -> Result<String, String> {
    let canonical = old_repos
        .canonicalize()
        .map_err(|error| format!("repos-pointer-target-unreadable:{error}"))?;
    let target = canonical
        .to_str()
        .ok_or_else(|| "repos-pointer-target-not-utf8".to_string())?
        .to_string();
    validate(new_nest, &target)?;
    Ok(target)
}

/// The trimmed content of the nest's `.repos-dir`, if it holds one.
fn read_pointer(nest: &Path) -> Option<String> {
    fs::read_to_string(nest.join(POINTER_NAME))
        .ok()
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty())
}

/// True when the new folder's `.repos-dir` already names `old_repos`: the pointer
/// serves it, so there is nothing left to move or to report.
pub(super) fn serves(new_nest: &Path, old_repos: &Path) -> bool {
    let Some(text) = read_pointer(new_nest) else {
        return false;
    };
    match (Path::new(&text).canonicalize(), old_repos.canonicalize()) {
        (Ok(named), Ok(old)) => named == old,
        _ => false,
    }
}

/// The folder a finished migration pointed `nest` at, if `nest/.repos-dir` still
/// holds exactly that. A pointer the person chose later differs, so it is not
/// ours to touch.
fn generated_target(nest: &Path, journal_dir: &Path) -> Option<String> {
    let Loaded::Valid(journal) = journal::load(journal_dir) else {
        return None;
    };
    if journal.phase != Phase::Done {
        return None;
    }
    let target = journal.repos_pointer.clone()?;
    (read_pointer(nest).as_deref() == Some(target.as_str())).then_some(target)
}

/// The repositories folder a workspace apply should use: the person's own
/// choice when there is one, otherwise the folder this migration left in use
/// (when it still validates). Without this, applying a workspace with no
/// repositories folder chosen would erase the pointer and bring back an empty
/// `REPOS` beside clones that stayed behind.
pub(crate) fn effective_candidate(
    nest: &Path,
    journal_dir: &Path,
    chosen: Option<&str>,
) -> Option<String> {
    if let Some(chosen) = chosen.map(str::trim).filter(|text| !text.is_empty()) {
        return Some(chosen.to_string());
    }
    let target = generated_target(nest, journal_dir)?;
    validate(nest, &target).ok().map(|()| target)
}

/// If the pointer this migration wrote no longer validates (the person moved or
/// removed the old `REPOS`), remove that file so the host falls back to a
/// default `REPOS`. Logs one line; never fails the launch. Run after the nest is
/// created and before `resolve_repos_at_boot`.
pub(crate) fn heal_repos_pointer(nest: &Path, journal_dir: &Path) {
    let Some(target) = generated_target(nest, journal_dir) else {
        return;
    };
    let Err(reason) = validate(nest, &target) else {
        return;
    };
    match fs::remove_file(nest.join(POINTER_NAME)) {
        Ok(()) => eprintln!(
            "{LOG_PREFIX} repositories pointer to {target} removed ({reason}); \
             the default repositories folder is used"
        ),
        Err(error) => {
            eprintln!("{LOG_PREFIX} could not remove the stale repositories pointer: {error}")
        }
    }
}
