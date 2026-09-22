//! Host-neutral wire wireframe for terminal frames.
//!
//! Extraction of the `WireRow`/`WireSpan`/`WireCluster`/`WireStyle`/
//! `WireCursor`/`FrameMessage` mapping in upstream
//! `desktop/src-tauri/src/terminal_runtime.rs` (`wire_publication`), with
//! the Tauri channel send removed: this module maps a publication to its
//! wire form and returns it, so the host pipe owns delivery.
//!
//! Mapping rules preserved verbatim:
//!
//! - A span whose `cluster_count == 1` stays atomic (one cluster carrying
//!   the whole text, e.g. a keycap or accented letter); otherwise each
//!   `char` becomes one cluster at `column + index * width`.
//! - A span whose counts are inconsistent (neither 1 nor exactly the
//!   `char` count) is an error, never silently shipped.
//! - `bracketed_paste`/`focus_reporting` are filled by the session from
//!   the terminal's live input modes at publish time; the mapper leaves
//!   them at their default and the caller overwrites them.

use serde::{Deserialize, Serialize};

use crate::publisher::Publication;

/// Viewport identity on the wire. Compared as one value.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WireViewport {
    pub generation: u64,
    pub columns: usize,
    pub screen_lines: usize,
}

impl From<buzz_terminal::Viewport> for WireViewport {
    fn from(value: buzz_terminal::Viewport) -> Self {
        Self {
            generation: value.generation,
            columns: value.columns,
            screen_lines: value.screen_lines,
        }
    }
}

impl From<WireViewport> for buzz_terminal::Viewport {
    fn from(value: WireViewport) -> Self {
        Self {
            generation: value.generation,
            columns: value.columns,
            screen_lines: value.screen_lines,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WireStyle {
    pub fg: u32,
    pub bg: u32,
    pub flags: u16,
}

impl From<buzz_terminal::damage::Style> for WireStyle {
    fn from(value: buzz_terminal::damage::Style) -> Self {
        Self {
            fg: value.fg,
            bg: value.bg,
            flags: value.flags,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WireCluster {
    pub column: usize,
    pub text: String,
    pub width: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WireSpan {
    pub style: WireStyle,
    pub clusters: Vec<WireCluster>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WireRow {
    pub line: usize,
    pub wrapped: bool,
    pub spans: Vec<WireSpan>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WireCursor {
    pub line: usize,
    pub column: usize,
    pub visible: bool,
}

/// Host-neutral frame message. Field-for-field the upstream
/// `FrameMessage`, minus the Tauri channel envelope.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WireFrame {
    pub subscription_id: String,
    pub sequence: u64,
    pub rows: Vec<WireRow>,
    pub cursor: WireCursor,
    pub full: bool,
    pub viewport: WireViewport,
    pub bracketed_paste: bool,
    pub focus_reporting: bool,
}

/// Map one publication to its wire form. Returns an error (never a
/// partial frame) when the engine emits an inconsistent cluster count.
pub fn wire_frame(publication: &Publication) -> Result<WireFrame, String> {
    let frame = &publication.frame;
    let rows = frame
        .rows
        .iter()
        .map(|row| {
            let spans = row
                .spans
                .iter()
                .map(|span| {
                    if !span.counts_are_consistent() {
                        return Err(
                            "terminal engine emitted an inconsistent cluster count".to_string()
                        );
                    }
                    let clusters = if span.cluster_count == 1 {
                        vec![WireCluster {
                            column: span.column,
                            text: span.text.clone(),
                            width: span.width,
                        }]
                    } else {
                        span.text
                            .chars()
                            .enumerate()
                            .map(|(index, ch)| WireCluster {
                                column: span.column + index * usize::from(span.width),
                                text: ch.to_string(),
                                width: span.width,
                            })
                            .collect()
                    };
                    Ok(WireSpan {
                        style: span.style.into(),
                        clusters,
                    })
                })
                .collect::<Result<Vec<WireSpan>, String>>()?;
            Ok::<WireRow, String>(WireRow {
                line: row.line,
                wrapped: row.wrapped,
                spans,
            })
        })
        .collect::<Result<Vec<WireRow>, String>>()?;
    Ok(WireFrame {
        subscription_id: publication.subscription_id.to_string(),
        sequence: publication.sequence,
        rows,
        cursor: WireCursor {
            line: frame.cursor.line,
            column: frame.cursor.column,
            visible: frame.cursor.visible,
        },
        full: frame.full,
        viewport: frame.viewport.into(),
        bracketed_paste: false,
        focus_reporting: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::publisher::SubscriptionId;
    use buzz_terminal::damage::{CursorFrame, RowFrame, Span};
    use buzz_terminal::{Size, Viewport};

    fn publication(spans: Vec<Span>) -> Publication {
        Publication {
            subscription_id: SubscriptionId::new(),
            sequence: 7,
            frame: buzz_terminal::damage::Frame {
                rows: vec![RowFrame {
                    line: 3,
                    wrapped: true,
                    spans,
                }],
                cursor: CursorFrame {
                    line: 1,
                    column: 2,
                    visible: true,
                },
                cursor_changed: true,
                full: true,
                viewport: Viewport {
                    generation: 4,
                    columns: 80,
                    screen_lines: 24,
                },
            },
        }
    }

    fn style() -> buzz_terminal::damage::Style {
        buzz_terminal::damage::Style {
            fg: 1,
            bg: 2,
            flags: 3,
        }
    }

    #[test]
    fn session_size_defaults_match_upstream_scroll_default() {
        // The mapper never renegotiates scrollback; this pins the engine
        // default the extracted runtime inherits from `Size::default`.
        let size = Size::default();
        assert_eq!(
            (size.columns, size.screen_lines, size.scrollback),
            (80, 24, 10_000)
        );
    }

    #[test]
    fn mapper_preserves_soft_wrap_metadata() {
        let message = wire_frame(&publication(Vec::new())).unwrap();
        assert!(message.rows[0].wrapped);
    }

    #[test]
    fn mapper_expands_ascii_runs_without_unicode_classification() {
        let message = wire_frame(&publication(vec![Span {
            column: 4,
            text: "abc".into(),
            width: 1,
            cluster_count: 3,
            style: style(),
        }]))
        .unwrap();
        let clusters = &message.rows[0].spans[0].clusters;
        assert_eq!(
            clusters
                .iter()
                .map(|cluster| (cluster.column, cluster.text.as_str()))
                .collect::<Vec<_>>(),
            vec![(4, "a"), (5, "b"), (6, "c")]
        );
    }

    #[test]
    fn mapper_keeps_a_multi_char_cluster_atomic() {
        let message = wire_frame(&publication(vec![Span {
            column: 9,
            text: "1\u{fe0f}\u{20e3}".into(),
            width: 2,
            cluster_count: 1,
            style: style(),
        }]))
        .unwrap();
        let clusters = &message.rows[0].spans[0].clusters;
        assert_eq!(clusters.len(), 1);
        assert_eq!(clusters[0].column, 9);
        assert_eq!(clusters[0].text, "1\u{fe0f}\u{20e3}");
        assert_eq!(clusters[0].width, 2);
    }

    #[test]
    fn mapper_rejects_an_inconsistent_engine_span() {
        let result = wire_frame(&publication(vec![Span {
            column: 0,
            text: "ab".into(),
            width: 1,
            cluster_count: 3,
            style: style(),
        }]));
        assert!(result.is_err());
    }

    #[test]
    fn wire_viewport_round_trips_engine_viewport() {
        let engine = Viewport {
            generation: 9,
            columns: 100,
            screen_lines: 40,
        };
        let wire: WireViewport = engine.into();
        let back: Viewport = wire.into();
        assert_eq!(back, engine);
    }
}
