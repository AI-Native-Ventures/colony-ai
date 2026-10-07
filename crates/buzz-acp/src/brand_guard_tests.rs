//! Brand guard for the agent-visible text that buzz-acp hands to agents.
//!
//! Every surface here is produced by the same production code an agent run
//! uses: the embedded base prompt, the session-model addendum, the framed
//! system prompt, the workspace section, the core-memory nudge, the canvas
//! section, and the per-turn prompts for every scope the harness can build.
//! None of it may say `buzz` outside [`ALLOW`]. See `test-support/brand_guard.rs`
//! for the matching rules and the falsifiability check.

#[path = "../../../test-support/brand_guard.rs"]
pub(crate) mod brand_guard;

use std::time::Instant;

use brand_guard::{Allow, Match, Surface};
use nostr::{Event, EventBuilder, Keys, Kind, Tag};
use uuid::Uuid;

use crate::engram_fetch::ONBOARDING_NUDGE;
use crate::pool::{framed_system_prompt, render_canvas_section, workspace_section};
use crate::prompt_framing::DEFAULT_BASE_PROMPT;
use crate::prompt_project::PromptProjectInfo;
use crate::queue::{
    format_prompt, BatchEvent, CancelReason, ContextMessage, ConversationContext, FlushBatch,
    FormatPromptArgs, PromptChannelInfo, StandingContext,
};
use crate::scope::{SessionPolicy, SessionScope};

/// The only places the old name may still appear in agent-visible text.
///
/// The two turn tags are a machine contract that running agents already parse,
/// so they cannot be renamed in the same release that stops the name appearing
/// in prose. Environment variable names are not allowed here: the prompts no
/// longer name them. Each entry says why and when it can go.
const ALLOW: &[Allow] = &[
    Allow {
        text: "buzz-event",
        kind: Match::XmlTag,
        reason: "Structural turn tag that wraps every incoming message and is named in the base \
                 prompt so the model finds the request. Agents already running parse it. \
                 Removal: later track, rename with dual-tag support in the harness and prompts.",
    },
    Allow {
        text: "buzz-events",
        kind: Match::XmlTag,
        reason: "Structural turn tag that wraps a batch of incoming messages, the plural twin of \
                 the single-event tag. Removal: later track, together with the single-event tag.",
    },
];

const CHANNEL_ID: &str = "11111111-1111-4111-8111-111111111111";
const THREAD_ROOT: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
/// What a fresh install gets as the working folder.
const FRESH_CWD: &str = "/Users/test/.colony";

fn make_event(content: &str, tags: Vec<Tag>) -> Event {
    EventBuilder::new(Kind::Custom(9), content)
        .tags(tags)
        .sign_with_keys(&Keys::generate())
        .expect("signing a fixture event cannot fail")
}

fn reply_event(content: &str) -> Event {
    let tag = Tag::parse(["e", THREAD_ROOT, "", "reply"]).expect("valid reply tag");
    make_event(content, vec![tag])
}

fn batch_of(
    channel_id: Uuid,
    scope: SessionScope,
    events: &[&Event],
    cancelled: &[&Event],
    reason: Option<CancelReason>,
) -> FlushBatch {
    let wrap = |event: &Event| BatchEvent {
        event: event.clone(),
        prompt_tag: "@mention".into(),
        received_at: Instant::now(),
    };
    FlushBatch {
        channel_id,
        scope,
        events: events.iter().copied().map(&wrap).collect(),
        cancelled_events: cancelled.iter().copied().map(&wrap).collect(),
        cancel_reason: reason,
    }
}

fn channel_info(is_dm: bool, project: Option<PromptProjectInfo>) -> PromptChannelInfo {
    PromptChannelInfo {
        name: if is_dm { "DM" } else { "general" }.into(),
        channel_type: if is_dm { "dm" } else { "stream" }.into(),
        description: None,
        project,
    }
}

fn project_info() -> PromptProjectInfo {
    let owner = "b".repeat(64);
    PromptProjectInfo {
        name: "Launch Site".into(),
        slug: "launch-site".into(),
        owner: owner.clone(),
        coordinate: format!("30621:{owner}:launch-site"),
        default_repo_owner: None,
        default_repo_id: None,
    }
}

fn render<'a>(
    batch: &FlushBatch,
    info: &'a PromptChannelInfo,
    args: FormatPromptArgs<'a>,
) -> String {
    format_prompt(
        batch,
        &FormatPromptArgs {
            channel_info: Some(info),
            standing_context_sent: true,
            ..args
        },
    )
    .join("\n\n")
}

fn truncated_context(is_dm: bool) -> ConversationContext {
    let messages = vec![ContextMessage {
        event_id: "c".repeat(64),
        pubkey: "d".repeat(64),
        timestamp: "2026-10-06T08:00:00Z".into(),
        content: "earlier message".into(),
    }];
    if is_dm {
        ConversationContext::Dm {
            messages,
            total: 9,
            truncated: true,
        }
    } else {
        ConversationContext::Thread {
            messages,
            total: 9,
            root_present: false,
            truncated: true,
        }
    }
}

/// Per-turn prompts for every scope, thread position and context state.
fn turn_prompt_surfaces() -> Vec<Surface> {
    let channel_id = Uuid::parse_str(CHANNEL_ID).expect("valid uuid");
    let top = make_event("start work", vec![]);
    let reply = reply_event("continue work");
    let mut out = Vec::new();

    for policy in [SessionPolicy::Channel, SessionPolicy::Thread] {
        for is_dm in [false, true] {
            for (position, event) in [("top-level", &top), ("reply", &reply)] {
                let scope = SessionScope::derive(policy, channel_id, is_dm, event);
                let batch = batch_of(channel_id, scope, &[event], &[], None);
                let info = channel_info(is_dm, None);
                let included = truncated_context(is_dm);
                for (state, context, had_session_events) in [
                    ("no context", None, false),
                    ("earlier context in session", None, true),
                    ("truncated context", Some(&included), false),
                ] {
                    let prompt = render(
                        &batch,
                        &info,
                        FormatPromptArgs {
                            conversation_context: context,
                            conversation_context_had_session_events: had_session_events,
                            has_system_prompt_support: true,
                            ..Default::default()
                        },
                    );
                    let dm = if is_dm { "dm" } else { "channel" };
                    out.push(Surface::new(
                        format!("turn[{policy:?} {dm} {position}, {state}]"),
                        prompt,
                    ));
                }
            }
        }
    }

    // A project home channel adds the project block and its command hints.
    let project_info = channel_info(false, Some(project_info()));
    for (position, event) in [("top-level", &top), ("reply", &reply)] {
        let scope = SessionScope::derive(SessionPolicy::Thread, channel_id, false, event);
        let batch = batch_of(channel_id, scope, &[event], &[], None);
        let prompt = render(&batch, &project_info, FormatPromptArgs::default());
        out.push(Surface::new(
            format!("turn[project home {position}]"),
            prompt,
        ));
    }

    // Merged turns after a cancel, and a multi-event batch.
    let info = channel_info(false, None);
    for reason in [CancelReason::Steer, CancelReason::Interrupt] {
        let scope = SessionScope::derive(SessionPolicy::Channel, channel_id, false, &top);
        let batch = batch_of(channel_id, scope, &[&reply], &[&top], Some(reason));
        let prompt = render(&batch, &info, FormatPromptArgs::default());
        out.push(Surface::new(format!("turn[merged {reason:?}]"), prompt));
    }
    let scope = SessionScope::derive(SessionPolicy::Channel, channel_id, false, &top);
    let batch = batch_of(channel_id, scope, &[&top, &reply], &[], None);
    out.push(Surface::new(
        "turn[two events in one batch]",
        render(&batch, &info, FormatPromptArgs::default()),
    ));

    out
}

/// Everything buzz-acp puts in front of an agent, built by production code.
fn surfaces() -> Vec<Surface> {
    let mut out = Vec::new();

    for policy in [SessionPolicy::Channel, SessionPolicy::Thread] {
        out.push(Surface::new(
            format!("base prompt with session model ({policy:?})"),
            policy.append_session_model(DEFAULT_BASE_PROMPT),
        ));
    }
    let base = SessionPolicy::Thread.append_session_model(DEFAULT_BASE_PROMPT);

    out.push(Surface::new(
        "workspace section",
        workspace_section(FRESH_CWD),
    ));
    out.push(Surface::new(
        "framed system prompt",
        framed_system_prompt(
            FRESH_CWD,
            Some(&base),
            Some("You are Scout, the first employee of this business."),
        )
        .expect("a base and a persona always frame to a prompt"),
    ));
    out.push(Surface::new(
        "legacy standing context",
        StandingContext {
            base_prompt: Some(&base),
            system_prompt: Some("You are Scout, the first employee of this business."),
            team_instructions: Some("Be concise."),
            agent_core: Some(ONBOARDING_NUDGE),
            huddle_instructions: Some("Keep answers short."),
            agent_canvas: Some(&render_canvas_section(
                &"e".repeat(64),
                "2026-10-06T08:00:00+00:00",
                CHANNEL_ID,
            )),
        }
        .sections()
        .join("\n\n"),
    ));
    out.push(Surface::new("core memory nudge", ONBOARDING_NUDGE));
    out.push(Surface::new(
        "default heartbeat prompt",
        crate::default_heartbeat_prompt(),
    ));
    out.push(Surface::new(
        "channel canvas section",
        render_canvas_section(&"e".repeat(64), "2026-10-06T08:00:00+00:00", CHANNEL_ID),
    ));

    out.extend(turn_prompt_surfaces());
    out
}

#[test]
fn agent_visible_text_never_says_buzz() {
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
fn guard_corpus_covers_the_production_seams() {
    let all = surfaces();
    let find = |needle: &str| all.iter().any(|s| s.name.contains(needle));
    assert!(find("base prompt"), "base prompt surface missing");
    assert!(find("workspace section"), "workspace surface missing");
    assert!(
        find("framed system prompt"),
        "framed prompt surface missing"
    );
    assert!(find("core memory nudge"), "core nudge surface missing");
    assert!(find("channel canvas"), "canvas surface missing");
    assert!(find("project home"), "project home turn missing");
    assert!(find("merged Interrupt"), "interrupt merge turn missing");
    // The base prompt is the real file, not an empty stand-in.
    let base = all
        .iter()
        .find(|s| s.name.starts_with("base prompt"))
        .expect("base prompt surface");
    assert!(
        base.text.len() > 2_000,
        "the base prompt surface is suspiciously small: {} bytes",
        base.text.len()
    );
    // Plain turn prompts carry the structural tag that the allow-list names.
    // Merged turns arrive in their own sections instead.
    assert!(
        all.iter()
            .filter(|s| s.name.starts_with("turn[") && !s.name.contains("merged"))
            .all(|s| s.text.contains("<buzz-event")),
        "every plain turn prompt must carry its event tag"
    );
}
