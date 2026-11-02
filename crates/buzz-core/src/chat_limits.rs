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
//!
//! A model does not reliably type that fence. It forgets the closing line,
//! the shell eats the backticks, or it writes the post with no fence at all.
//! [`repair_document`] fixes those shapes before the limit is applied, so a
//! document is posted as a card instead of being cut to 50 words, and
//! [`document_message`] builds the fence for a caller that has only the title
//! and the text (`colony messages send --doc`).

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
            "Too long for chat: {} words. Rewrite in under {CHAT_TARGET_WORDS} words. Send an article or draft with `--doc --title \"Title\"` (Colony builds the card), or put it in a ```doc fence (start it with a `# Title` line and close it). Put code in a fence with its language tag. Put other long detail in a doc and link it.",
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

/// Nest folders an employee saved owner-approved records in instead of proposing
/// them (GATE-329-COF: a plan in `PLANS/`, a playbook change in `GUIDES/`, the
/// weekly review in `OUTBOX/`, each announced in chat as created).
const RECORD_FOLDERS: [&str; 3] = ["PLANS/", "GUIDES/", "OUTBOX/"];

/// What the `colony messages send` guard says when chat text names a file in
/// one of the [`RECORD_FOLDERS`]. It carries the fix, because a refusal the
/// model cannot act on is just retried with the path reworded.
pub const NAMES_A_RECORD_FILE: &str = "Do not name files in a message to a person, and a plan, a playbook change, a goal or the weekly review is never a file. Propose it with `colony plans propose`, `colony playbooks propose`, `colony numbers goals propose` or `colony numbers review write`, wait for the command to print an id, then say in one short line that it is waiting for their approval. If you did not run one of those commands, say what you did instead, without the file name.";

/// Whether `text` names a file inside one of the [`RECORD_FOLDERS`], as in
/// `OUTBOX/WEEKLY_REVIEW.md` or `~/.colony/PLANS/CLIENTS.md`.
fn names_a_record_file(text: &str) -> bool {
    RECORD_FOLDERS.iter().any(|folder| {
        text.match_indices(folder).any(|(at, _)| {
            let starts_a_word = text[..at]
                .chars()
                .next_back()
                .is_none_or(|c| !c.is_ascii_alphanumeric() && c != '_');
            let has_a_name = text[at + folder.len()..]
                .chars()
                .next()
                .is_some_and(|c| c.is_ascii_alphanumeric() || c == '_');
            starts_a_word && has_a_name
        })
    })
}

/// Refuse a chat message whose text outside fenced blocks names a file in a
/// record folder. A fenced block is a deliverable and is not looked at.
pub fn check_no_record_file(content: &str) -> Result<(), &'static str> {
    let (segments, _) = segments(content);
    let names_one = segments.iter().any(|segment| match segment {
        Segment::Prose(text) => names_a_record_file(text),
        Segment::Fence(_) => false,
    });
    if names_one {
        Err(NAMES_A_RECORD_FILE)
    } else {
        Ok(())
    }
}

/// Words a heading-led reply must have, from its heading on, before it counts
/// as a document rather than a chat message that happens to start with `#`.
const DOCUMENT_MIN_WORDS: usize = 40;

/// The info string of a fence a model plausibly meant as a document card.
fn is_document_info(info: &str) -> bool {
    matches!(
        info.trim().to_ascii_lowercase().as_str(),
        "doc" | "markdown" | "md" | "text" | "txt" | ""
    )
}

/// Whether `line` is a markdown heading of level 1 to 3 (`# Title`).
fn is_heading(line: &str) -> bool {
    let trimmed = line.trim_start();
    let hashes = trimmed.chars().take_while(|c| *c == '#').count();
    (1..=3).contains(&hashes)
        && line.len() - trimmed.len() <= 3
        && trimmed[hashes..]
            .strip_prefix(' ')
            .is_some_and(|title| !title.trim().is_empty())
}

/// The fence that holds `body` safely: backticks, one more than the longest run
/// inside it, at least three.
fn fence_for(body: &str) -> String {
    let mut longest = 0;
    let mut run = 0;
    for c in body.chars() {
        if c == '`' {
            run += 1;
            longest = longest.max(run);
        } else {
            run = 0;
        }
    }
    "`".repeat((longest + 1).max(3))
}

/// `body` as a document card. The first `# Title` line is the card title.
fn wrap_document(body: &str) -> String {
    let fence = fence_for(body);
    format!("{fence}doc\n{}\n{fence}", body.trim())
}

/// Drop the word `doc` an eaten fence leaves at the start of a reply. A shell
/// removes the backticks of "```doc" inside double quotes and keeps `doc`, so
/// the text starts "doc" alone on a line, or fused to its heading as "doc# ".
fn strip_eaten_fence_label(text: &str) -> &str {
    let Some(rest) = text.strip_prefix("doc") else {
        return text;
    };
    let after_label = rest.trim_start_matches([' ', '\t']);
    if after_label.starts_with('#')
        || after_label.starts_with('\n')
        || after_label.starts_with("\r\n")
    {
        rest.trim_start()
    } else {
        text
    }
}

/// Turn a document that did not arrive as a `doc` card into one.
///
/// Returns the corrected text, or `None` when there is nothing to correct. A
/// reply inside the limit is never touched, and neither is a reply that is not
/// clearly a document, so chat stays chat. The shapes handled:
///
/// 1. A `doc` fence that was never closed: the closing line is added. (This is
///    what the app shows as a code block labelled "doc" when left alone, and
///    what [`shorten_for_chat`] used to cut to 50 words.) A fence with no info
///    string, or `md`/`markdown`/`text`, that opens on a `# Title` is treated
///    the same way.
/// 2. A fence eaten by the shell, leaving `doc` in front of the heading.
/// 3. A heading-led reply with no fence around it, optionally after a short
///    chat line: everything from the heading on becomes the card.
pub fn repair_document(content: &str) -> Option<String> {
    let text = content.trim();
    if check_chat_length(text).is_ok() {
        return None;
    }

    if segments(text).1 {
        return close_open_document_fence(text);
    }

    // Look for a heading that starts the document. A fence before it means the
    // person already got a deliverable; a fence after it is code inside the
    // document, which the new card holds.
    let text = strip_eaten_fence_label(text);
    let mut preamble_words = 0;
    let mut offset = 0;
    for line in text.split_inclusive('\n') {
        if fence_marker(line).is_some() {
            return None;
        }
        if is_heading(line) {
            let body = &text[offset..];
            if preamble_words > CHAT_TARGET_WORDS || words_in(body) < DOCUMENT_MIN_WORDS {
                return None;
            }
            let preamble = text[..offset].trim_end();
            let card = wrap_document(body);
            return Some(if preamble.is_empty() {
                card
            } else {
                format!("{preamble}\n{card}")
            });
        }
        preamble_words += words_in(line);
        if preamble_words > CHAT_TARGET_WORDS {
            return None;
        }
        offset += line.len();
    }
    None
}

/// Close the fence a reply left open, when it opened a document.
fn close_open_document_fence(text: &str) -> Option<String> {
    let mut offset = 0;
    let mut open: Option<(char, usize, usize, usize)> = None;
    for line in text.split_inclusive('\n') {
        let end = offset + line.len();
        match open {
            Some((marker, run, _, _)) => {
                if closes_fence(line, marker, run) {
                    open = None;
                }
            }
            None => {
                if let Some((marker, run)) = fence_marker(line) {
                    open = Some((marker, run, offset, end));
                }
            }
        }
        offset = end;
    }
    let (marker, run, start, opening_end) = open?;
    let opening = &text[start..opening_end];
    let info = opening.trim_start().trim_start_matches(marker).trim();
    if !is_document_info(info) {
        return None;
    }
    let body = &text[opening_end..];
    let explicit_doc = info.eq_ignore_ascii_case("doc");
    if !explicit_doc
        && !body
            .lines()
            .find(|l| !l.trim().is_empty())
            .is_some_and(is_heading)
    {
        return None;
    }
    let fence: String = std::iter::repeat_n(marker, run).collect();
    let mut repaired = String::with_capacity(text.len() + 8);
    repaired.push_str(&text[..start]);
    repaired.push_str(&format!("{fence}doc\n"));
    repaired.push_str(body.trim_end());
    repaired.push('\n');
    repaired.push_str(&fence);
    Some(repaired)
}

/// A document card holding `body`, for a caller that has the text and a title
/// but should not have to type the fence (`colony messages send --doc`).
///
/// The title is `title` when given, else the body's first `# Title` line; a
/// first-line heading in the body is not repeated under it. The fence is longer
/// than any backtick run in the body, so code blocks inside the document cannot
/// close it early.
pub fn document_message(title: Option<&str>, body: &str) -> Result<String, String> {
    let body = body.trim();
    if body.is_empty() {
        return Err("A document needs text. Pass the text with --content (or - for stdin).".into());
    }
    let (first_line, rest) = body.split_once('\n').unwrap_or((body, ""));
    let heading = first_line
        .trim_start()
        .strip_prefix("# ")
        .map(str::trim)
        .filter(|h| !h.is_empty());
    let (title, text) = match (title.map(str::trim).filter(|t| !t.is_empty()), heading) {
        (Some(title), Some(_)) => (title, rest.trim()),
        (Some(title), None) => (title, body),
        (None, Some(heading)) => (heading, rest.trim()),
        (None, None) => {
            return Err(
                "A document needs a title. Pass --title \"Title\" or start the text with a `# Title` line."
                    .into(),
            )
        }
    };
    let title = title
        .trim_start_matches('#')
        .trim()
        .replace(['\n', '\r'], " ");
    let document = format!("# {title}\n\n{text}");
    Ok(wrap_document(&document))
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
/// instead ([`TOO_LONG_LINE`]). A document that lost or never closed its fence
/// is repaired first ([`repair_document`]), so it is posted as a card and not
/// cut.
pub fn shorten_for_chat(content: &str) -> String {
    let repaired = repair_document(content);
    let text = repaired.as_deref().unwrap_or(content).trim();
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
            "Too long for chat: 75 words. Rewrite in under 50 words. Send an article or draft with `--doc --title \"Title\"` (Colony builds the card), or put it in a ```doc fence (start it with a `# Title` line and close it). Put code in a fence with its language tag. Put other long detail in a doc and link it."
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

    /// The blog post of the GATE-312 P10 failure: a heading, an opening
    /// paragraph and five bold-numbered signs, about 300 words.
    fn p10_post() -> String {
        let mut post = String::from(
            "# 5 signs your guesthouse needs social media\nYour guesthouse has charm, clean rooms, and a great breakfast. But if the phone isn't ringing and the calendar has gaps, social media might be the missing piece. Here are five signs it's time to show up online.\n",
        );
        for n in 1..=5 {
            post.push_str(&format!(
                "\n**{n}. Sign number {n} is here.** {}\n",
                words(50)
            ));
        }
        post
    }

    fn assert_card(posted: &str, post: &str) {
        assert!(
            posted.contains(post.trim()),
            "the whole post survives: {posted}"
        );
        assert!(check_chat_length(posted).is_ok(), "{posted}");
        assert!(!posted.contains(SHORTENED_OFFER), "{posted}");
        let (parsed, unclosed) = segments(posted);
        assert!(!unclosed, "{posted}");
        assert!(
            parsed
                .iter()
                .any(|s| matches!(s, Segment::Fence(f) if f.starts_with("```doc\n# 5 signs"))),
            "a closed doc fence: {posted}"
        );
    }

    #[test]
    fn p10_reply_with_an_unclosed_doc_fence_is_posted_as_a_card_not_cut() {
        // The shape that reached the person: the model opened ```doc and never
        // closed it, so every word counted as chat and was cut to 48 words.
        let post = p10_post();
        let reply = format!("```doc\n{post}");
        assert!(check_chat_length(&reply).unwrap_err().unclosed_fence);

        let posted = shorten_for_chat(&reply);

        assert_card(&posted, &post);
        assert!(posted.ends_with("\n```"), "{posted}");
    }

    #[test]
    fn a_doc_fence_left_open_after_a_chat_line_keeps_the_line_and_closes_the_card() {
        let post = p10_post();
        let reply = format!("Here's the blog post.\n```doc\n{post}");
        let posted = shorten_for_chat(&reply);
        assert!(
            posted.starts_with("Here's the blog post.\n```doc\n# 5 signs"),
            "{posted}"
        );
        assert_card(&posted, &post);
        // A longer opening fence is closed with the same fence.
        let fenced = format!("````doc\n{post}");
        let repaired = repair_document(&fenced).unwrap();
        assert!(repaired.ends_with("\n````"), "{repaired}");
    }

    #[test]
    fn a_fence_the_shell_ate_is_rebuilt() {
        let post = p10_post();
        // Backticks removed, the word doc left behind, on its own line or fused.
        for eaten in [
            format!("doc\n{post}"),
            format!("doc{post}"),
            format!("Doc\n{post}"),
        ] {
            let posted = shorten_for_chat(&eaten);
            assert_card(&posted, &post);
            assert!(!posted.contains("doc# "), "{posted}");
        }
    }

    #[test]
    fn a_heading_led_post_without_any_fence_becomes_a_card() {
        let post = p10_post();
        assert_card(&shorten_for_chat(&post), &post);
        // After one short chat line, only the document goes in the card.
        let with_line = format!("Here's the post.\n\n{post}");
        let posted = shorten_for_chat(&with_line);
        assert!(
            posted.starts_with("Here's the post.\n```doc\n# 5 signs"),
            "{posted}"
        );
        assert_card(&posted, &post);
    }

    #[test]
    fn an_unfenced_document_with_code_ticks_gets_a_longer_fence() {
        let post = format!("{}\n\n````\nnested\n````\n", p10_post());
        let repaired = repair_document(&post).unwrap();
        assert!(repaired.starts_with("`````doc\n"), "{repaired}");
        assert!(repaired.ends_with("\n`````"), "{repaired}");
    }

    #[test]
    fn a_properly_fenced_document_is_left_alone() {
        let post = p10_post();
        let reply = format!("Here's the blog post.\n```doc\n{post}\n```");
        assert_eq!(repair_document(&reply), None);
        assert_eq!(shorten_for_chat(&reply), reply);
    }

    #[test]
    fn normal_chat_is_never_turned_into_a_card() {
        // Inside the limit, even when it starts with a heading or "doc".
        let short = "Best lead: Pecan Tree Guesthouse. Draft a WhatsApp to them?";
        assert_eq!(repair_document(short), None);
        assert_eq!(shorten_for_chat(short), short);
        assert_eq!(repair_document("# Done\nThe post is live."), None);
        assert_eq!(repair_document("doc\n# Done"), None);
        // Over the limit but prose, not a document.
        let long = (1..=14)
            .map(|n| format!("Guest house number {n} was checked and ruled out."))
            .collect::<Vec<_>>()
            .join(" ");
        assert_eq!(repair_document(&long), None);
        assert!(shorten_for_chat(&long).ends_with(SHORTENED_OFFER));
        // A long chat answer that only mentions a heading later is not a document.
        let late = format!("{}\n# Heading\n{}", words(70), words(80));
        assert_eq!(repair_document(&late), None);
        // An unclosed fence that is code stays as the old rules treat it.
        let code = format!("```python\n{}", words(100));
        assert_eq!(repair_document(&code), None);
    }

    #[test]
    fn an_unclosed_plain_fence_counts_as_a_document_only_when_it_opens_on_a_heading() {
        let post = p10_post();
        let repaired = repair_document(&format!("```\n{post}")).unwrap();
        assert!(repaired.starts_with("```doc\n# 5 signs"), "{repaired}");
        assert_eq!(repair_document(&format!("```\n{}", words(100))), None);
        let markdown = repair_document(&format!("```markdown\n{post}")).unwrap();
        assert!(markdown.starts_with("```doc\n# 5 signs"), "{markdown}");
    }

    #[test]
    fn document_message_builds_the_card_from_a_title_and_text() {
        let card = document_message(Some("5 signs"), "Opening line.\n\nSecond paragraph.").unwrap();
        assert_eq!(
            card,
            "```doc\n# 5 signs\n\nOpening line.\n\nSecond paragraph.\n```"
        );
        // The text's own first heading is the title when none is given, and is
        // not repeated; an explicit title wins over it.
        let from_text = document_message(None, "# From text\nBody.").unwrap();
        assert_eq!(from_text, "```doc\n# From text\n\nBody.\n```");
        let explicit = document_message(Some("Given"), "# From text\nBody.").unwrap();
        assert_eq!(explicit, "```doc\n# Given\n\nBody.\n```");
        assert!(check_chat_length(&card).is_ok());
        let big = document_message(Some("Big"), &words(900)).unwrap();
        assert!(
            check_chat_length(&big).is_ok(),
            "a built card is not word-capped"
        );
    }

    #[test]
    fn document_message_fence_survives_code_blocks_in_the_text() {
        let card = document_message(Some("Code"), "Intro\n\n```bash\nls\n```\n").unwrap();
        assert!(card.starts_with("````doc\n# Code"), "{card}");
        assert!(card.ends_with("\n````"), "{card}");
        let (parsed, unclosed) = segments(&card);
        assert!(!unclosed);
        assert_eq!(parsed.len(), 1);
    }

    #[test]
    fn document_message_refuses_what_it_cannot_make_into_a_card() {
        assert!(document_message(Some("T"), "  \n").is_err());
        let untitled = document_message(None, "No heading here.").unwrap_err();
        assert!(untitled.contains("--title"), "{untitled}");
        assert!(document_message(Some("  "), "Body.").is_err());
        // A title cannot break out of its line.
        let card = document_message(Some("## Two\nlines"), "Body.").unwrap();
        assert!(card.starts_with("```doc\n# Two lines\n"), "{card}");
    }

    #[test]
    fn limits_text_has_no_em_dashes() {
        for text in [SHORTENED_OFFER, TOO_LONG_LINE] {
            assert!(!text.contains('\u{2014}'));
        }
        let error = check_chat_length(&words(75)).unwrap_err().to_string();
        assert!(!error.contains('\u{2014}'));
    }

    #[test]
    fn chat_that_names_a_record_file_is_refused() {
        for text in [
            "I saved the weekly review to OUTBOX/WEEKLY_REVIEW_2026-11-01.md.",
            "Created the playbook in GUIDES/OPERATIONS_PLAYBOOK.md",
            "The plan is at ~/.colony/PLANS/MELVILLE_CLIENT_ACQUISITION.md now.",
            "Done: (PLANS/plan.md)",
        ] {
            assert_eq!(
                check_no_record_file(text),
                Err(NAMES_A_RECORD_FILE),
                "{text}"
            );
        }
    }

    #[test]
    fn chat_that_does_not_name_a_record_file_is_accepted() {
        for text in [
            "Proposed the plan. It is waiting for your approval.",
            "I put it in the plans folder.",
            "Check SUBPLANS/ for the old ones.",
            "The OUTBOX/ folder is empty.",
            "RESEARCH/MELVILLE_GUESTHOUSES.md has the list.",
        ] {
            assert_eq!(check_no_record_file(text), Ok(()), "{text}");
        }
    }

    #[test]
    fn a_fenced_deliverable_may_name_a_record_file() {
        let text = "Here is the note.\n\n```doc\n# Layout\nSave it in OUTBOX/NOTE.md\n```";
        assert_eq!(check_no_record_file(text), Ok(()));
        // The same words outside a fence are refused.
        assert_eq!(
            check_no_record_file("Save it in OUTBOX/NOTE.md"),
            Err(NAMES_A_RECORD_FILE)
        );
    }

    #[test]
    fn the_record_file_refusal_names_every_command_and_has_no_em_dash() {
        for command in [
            "colony plans propose",
            "colony playbooks propose",
            "colony numbers goals propose",
            "colony numbers review write",
        ] {
            assert!(NAMES_A_RECORD_FILE.contains(command), "{command}");
        }
        assert!(!NAMES_A_RECORD_FILE.contains('\u{2014}'));
    }
}
