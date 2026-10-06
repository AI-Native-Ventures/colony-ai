//! Tests for the managed-section markers of AGENTS.md.
//!
//! This build writes the current markers only. Files written by builds before
//! the rename still carry the legacy ones, so every case that matters runs for
//! all four pairings of opening and closing marker: current, legacy, and the
//! two mixes. The owner's notes above and below the section must come back
//! byte for byte, and no legacy marker may survive a refresh or an upsert.

use super::*;

/// How a file in the wild pairs its opening and closing markers.
#[derive(Clone, Copy, Debug)]
enum Pairing {
    Current,
    Legacy,
    LegacyBeginCurrentEnd,
    CurrentBeginLegacyEnd,
}

const PAIRINGS: [Pairing; 4] = [
    Pairing::Current,
    Pairing::Legacy,
    Pairing::LegacyBeginCurrentEnd,
    Pairing::CurrentBeginLegacyEnd,
];

/// The opening line older builds wrote on every regeneration. The em dash is an
/// escape so this file stays free of it.
fn legacy_begin_line() -> String {
    format!("{LEGACY_BEGIN_MARKER} \u{2014} regenerated automatically, do not edit below -->")
}

/// The opening line of the old template, which a nest that was never
/// regenerated still holds.
fn legacy_template_begin_line() -> String {
    format!("{LEGACY_BEGIN_MARKER} , regenerated automatically, do not edit below -->")
}

impl Pairing {
    fn begin_line(self) -> String {
        match self {
            Pairing::Current | Pairing::CurrentBeginLegacyEnd => BEGIN_LINE.to_string(),
            Pairing::Legacy | Pairing::LegacyBeginCurrentEnd => legacy_begin_line(),
        }
    }

    fn end_marker(self) -> &'static str {
        match self {
            Pairing::Current | Pairing::LegacyBeginCurrentEnd => END_MARKER,
            Pairing::Legacy | Pairing::CurrentBeginLegacyEnd => LEGACY_END_MARKER,
        }
    }

    /// A complete section of this pairing, ending in a newline.
    fn section(self, body: &str) -> String {
        format!("{}\n{body}\n{}\n", self.begin_line(), self.end_marker())
    }
}

/// A complete section with the current markers, as this build writes it.
fn current_section(body: &str) -> String {
    Pairing::Current.section(body)
}

/// Owner notes above the section: CRLF, trailing spaces and an inline mention
/// that is not a marker. Ends so the section starts on a fresh line.
const NOTES_ABOVE: &str =
    "# My own notes\r\n\r\n  indented line with trailing spaces   \n\nmention <!-- not a marker --> inline\n\n";

/// Owner notes below the section: a marker-looking line that is indented, so it
/// is not at column 0, and a last line with no newline.
const NOTES_BELOW: &str =
    "\n## Mine\n    <!-- BEGIN BUZZ MANAGED indented, not a marker -->\nlast line without newline";

/// A line that opens or closes a legacy section at column 0.
fn has_legacy_marker_line(text: &str) -> bool {
    text.lines()
        .any(|line| line.starts_with(LEGACY_BEGIN_MARKER) || line.starts_with(LEGACY_END_MARKER))
}

fn write_agents_md(dir: &Path, content: &str) -> PathBuf {
    let file = dir.join("AGENTS.md");
    fs::write(&file, content).unwrap();
    file
}

/// The template text above its managed section: what a refresh puts first.
fn template_static() -> &'static str {
    &AGENTS_MD[..AGENTS_MD
        .find(BEGIN_LINE)
        .expect("template has the opening line")]
}

#[test]
fn legacy_markers_are_the_text_older_builds_wrote() {
    // Detection only. Changing either string would stop finding the sections
    // that every existing install holds.
    assert_eq!(LEGACY_BEGIN_MARKER, "<!-- BEGIN BUZZ MANAGED");
    assert_eq!(LEGACY_END_MARKER, "<!-- END BUZZ MANAGED -->");
}

#[test]
fn the_markers_this_build_writes_never_say_the_old_name() {
    for text in [BEGIN_MARKER, BEGIN_LINE, END_MARKER] {
        assert!(
            !text.to_ascii_lowercase().contains("buzz"),
            "marker `{text}` must not carry the old name"
        );
        assert!(
            !text.contains('\u{2014}'),
            "marker `{text}` must not carry an em dash"
        );
    }
    assert!(BEGIN_LINE.starts_with(BEGIN_MARKER));
}

#[test]
fn the_template_carries_exactly_one_current_section() {
    assert_eq!(AGENTS_MD.matches(BEGIN_LINE).count(), 1);
    assert_eq!(AGENTS_MD.matches(END_MARKER).count(), 1);
    assert!(
        AGENTS_MD.contains(&format!("\n{BEGIN_LINE}\n")),
        "the opening line must sit on its own line"
    );
    assert!(
        !AGENTS_MD.to_ascii_lowercase().contains("buzz"),
        "the template must not say the old name anywhere"
    );
}

#[test]
fn a_fresh_nest_never_says_the_old_name_in_agents_md() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join(".colony");
    ensure_nest_at(&root).unwrap();

    let agents_md = root.join("AGENTS.md");
    let written = fs::read_to_string(&agents_md).unwrap();
    assert_eq!(written, AGENTS_MD, "a fresh nest holds the template as is");
    assert!(!written.to_ascii_lowercase().contains("buzz"));

    // After boot the managed section is regenerated with the roster.
    let managed = render_dynamic_section(&[], &[], &HashSet::new(), "wss://relay.example.com");
    upsert_managed_section(&agents_md, &managed).unwrap();
    let regenerated = fs::read_to_string(&agents_md).unwrap();
    assert!(!regenerated.to_ascii_lowercase().contains("buzz"));
    assert_eq!(regenerated.matches(BEGIN_MARKER).count(), 1);
    assert_eq!(regenerated.matches(END_MARKER).count(), 1);
}

#[test]
fn upsert_replaces_a_section_of_every_pairing_once_and_keeps_both_sides_byte_for_byte() {
    for pairing in PAIRINGS {
        let tmp = tempfile::tempdir().unwrap();
        let file = write_agents_md(
            tmp.path(),
            &format!(
                "{NOTES_ABOVE}{}{NOTES_BELOW}",
                pairing.section("old roster")
            ),
        );

        upsert_managed_section(&file, "new roster").unwrap();

        let result = fs::read_to_string(&file).unwrap();
        assert_eq!(
            result,
            format!(
                "{NOTES_ABOVE}{}{NOTES_BELOW}",
                current_section("new roster")
            ),
            "{pairing:?}: the section is replaced as a whole and nothing else moves"
        );
        assert_eq!(result.matches(BEGIN_MARKER).count(), 1, "{pairing:?}");
        assert_eq!(result.matches(END_MARKER).count(), 1, "{pairing:?}");
        assert!(!has_legacy_marker_line(&result), "{pairing:?}");
        assert!(!result.contains("old roster"), "{pairing:?}");
    }
}

#[test]
fn upsert_is_idempotent_for_every_pairing() {
    for pairing in PAIRINGS {
        let tmp = tempfile::tempdir().unwrap();
        let file = write_agents_md(
            tmp.path(),
            &format!(
                "{NOTES_ABOVE}{}{NOTES_BELOW}",
                pairing.section("old roster")
            ),
        );

        upsert_managed_section(&file, "same roster").unwrap();
        let first = fs::read_to_string(&file).unwrap();
        upsert_managed_section(&file, "same roster").unwrap();
        let second = fs::read_to_string(&file).unwrap();

        assert_eq!(
            first, second,
            "{pairing:?}: the second upsert changes nothing"
        );
    }
}

#[test]
fn upsert_replaces_the_block_of_a_nest_that_was_never_regenerated() {
    // What a build before the rename wrote on first launch: the template with
    // its comma form of the opening line and the legacy closing marker.
    let old_template = AGENTS_MD
        .replace(BEGIN_LINE, &legacy_template_begin_line())
        .replace(END_MARKER, LEGACY_END_MARKER);
    assert!(
        has_legacy_marker_line(&old_template),
        "fixture precondition"
    );
    let tmp = tempfile::tempdir().unwrap();
    let file = write_agents_md(tmp.path(), &format!("{old_template}{NOTES_BELOW}"));

    upsert_managed_section(&file, "new roster").unwrap();

    assert_eq!(
        fs::read_to_string(&file).unwrap(),
        format!(
            "{}{}{NOTES_BELOW}",
            template_static(),
            current_section("new roster")
        )
    );
}

#[test]
fn upsert_with_an_unmatched_opening_marker_keeps_the_text_after_it() {
    // No closing marker: the unmatched opening line goes, the text that followed
    // it stays, and one new section is appended.
    for begin in [BEGIN_LINE.to_string(), legacy_begin_line()] {
        let tmp = tempfile::tempdir().unwrap();
        let file = write_agents_md(
            tmp.path(),
            &format!("{NOTES_ABOVE}{begin}\norphaned body\n"),
        );

        upsert_managed_section(&file, "fresh").unwrap();

        assert_eq!(
            fs::read_to_string(&file).unwrap(),
            format!("{NOTES_ABOVE}orphaned body\n\n{}", current_section("fresh")),
            "opening line `{begin}`"
        );
    }
}

#[test]
fn upsert_with_the_closing_marker_before_the_opening_one_keeps_the_text_between() {
    // No ordered pair. The opening line is unmatched and goes. A legacy closing
    // line is unmatched too and goes; a current one stays, as it always did.
    for pairing in PAIRINGS {
        let tmp = tempfile::tempdir().unwrap();
        let file = write_agents_md(
            tmp.path(),
            &format!(
                "# Header\n\n{}\nsome middle content\n{}\nold section\n",
                pairing.end_marker(),
                pairing.begin_line()
            ),
        );

        upsert_managed_section(&file, "fresh").unwrap();

        let kept_end = match pairing {
            Pairing::Current | Pairing::LegacyBeginCurrentEnd => format!("{END_MARKER}\n"),
            Pairing::Legacy | Pairing::CurrentBeginLegacyEnd => String::new(),
        };
        let result = fs::read_to_string(&file).unwrap();
        assert_eq!(
            result,
            format!(
                "# Header\n\n{kept_end}some middle content\nold section\n\n{}",
                current_section("fresh")
            ),
            "{pairing:?}"
        );
        assert!(!has_legacy_marker_line(&result), "{pairing:?}");
    }
}

#[test]
fn upsert_with_only_a_legacy_closing_marker_drops_just_that_line() {
    let tmp = tempfile::tempdir().unwrap();
    let file = write_agents_md(
        tmp.path(),
        &format!("# Header\n\n{LEGACY_END_MARKER}\nafter\n"),
    );

    upsert_managed_section(&file, "fresh").unwrap();

    assert_eq!(
        fs::read_to_string(&file).unwrap(),
        format!("# Header\n\nafter\n\n{}", current_section("fresh"))
    );
}

#[test]
fn upsert_replaces_only_the_first_section_of_a_duplicated_pair() {
    let second = Pairing::Legacy.section("second block");
    let tmp = tempfile::tempdir().unwrap();
    let file = write_agents_md(
        tmp.path(),
        &format!(
            "# Header\n\n{}\nbetween blocks\n\n{second}",
            Pairing::Legacy.section("first block")
        ),
    );

    upsert_managed_section(&file, "replaced").unwrap();

    assert_eq!(
        fs::read_to_string(&file).unwrap(),
        format!(
            "# Header\n\n{}\nbetween blocks\n\n{second}",
            current_section("replaced")
        ),
        "the first pair is replaced, the text between and the second pair are not touched"
    );
}

#[test]
fn upsert_ignores_an_indented_legacy_marker() {
    let tmp = tempfile::tempdir().unwrap();
    let indented = format!("    {LEGACY_BEGIN_MARKER} - quoted in a code block -->");
    let file = write_agents_md(
        tmp.path(),
        &format!("# Header\n\n{indented}\n\nReal content here\n"),
    );

    upsert_managed_section(&file, "appended").unwrap();

    assert_eq!(
        fs::read_to_string(&file).unwrap(),
        format!(
            "# Header\n\n{indented}\n\nReal content here\n\n{}",
            current_section("appended")
        )
    );
}

/// Write a nest the way an earlier build left it: stale static text above the
/// section, the section, then the owner's notes, and an old version stamp.
fn seed_old_nest(root: &Path, pairing: Pairing, version: Option<&str>) {
    fs::create_dir_all(root).unwrap();
    write_agents_md(
        root,
        &format!(
            "# Stale static text\n\n{}{NOTES_BELOW}",
            pairing.section("stale roster")
        ),
    );
    if let Some(version) = version {
        fs::write(root.join(".nest-agents-version"), format!("{version}\n")).unwrap();
    }
}

#[test]
fn refresh_rewrites_the_markers_of_every_pairing_and_keeps_the_notes_below() {
    for pairing in PAIRINGS {
        for version in [Some("6"), Some("1"), None] {
            let tmp = tempfile::tempdir().unwrap();
            let root = tmp.path().join(".colony");
            seed_old_nest(&root, pairing, version);

            ensure_nest_at(&root).unwrap();

            let result = fs::read_to_string(root.join("AGENTS.md")).unwrap();
            assert_eq!(
                result,
                format!(
                    "{}{}{NOTES_BELOW}",
                    template_static(),
                    current_section("stale roster")
                ),
                "{pairing:?} at version {version:?}: static text refreshed, section body and notes kept"
            );
            assert!(!has_legacy_marker_line(&result), "{pairing:?} {version:?}");
            let stamp = fs::read_to_string(root.join(".nest-agents-version")).unwrap();
            assert_eq!(stamp.trim(), NEST_AGENTS_VERSION.to_string());
        }
    }
}

#[test]
fn refresh_is_a_no_op_the_second_time() {
    for pairing in PAIRINGS {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join(".colony");
        seed_old_nest(&root, pairing, Some("6"));

        ensure_nest_at(&root).unwrap();
        let first = fs::read_to_string(root.join("AGENTS.md")).unwrap();
        ensure_nest_at(&root).unwrap();
        let second = fs::read_to_string(root.join("AGENTS.md")).unwrap();

        assert_eq!(first, second, "{pairing:?}");
    }
}

#[test]
fn refresh_then_upsert_ends_with_one_current_section_and_the_notes_unchanged() {
    // The first boot after an upgrade: the refresh at ensure time, then the
    // regeneration that renders the roster.
    for pairing in PAIRINGS {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join(".colony");
        seed_old_nest(&root, pairing, Some("6"));

        ensure_nest_at(&root).unwrap();
        let agents_md = root.join("AGENTS.md");
        upsert_managed_section(&agents_md, "rendered roster").unwrap();

        assert_eq!(
            fs::read_to_string(&agents_md).unwrap(),
            format!(
                "{}{}{NOTES_BELOW}",
                template_static(),
                current_section("rendered roster")
            ),
            "{pairing:?}"
        );
    }
}

#[test]
fn refresh_rewrites_an_unmatched_legacy_opening_marker_and_keeps_what_follows() {
    // No closing marker. The legacy line becomes the current one so no legacy
    // marker survives; the next upsert treats it like any unmatched opening line.
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join(".colony");
    fs::create_dir_all(&root).unwrap();
    write_agents_md(
        &root,
        &format!(
            "# Stale static text\n\n{}\norphaned body\n",
            legacy_begin_line()
        ),
    );
    fs::write(root.join(".nest-agents-version"), "6\n").unwrap();

    ensure_nest_at(&root).unwrap();

    let agents_md = root.join("AGENTS.md");
    let refreshed = fs::read_to_string(&agents_md).unwrap();
    assert_eq!(
        refreshed,
        format!("{}{BEGIN_LINE}\norphaned body\n", template_static())
    );

    upsert_managed_section(&agents_md, "fresh").unwrap();
    assert_eq!(
        fs::read_to_string(&agents_md).unwrap(),
        format!(
            "{}orphaned body\n\n{}",
            template_static(),
            current_section("fresh")
        )
    );
}

#[test]
fn refresh_leaves_a_file_with_no_section_to_the_full_template() {
    // The existing fail-safe: no section of either generation, so the file is
    // replaced by the template, which carries the current markers.
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join(".colony");
    fs::create_dir_all(&root).unwrap();
    write_agents_md(&root, "# Only my text\n");
    fs::write(root.join(".nest-agents-version"), "6\n").unwrap();

    ensure_nest_at(&root).unwrap();

    assert_eq!(
        fs::read_to_string(root.join("AGENTS.md")).unwrap(),
        AGENTS_MD
    );
}

#[test]
fn migrate_legacy_markers_leaves_current_markers_and_everything_else_alone() {
    let current = format!("{}{NOTES_BELOW}", current_section("body"));
    assert_eq!(migrate_legacy_markers(&current), current);
    assert_eq!(migrate_legacy_markers(""), "");
    assert_eq!(
        migrate_legacy_markers("no section here\r\n"),
        "no section here\r\n"
    );
}
