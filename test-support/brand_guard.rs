//! Brand guard: fails when text an agent can see says the old product name.
//!
//! This file is shared test source, not a crate. Each crate that owns an
//! agent-visible text surface includes it from a `#[cfg(test)]` module with
//! `#[path = "..."]`, builds a corpus from its REAL production constants and
//! rendered outputs, and calls the `assert_*` functions below. Sharing source
//! (instead of a crate) keeps `Cargo.lock` untouched and lets every surface
//! use exactly the same matching rules.
//!
//! Rules:
//!
//! * Any case-insensitive `buzz` in a surface is a violation, unless the
//!   occurrence sits inside a span matched by an [`Allow`] entry.
//! * An [`Allow`] entry is an exact, case-sensitive pattern with a written
//!   reason. Entries are deliberately narrow: whole tokens or whole XML tag
//!   names, never a bare `buzz`.
//! * An entry that matches nothing in the crate's corpus is stale and fails
//!   [`assert_no_stale_entries`], so the list can only shrink as surfaces are
//!   cleaned up.
//! * [`assert_guard_is_falsifiable`] injects forbidden strings into every real
//!   surface and requires the scanner to flag each one, so a scanner that
//!   silently stopped matching cannot pass.
#![allow(dead_code)]

/// How an [`Allow`] entry is matched against a surface.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Match {
    /// The pattern is an identifier such as `BUZZ_RELAY_URL`. It matches only
    /// when the characters on both sides are not ASCII alphanumerics or `_`,
    /// so `BUZZ_RELAY_URLS` and `XBUZZ_RELAY_URL` are still violations.
    Token,
    /// The pattern is an XML tag name such as `buzz-event`. It matches
    /// `<name` or `</name` when followed by `>`, `/`, or whitespace, so the
    /// whole tag head is allowed but prose that merely mentions the name is
    /// not.
    XmlTag,
    /// The pattern is an exact literal, matched case-sensitively anywhere.
    Literal,
}

/// One narrow exception to the "no buzz" rule.
#[derive(Clone, Copy, Debug)]
pub struct Allow {
    /// Exact, case-sensitive pattern. Must contain `buzz` (any case).
    pub text: &'static str,
    /// How the pattern is matched.
    pub kind: Match,
    /// Why the old name must stay here and when it can go.
    pub reason: &'static str,
}

/// One named piece of agent-visible text.
#[derive(Clone, Debug)]
pub struct Surface {
    /// Where the text comes from, shown in failure reports.
    pub name: String,
    /// The text exactly as an agent would receive it.
    pub text: String,
}

impl Surface {
    /// Build a surface from a name and its text.
    pub fn new(name: impl Into<String>, text: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            text: text.into(),
        }
    }
}

/// One forbidden occurrence found in a surface.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Violation {
    /// Surface the occurrence was found in.
    pub surface: String,
    /// One-based line number inside the surface.
    pub line: usize,
    /// The offending line, trimmed and truncated.
    pub excerpt: String,
}

impl std::fmt::Display for Violation {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}:{}: {}", self.surface, self.line, self.excerpt)
    }
}

fn is_ident_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_'
}

/// Byte offsets of every case-insensitive `buzz` in `text`.
fn find_buzz(text: &str) -> Vec<usize> {
    let bytes = text.as_bytes();
    if bytes.len() < 4 {
        return Vec::new();
    }
    (0..=bytes.len() - 4)
        .filter(|&i| bytes[i..i + 4].eq_ignore_ascii_case(b"buzz"))
        .collect()
}

/// Byte spans `(start, end, entry_index)` of every accepted allow-list match.
fn allowed_spans(text: &str, allow: &[Allow]) -> Vec<(usize, usize, usize)> {
    let bytes = text.as_bytes();
    let mut spans = Vec::new();
    for (index, entry) in allow.iter().enumerate() {
        if entry.text.is_empty() {
            continue;
        }
        let mut from = 0;
        while let Some(rel) = text[from..].find(entry.text) {
            let start = from + rel;
            let end = start + entry.text.len();
            from = end;
            match entry.kind {
                Match::Literal => spans.push((start, end, index)),
                Match::Token => {
                    let before_ok = start == 0 || !is_ident_byte(bytes[start - 1]);
                    let after_ok = end >= bytes.len() || !is_ident_byte(bytes[end]);
                    if before_ok && after_ok {
                        spans.push((start, end, index));
                    }
                }
                Match::XmlTag => {
                    let open = start >= 1 && bytes[start - 1] == b'<';
                    let close = start >= 2 && &bytes[start - 2..start] == b"</";
                    let after_ok = end < bytes.len()
                        && (matches!(bytes[end], b'>' | b'/') || bytes[end].is_ascii_whitespace());
                    if after_ok && (open || close) {
                        let span_start = if close { start - 2 } else { start - 1 };
                        spans.push((span_start, end, index));
                    }
                }
            }
        }
    }
    spans
}

fn line_of(text: &str, offset: usize) -> usize {
    text.as_bytes()[..offset]
        .iter()
        .filter(|&&b| b == b'\n')
        .count()
        + 1
}

fn excerpt_of(text: &str, offset: usize) -> String {
    let start = text[..offset].rfind('\n').map_or(0, |p| p + 1);
    let end = text[offset..].find('\n').map_or(text.len(), |p| offset + p);
    let line = text[start..end].trim();
    let mut out: String = line.chars().take(140).collect();
    if line.chars().count() > 140 {
        out.push_str("...");
    }
    out
}

/// Every forbidden `buzz` in `text` that no allow-list entry covers.
pub fn violations(surface: &str, text: &str, allow: &[Allow]) -> Vec<Violation> {
    let spans = allowed_spans(text, allow);
    find_buzz(text)
        .into_iter()
        .filter(|&at| !spans.iter().any(|&(s, e, _)| s <= at && at < e))
        .map(|at| Violation {
            surface: surface.to_string(),
            line: line_of(text, at),
            excerpt: excerpt_of(text, at),
        })
        .collect()
}

/// For each allow-list entry, whether it covers at least one `buzz` in `text`.
pub fn entries_used(text: &str, allow: &[Allow]) -> Vec<bool> {
    let buzz = find_buzz(text);
    let spans = allowed_spans(text, allow);
    (0..allow.len())
        .map(|index| {
            spans
                .iter()
                .any(|&(s, e, i)| i == index && buzz.iter().any(|&at| s <= at && at < e))
        })
        .collect()
}

/// Fail with a full report when any surface says `buzz` outside the allow-list.
pub fn assert_clean(surfaces: &[Surface], allow: &[Allow]) {
    let found: Vec<Violation> = surfaces
        .iter()
        .flat_map(|s| violations(&s.name, &s.text, allow))
        .collect();
    assert!(
        found.is_empty(),
        "agent-visible text still says buzz in {} place(s) across {} surface(s):\n{}\n\
         Say Colony, or the colony command, instead. Only allow-list entries with a written \
         reason may keep the old name.",
        found.len(),
        surfaces.len(),
        found
            .iter()
            .map(|v| format!("  {v}"))
            .collect::<Vec<_>>()
            .join("\n"),
    );
}

/// Fail when an allow-list entry covers nothing in any of `surfaces`.
pub fn assert_no_stale_entries(surfaces: &[Surface], allow: &[Allow]) {
    let mut used = vec![false; allow.len()];
    for surface in surfaces {
        for (slot, hit) in used.iter_mut().zip(entries_used(&surface.text, allow)) {
            *slot |= hit;
        }
    }
    let stale: Vec<String> = allow
        .iter()
        .zip(&used)
        .filter(|(_, &hit)| !hit)
        .map(|(entry, _)| format!("  `{}` ({:?}): {}", entry.text, entry.kind, entry.reason))
        .collect();
    assert!(
        stale.is_empty(),
        "stale brand allow-list entries (no surface uses them any more, delete them):\n{}",
        stale.join("\n"),
    );
}

/// Fail when an allow-list entry is too broad or lacks a written reason.
pub fn assert_entries_justified(allow: &[Allow]) {
    for entry in allow {
        assert!(
            entry.text.to_ascii_lowercase().contains("buzz"),
            "allow-list entry `{}` does not contain the old name, so it allows nothing",
            entry.text,
        );
        assert!(
            entry.text.len() > "buzz".len() + 2,
            "allow-list entry `{}` is too short to be a narrow exception",
            entry.text,
        );
        assert!(
            entry.reason.trim().len() >= 40,
            "allow-list entry `{}` needs a written reason of at least a sentence",
            entry.text,
        );
        assert!(
            !entry.reason.contains('\u{2014}'),
            "allow-list entry `{}` reason must not contain an em dash",
            entry.text,
        );
        assert!(
            entry.kind != Match::Literal || entry.text.chars().filter(|c| *c != ' ').count() >= 8,
            "literal allow-list entry `{}` is too short to be a narrow exception",
            entry.text,
        );
    }
    for (i, a) in allow.iter().enumerate() {
        for b in &allow[i + 1..] {
            assert!(
                a.text != b.text || a.kind != b.kind,
                "duplicate allow-list entry `{}`",
                a.text,
            );
        }
    }
}

/// Strings that must always be flagged, whatever the surrounding text.
const FORBIDDEN_PROBES: &[&str] = &[
    "Run `buzz mem get core` first.",
    "You are working inside Buzz.",
    "Open /Users/someone/.buzz/notes.md",
    "BUZZ",
    "bUzZ messages send",
];

/// Prove the guard fails on injected forbidden text, using the real surfaces.
///
/// For every surface and every probe: appending the probe must add at least
/// one violation, reported on the probe's own line. A scanner that stopped
/// matching, or an allow-list so broad it swallows ordinary prose, fails here.
pub fn assert_guard_is_falsifiable(surfaces: &[Surface], allow: &[Allow]) {
    assert!(!surfaces.is_empty(), "no surfaces were checked");
    for surface in surfaces {
        assert!(
            !surface.text.trim().is_empty(),
            "surface {} is empty, so it proves nothing",
            surface.name,
        );
        let before = violations(&surface.name, &surface.text, allow);
        for probe in FORBIDDEN_PROBES {
            let injected = format!("{}\n{probe}\n", surface.text);
            let probe_line = line_of(&injected, surface.text.len() + 1);
            let after = violations(&surface.name, &injected, allow);
            assert!(
                after.len() > before.len(),
                "guard did not flag injected `{probe}` in surface {}",
                surface.name,
            );
            assert!(
                after.iter().any(|v| v.line == probe_line),
                "guard flagged injected `{probe}` in surface {} on the wrong line",
                surface.name,
            );
        }
        // Injection in the middle of a line, with allowed tokens around it.
        let mixed = format!(
            "{}\nuse BUZZ_FAKE_NOT_ALLOWED then buzz again\n",
            surface.text
        );
        assert!(
            violations(&surface.name, &mixed, allow).len() >= before.len() + 2,
            "guard must flag both `BUZZ_FAKE_NOT_ALLOWED` and `buzz` in surface {}",
            surface.name,
        );
    }
}

#[cfg(test)]
mod scanner_selftests {
    use super::*;

    const ALLOW: &[Allow] = &[
        Allow {
            text: "BUZZ_RELAY_URL",
            kind: Match::Token,
            reason: "fixture entry used only by the scanner self-tests, never in production",
        },
        Allow {
            text: "buzz-event",
            kind: Match::XmlTag,
            reason: "fixture entry used only by the scanner self-tests, never in production",
        },
        Allow {
            text: "<!-- BEGIN BUZZ MANAGED",
            kind: Match::Literal,
            reason: "fixture entry used only by the scanner self-tests, never in production",
        },
    ];

    fn count(text: &str) -> usize {
        violations("t", text, ALLOW).len()
    }

    #[test]
    fn plain_prose_in_any_case_is_a_violation() {
        assert_eq!(count("Colony is fine"), 0);
        assert_eq!(count("buzz"), 1);
        assert_eq!(count("Buzz"), 1);
        assert_eq!(count("BUZZ"), 1);
        assert_eq!(count("a bUzZ b"), 1);
        assert_eq!(count("buzz and Buzz"), 2);
        assert_eq!(count("/Users/me/.buzz/x.md"), 1);
        assert_eq!(count("buzz-agent"), 1);
    }

    #[test]
    fn tokens_match_only_on_identifier_boundaries() {
        assert_eq!(count("export BUZZ_RELAY_URL=x"), 0);
        assert_eq!(count("`BUZZ_RELAY_URL`"), 0);
        assert_eq!(count("BUZZ_RELAY_URL"), 0);
        assert_eq!(count("BUZZ_RELAY_URLS"), 1);
        assert_eq!(count("XBUZZ_RELAY_URL"), 1);
        assert_eq!(count("MY_BUZZ_RELAY_URL"), 1);
        assert_eq!(count("BUZZ_RELAY_URL_EXTRA"), 1);
        assert_eq!(count("BUZZ_OTHER"), 1);
        assert_eq!(count("BUZZ_RELAY_URL then buzz"), 1);
    }

    #[test]
    fn xml_tags_allow_the_tag_head_but_not_prose() {
        assert_eq!(count("<buzz-event>"), 0);
        assert_eq!(count("</buzz-event>"), 0);
        assert_eq!(count("<buzz-event type=\"@mention\">"), 0);
        assert_eq!(count("<buzz-event\n>"), 0);
        assert_eq!(count("a `<buzz-event>` b"), 0);
        assert_eq!(count("buzz-event"), 1);
        assert_eq!(count("the buzz-event tag"), 1);
        assert_eq!(count("<buzz-events>"), 1);
        assert_eq!(count("<buzz-eventx>"), 1);
        assert_eq!(count("<buzz-event>Run buzz now</buzz-event>"), 1);
    }

    #[test]
    fn literals_match_exactly_and_case_sensitively() {
        assert_eq!(count("<!-- BEGIN BUZZ MANAGED , regenerated -->"), 0);
        assert_eq!(count("<!-- begin buzz managed -->"), 1);
        assert_eq!(count("BEGIN BUZZ MANAGED"), 1);
    }

    #[test]
    fn violations_report_line_and_trimmed_excerpt() {
        let found = violations("s", "one\ntwo\n  say buzz here  \nfour", ALLOW);
        assert_eq!(
            found,
            vec![Violation {
                surface: "s".into(),
                line: 3,
                excerpt: "say buzz here".into(),
            }]
        );
        assert_eq!(found[0].to_string(), "s:3: say buzz here");
    }

    #[test]
    fn multibyte_text_around_matches_is_safe() {
        assert_eq!(count("caf\u{e9} \u{1f41d} buzz \u{4e2d}\u{6587}"), 1);
        assert_eq!(count("\u{1f41d}BUZZ_RELAY_URL\u{1f41d}"), 0);
        assert_eq!(count(""), 0);
        assert_eq!(count("buz"), 0);
    }

    #[test]
    fn stale_entries_are_reported_and_used_entries_are_not() {
        let used = entries_used("export BUZZ_RELAY_URL", ALLOW);
        assert_eq!(used, vec![true, false, false]);
        let surfaces = [Surface::new("a", "export BUZZ_RELAY_URL")];
        let stale = std::panic::catch_unwind(|| assert_no_stale_entries(&surfaces, ALLOW));
        assert!(stale.is_err(), "unused entries must fail the stale check");
        let all = [Surface::new(
            "a",
            "BUZZ_RELAY_URL <buzz-event> <!-- BEGIN BUZZ MANAGED",
        )];
        assert_no_stale_entries(&all, ALLOW);
    }

    #[test]
    fn a_surface_with_only_forbidden_text_fails_assert_clean() {
        let dirty = [Surface::new("d", "run buzz")];
        let result = std::panic::catch_unwind(|| assert_clean(&dirty, ALLOW));
        assert!(result.is_err());
        let clean = [Surface::new("c", "run colony with BUZZ_RELAY_URL set")];
        assert_clean(&clean, ALLOW);
    }

    #[test]
    fn justification_rules_reject_weak_entries() {
        assert_entries_justified(ALLOW);
        let no_reason = [Allow {
            text: "BUZZ_RELAY_URL",
            kind: Match::Token,
            reason: "short",
        }];
        assert!(std::panic::catch_unwind(|| assert_entries_justified(&no_reason)).is_err());
        let bare = [Allow {
            text: "buzz",
            kind: Match::Literal,
            reason: "a sufficiently long reason that would otherwise pass the length check",
        }];
        assert!(std::panic::catch_unwind(|| assert_entries_justified(&bare)).is_err());
        let off_topic = [Allow {
            text: "COLONY_RELAY_URL",
            kind: Match::Token,
            reason: "a sufficiently long reason that would otherwise pass the length check",
        }];
        assert!(std::panic::catch_unwind(|| assert_entries_justified(&off_topic)).is_err());
    }

    #[test]
    fn falsifiability_check_passes_on_clean_text_and_catches_a_blind_allow_list() {
        let clean = [Surface::new("c", "Use the colony command.\nSecond line.")];
        assert_guard_is_falsifiable(&clean, ALLOW);
        // An allow-list entry that swallows the probe must make the check fail.
        let swallow = [Allow {
            text: "Run `buzz mem get core` first.",
            kind: Match::Literal,
            reason: "deliberately blind fixture used to prove the check can fail itself",
        }];
        let result = std::panic::catch_unwind(|| assert_guard_is_falsifiable(&clean, &swallow));
        assert!(
            result.is_err(),
            "a blind allow-list must fail falsifiability"
        );
    }
}
