//! Reply guarantee for turns a person started.
//!
//! An agent is told to answer people with `colony messages send`, and its tool
//! calls and thinking are invisible. A model that does the work and then ends
//! the turn with the answer only as assistant text leaves the person with
//! silence. This module is the harness-side safety net: when a turn that a
//! person started ends and the agent published nothing into that conversation,
//! the harness posts the agent's final assistant message itself, threaded the
//! way `--reply-to` would thread it.
//!
//! What the net posts obeys the same chat limit as `colony messages send`
//! (`buzz_core::chat_limits`): a long final message is cut back to whole
//! sentences and the rest is offered, never posted as a wall of text. A fenced
//! block the person asked for is a deliverable and is posted whole.
//!
//! The net never speaks when it could be wrong to:
//!   - agent to agent turns and messages that do not mention the agent stay
//!     silent, because silence is a valid ending there;
//!   - an agent that published anything into the conversation during the turn
//!     is never doubled up on;
//!   - the harness reply carries no `p` tags, so it can never wake anyone.

use std::collections::HashSet;
use std::time::Duration;

use uuid::Uuid;

use crate::acp::StopReason;
use crate::queue::{self, FlushBatch, PromptProfile, PromptProfileLookup, ReplyDestination};
use crate::relay::RestClient;

/// What the harness says when a turn ended without an answer worth posting.
pub(crate) const FALLBACK_LINE: &str = "I couldn't finish that. Try asking again.";

/// Most bytes of the final assistant message captured. The relay accepts 64 KiB
/// of content; this stays well inside it. What is posted is shortened to the
/// chat limit on top of this bound, so a fenced deliverable is the only part of
/// a post that can approach it.
const MAX_FINAL_TEXT_BYTES: usize = 32 * 1024;

/// Kinds that count as the agent having answered in a conversation: chat
/// messages, diffs, forum posts and forum comments.
const REPLY_KINDS: [u16; 5] = [
    buzz_core::kind::KIND_STREAM_MESSAGE as u16,
    buzz_core::kind::KIND_STREAM_MESSAGE_V2 as u16,
    buzz_core::kind::KIND_STREAM_MESSAGE_DIFF as u16,
    buzz_core::kind::KIND_FORUM_POST as u16,
    buzz_core::kind::KIND_FORUM_COMMENT as u16,
];

/// Newest agent messages fetched when checking whether the agent already spoke.
const CHECK_LIMIT: usize = 50;
const CHECK_ATTEMPTS: u32 = 2;
const CHECK_TIMEOUT: Duration = Duration::from_secs(5);
const CHECK_RETRY_DELAY: Duration = Duration::from_secs(1);

/// Resubmitting the same signed event is idempotent, so a failed post is tried
/// again on top of the REST client's own transient-error retries.
const POST_ATTEMPTS: u32 = 3;
const POST_TIMEOUT: Duration = Duration::from_secs(15);
const POST_RETRY_DELAY: Duration = Duration::from_secs(2);

// ── final assistant message ─────────────────────────────────────────────────

/// The assistant message a turn ended on.
///
/// Fed from `agent_message_chunk` updates. Text said before a tool call is
/// narration of work in progress, so a tool call discards it and only text after
/// the last tool call survives. A new `messageId` starts a new message.
#[derive(Debug, Default)]
pub(crate) struct FinalTextCapture {
    text: String,
    message_id: Option<String>,
    truncated: bool,
}

impl FinalTextCapture {
    /// Forget everything: a new prompt is starting.
    pub(crate) fn reset(&mut self) {
        *self = Self::default();
    }

    pub(crate) fn push_chunk(&mut self, message_id: Option<&str>, chunk: &str) {
        if let Some(id) = message_id {
            if self.message_id.as_deref() != Some(id) {
                self.text.clear();
                self.truncated = false;
                self.message_id = Some(id.to_owned());
            }
        }
        if self.truncated {
            return;
        }
        let room = MAX_FINAL_TEXT_BYTES.saturating_sub(self.text.len());
        if chunk.len() <= room {
            self.text.push_str(chunk);
            return;
        }
        let mut end = room;
        while !chunk.is_char_boundary(end) {
            end -= 1;
        }
        self.text.push_str(&chunk[..end]);
        self.truncated = true;
    }

    /// The agent started a tool call: what it said so far was not the answer.
    pub(crate) fn tool_started(&mut self) {
        self.reset();
    }

    /// The captured message, trimmed. Empty when the turn ended on a tool call
    /// or said nothing.
    pub(crate) fn take(&mut self) -> String {
        let mut text = self.text.trim().to_owned();
        if self.truncated && !text.is_empty() {
            text.push('…');
        }
        self.reset();
        text
    }
}

/// The text to post for a turn that ended with `stop_reason`.
///
/// Only a turn the model finished (or refused, whose explanation is the answer)
/// may speak with its own words, and those words are held to the chat limit. A
/// turn that ran out of tokens or steps, or was cancelled, has at best a cut-off
/// answer, so it gets the plain fallback.
pub(crate) fn reply_content(stop_reason: &StopReason, final_text: &str) -> String {
    let text = final_text.trim();
    let finished = matches!(stop_reason, StopReason::EndTurn | StopReason::Refusal);
    if finished && !text.is_empty() {
        buzz_core::chat_limits::shorten_for_chat(text)
    } else {
        FALLBACK_LINE.to_owned()
    }
}

// ── when and where to speak ─────────────────────────────────────────────────

/// A turn the harness must not leave without a reply, and where the reply goes.
#[derive(Debug, Clone)]
pub(crate) struct ReplyPlan {
    channel_id: Uuid,
    destination: ReplyDestination,
    /// Thread roots this turn answers. An agent message in the channel counts
    /// as this turn's answer when it is top level or rooted in one of these;
    /// a message in some other thread belongs to a different session.
    roots: HashSet<String>,
}

impl ReplyPlan {
    /// A plan for `batch`, or `None` when silence is a valid ending: the turn was
    /// not started by a person, or (outside a DM) nobody mentioned the agent.
    pub(crate) fn for_batch(
        batch: &FlushBatch,
        is_dm: bool,
        agent: &nostr::PublicKey,
        profile_lookup: Option<&PromptProfileLookup>,
    ) -> Option<Self> {
        let last = batch.events.last()?;
        let agent_hex = agent.to_hex();
        let all_events = || batch.events.iter().chain(batch.cancelled_events.iter());
        if !is_dm && !all_events().any(|batched| mentions(&batched.event, &agent_hex)) {
            return None;
        }

        // The agent is an agent by definition, whatever its profile says (or
        // fails to say yet): never let a mention of itself make a turn human.
        let mut lookup = profile_lookup.cloned().unwrap_or_default();
        lookup
            .entry(agent_hex)
            .and_modify(|profile| profile.is_agent = true)
            .or_insert(PromptProfile {
                display_name: None,
                nip05_handle: None,
                is_agent: true,
            });
        let destination = queue::reply_destination(&last.event, is_dm, Some(&lookup));
        if destination == ReplyDestination::NotHumanFacing {
            return None;
        }

        let roots = all_events()
            .map(|batched| {
                queue::parse_thread_tags(&batched.event)
                    .root_event_id
                    .unwrap_or_else(|| batched.event.id.to_hex())
            })
            .collect();
        Some(Self {
            channel_id: batch.channel_id,
            destination,
            roots,
        })
    }

    /// Whether an event the agent published counts as its answer to this turn.
    fn is_answer(&self, event: &nostr::Event) -> bool {
        match queue::parse_thread_tags(event).root_event_id {
            None => true,
            Some(root) => self.roots.contains(&root),
        }
    }
}

fn mentions(event: &nostr::Event, agent_hex: &str) -> bool {
    event.tags.iter().any(|tag| {
        let parts = tag.as_slice();
        parts.first().map(String::as_str) == Some("p")
            && parts
                .get(1)
                .is_some_and(|value| value.eq_ignore_ascii_case(agent_hex))
    })
}

// ── speaking ────────────────────────────────────────────────────────────────

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum ReplyOutcome {
    /// The agent published into the conversation itself; the harness added nothing.
    AlreadyReplied,
    /// The harness posted the reply.
    Posted,
    /// Every attempt to post failed; the error is logged.
    Failed,
}

/// Seconds since the Unix epoch, as a relay `created_at`.
pub(crate) fn unix_now() -> u64 {
    nostr::Timestamp::now().as_secs()
}

/// Post `final_text` (or the fallback line) as the agent's reply to the turn,
/// unless the agent already published into the conversation since
/// `turn_started_unix`.
///
/// Bounded: two bounded history checks and three bounded posts at most. When the
/// history cannot be read the reply is posted anyway, because a rare duplicate
/// is better than the silence this exists to prevent. A post that never lands is
/// logged as an error with the channel and event id, never dropped quietly.
pub(crate) async fn ensure_reply(
    rest: &RestClient,
    plan: &ReplyPlan,
    turn_started_unix: u64,
    stop_reason: &StopReason,
    final_text: &str,
) -> ReplyOutcome {
    let channel = plan.channel_id;
    match agent_replied_since(rest, plan, turn_started_unix).await {
        Ok(true) => {
            tracing::debug!(
                target: "pool::reply",
                channel = %channel,
                "agent already replied this turn - nothing to add"
            );
            return ReplyOutcome::AlreadyReplied;
        }
        Ok(false) => {}
        Err(error) => tracing::warn!(
            target: "pool::reply",
            channel = %channel,
            "could not check whether the agent replied ({error}) - posting the reply anyway"
        ),
    }

    let content = reply_content(stop_reason, final_text);
    let event = match build_reply(rest, plan, &content) {
        Ok(event) => event,
        Err(error) => {
            tracing::error!(
                target: "pool::reply",
                channel = %channel,
                "could not build the reply for a turn the agent left unanswered: {error}"
            );
            return ReplyOutcome::Failed;
        }
    };

    let mut last_error = String::new();
    for attempt in 1..=POST_ATTEMPTS {
        match tokio::time::timeout(POST_TIMEOUT, rest.submit_event(&event)).await {
            Ok(Ok(_)) => {
                tracing::info!(
                    target: "pool::reply",
                    channel = %channel,
                    event_id = %event.id,
                    stop_reason = ?stop_reason,
                    fallback = (content == FALLBACK_LINE),
                    "agent ended the turn without publishing - posted its final message as the reply"
                );
                return ReplyOutcome::Posted;
            }
            Ok(Err(error)) => last_error = error.to_string(),
            Err(_) => last_error = format!("timed out after {}s", POST_TIMEOUT.as_secs()),
        }
        tracing::warn!(
            target: "pool::reply",
            channel = %channel,
            event_id = %event.id,
            attempt,
            "posting the reply failed: {last_error}"
        );
        if attempt < POST_ATTEMPTS {
            tokio::time::sleep(POST_RETRY_DELAY).await;
        }
    }
    tracing::error!(
        target: "pool::reply",
        channel = %channel,
        event_id = %event.id,
        "turn ended with no reply and the harness could not post one: {last_error}"
    );
    ReplyOutcome::Failed
}

fn build_reply(rest: &RestClient, plan: &ReplyPlan, content: &str) -> Result<nostr::Event, String> {
    let thread_ref = match &plan.destination {
        ReplyDestination::Thread { root, parent } => Some(buzz_sdk::ThreadRef {
            root_event_id: nostr::EventId::from_hex(root)
                .map_err(|error| format!("bad thread root {root}: {error}"))?,
            parent_event_id: nostr::EventId::from_hex(parent)
                .map_err(|error| format!("bad thread parent {parent}: {error}"))?,
        }),
        ReplyDestination::TopLevel | ReplyDestination::NotHumanFacing => None,
    };
    buzz_sdk::build_message(
        plan.channel_id,
        content,
        thread_ref.as_ref(),
        &[],
        false,
        &[],
        &[],
    )
    .map_err(|error| format!("build failed: {error}"))?
    .sign_with_keys(&rest.keys)
    .map_err(|error| format!("sign failed: {error}"))
}

/// Did the agent publish an answer into this conversation since `since`?
async fn agent_replied_since(
    rest: &RestClient,
    plan: &ReplyPlan,
    since: u64,
) -> Result<bool, String> {
    let filter = nostr::Filter::new()
        .kinds(REPLY_KINDS.map(nostr::Kind::Custom))
        .author(rest.keys.public_key())
        .custom_tags(
            nostr::SingleLetterTag::lowercase(nostr::Alphabet::H),
            [plan.channel_id.to_string()],
        )
        .since(nostr::Timestamp::from(since))
        .limit(CHECK_LIMIT);

    let mut last_error = String::new();
    for attempt in 1..=CHECK_ATTEMPTS {
        match tokio::time::timeout(CHECK_TIMEOUT, rest.query(std::slice::from_ref(&filter))).await {
            Ok(Ok(response)) => return answer_in_response(&response, plan),
            Ok(Err(error)) => last_error = error.to_string(),
            Err(_) => last_error = format!("timed out after {}s", CHECK_TIMEOUT.as_secs()),
        }
        if attempt < CHECK_ATTEMPTS {
            tokio::time::sleep(CHECK_RETRY_DELAY).await;
        }
    }
    Err(last_error)
}

/// Whether any event in a `/query` response is the agent's answer to this turn.
/// An event that cannot be read is assumed to be one: doubling up is worse than
/// guessing wrong the other way only when the relay is already misbehaving.
fn answer_in_response(response: &serde_json::Value, plan: &ReplyPlan) -> Result<bool, String> {
    let events = response
        .as_array()
        .ok_or_else(|| "query response is not an event array".to_owned())?;
    Ok(events.iter().any(
        |raw| match serde_json::from_value::<nostr::Event>(raw.clone()) {
            Ok(event) => plan.is_answer(&event),
            Err(_) => true,
        },
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::queue::BatchEvent;
    use crate::scope::SessionScope;
    use nostr::{EventBuilder, Keys, Kind, Tag};

    fn event_by(keys: &Keys, tags: Vec<Vec<String>>) -> nostr::Event {
        let tags: Vec<Tag> = tags
            .iter()
            .map(|parts| Tag::parse(parts.iter().map(String::as_str)).unwrap())
            .collect();
        EventBuilder::new(Kind::Custom(9), "@Scout hello")
            .tags(tags)
            .sign_with_keys(keys)
            .unwrap()
    }

    fn batch_of(events: Vec<nostr::Event>) -> FlushBatch {
        let channel_id = Uuid::new_v4();
        FlushBatch {
            channel_id,
            scope: SessionScope::Conversation { channel_id },
            events: events
                .into_iter()
                .map(|event| BatchEvent {
                    event,
                    prompt_tag: "test".into(),
                    received_at: std::time::Instant::now(),
                })
                .collect(),
            cancelled_events: vec![],
            cancel_reason: None,
        }
    }

    fn mention_tag(agent: &Keys) -> Vec<String> {
        vec!["p".into(), agent.public_key().to_hex()]
    }

    // ── FinalTextCapture ────────────────────────────────────────────────────

    #[test]
    fn capture_keeps_only_text_after_the_last_tool_call() {
        let mut capture = FinalTextCapture::default();
        capture.push_chunk(None, "Let me ");
        capture.push_chunk(None, "look.");
        capture.tool_started();
        capture.push_chunk(None, "Still ");
        capture.tool_started();
        capture.push_chunk(None, "The title ");
        capture.push_chunk(None, "is X.\n");
        assert_eq!(capture.take(), "The title is X.");
        assert_eq!(capture.take(), "", "taking clears the capture");
    }

    #[test]
    fn capture_is_empty_when_the_turn_ends_on_a_tool_call() {
        let mut capture = FinalTextCapture::default();
        capture.push_chunk(None, "Working on it.");
        capture.tool_started();
        assert_eq!(capture.take(), "");
    }

    #[test]
    fn capture_starts_over_on_a_new_message_id() {
        let mut capture = FinalTextCapture::default();
        capture.push_chunk(Some("m1"), "first ");
        capture.push_chunk(Some("m1"), "message");
        capture.push_chunk(Some("m2"), "second message");
        assert_eq!(capture.take(), "second message");
    }

    #[test]
    fn capture_reset_forgets_the_previous_turn() {
        let mut capture = FinalTextCapture::default();
        capture.push_chunk(Some("m1"), "old answer");
        capture.reset();
        capture.push_chunk(Some("m1"), "new answer");
        assert_eq!(capture.take(), "new answer");
    }

    #[test]
    fn capture_is_bounded_and_marks_the_cut_on_a_char_boundary() {
        let mut capture = FinalTextCapture::default();
        // 3-byte characters never line up with the byte cap.
        let chunk = "€".repeat(MAX_FINAL_TEXT_BYTES);
        capture.push_chunk(None, &chunk);
        capture.push_chunk(None, "more");
        let text = capture.take();
        assert!(text.ends_with('…'));
        assert!(!text.contains("mo"), "nothing is appended after the cut");
        assert!(text.len() <= MAX_FINAL_TEXT_BYTES + '…'.len_utf8());
        assert!(text.chars().filter(|c| *c == '€').count() >= MAX_FINAL_TEXT_BYTES / 3 - 1);
    }

    // ── reply_content ───────────────────────────────────────────────────────

    #[test]
    fn reply_content_uses_the_model_words_only_for_a_finished_turn() {
        assert_eq!(reply_content(&StopReason::EndTurn, "  Done.  "), "Done.");
        assert_eq!(
            reply_content(&StopReason::Refusal, "I can't help with that."),
            "I can't help with that."
        );
        for stop in [
            StopReason::MaxTokens,
            StopReason::MaxTurnRequests,
            StopReason::Cancelled,
        ] {
            assert_eq!(reply_content(&stop, "The title is \"Col"), FALLBACK_LINE);
        }
        assert_eq!(reply_content(&StopReason::EndTurn, " \n "), FALLBACK_LINE);
        assert_eq!(reply_content(&StopReason::Refusal, ""), FALLBACK_LINE);
    }

    fn long_answer() -> String {
        (1..=14)
            .map(|n| format!("Guest house number {n} was checked and ruled out."))
            .collect::<Vec<_>>()
            .join(" ")
    }

    #[test]
    fn reply_content_holds_the_model_words_to_the_chat_limit() {
        let long = long_answer();
        assert!(buzz_core::chat_limits::check_chat_length(&long).is_err());

        let reply = reply_content(&StopReason::EndTurn, &long);

        assert!(
            buzz_core::chat_limits::check_chat_length(&reply).is_ok(),
            "{reply}"
        );
        assert!(reply.starts_with("Guest house number 1 was checked and ruled out."));
        assert!(
            reply.ends_with(buzz_core::chat_limits::SHORTENED_OFFER),
            "{reply}"
        );
        assert!(
            !reply.contains("number 14 "),
            "the tail is offered, not posted: {reply}"
        );
        // A refusal is shortened the same way.
        assert_eq!(reply_content(&StopReason::Refusal, &long), reply);
    }

    #[test]
    fn reply_content_does_not_cut_a_sentence_in_half() {
        let one_long_sentence = format!("{} and that is all.", vec!["word"; 120].join(" "));
        assert_eq!(
            reply_content(&StopReason::EndTurn, &one_long_sentence),
            buzz_core::chat_limits::TOO_LONG_LINE
        );
    }

    #[test]
    fn reply_content_keeps_a_fenced_deliverable_whole() {
        let post = format!(
            "Here's the blog post.\n```doc\n# Karoo launch\n{}\n```",
            vec!["word"; 700].join(" ")
        );
        assert_eq!(reply_content(&StopReason::EndTurn, &post), post);
    }

    /// The GATE-312 P10 reply: the model opened a `doc` fence for the blog post
    /// and never closed it. It used to be cut to 48 words, "Want the rest?"
    /// appended, and shown as a code block labelled "doc".
    fn p10_post() -> String {
        let mut post = String::from(
            "# 5 signs your guesthouse needs social media\nYour guesthouse has charm, clean rooms, and a great breakfast. But if the phone isn't ringing and the calendar has gaps, social media might be the missing piece. Here are five signs it's time to show up online.\n",
        );
        for n in 1..=5 {
            post.push_str(&format!(
                "\n**{n}. Sign number {n}.** {}\n",
                vec!["word"; 50].join(" ")
            ));
        }
        post
    }

    #[test]
    fn reply_content_posts_an_unclosed_doc_fence_as_a_card() {
        let post = p10_post();
        for stop in [StopReason::EndTurn, StopReason::Refusal] {
            let reply = reply_content(&stop, &format!("```doc\n{post}"));
            assert!(reply.contains(post.trim()), "the whole post: {reply}");
            assert!(reply.starts_with("```doc\n# 5 signs"), "{reply}");
            assert!(reply.ends_with("\n```"), "closed: {reply}");
            assert!(
                !reply.contains(buzz_core::chat_limits::SHORTENED_OFFER),
                "{reply}"
            );
        }
    }

    #[test]
    fn reply_content_posts_an_eaten_fence_and_an_unfenced_post_as_a_card() {
        let post = p10_post();
        for text in [
            format!("doc\n{post}"),
            format!("Here's the post.\n\n{post}"),
        ] {
            let reply = reply_content(&StopReason::EndTurn, &text);
            assert!(reply.contains(post.trim()), "{reply}");
            assert!(reply.contains("```doc\n# 5 signs"), "{reply}");
            assert!(reply.ends_with("\n```"), "{reply}");
        }
    }

    #[test]
    fn reply_content_leaves_a_short_answer_and_a_closed_card_alone() {
        let short = "Best lead: Pecan Tree Guesthouse. Draft a WhatsApp to them?";
        assert_eq!(reply_content(&StopReason::EndTurn, short), short);
        let closed = format!("Here it is.\n```doc\n{}\n```", p10_post());
        assert_eq!(reply_content(&StopReason::EndTurn, &closed), closed);
    }

    /// The prompt is the first line of defence; the harness reply is the net.
    #[test]
    fn base_prompt_tells_agents_their_final_text_is_not_delivered() {
        let prompt = include_str!("base_prompt.md");
        assert!(prompt.contains("The text you write at the end of a turn is not delivered"));
        assert!(prompt.contains("your last action must be `colony messages send`"));
        assert!(prompt.contains("One sentence is enough; silence is not."));
    }

    #[test]
    fn fallback_line_is_plain_user_copy() {
        assert!(!FALLBACK_LINE.contains('\u{2014}'), "no em dashes");
        assert!(!FALLBACK_LINE.to_lowercase().contains("buzz"));
    }

    // ── ReplyPlan::for_batch ────────────────────────────────────────────────

    #[test]
    fn plan_requires_a_mention_outside_a_dm() {
        let agent = Keys::generate();
        let human = Keys::generate();
        let plain = batch_of(vec![event_by(&human, vec![])]);
        assert!(ReplyPlan::for_batch(&plain, false, &agent.public_key(), None).is_none());
        // In a DM every message from a person is addressed to the agent.
        assert!(ReplyPlan::for_batch(&plain, true, &agent.public_key(), None).is_some());

        let mentioned = batch_of(vec![event_by(&human, vec![mention_tag(&agent)])]);
        let plan = ReplyPlan::for_batch(&mentioned, false, &agent.public_key(), None).unwrap();
        let trigger = mentioned.events[0].event.id.to_hex();
        assert_eq!(
            plan.destination,
            ReplyDestination::Thread {
                root: trigger.clone(),
                parent: trigger
            }
        );
    }

    #[test]
    fn plan_ignores_a_mention_of_somebody_else() {
        let agent = Keys::generate();
        let other = Keys::generate();
        let human = Keys::generate();
        let batch = batch_of(vec![event_by(&human, vec![mention_tag(&other)])]);
        assert!(ReplyPlan::for_batch(&batch, false, &agent.public_key(), None).is_none());
    }

    #[test]
    fn plan_stays_silent_for_an_agent_author_that_mentions_this_agent() {
        let agent = Keys::generate();
        let other_agent = Keys::generate();
        let lookup = PromptProfileLookup::from([(
            other_agent.public_key().to_hex(),
            PromptProfile {
                is_agent: true,
                ..Default::default()
            },
        )]);
        // The mention is of this agent, whose own profile is absent from the
        // lookup: that must not make the turn look human.
        let batch = batch_of(vec![event_by(&other_agent, vec![mention_tag(&agent)])]);
        assert!(ReplyPlan::for_batch(&batch, false, &agent.public_key(), Some(&lookup)).is_none());
        assert!(ReplyPlan::for_batch(&batch, true, &agent.public_key(), Some(&lookup)).is_none());
    }

    #[test]
    fn plan_counts_a_mention_in_a_cancelled_event_that_was_merged_in() {
        let agent = Keys::generate();
        let human = Keys::generate();
        let mut batch = batch_of(vec![event_by(&human, vec![])]);
        batch.cancelled_events = vec![BatchEvent {
            event: event_by(&human, vec![mention_tag(&agent)]),
            prompt_tag: "test".into(),
            received_at: std::time::Instant::now(),
        }];
        let plan = ReplyPlan::for_batch(&batch, false, &agent.public_key(), None).unwrap();
        assert_eq!(plan.roots.len(), 2);
    }

    // ── answer detection ────────────────────────────────────────────────────

    fn plan_with_roots(roots: &[&str]) -> ReplyPlan {
        ReplyPlan {
            channel_id: Uuid::new_v4(),
            destination: ReplyDestination::TopLevel,
            roots: roots.iter().map(|root| root.to_string()).collect(),
        }
    }

    #[test]
    fn a_top_level_post_or_a_post_in_this_thread_is_the_answer() {
        let agent = Keys::generate();
        let root = "a".repeat(64);
        let plan = plan_with_roots(&[root.as_str()]);
        let top_level = event_by(&agent, vec![]);
        let in_thread = event_by(
            &agent,
            vec![vec!["e".into(), root, "".into(), "reply".into()]],
        );
        let response = serde_json::json!([top_level]);
        assert_eq!(answer_in_response(&response, &plan), Ok(true));
        let response = serde_json::json!([in_thread]);
        assert_eq!(answer_in_response(&response, &plan), Ok(true));
    }

    #[test]
    fn a_post_in_another_thread_is_not_the_answer() {
        let agent = Keys::generate();
        let root = "a".repeat(64);
        let plan = plan_with_roots(&[root.as_str()]);
        let elsewhere = event_by(
            &agent,
            vec![vec!["e".into(), "b".repeat(64), "".into(), "reply".into()]],
        );
        assert_eq!(
            answer_in_response(&serde_json::json!([elsewhere]), &plan),
            Ok(false)
        );
        assert_eq!(answer_in_response(&serde_json::json!([]), &plan), Ok(false));
    }

    #[test]
    fn unreadable_events_count_as_an_answer_and_a_non_array_is_an_error() {
        let plan = plan_with_roots(&[]);
        assert_eq!(
            answer_in_response(&serde_json::json!([{"id": "nope"}]), &plan),
            Ok(true)
        );
        assert!(answer_in_response(&serde_json::json!({}), &plan).is_err());
    }
}
