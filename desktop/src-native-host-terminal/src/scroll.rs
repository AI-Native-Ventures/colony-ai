//! The one place the DOM's wheel sign meets the engine's scroll sign.
//!
//! Extraction of upstream
//! `desktop/src-tauri/src/terminal_runtime/scroll_sign.rs`, unchanged in
//! behavior: the conversion is two characters of code and the sign is the
//! whole subject, so it stays a named function rather than a `-` in an
//! argument list. Inlined, the conversion is executed by every scroll test
//! and asserted by none of them, and deleting it leaves both suites green
//! while reversing a real trackpad.

use buzz_terminal::SharedTerminal;

/// A wheel delta in whole cells, carrying the **DOM's** sign.
///
/// A newtype rather than a bare `i32` so the engine's opposite convention
/// cannot be reached by accident: `SharedTerminal::scroll` takes an `i32`,
/// so handing it this value straight from the wire is a type error rather
/// than a silently reversed terminal.
#[derive(Debug, Clone, Copy)]
pub struct DomLines(pub i32);

/// Scroll `terminal` by a DOM wheel delta in cells.
///
/// The DOM sign is the spec because the OS-reported delta is the only
/// stable thing here. macOS "natural scrolling" flips what a given finger
/// motion reports, so a rule stated as "swipe up goes back" is correct for
/// one preference setting and backwards for the other. Stated against
/// `deltaY` it is correct for both: **negative DOM lines — the direction
/// that scrolls a web page toward the top of the document — go back into
/// history**, which is positive in the engine's `Scroll::Delta`
/// convention.
///
/// `saturating_neg` because this arrives over IPC: plain unary negation on
/// `i32::MIN` panics in debug and wraps to `i32::MIN` in release, so a
/// crafted command could scroll the wrong way. Saturating leaves it going
/// back, which the engine then clamps at the oldest line.
///
/// Returns whether the viewport actually moved.
pub fn dom_lines_to_engine(terminal: &SharedTerminal, dom_lines: DomLines) -> bool {
    terminal.scroll(dom_lines.0.saturating_neg())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A terminal with four lines of history and a two-row viewport.
    fn scrollable() -> SharedTerminal {
        let size = buzz_terminal::Size {
            columns: 8,
            screen_lines: 2,
            scrollback: 16,
        };
        let (term, actions) =
            buzz_terminal::Terminal::new(size, buzz_terminal::fences::Fences::ALL);
        // Leaked deliberately: dropping the receiver disconnects the channel
        // and every later listener send fails silently.
        std::mem::forget(actions);
        let shared = SharedTerminal::new(term);
        shared.feed_fully(b"L1\r\nL2\r\nL3\r\nL4");
        shared
    }

    fn screen(terminal: &SharedTerminal) -> Vec<String> {
        let mut encoder = buzz_terminal::damage::Encoder::new();
        terminal
            .snapshot(&mut encoder)
            .rows
            .iter()
            .map(|row| {
                row.spans
                    .iter()
                    .map(|span| span.text.as_str())
                    .collect::<String>()
                    .trim_end()
                    .to_string()
            })
            .collect()
    }

    #[test]
    fn a_negative_dom_delta_scrolls_backwards_into_history() {
        let terminal = scrollable();
        assert_eq!(screen(&terminal), vec!["L3", "L4"], "starts at live edge");

        assert!(dom_lines_to_engine(&terminal, DomLines(-2)));
        assert_eq!(
            screen(&terminal),
            vec!["L1", "L2"],
            "a page-upwards gesture must reach older lines, not newer ones"
        );

        assert!(dom_lines_to_engine(&terminal, DomLines(2)));
        assert_eq!(
            screen(&terminal),
            vec!["L3", "L4"],
            "and a page-downwards gesture returns to the live edge"
        );
    }

    #[test]
    fn a_dom_delta_past_the_oldest_line_reports_no_movement() {
        let terminal = scrollable();
        assert!(dom_lines_to_engine(&terminal, DomLines(-2)));
        assert!(
            !dom_lines_to_engine(&terminal, DomLines(-1_000)),
            "there is nothing older, so nothing moved"
        );
        assert_eq!(screen(&terminal), vec!["L1", "L2"]);
    }

    #[test]
    fn the_most_negative_dom_delta_saturates_backwards_instead_of_wrapping_forwards() {
        let terminal = scrollable();
        assert!(dom_lines_to_engine(&terminal, DomLines(i32::MIN)));
        assert_eq!(
            screen(&terminal),
            vec!["L1", "L2"],
            "a hostile delta must clamp at the oldest line, not flip direction"
        );
    }
}
