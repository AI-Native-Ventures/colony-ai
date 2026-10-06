//! Brand guard for what the model reads from the dev-MCP server.
//!
//! Two things reach the model from here: the server instructions (the shell
//! bootstrap, with its working directory and the hint about the CLI) and the
//! tool listing (every tool's name, description and parameter schema). Both are
//! produced by the production code paths. See `test-support/brand_guard.rs` for
//! the matching rules.
//!
//! Not covered: the MCP server name reported by `get_info`, which needs a live
//! shell state to construct, and the Git Bash error message that only exists in
//! Windows builds.

#[path = "../../../test-support/brand_guard.rs"]
mod brand_guard;

use std::path::Path;

use brand_guard::{Allow, Surface};

use crate::shell::build_bootstrap_with;
use crate::DevMcp;

/// Nothing is allowed: tool descriptions and the bootstrap name no variables
/// and no old product name. An entry would need a written reason and would
/// fail the stale check as soon as the text stopped needing it.
const ALLOW: &[Allow] = &[];

fn surfaces() -> Vec<Surface> {
    let mut out = Vec::new();
    for (shell, colony_connected) in [("bash", true), ("bash", false), ("powershell", true)] {
        out.push(Surface::new(
            format!("bootstrap[{shell}, connected={colony_connected}]"),
            build_bootstrap_with(Path::new("/work/project"), shell, colony_connected),
        ));
    }
    for tool in DevMcp::tool_router().list_all() {
        out.push(Surface::new(
            format!("tool listing[{}]", tool.name),
            serde_json::to_string_pretty(&tool).expect("a tool definition serializes to json"),
        ));
    }
    out
}

#[test]
fn dev_mcp_text_never_says_buzz() {
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
fn guard_corpus_covers_the_bootstrap_and_every_tool() {
    let all = surfaces();
    let find = |needle: &str| all.iter().find(|s| s.name == needle);
    let shell = find("tool listing[shell]").expect("the shell tool is listed");
    assert!(
        shell.text.contains("\"description\""),
        "tool descriptions must be part of the scanned text: {}",
        shell.text
    );
    let connected = find("bootstrap[bash, connected=true]").expect("connected bootstrap");
    let bare = find("bootstrap[bash, connected=false]").expect("bare bootstrap");
    assert!(
        connected.text.len() > bare.text.len(),
        "the connected bootstrap must carry the CLI hint the bare one lacks"
    );
    assert!(
        all.iter()
            .filter(|s| s.name.starts_with("tool listing["))
            .count()
            >= 5,
        "expected the full tool listing"
    );
}
