//! How long an agent's chat message may be.
//!
//! A person who asks an AI employee for something gets ONE short message back,
//! not a report. The prompts already ask for under 50 words, but a model
//! ignores a limit it is only told about. The same limit is therefore enforced
//! where messages are sent: the `colony messages send` guard and the harness
//! safety net both go through this module, so the two can never disagree.
//!
//! The limit is for chat text, the agent talking. A deliverable the person
//! asked for (an article, a draft, code) goes inside a fenced block and is not
//! word-capped here; only the relay's own byte limit applies to it. A prose
//! deliverable uses a fence with the info string `doc` and a `# Title` first
//! line, code uses a fence with its language tag. The app shows a `doc` fence
//! as a collapsed card, so even a long one keeps the chat short to read.

/// Words an agent is asked to stay under. Error text and shortened replies
/// aim for this, so a retry lands well inside [`CHAT_MAX_WORDS`].
pub const CHAT_TARGET_WORDS: usize = 50;

/// Most words allowed outside fenced blocks in one chat message.
pub const CHAT_MAX_WORDS: usize = 60;

/// Appended to a reply that had to be shortened.
pub const SHORTENED_OFFER: &str = "Want the rest?";

/// Said instead of a reply whose first sentence alone is longer than the limit:
/// cutting that sentence short would stop mid-sentence.
pub const TOO_LONG_LINE: &str =
    "That answer is too long for a chat message. Want the short version?";

/// Word counts of a chat message, split by where the words sit.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ChatWords {
    /// Words outside fenced blocks: the part that is capped.
    pub prose: usize,
    /// Words inside closed fenced blocks, fence lines included: not capped.
    pub fenced: usize,
}

/// A run of the message that is either chat text or one closed fenced block.
enum Segment<'a> {
    Prose(&'a str),
    Fence(&'a str),
}

/// The fence character and run length when `line` opens or closes a fence.
fn fence_marker(line: &str) -> Option<(char, usize)> {
    let trimmed = line.trim_start();
    let marker = trimmed.chars().next().filter(|c| matches!(c, '`' | '~'))?;
    let run = trimmed.chars().take_while(|c| *c == marker).count();
    (run >= 3).then_some((marker, run))
}

/// Whether `line` closes a fence opened with `run` copies of `marker`.
fn closes_fence(line: &str, marker: char, run: usize) -> bool {
    let trimmed = line.trim();
    trimmed.chars().count() >= run && trimmed.chars().all(|c| c == marker)
}

/// Split `text` into chat text and closed fenced blocks, and say whether a
/// fence was left open. An open fence is not a deliverable, so its text stays
/// chat text: otherwise a missing closing fence would hide any amount of prose.
fn segments(text: &str) -> (Vec<Segment<'_>>, bool) {
    let mut segments = Vec::new();
    let mut prose_start = 0;
    let mut open: Option<(char, usize, usize)> = None;
    let mut offset = 0;
    for line in text.split_inclusive('\n') {
        let end = offset + line.len();
        if let Some((marker, run, start)) = open {
            if closes_fence(line, marker, run) {
                segments.push(Segment::Fence(&text[start..end]));
                open = None;
                prose_start = end;
            }
        } else if let Some((marker, run)) = fence_marker(line) {
            if offset > prose_start {
                segments.push(Segment::Prose(&text[prose_start..offset]));
            }
            open = Some((marker, run, offset));
        }
        offset = end;
    }
    let (rest_start, unclosed) = match open {
        Some((_, _, start)) => (start, true),
        None => (prose_start, false),
    };
    if rest_start < text.len() {
        segments.push(Segment::Prose(&text[rest_start..]));
    }
    (segments, unclosed)
}

fn words_in(text: &str) -> usize {
    text.split_whitespace().count()
}

/// Count the words of `content` and say whether a fence was left open.
fn analyze(content: &str) -> (ChatWords, bool) {
    let (segments, unclosed_fence) = segments(content);
    let mut words = ChatWords {
        prose: 0,
        fenced: 0,
    };
    for segment in segments {
        match segment {
            Segment::Prose(text) => words.prose += words_in(text),
            Segment::Fence(text) => words.fenced += words_in(text),
        }
    }
    (words, unclosed_fence)
}

/// Count the words of `content`, chat text apart from fenced blocks.
pub fn count_chat_words(content: &str) -> ChatWords {
    analyze(content).0
}

/// A chat message that is over the limit.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ChatTooLong {
    /// What the message holds.
    pub words: ChatWords,
    /// A fenced block was opened and never closed, so its text counted as chat.
    pub unclosed_fence: bool,
}

impl std::fmt::Display for ChatTooLong {
    /// The text a model reads when its message is refused. It says exactly how
    /// to fix the message, because the model will retry from this alone.
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "Too long for chat: {} words. Rewrite in under {CHAT_TARGET_WORDS} words. Put an article or draft in a ```doc fence (start it with a `# Title` line). Put code in a fence with its language tag. Put other long detail in a doc and link it.",
            self.words.prose
        )?;
        if self.unclosed_fence {
            f.write_str(" A fence is not closed, so its text counted as chat.")?;
        }
        Ok(())
    }
}

impl std::error::Error for ChatTooLong {}

/// Refuse a chat message whose text outside fenced blocks is over the limit.
pub fn check_chat_length(content: &str) -> Result<(), ChatTooLong> {
    let (words, unclosed_fence) = analyze(content);
    if words.prose > CHAT_MAX_WORDS {
        Err(ChatTooLong {
            words,
            unclosed_fence,
        })
    } else {
        Ok(())
    }
}

/// One piece of a message that is kept or dropped whole: a sentence of chat
/// text, or a closed fenced block.
struct Piece<'a> {
    text: &'a str,
    /// Line breaks before this piece in the original: 0 when it follows
    /// another sentence on the same line.
    breaks: usize,
    fence: bool,
    /// Chat words the piece costs. A fenced block costs none.
    words: usize,
}

/// Split a line of chat text into sentences. A sentence ends at `.`, `!` or `?`
/// followed by whitespace or the end of the line.
fn split_sentences(line: &str) -> Vec<&str> {
    let mut sentences = Vec::new();
    let mut start = 0;
    let mut chars = line.char_indices().peekable();
    while let Some((index, c)) = chars.next() {
        if !matches!(c, '.' | '!' | '?') {
            continue;
        }
        let at_boundary = chars.peek().is_none_or(|(_, next)| next.is_whitespace());
        if !at_boundary {
            continue;
        }
        let sentence = line[start..index + c.len_utf8()].trim();
        if !sentence.is_empty() {
            sentences.push(sentence);
        }
        while chars.peek().is_some_and(|(_, next)| next.is_whitespace()) {
            chars.next();
        }
        start = chars
            .peek()
            .map_or(line.len(), |(next_index, _)| *next_index);
    }
    let rest = line[start..].trim();
    if !rest.is_empty() {
        sentences.push(rest);
    }
    sentences
}

fn pieces_of(text: &str) -> Vec<Piece<'_>> {
    let mut pieces: Vec<Piece<'_>> = Vec::new();
    let mut pending_breaks = 0;
    for segment in segments(text).0 {
        match segment {
            Segment::Fence(block) => {
                let breaks = if pieces.is_empty() {
                    0
                } else {
                    pending_breaks + 1
                };
                pending_breaks = 0;
                pieces.push(Piece {
                    text: block.trim_end(),
                    breaks,
                    fence: true,
                    words: 0,
                });
            }
            Segment::Prose(prose) => {
                for line in prose.lines() {
                    let line = line.trim();
                    if line.is_empty() {
                        pending_breaks += 1;
                        continue;
                    }
                    let breaks = if pieces.is_empty() {
                        0
                    } else {
                        pending_breaks + 1
                    };
                    pending_breaks = 0;
                    for (n, sentence) in split_sentences(line).into_iter().enumerate() {
                        pieces.push(Piece {
                            text: sentence,
                            breaks: if n == 0 { breaks } else { 0 },
                            fence: false,
                            words: words_in(sentence),
                        });
                    }
                }
            }
        }
    }
    pieces
}

/// Shorten `content` to fit chat, for text the harness posts on an agent's
/// behalf.
///
/// A message already inside the limit is returned as it is (trimmed). A longer
/// one keeps its leading whole sentences and fenced blocks, in order, up to
/// [`CHAT_TARGET_WORDS`] words of chat text, then offers the rest in one short
/// line. Fenced blocks are deliverables and are kept whole. It never cuts a
/// sentence in half: when even the first sentence is too long it says so
/// instead ([`TOO_LONG_LINE`]).
pub fn shorten_for_chat(content: &str) -> String {
    let text = content.trim();
    if check_chat_length(text).is_ok() {
        return text.to_owned();
    }

    let mut out = String::new();
    let mut prose = 0;
    let mut kept = 0;
    let mut last_was_fence = false;
    let mut dropped = false;
    for piece in pieces_of(text) {
        if !piece.fence && prose + piece.words > CHAT_TARGET_WORDS {
            dropped = true;
            break;
        }
        if kept > 0 {
            out.push_str(match piece.breaks {
                0 => " ",
                1 => "\n",
                _ => "\n\n",
            });
        }
        out.push_str(piece.text);
        prose += piece.words;
        last_was_fence = piece.fence;
        kept += 1;
    }

    if kept == 0 {
        return TOO_LONG_LINE.to_owned();
    }
    if dropped {
        out.push_str(if last_was_fence { "\n\n" } else { " " });
        out.push_str(SHORTENED_OFFER);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn words(n: usize) -> String {
        vec!["word"; n].join(" ")
    }

    fn doc(body: &str) -> String {
        format!("```doc\n# Title\n{body}\n```")
    }

    #[test]
    fn fenced_blocks_are_counted_apart_from_chat_text() {
        let content = format!("Here is the draft.\n{}\nDone.", doc(&words(10)));
        let counted = count_chat_words(&content);
        assert_eq!(counted.prose, 5);
        assert!(counted.fenced >= 10, "{counted:?}");
    }

    #[test]
    fn sixty_words_pass_and_sixty_one_do_not() {
        assert!(check_chat_length(&words(CHAT_MAX_WORDS)).is_ok());
        let error = check_chat_length(&words(CHAT_MAX_WORDS + 1)).unwrap_err();
        assert_eq!(error.words.prose, CHAT_MAX_WORDS + 1);
    }

    #[test]
    fn a_long_deliverable_in_a_fence_is_not_word_capped() {
        let post = format!("Here's the blog post.\n{}", doc(&words(900)));
        assert!(check_chat_length(&post).is_ok());
        let code = format!("Here is the script.\n```python\n{}\n```", words(400));
        assert!(check_chat_length(&code).is_ok());
        let tilde = format!("Here it is.\n~~~doc\n# T\n{}\n~~~", words(400));
        assert!(check_chat_length(&tilde).is_ok());
    }

    #[test]
    fn chat_text_around_a_fence_still_has_the_limit() {
        let before = format!("{}\n{}", words(CHAT_MAX_WORDS + 1), doc("short"));
        assert!(check_chat_length(&before).is_err());
        let after = format!("{}\n{}", doc("short"), words(CHAT_MAX_WORDS + 1));
        assert!(check_chat_length(&after).is_err());
        let split = format!(
            "{}\n{}\n{}",
            words(40),
            doc("short"),
            words(CHAT_MAX_WORDS - 39)
        );
        assert!(
            check_chat_length(&split).is_err(),
            "words before and after a fence add up"
        );
    }

    #[test]
    fn a_fence_that_is_never_closed_hides_nothing() {
        let content = format!("Here it is.\n```doc\n# Title\n{}", words(200));
        let error = check_chat_length(&content).unwrap_err();
        assert!(error.unclosed_fence);
        assert!(error.to_string().contains("A fence is not closed"));
        // A closing fence that is shorter than the opening one does not close it.
        let short_close = format!("````doc\n# T\n{}\n```", words(100));
        assert!(check_chat_length(&short_close).is_err());
    }

    #[test]
    fn the_refusal_tells_the_model_how_to_fix_the_message() {
        let error = check_chat_length(&words(75)).unwrap_err();
        assert_eq!(
            error.to_string(),
            "Too long for chat: 75 words. Rewrite in under 50 words. Put an article or draft in a ```doc fence (start it with a `# Title` line). Put code in a fence with its language tag. Put other long detail in a doc and link it."
        );
    }

    #[test]
    fn a_message_inside_the_limit_is_left_alone() {
        let text = "Best lead: Pecan Tree Guesthouse. 2013 website, 2 posts this year, has WhatsApp. 8 others ruled out. Draft a WhatsApp to them?";
        assert_eq!(shorten_for_chat(&format!("  {text}\n")), text);
    }

    #[test]
    fn a_long_message_keeps_whole_leading_sentences_and_offers_the_rest() {
        let sentences: Vec<String> = (1..=12)
            .map(|n| format!("Sentence number {n} is here today."))
            .collect();
        let long = sentences.join(" ");
        let short = shorten_for_chat(&long);

        assert!(short.ends_with(SHORTENED_OFFER), "{short}");
        let body = short.strip_suffix(SHORTENED_OFFER).unwrap().trim_end();
        assert!(long.starts_with(body), "kept text is a prefix: {body}");
        assert!(body.ends_with('.'), "stops on a sentence end: {body}");
        assert!(body.contains("Sentence number 1 "));
        assert!(!body.contains("Sentence number 12 "));
        assert!(check_chat_length(&short).is_ok(), "{short}");
    }

    #[test]
    fn a_first_sentence_that_is_too_long_is_not_cut_in_half() {
        let long = format!("{}. And then it carries on.", words(90));
        assert_eq!(shorten_for_chat(&long), TOO_LONG_LINE);
    }

    #[test]
    fn a_fenced_deliverable_is_kept_whole_when_chat_text_is_trimmed() {
        let article = doc(&words(300));
        let long = format!(
            "Draft is below.\n{article}\nWant me to send it?\n{}",
            words(80)
        );
        let short = shorten_for_chat(&long);
        assert!(
            short.starts_with("Draft is below.\n```doc\n# Title\n"),
            "{short}"
        );
        assert!(short.contains(&article), "the fence survives whole");
        assert!(short.contains("Want me to send it?"), "{short}");
        assert!(short.ends_with(SHORTENED_OFFER), "{short}");
        assert!(check_chat_length(&short).is_ok(), "{short}");
    }

    #[test]
    fn the_offer_after_a_fence_sits_outside_it() {
        let long = format!("{}\n{}", doc("short"), words(80));
        let short = shorten_for_chat(&long);
        assert!(
            short.ends_with(&format!("```\n\n{SHORTENED_OFFER}")),
            "{short}"
        );
    }

    #[test]
    fn paragraph_breaks_survive_shortening() {
        let long = format!(
            "First point is short.\n\nSecond point is short too.\n\n{}",
            (0..20)
                .map(|n| format!("Filler sentence {n} is here."))
                .collect::<Vec<_>>()
                .join(" ")
        );
        let short = shorten_for_chat(&long);
        assert!(
            short.starts_with("First point is short.\n\nSecond point is short too.\n\n"),
            "{short}"
        );
    }

    #[test]
    fn every_shortened_message_passes_the_check() {
        for n in [61, 100, 400, 2000] {
            let text = (0..n / 6)
                .map(|i| format!("This is sentence {i} here."))
                .collect::<Vec<_>>()
                .join(" ");
            let short = shorten_for_chat(&text);
            assert!(check_chat_length(&short).is_ok(), "{n}: {short}");
        }
    }

    #[test]
    fn limits_text_has_no_em_dashes() {
        for text in [SHORTENED_OFFER, TOO_LONG_LINE] {
            assert!(!text.contains('\u{2014}'));
        }
        let error = check_chat_length(&words(75)).unwrap_err().to_string();
        assert!(!error.contains('\u{2014}'));
    }
}
