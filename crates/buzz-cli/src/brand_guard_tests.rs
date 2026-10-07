//! Brand guard for the CLI help an agent reads when it runs `colony --help`.
//!
//! The base prompt tells agents to run `--help` for the command tree and for
//! each group, so the help is agent-visible text. Every surface here is the
//! help the production parser prints when the binary is invoked as `colony`:
//! root `--help` and `-h`, and `--help` for every group and subcommand in the
//! tree. See `test-support/brand_guard.rs` for the matching rules.
//!
//! The legacy `buzz` invocation is deliberately not scanned: it must keep
//! printing its own name for old agents and scripts.

#[path = "../../../test-support/brand_guard.rs"]
mod brand_guard;

use brand_guard::{Allow, Surface};
use clap::error::ErrorKind;

use crate::{build_command, parse_args};

/// The help prints no environment variable names and no old name, so nothing
/// is allowed here. Keep it empty: an entry would need a written reason and
/// would fail the stale check the moment the help stopped needing it.
const ALLOW: &[Allow] = &[];

/// Render the help the CLI prints for `argv`, failing if it prints anything else.
fn help_for(argv: &[&str]) -> String {
    match parse_args(argv.iter().copied()) {
        Err(error) if error.kind() == ErrorKind::DisplayHelp => error.to_string(),
        Err(error) => panic!("{argv:?} did not print help: {error}"),
        Ok(_) => panic!("{argv:?} unexpectedly parsed instead of printing help"),
    }
}

/// Every subcommand path in the tree, depth first, skipping clap's own `help`.
fn command_paths(cmd: &clap::Command, prefix: &mut Vec<String>, out: &mut Vec<Vec<String>>) {
    for sub in cmd.get_subcommands().filter(|s| s.get_name() != "help") {
        prefix.push(sub.get_name().to_owned());
        out.push(prefix.clone());
        command_paths(sub, prefix, out);
        prefix.pop();
    }
}

fn surfaces() -> Vec<Surface> {
    let mut out = Vec::new();
    for flag in ["--help", "-h"] {
        out.push(Surface::new(
            format!("help[colony {flag}]"),
            help_for(&["colony", flag]),
        ));
    }

    let mut paths = Vec::new();
    command_paths(&build_command(), &mut Vec::new(), &mut paths);
    for path in paths {
        let mut argv = vec!["colony"];
        argv.extend(path.iter().map(String::as_str));
        argv.push("--help");
        out.push(Surface::new(
            format!("help[{}]", argv.join(" ")),
            help_for(&argv),
        ));
    }
    out
}

#[test]
fn cli_help_invoked_as_colony_never_says_buzz() {
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
fn guard_flags_injected_buzz_in_the_real_help() {
    brand_guard::assert_guard_is_falsifiable(&surfaces(), ALLOW);
}

#[test]
fn guard_corpus_covers_the_whole_command_tree() {
    let all = surfaces();
    assert!(
        all.len() > 30,
        "expected the root and the whole command tree, found {} surfaces",
        all.len()
    );
    let find = |needle: &str| all.iter().any(|s| s.name == needle);
    assert!(find("help[colony --help]"), "root --help missing");
    assert!(find("help[colony -h]"), "root -h missing");
    assert!(
        find("help[colony messages send --help]"),
        "a leaf command is missing"
    );
    let root = all
        .iter()
        .find(|s| s.name == "help[colony --help]")
        .expect("root help surface");
    assert!(
        root.text.contains("Usage: colony"),
        "the help was not rendered as the colony command:\n{}",
        root.text
    );
}
