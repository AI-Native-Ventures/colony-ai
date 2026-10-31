//! Guard rails that keep agents out of macOS privacy-protected folders.
//!
//! macOS attributes a child process to the app that launched it ("responsible
//! process"). When an agent runs `find ~` it walks into the Photos Library,
//! Music, Mail and similar locations, and macOS then asks the owner to let
//! *Colony* access them. Colony has no feature that needs those locations, and
//! because the app is ad-hoc signed a "Don't Allow" is forgotten at the next
//! update, so the dialog comes back. The fix is to stop agents from walking
//! there in the first place.
//!
//! Per harness this module enforces what the harness allows:
//!
//! - **Claude Code** (`claude-agent-acp`): permission deny rules passed in
//!   `session/new` `_meta.claudeCode.options.disallowedTools`. Deny rules win
//!   over `bypassPermissions`.
//! - **OpenCode**: a `permission` block merged into `OPENCODE_CONFIG_CONTENT`.
//! - **Codex**: nothing the adapter config supports (see [`CODEX_NOTE`]); the
//!   base prompt rule is the only guard there.

use serde_json::{json, Map, Value};

/// Folders under the home directory that macOS protects (or that hold private
/// data) and that no Colony feature needs. Paths are home-relative.
pub(crate) const PRIVATE_HOME_FOLDERS: &[&str] = &[
    "Pictures",
    "Music",
    "Movies",
    "Library/Mail",
    "Library/Messages",
    "Library/Calendars",
    "Library/Application Support/AddressBook",
];

/// Absolute roots that hold removable or network volumes.
pub(crate) const PRIVATE_ABSOLUTE_FOLDERS: &[&str] = &["/Volumes"];

/// Why Codex gets no config guard, for the PR and logs.
pub(crate) const CODEX_NOTE: &str = "codex-acp has no per-path read deny in its supported config; \
     agents are only instructed via the base prompt";

/// Whole-home scan shapes. Each entry is a command prefix; Claude Code matches
/// `Bash(<prefix>:*)` on a word boundary, so `find ~` matches `find ~ -name x`
/// and `find ~/ -name x` but never `find ~/.colony/RESEARCH`.
const HOME_SCAN_PREFIXES: &[&str] = &[
    "find ~",
    "find ~/",
    "find $HOME",
    "find $HOME/",
    "find \"$HOME\"",
    "find /Users",
    "find /",
    "find -L ~",
    "find -L $HOME",
    "grep -r ~",
    "grep -R ~",
    "grep -rn ~",
    "grep -rl ~",
    "grep -ri ~",
    "grep -r $HOME",
    "grep -R $HOME",
    "grep -r /Users",
    "grep -R /Users",
    "rg ~",
    "rg --files ~",
    "rg $HOME",
    "du ~",
    "du -a ~",
    "ls -R ~",
    "ls -R $HOME",
    "tree ~",
    "tree $HOME",
];

/// Claude Code permission rules for the private folders.
///
/// `home` is the resolved home directory (for example from `$HOME`) so the
/// absolute spelling of the same paths is covered too. Pass `None` when it is
/// unknown; the `~` forms still apply.
pub(crate) fn claude_disallowed_tools(home: Option<&str>) -> Vec<String> {
    let home = home
        .map(|h| h.trim_end_matches('/'))
        .filter(|h| !h.is_empty());
    let mut rules = Vec::new();

    let mut paths: Vec<String> = Vec::new();
    for folder in PRIVATE_HOME_FOLDERS {
        paths.push(format!("~/{folder}"));
        if let Some(home) = home {
            paths.push(format!("{home}/{folder}"));
        }
    }
    for folder in PRIVATE_ABSOLUTE_FOLDERS {
        paths.push((*folder).to_owned());
    }

    for path in &paths {
        // File tools. `//` marks an absolute path in Claude Code rule syntax.
        let spec = if path.starts_with("~/") {
            path.clone()
        } else {
            format!("/{path}")
        };
        for tool in ["Read", "Glob", "Grep", "Edit"] {
            rules.push(format!("{tool}({spec})"));
            rules.push(format!("{tool}({spec}/**)"));
        }
        // Shell: anything that names the folder as an argument.
        rules.push(format!("Bash(* {path})"));
        rules.push(format!("Bash(* {path}/*)"));
        rules.push(format!("Bash(ls {path}:*)"));
        rules.push(format!("Bash(find {path}:*)"));
        rules.push(format!("Bash(open {path}:*)"));
    }

    for prefix in HOME_SCAN_PREFIXES {
        rules.push(format!("Bash({prefix}:*)"));
    }
    if let Some(home) = home {
        for prefix in ["find", "grep -r", "grep -R", "rg", "du", "ls -R", "tree"] {
            rules.push(format!("Bash({prefix} {home}:*)"));
            rules.push(format!("Bash({prefix} {home}/:*)"));
        }
    }

    rules.sort();
    rules.dedup();
    rules
}

/// OpenCode `permission` block for the private folders.
pub(crate) fn opencode_permission(home: Option<&str>) -> Value {
    let home = home
        .map(|h| h.trim_end_matches('/'))
        .filter(|h| !h.is_empty());
    let mut read = Map::new();
    let mut external = Map::new();
    let mut bash = Map::new();

    let mut paths: Vec<String> = Vec::new();
    for folder in PRIVATE_HOME_FOLDERS {
        paths.push(format!("~/{folder}"));
        if let Some(home) = home {
            paths.push(format!("{home}/{folder}"));
        }
    }
    for folder in PRIVATE_ABSOLUTE_FOLDERS {
        paths.push((*folder).to_owned());
    }
    for path in &paths {
        read.insert(format!("{path}/**"), json!("deny"));
        read.insert(path.clone(), json!("deny"));
        external.insert(format!("{path}/**"), json!("deny"));
        external.insert(path.clone(), json!("deny"));
        bash.insert(format!("* {path}*"), json!("deny"));
    }
    for prefix in HOME_SCAN_PREFIXES {
        bash.insert((*prefix).to_owned(), json!("deny"));
        bash.insert(format!("{prefix} *"), json!("deny"));
    }
    json!({
        "read": read,
        "external_directory": external,
        "bash": bash,
    })
}

/// Merge the private-folder `permission` block into an `OPENCODE_CONFIG_CONTENT`
/// JSON object. Existing `deny` rules and unrelated keys survive; a rule for
/// the same pattern is forced to `deny`. Returns `None` when `existing` is not
/// a JSON object (the caller then leaves the variable alone rather than
/// replacing a config it cannot read).
pub(crate) fn opencode_config_with_guard(
    existing: Option<&str>,
    home: Option<&str>,
) -> Option<String> {
    let mut config = match existing.map(str::trim).filter(|s| !s.is_empty()) {
        None => Map::new(),
        Some(raw) => match serde_json::from_str::<Value>(raw) {
            Ok(Value::Object(map)) => map,
            _ => return None,
        },
    };
    // `"permission": "allow"` shorthand becomes a `*` rule so deny patterns
    // can sit beside it (the last matching rule wins).
    let mut permission = match config.remove("permission") {
        Some(Value::Object(map)) => map,
        Some(Value::Null) | None => Map::new(),
        Some(blanket) => Map::from_iter([("*".to_owned(), blanket)]),
    };
    if let Value::Object(guard) = opencode_permission(home) {
        for (tool, rules) in guard {
            let Value::Object(rules) = rules else {
                continue;
            };
            let mut merged = match permission.remove(&tool) {
                Some(Value::Object(map)) => map,
                Some(Value::Null) | None => Map::new(),
                // A bare action such as `"bash": "allow"` keeps working as a
                // `*` rule with the deny patterns after it.
                Some(blanket) => Map::from_iter([("*".to_owned(), blanket)]),
            };
            for (pattern, action) in rules {
                merged.insert(pattern, action);
            }
            permission.insert(tool, Value::Object(merged));
        }
    }
    config.insert("permission".to_owned(), Value::Object(permission));
    Some(Value::Object(config).to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn claude_rules_cover_every_private_folder_for_every_file_tool() {
        let rules = claude_disallowed_tools(Some("/Users/example"));
        for folder in PRIVATE_HOME_FOLDERS {
            for tool in ["Read", "Glob", "Grep"] {
                assert!(
                    rules.contains(&format!("{tool}(~/{folder}/**)")),
                    "missing {tool} deny for ~/{folder}"
                );
                assert!(
                    rules.contains(&format!("{tool}(//Users/example/{folder}/**)")),
                    "missing absolute {tool} deny for {folder}"
                );
            }
        }
        assert!(rules.contains(&"Read(//Volumes/**)".to_owned()));
    }

    #[test]
    fn claude_rules_block_whole_home_scans() {
        let rules = claude_disallowed_tools(Some("/Users/example"));
        for expected in [
            "Bash(find ~:*)",
            "Bash(find $HOME:*)",
            "Bash(find /Users:*)",
            "Bash(find /Users/example:*)",
            "Bash(grep -r ~:*)",
            "Bash(grep -r /Users/example:*)",
        ] {
            assert!(rules.iter().any(|r| r == expected), "missing {expected}");
        }
    }

    #[test]
    fn claude_rules_do_not_block_the_nest() {
        // Prefix rules match on a word boundary: `find ~/.colony/...` is not
        // `find ~` followed by a space, so the nest stays searchable.
        let rules = claude_disallowed_tools(Some("/Users/example"));
        assert!(!rules.iter().any(|r| r.contains(".colony")));
        assert!(!rules.iter().any(|r| r == "Bash(find:*)"));
        assert!(!rules.iter().any(|r| r.starts_with("Read(~/**")));
    }

    #[test]
    fn claude_rules_work_without_a_known_home() {
        let rules = claude_disallowed_tools(None);
        assert!(rules.contains(&"Read(~/Pictures/**)".to_owned()));
        assert!(rules.contains(&"Bash(find ~:*)".to_owned()));
        assert!(!rules.iter().any(|r| r.contains("//Users/")));
    }

    #[test]
    fn opencode_guard_merges_into_existing_config() {
        let merged = opencode_config_with_guard(
            Some(r#"{"autoupdate":false,"share":"disabled"}"#),
            Some("/Users/example"),
        )
        .expect("merged");
        let value: Value = serde_json::from_str(&merged).unwrap();
        assert_eq!(value["autoupdate"], json!(false));
        assert_eq!(value["share"], json!("disabled"));
        assert_eq!(value["permission"]["read"]["~/Pictures/**"], json!("deny"));
        assert_eq!(
            value["permission"]["external_directory"]["/Volumes/**"],
            json!("deny")
        );
        assert_eq!(value["permission"]["bash"]["find ~ *"], json!("deny"));
    }

    #[test]
    fn opencode_guard_keeps_blanket_permission_and_forces_deny() {
        let merged = opencode_config_with_guard(
            Some(r#"{"permission":{"bash":"allow","read":{"~/Pictures/**":"allow"}}}"#),
            None,
        )
        .expect("merged");
        let value: Value = serde_json::from_str(&merged).unwrap();
        assert_eq!(value["permission"]["bash"]["*"], json!("allow"));
        assert_eq!(value["permission"]["bash"]["find ~ *"], json!("deny"));
        assert_eq!(value["permission"]["read"]["~/Pictures/**"], json!("deny"));
    }

    #[test]
    fn opencode_guard_leaves_unreadable_config_alone() {
        assert!(opencode_config_with_guard(Some("not json"), None).is_none());
        assert!(opencode_config_with_guard(Some("[1]"), None).is_none());
        assert!(opencode_config_with_guard(None, None).is_some());
    }
}
