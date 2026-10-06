//! Brand guard for the text Colony writes into the agent working folder.
//!
//! Agents run with the nest as their working directory and read everything in
//! it: AGENTS.md, the CLI skill, and the names of the files and links
//! themselves. The corpus here is produced by the real writer
//! ([`ensure_nest_at`] plus [`upsert_managed_section`]), so a skill renamed or
//! added later is scanned without touching this file. See
//! `test-support/brand_guard.rs` for the matching rules.

#[path = "../../../../../test-support/brand_guard.rs"]
mod brand_guard;

use super::*;
use crate::managed_agents::personas::{built_in_persona_definition, POLLEN_PERSONA_ID};
use brand_guard::{Allow, Match, Surface};

/// The only places the old name may still appear in the working folder.
///
/// The skill no longer names environment variables, so no `BUZZ_*` entry is allowed here.
const ALLOW: &[Allow] = &[
    Allow {
        text: "<!-- BEGIN BUZZ MANAGED",
        kind: Match::Literal,
        reason: "Opening marker of the managed AGENTS.md section. Every existing install carries \
                 it and the refresh code finds the section by it, so renaming it without a \
                 migration would duplicate the section. Removal: the nest migration PR, with \
                 dual-marker matching.",
    },
    Allow {
        text: "<!-- END BUZZ MANAGED -->",
        kind: Match::Literal,
        reason: "Closing marker of the managed AGENTS.md section, paired with the opening marker \
                 and kept for the same reason. Removal: the nest migration PR, with dual-marker \
                 matching.",
    },
];

/// Record every entry under `dir`: file contents as surfaces, names in `tree`.
///
/// Symlinks are recorded by name and target and never followed, so a skill
/// that is linked into several harness folders is scanned once, at its real
/// location, and its link names are scanned as names.
fn walk(root: &Path, dir: &Path, files: &mut Vec<Surface>, tree: &mut Vec<String>) {
    let mut entries: Vec<_> = fs::read_dir(dir)
        .expect("read nest directory")
        .map(|entry| entry.expect("read nest entry"))
        .collect();
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        let path = entry.path();
        let rel = path
            .strip_prefix(root)
            .expect("entry lives under the nest root")
            .to_string_lossy()
            .replace('\\', "/");
        let kind = fs::symlink_metadata(&path)
            .expect("stat nest entry")
            .file_type();
        if kind.is_symlink() {
            let target = fs::read_link(&path).expect("read link target");
            tree.push(format!(
                "{rel} -> {}",
                target.to_string_lossy().replace('\\', "/")
            ));
        } else if kind.is_dir() {
            tree.push(format!("{rel}/"));
            walk(root, &path, files, tree);
        } else {
            tree.push(rel.clone());
            let bytes = fs::read(&path).expect("read nest file");
            files.push(Surface::new(
                format!("nest file {rel}"),
                String::from_utf8_lossy(&bytes).into_owned(),
            ));
        }
    }
}

fn surfaces() -> Vec<Surface> {
    let tmp = tempfile::tempdir().expect("temp dir");
    let root = tmp.path().join(".colony");
    ensure_nest_at(&root).expect("a fresh nest is written");

    // Fill the managed section the way the app does after boot, so the
    // rendered AGENTS.md is what an agent actually reads.
    let managed = render_dynamic_section(&[], &[], &HashSet::new(), "wss://relay.example.com");
    upsert_managed_section(&root.join("AGENTS.md"), &managed)
        .expect("the managed section is written");

    let mut out = Vec::new();
    let mut tree = Vec::new();
    walk(&root, &root, &mut out, &mut tree);
    out.push(Surface::new(
        "nest tree (entry names and link targets)",
        tree.join("\n"),
    ));
    out.push(Surface::new("managed section (no agents)", managed));

    // Persona instructions are part of what Scout and the other built-in
    // employees are told.
    for id in ["builtin:fizz", "builtin:honey", POLLEN_PERSONA_ID] {
        let persona = built_in_persona_definition(id, "2026-10-06T08:00:00Z")
            .expect("built-in persona exists");
        out.push(Surface::new(
            format!("persona instructions ({})", persona.display_name),
            persona.system_prompt,
        ));
    }
    out
}

#[test]
fn working_folder_text_never_says_buzz() {
    brand_guard::assert_clean(&surfaces(), ALLOW);
}

#[test]
fn allow_list_has_no_stale_entries() {
    brand_guard::assert_no_stale_entries(&surfaces(), ALLOW);
}

#[test]
fn allow_list_entries_are_justified() {
    brand_guard::assert_entries_justified(ALLOW);
}

#[test]
fn guard_flags_injected_buzz_in_every_real_surface() {
    brand_guard::assert_guard_is_falsifiable(&surfaces(), ALLOW);
}

#[test]
fn guard_corpus_covers_what_the_writer_produces() {
    let all = surfaces();
    let find = |needle: &str| all.iter().any(|s| s.name.contains(needle));
    assert!(find("nest file AGENTS.md"), "rendered AGENTS.md missing");
    assert!(
        all.iter().any(
            |s| s.name.starts_with("nest file .agents/skills/") && s.name.ends_with("SKILL.md")
        ),
        "the CLI skill file is missing from the corpus"
    );
    assert!(find("nest tree"), "entry names are not scanned");
    assert!(find("persona instructions (Scout)"), "Scout is not scanned");
    let agents = all
        .iter()
        .find(|s| s.name == "nest file AGENTS.md")
        .expect("AGENTS.md surface");
    assert!(
        agents.text.contains("## Active Agents"),
        "AGENTS.md must include the rendered managed section"
    );
}
