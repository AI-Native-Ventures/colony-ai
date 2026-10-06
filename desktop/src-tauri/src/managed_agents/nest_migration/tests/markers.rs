//! The first boot after the move: the host refreshes the moved AGENTS.md and
//! regenerates its managed section, and the file must end with one section
//! carrying the current markers and the owner's notes below it unchanged.

use super::*;
use crate::managed_agents::{ensure_nest_at, upsert_managed_section, AGENTS_MD};

/// What `~/.buzz/AGENTS.md` looks like on an install from before the rename.
/// The em dash is an escape so this file stays free of it.
const LEGACY_AGENTS_MD: &str = "# Nest\nstatic\n<!-- BEGIN BUZZ MANAGED \u{2014} regenerated automatically, do not edit below -->\n## Active Agents\n\nold roster\n<!-- END BUZZ MANAGED -->\nmine\n\nmore of mine\n";

const CURRENT_BEGIN: &str =
    "<!-- BEGIN COLONY MANAGED - regenerated automatically, do not edit below -->";
const CURRENT_END: &str = "<!-- END COLONY MANAGED -->";
const OWNER_NOTES: &str = "mine\n\nmore of mine\n";

/// The template text above its managed section.
fn template_static() -> &'static str {
    &AGENTS_MD[..AGENTS_MD
        .find(CURRENT_BEGIN)
        .expect("template opening line")]
}

#[test]
fn a_moved_agents_md_with_legacy_markers_ends_with_one_current_section_and_the_notes() {
    let env = Env::new();
    write(&env.old().join("AGENTS.md"), LEGACY_AGENTS_MD.as_bytes());
    write(&env.old().join(".nest-agents-version"), b"6\n");

    // The move changes no byte.
    assert_eq!(env.run().outcome, Outcome::Migrated);
    let moved = env.new_dir().join("AGENTS.md");
    assert_eq!(fs::read_to_string(&moved).unwrap(), LEGACY_AGENTS_MD);

    // Boot step one: the refresh at ensure time rewrites the markers in place.
    ensure_nest_at(&env.new_dir()).unwrap();
    let refreshed = fs::read_to_string(&moved).unwrap();
    assert_eq!(
        refreshed,
        format!(
            "{}{CURRENT_BEGIN}\n## Active Agents\n\nold roster\n{CURRENT_END}\n{OWNER_NOTES}",
            template_static()
        )
    );

    // Boot step two: the regeneration replaces the section with the roster.
    upsert_managed_section(&moved, "## Active Agents\n\nnew roster").unwrap();
    let regenerated = fs::read_to_string(&moved).unwrap();
    assert_eq!(
        regenerated,
        format!(
            "{}{CURRENT_BEGIN}\n## Active Agents\n\nnew roster\n{CURRENT_END}\n{OWNER_NOTES}",
            template_static()
        )
    );
    assert_eq!(regenerated.matches("MANAGED").count(), 2, "one section");
    assert!(
        !regenerated.to_ascii_lowercase().contains("buzz"),
        "no trace of the old name is left in the file"
    );

    // A second boot changes nothing.
    ensure_nest_at(&env.new_dir()).unwrap();
    upsert_managed_section(&moved, "## Active Agents\n\nnew roster").unwrap();
    assert_eq!(fs::read_to_string(&moved).unwrap(), regenerated);
}
