//! The CLI says Colony wherever an agent or person can read it, and keeps
//! answering to its legacy `buzz` name.

use crate::{build_command, invoked_name, parse_args};
use clap::error::ErrorKind;
use std::ffi::OsStr;

/// True when `text` still carries the old product name in any casing.
fn leaks_old_name(text: &str) -> bool {
    text.to_ascii_lowercase().contains("buzz")
}

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

#[test]
fn leak_check_flags_the_old_name_and_passes_the_new_one() {
    // Falsifiability: the predicate behind every assertion below must fail on a
    // real leak, otherwise the tree walk proves nothing.
    assert!(leaks_old_name("Run `buzz mem get core` first"));
    assert!(leaks_old_name("Buzz Desktop renders it"));
    assert!(leaks_old_name("set BUZZ_RELAY_URL"));
    assert!(!leaks_old_name("Run `colony mem get core` first"));
}

#[test]
fn root_help_invoked_as_colony_never_says_buzz() {
    for flag in ["--help", "-h"] {
        let help = help_for(&["colony", flag]);
        assert!(help.contains("Usage: colony"), "{flag}:\n{help}");
        assert!(help.contains("Colony CLI"), "{flag}:\n{help}");
        assert!(
            !leaks_old_name(&help),
            "root {flag} leaks the old name:\n{help}"
        );
    }
}

#[test]
fn every_group_and_subcommand_help_is_free_of_the_old_name() {
    let mut paths = Vec::new();
    command_paths(&build_command(), &mut Vec::new(), &mut paths);
    assert!(
        paths.len() > 30,
        "expected the whole command tree, found {} paths",
        paths.len()
    );

    for path in paths {
        let mut argv = vec!["colony"];
        argv.extend(path.iter().map(String::as_str));
        argv.push("--help");
        let help = help_for(&argv);
        assert!(
            !leaks_old_name(&help),
            "`colony {}` --help leaks the old name:\n{help}",
            path.join(" ")
        );
    }
}

#[test]
fn help_never_names_the_environment_variables() {
    let help = help_for(&["colony", "--help"]);
    assert!(help.contains("--relay <RELAY>"), "{help}");
    assert!(help.contains("--private-key <PRIVATE_KEY>"), "{help}");
    assert!(!help.contains("[env:"), "{help}");
    assert!(!help.contains("BUZZ_"), "{help}");
}

#[test]
fn examples_teach_the_colony_command() {
    let help = help_for(&["colony", "channels", "list", "--help"]);
    assert!(help.contains("colony channels list"), "{help}");
    let help = help_for(&["colony", "messages", "send", "--help"]);
    assert!(
        help.contains("colony messages send --channel <UUID>"),
        "{help}"
    );
}

#[test]
fn usage_prints_the_name_the_cli_was_invoked_as() {
    let colony = help_for(&["colony", "messages", "send", "--help"]);
    assert!(colony.contains("Usage: colony messages send"), "{colony}");

    // A full path, as the shim directory and the app-private link produce.
    let by_path = help_for(&["/opt/colony/bin/colony", "--help"]);
    assert!(by_path.contains("Usage: colony"), "{by_path}");

    // Older agents and scripts still call it `buzz`, and it still works.
    let legacy = help_for(&["buzz", "messages", "send", "--help"]);
    assert!(legacy.contains("Usage: buzz messages send"), "{legacy}");
}

#[test]
fn invoked_name_is_the_file_stem_with_a_colony_fallback() {
    assert_eq!(invoked_name(Some(OsStr::new("colony"))), "colony");
    assert_eq!(
        invoked_name(Some(OsStr::new("/tmp/shims/colony"))),
        "colony"
    );
    assert_eq!(
        invoked_name(Some(OsStr::new("/tmp/shims/colony.exe"))),
        "colony"
    );
    assert_eq!(invoked_name(Some(OsStr::new("/usr/bin/buzz"))), "buzz");
    assert_eq!(invoked_name(Some(OsStr::new(""))), "colony");
    assert_eq!(invoked_name(None), "colony");
}

#[test]
fn legacy_buzz_invocation_still_parses_commands() {
    for name in ["colony", "buzz"] {
        assert!(
            parse_args([name, "channels", "list"]).is_ok(),
            "{name} should parse `channels list`"
        );
    }
}
