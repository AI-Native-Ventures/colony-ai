//! A bounded look inside an entry for references that moving it would break.
//!
//! Moving an entry is a rename, so everything inside it keeps its bytes. What
//! can change meaning is a reference that spells out the old location:
//!
//! * a symlink with an absolute target inside the old folder,
//! * a relative symlink that reaches a sibling entry that is staying behind,
//! * a `.git` pointer file (linked worktree or submodule) that names the old
//!   folder, and a repository whose `.git/worktrees` lists linked worktrees
//!   (their pointers back to it spell out its absolute path).
//!
//! Colony does not rewrite files inside a person's checkouts. An entry with such
//! a reference is held back instead and the person is told. The walk never
//! follows a symlink and is capped in depth and entry count so a huge tree
//! cannot stall startup; a capped walk reports nothing found beyond the cap.

use std::fs;
use std::path::{Component, Path};

/// How far a walk goes.
pub(super) struct Limits {
    pub(super) max_entries: usize,
    pub(super) max_depth: usize,
}

/// Small knowledge folders: look at everything.
pub(super) const FULL: Limits = Limits {
    max_entries: 50_000,
    max_depth: 16,
};

/// Repositories can hold millions of files. Look at the top three levels
/// (`REPOS/<owner>/<repo>/.git`), which is where links and pointers sit.
pub(super) const SHALLOW: Limits = Limits {
    max_entries: 20_000,
    max_depth: 3,
};

/// A `.git` pointer file is one short line; anything larger is not read.
const GIT_POINTER_MAX_BYTES: u64 = 4096;

/// `Some(reason)` when something under `entry` would stop meaning the same
/// thing after `entry` is renamed from under `old_root`. `moving` lists the
/// top-level names that move together with it.
pub(super) fn find_broken_reference(
    entry: &Path,
    old_root: &Path,
    top_name: &str,
    moving: &[String],
    limits: &Limits,
) -> Option<String> {
    let canonical_root = old_root.canonicalize().ok();
    let mut stack = vec![(entry.to_path_buf(), 0usize)];
    let mut seen = 0usize;
    while let Some((path, depth)) = stack.pop() {
        seen += 1;
        if seen > limits.max_entries {
            return None;
        }
        let Ok(meta) = fs::symlink_metadata(&path) else {
            continue;
        };
        let file_type = meta.file_type();
        if file_type.is_symlink() {
            if let Some(reason) =
                symlink_problem(&path, old_root, canonical_root.as_deref(), top_name, moving)
            {
                return Some(reason);
            }
        } else if file_type.is_file() {
            let is_git_pointer = path.file_name().is_some_and(|name| name == ".git")
                && meta.len() <= GIT_POINTER_MAX_BYTES;
            if is_git_pointer && file_names_root(&path, old_root, canonical_root.as_deref()) {
                return Some(format!("git-pointer:{}", relative(&path, old_root)));
            }
        } else if file_type.is_dir() {
            if path.file_name().is_some_and(|name| name == ".git") {
                if has_linked_worktrees(&path) {
                    return Some(format!("git-worktrees:{}", relative(&path, old_root)));
                }
                // Never walk into repository internals.
            } else if depth < limits.max_depth {
                if let Ok(children) = fs::read_dir(&path) {
                    for child in children.flatten() {
                        stack.push((child.path(), depth + 1));
                    }
                }
            }
        }
    }
    None
}

fn relative(path: &Path, root: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .display()
        .to_string()
}

fn symlink_problem(
    link: &Path,
    old_root: &Path,
    canonical_root: Option<&Path>,
    top_name: &str,
    moving: &[String],
) -> Option<String> {
    let target = fs::read_link(link).ok()?;
    if target.is_absolute() {
        let inside =
            target.starts_with(old_root) || canonical_root.is_some_and(|c| target.starts_with(c));
        return inside.then(|| format!("absolute-link:{}", relative(link, old_root)));
    }
    // Relative: resolve lexically from the link's folder, measured from the old
    // root, to see which top-level entry it lands in.
    let parent = link.parent()?;
    let from_root = parent.strip_prefix(old_root).ok()?;
    let mut parts: Vec<String> = from_root
        .components()
        .filter_map(|component| match component {
            Component::Normal(part) => Some(part.to_string_lossy().into_owned()),
            _ => None,
        })
        .collect();
    for component in target.components() {
        match component {
            Component::Normal(part) => parts.push(part.to_string_lossy().into_owned()),
            Component::ParentDir => {
                // Leaving the old folder altogether: the new folder sits at the
                // same depth under the home directory, so it resolves to the
                // same place.
                parts.pop()?;
            }
            _ => {}
        }
    }
    let first = parts.first()?;
    if first == top_name || moving.iter().any(|name| name == first) {
        None
    } else {
        Some(format!("relative-link:{}", relative(link, old_root)))
    }
}

fn file_names_root(file: &Path, old_root: &Path, canonical_root: Option<&Path>) -> bool {
    let Ok(bytes) = fs::read(file) else {
        return false;
    };
    let text = String::from_utf8_lossy(&bytes);
    text.contains(&*old_root.to_string_lossy())
        || canonical_root.is_some_and(|c| text.contains(&*c.to_string_lossy()))
}

fn has_linked_worktrees(git_dir: &Path) -> bool {
    fs::read_dir(git_dir.join("worktrees"))
        .map(|mut entries| entries.next().is_some())
        .unwrap_or(false)
}
