//! Reply guarantee, proven on the production seam.
//!
//! Every test runs [`run_prompt_task`] against a fake ACP agent (a bash script
//! that speaks the wire protocol) and a small in-process relay that records
//! what the harness submits and answers `POST /query` from those records. The
//! assertions read what a person would see: the kind 9 events the agent's key
//! published into the conversation.

use super::*;
use nostr::{EventBuilder, Keys, Kind, Tag, Timestamp};
use serde_json::{json, Value};

const FALLBACK_LINE: &str = "I couldn't finish that. Try asking again.";
const ANSWER: &str = "The title is \"Colony | Run your business with AI employees\".";

// ── in-process relay ────────────────────────────────────────────────────────

#[derive(Clone, Default)]
struct RelayState {
    events: Arc<Mutex<Vec<Value>>>,
}

impl RelayState {
    fn seed(&self, event: &nostr::Event) {
        self.events
            .lock()
            .unwrap()
            .push(serde_json::to_value(event).unwrap());
    }

    /// Kind 9 events published by `author`, in arrival order.
    fn messages_by(&self, author: &str) -> Vec<Value> {
        self.events
            .lock()
            .unwrap()
            .iter()
            .filter(|event| event["kind"] == 9 && event["pubkey"] == author)
            .cloned()
            .collect()
    }
}

struct MockRelay {
    base_url: String,
    state: RelayState,
    task: tokio::task::JoinHandle<()>,
}

impl Drop for MockRelay {
    fn drop(&mut self) {
        self.task.abort();
    }
}

async fn spawn_relay() -> MockRelay {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind mock relay");
    let base_url = format!("http://{}", listener.local_addr().expect("relay address"));
    let state = RelayState::default();
    let served = state.clone();
    let task = tokio::spawn(async move {
        while let Ok((socket, _)) = listener.accept().await {
            let state = served.clone();
            tokio::spawn(async move {
                let _ =
                    tokio::time::timeout(Duration::from_secs(10), handle_connection(socket, state))
                        .await;
            });
        }
    });
    MockRelay {
        base_url,
        state,
        task,
    }
}

async fn read_request(socket: &mut tokio::net::TcpStream) -> Option<(String, Vec<u8>)> {
    use tokio::io::AsyncReadExt;

    let mut bytes = Vec::new();
    let mut buffer = [0u8; 4096];
    loop {
        let read = socket.read(&mut buffer).await.ok()?;
        if read == 0 {
            return None;
        }
        bytes.extend_from_slice(&buffer[..read]);
        if bytes.len() > 512 * 1024 {
            return None;
        }
        if let Some(end) = bytes.windows(4).position(|part| part == b"\r\n\r\n") {
            let head = std::str::from_utf8(&bytes[..end]).ok()?.to_owned();
            let content_length = head
                .lines()
                .find_map(|line| {
                    let (name, value) = line.split_once(':')?;
                    name.eq_ignore_ascii_case("content-length")
                        .then(|| value.trim().parse::<usize>().ok())
                        .flatten()
                })
                .unwrap_or(0);
            if bytes.len() >= end + 4 + content_length {
                let request_line = head.lines().next()?.to_owned();
                return Some((
                    request_line,
                    bytes[end + 4..end + 4 + content_length].to_vec(),
                ));
            }
        }
    }
}

fn filter_matches(filter: &Value, event: &Value) -> bool {
    let list = |key: &str| filter.get(key).and_then(Value::as_array);
    if let Some(kinds) = list("kinds") {
        if !kinds.iter().any(|kind| kind == &event["kind"]) {
            return false;
        }
    }
    if let Some(authors) = list("authors") {
        if !authors.iter().any(|author| author == &event["pubkey"]) {
            return false;
        }
    }
    if let Some(since) = filter.get("since").and_then(Value::as_u64) {
        if event["created_at"].as_u64().unwrap_or(0) < since {
            return false;
        }
    }
    if let Some(channels) = list("#h") {
        let in_channel = event["tags"].as_array().is_some_and(|tags| {
            tags.iter()
                .any(|tag| tag[0] == "h" && channels.iter().any(|channel| channel == &tag[1]))
        });
        if !in_channel {
            return false;
        }
    }
    true
}

async fn handle_connection(mut socket: tokio::net::TcpStream, state: RelayState) {
    use tokio::io::AsyncWriteExt;

    let Some((request_line, body)) = read_request(&mut socket).await else {
        return;
    };
    let response_body = if request_line.starts_with("POST /events ") {
        if let Ok(event) = serde_json::from_slice::<Value>(&body) {
            state.events.lock().unwrap().push(event);
        }
        "{}".to_string()
    } else if request_line.starts_with("POST /query ") {
        let filters: Vec<Value> = serde_json::from_slice(&body).unwrap_or_default();
        let events = state.events.lock().unwrap();
        let matched: Vec<&Value> = events
            .iter()
            .filter(|event| filters.iter().any(|filter| filter_matches(filter, event)))
            .collect();
        serde_json::to_string(&matched).unwrap()
    } else {
        "{}".to_string()
    };
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{response_body}",
        response_body.len()
    );
    let _ = socket.write_all(response.as_bytes()).await;
}

// ── fake agent ──────────────────────────────────────────────────────────────

fn chunk(text: &str) -> Value {
    json!({"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"live-session",
        "update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":text}}}})
}

fn tool_call() -> Value {
    json!({"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"live-session",
        "update":{"sessionUpdate":"tool_call","toolCallId":"call-1","title":"browser","kind":"execute"}}})
}

/// What the agent does between receiving the prompt and answering it.
struct AgentTurn {
    /// `session/update` notifications, in order.
    updates: Vec<Value>,
    /// ACP `stopReason` wire value.
    stop_reason: &'static str,
    /// The agent publishes this itself, the way `colony messages send` would.
    posts_itself: bool,
}

impl AgentTurn {
    /// Narration, a tool call, then the answer as plain assistant text.
    fn answers_with_text_only() -> Self {
        Self {
            updates: vec![chunk("Let me open the page."), tool_call(), chunk(ANSWER)],
            stop_reason: "end_turn",
            posts_itself: false,
        }
    }
}

#[derive(Clone, Copy, Debug)]
enum Place {
    ChannelTopLevel,
    ChannelThreadReply,
    DmTopLevel,
    DmThreadReply,
}

struct Turn {
    place: Place,
    /// The trigger carries a `p` tag for the agent.
    mentions_agent: bool,
    /// The trigger's author has a NIP-OA `auth` tag on its profile.
    sender_is_agent: bool,
    agent: AgentTurn,
}

impl Turn {
    fn mention(place: Place, agent: AgentTurn) -> Self {
        Self {
            place,
            mentions_agent: !matches!(place, Place::DmTopLevel | Place::DmThreadReply),
            sender_is_agent: false,
            agent,
        }
    }
}

struct TurnRun {
    relay: MockRelay,
    agent_pubkey: String,
    channel_id: Uuid,
    trigger_id: String,
    root_id: String,
    outcome: PromptOutcome,
}

impl TurnRun {
    fn replies(&self) -> Vec<Value> {
        self.relay.state.messages_by(&self.agent_pubkey)
    }

    fn e_tags(reply: &Value) -> Vec<Vec<String>> {
        reply["tags"]
            .as_array()
            .unwrap()
            .iter()
            .map(|tag| {
                tag.as_array()
                    .unwrap()
                    .iter()
                    .map(|part| part.as_str().unwrap().to_owned())
                    .collect::<Vec<_>>()
            })
            .filter(|tag| tag[0] == "e")
            .collect()
    }

    fn assert_channel_tag(&self, reply: &Value) {
        assert!(
            reply["tags"]
                .as_array()
                .unwrap()
                .iter()
                .any(|tag| tag[0] == "h" && tag[1] == self.channel_id.to_string()),
            "reply must be scoped to the conversation's channel: {reply}"
        );
    }
}

/// Run one mention (or DM) turn end to end through `run_prompt_task`.
async fn run_turn(turn: Turn) -> TurnRun {
    let relay = spawn_relay().await;
    let mut ctx = tests::make_prompt_context_no_owner();
    ctx.rest_client.base_url = relay.base_url.clone();
    let channel_id = Uuid::new_v4();
    let is_dm = matches!(turn.place, Place::DmTopLevel | Place::DmThreadReply);
    ctx.channel_info = ChannelInfoResolver::new(
        HashMap::from([(
            channel_id,
            ChannelInfo {
                name: if is_dm { "dm" } else { "general" }.into(),
                channel_type: if is_dm { "dm" } else { "stream" }.into(),
                description: None,
            },
        )]),
        ctx.rest_client.clone(),
    );
    let agent_keys = ctx.agent_keys.clone();
    let agent_pubkey = agent_keys.public_key().to_hex();
    let ctx = Arc::new(ctx);

    let sender = Keys::generate();
    if turn.sender_is_agent {
        let owner = Keys::generate().public_key().to_hex();
        let profile = EventBuilder::new(Kind::Metadata, json!({"name": "Other bot"}).to_string())
            .tags([Tag::parse(["auth", owner.as_str(), "kind=0", "00"]).unwrap()])
            .sign_with_keys(&sender)
            .unwrap();
        relay.state.seed(&profile);
    }

    let channel = channel_id.to_string();
    let h_tag = Tag::parse(["h", channel.as_str()]).unwrap();
    let signed_root = |content: &str| {
        EventBuilder::new(Kind::Custom(9), content)
            .tags([h_tag.clone()])
            .sign_with_keys(&Keys::generate())
            .unwrap()
    };
    let root = signed_root("original question");
    let parent = signed_root("a message in the middle of the thread");
    let root_id = root.id.to_hex();
    let parent_id = parent.id.to_hex();

    let mut tags = vec![h_tag.clone()];
    if turn.mentions_agent {
        tags.push(Tag::parse(["p", agent_pubkey.as_str()]).unwrap());
    }
    if matches!(turn.place, Place::ChannelThreadReply | Place::DmThreadReply) {
        tags.push(Tag::parse(["e", root_id.as_str(), "", "root"]).unwrap());
        tags.push(Tag::parse(["e", parent_id.as_str(), "", "reply"]).unwrap());
    }
    let trigger = EventBuilder::new(Kind::Custom(9), "@Scout what is the page title?")
        .tags(tags)
        .sign_with_keys(&sender)
        .unwrap();
    let trigger_id = trigger.id.to_hex();

    let scope = match turn.place {
        Place::ChannelThreadReply => SessionScope::Thread {
            channel_id,
            root_event_id: root_id.clone(),
        },
        _ => SessionScope::Conversation { channel_id },
    };
    let batch = FlushBatch {
        channel_id,
        scope: scope.clone(),
        events: vec![crate::queue::BatchEvent {
            event: trigger,
            prompt_tag: "test".into(),
            received_at: std::time::Instant::now(),
        }],
        cancelled_events: vec![],
        cancel_reason: None,
    };

    let dir = std::env::temp_dir().join(format!("buzz-acp-turn-reply-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    let mut lines: Vec<String> = turn.agent.updates.iter().map(Value::to_string).collect();
    lines.push(
        json!({"jsonrpc":"2.0","id":0,"result":{"stopReason":turn.agent.stop_reason}}).to_string(),
    );
    std::fs::write(dir.join("turn.ndjson"), lines.join("\n") + "\n").unwrap();
    let mut script = String::from("IFS= read -r _prompt\n");
    if turn.agent.posts_itself {
        // Created in the future so the post always falls inside the turn window.
        let own_post = EventBuilder::new(Kind::Custom(9), "Posted by the agent itself")
            .tags([
                h_tag.clone(),
                Tag::parse(["e", root_id.as_str(), "", "reply"]).unwrap(),
            ])
            .custom_created_at(Timestamp::from(Timestamp::now().as_secs() + 600))
            .sign_with_keys(&agent_keys)
            .unwrap();
        std::fs::write(
            dir.join("post.json"),
            serde_json::to_string(&own_post).unwrap(),
        )
        .unwrap();
        script.push_str(&format!(
            "curl -sS --max-time 5 -X POST -H 'Content-Type: application/json' --data-binary @'{dir}/post.json' '{url}/events' >/dev/null\n",
            dir = dir.display(),
            url = relay.base_url,
        ));
    }
    script.push_str(&format!(
        "cat '{}/turn.ndjson'\ncat >/dev/null\n",
        dir.display()
    ));

    let acp = AcpClient::spawn("bash", &["-c".to_string(), script], &[], false)
        .await
        .expect("spawn fake ACP agent");
    let mut agent = OwnedAgent {
        index: 0,
        acp,
        state: SessionState::default(),
        model_capabilities: None,
        desired_model: None,
        model_overridden: false,
        desired_model_request_id: None,
        desired_model_pending_ack: false,
        startup_effort: None,
        agent_name: "reply-test-agent".into(),
        goose_system_prompt_supported: None,
        protocol_version: 1,
    };
    agent
        .state
        .sessions
        .insert(scope.clone(), "live-session".into());
    agent
        .state
        .deliveries
        .insert(scope, ChannelDeliveryState::default());

    let (result_tx, mut result_rx) = mpsc::unbounded_channel();
    run_prompt_task(
        agent,
        Some(batch),
        None,
        ctx,
        result_tx,
        None,
        "turn-1".into(),
    )
    .await;
    let mut result = result_rx.recv().await.expect("prompt result");
    result.agent.acp.shutdown().await;
    std::fs::remove_dir_all(&dir).unwrap();

    TurnRun {
        relay,
        agent_pubkey,
        channel_id,
        trigger_id,
        root_id,
        outcome: result.outcome,
    }
}

// ── the guarantee ───────────────────────────────────────────────────────────

#[tokio::test]
async fn text_only_mention_turn_posts_the_final_answer_once_under_the_mention() {
    let run = run_turn(Turn::mention(
        Place::ChannelTopLevel,
        AgentTurn::answers_with_text_only(),
    ))
    .await;

    assert!(matches!(
        run.outcome,
        PromptOutcome::Ok(StopReason::EndTurn)
    ));
    let replies = run.replies();
    assert_eq!(replies.len(), 1, "exactly one reply, got {replies:?}");
    assert_eq!(
        replies[0]["content"], ANSWER,
        "only the final assistant message is posted, not the narration before the tool call"
    );
    run.assert_channel_tag(&replies[0]);
    assert_eq!(
        TurnRun::e_tags(&replies[0]),
        vec![vec![
            "e".to_string(),
            run.trigger_id.clone(),
            String::new(),
            "reply".to_string()
        ]],
        "a top-level mention is answered in a new thread rooted at the mention"
    );
    assert!(
        !replies[0]["tags"].to_string().contains("\"p\""),
        "the harness reply must not notify anyone"
    );
}

#[tokio::test]
async fn thread_mention_is_answered_flat_under_the_thread_root() {
    let run = run_turn(Turn::mention(
        Place::ChannelThreadReply,
        AgentTurn::answers_with_text_only(),
    ))
    .await;

    let replies = run.replies();
    assert_eq!(replies.len(), 1, "exactly one reply, got {replies:?}");
    assert_eq!(replies[0]["content"], ANSWER);
    run.assert_channel_tag(&replies[0]);
    assert_eq!(
        TurnRun::e_tags(&replies[0]),
        vec![vec![
            "e".to_string(),
            run.root_id.clone(),
            String::new(),
            "reply".to_string()
        ]],
        "a thread mention is answered at layer 1, anchored to the thread root"
    );
}

#[tokio::test]
async fn direct_message_is_answered_at_the_top_level_of_the_conversation() {
    let run = run_turn(Turn::mention(
        Place::DmTopLevel,
        AgentTurn::answers_with_text_only(),
    ))
    .await;

    let replies = run.replies();
    assert_eq!(replies.len(), 1, "exactly one reply, got {replies:?}");
    assert_eq!(replies[0]["content"], ANSWER);
    run.assert_channel_tag(&replies[0]);
    assert!(
        TurnRun::e_tags(&replies[0]).is_empty(),
        "a top-level DM is answered without thread tags"
    );
}

#[tokio::test]
async fn direct_message_thread_reply_is_answered_under_the_message() {
    let run = run_turn(Turn::mention(
        Place::DmThreadReply,
        AgentTurn::answers_with_text_only(),
    ))
    .await;

    let replies = run.replies();
    assert_eq!(replies.len(), 1, "exactly one reply, got {replies:?}");
    run.assert_channel_tag(&replies[0]);
    assert_eq!(
        TurnRun::e_tags(&replies[0]),
        vec![
            vec![
                "e".to_string(),
                run.root_id.clone(),
                String::new(),
                "root".to_string()
            ],
            vec![
                "e".to_string(),
                run.trigger_id.clone(),
                String::new(),
                "reply".to_string()
            ],
        ],
        "a DM thread reply is answered like `--reply-to <that message>`"
    );
}

#[tokio::test]
async fn agent_that_posted_itself_gets_no_second_post() {
    let run = run_turn(Turn::mention(
        Place::ChannelThreadReply,
        AgentTurn {
            posts_itself: true,
            ..AgentTurn::answers_with_text_only()
        },
    ))
    .await;

    let replies = run.replies();
    assert_eq!(replies.len(), 1, "exactly one reply, got {replies:?}");
    assert_eq!(
        replies[0]["content"], "Posted by the agent itself",
        "the agent's own post stands; the harness adds nothing"
    );
}

#[tokio::test]
async fn empty_final_text_posts_the_short_fallback_line() {
    let run = run_turn(Turn::mention(
        Place::ChannelTopLevel,
        AgentTurn {
            // Text, then a tool call, then nothing: no final assistant message.
            updates: vec![chunk("Let me open the page."), tool_call()],
            stop_reason: "end_turn",
            posts_itself: false,
        },
    ))
    .await;

    let replies = run.replies();
    assert_eq!(replies.len(), 1, "exactly one reply, got {replies:?}");
    assert_eq!(replies[0]["content"], FALLBACK_LINE);
}

#[tokio::test]
async fn unfinished_turn_posts_the_short_fallback_line_not_a_cut_off_answer() {
    let run = run_turn(Turn::mention(
        Place::ChannelTopLevel,
        AgentTurn {
            updates: vec![chunk("The title is \"Col")],
            stop_reason: "max_tokens",
            posts_itself: false,
        },
    ))
    .await;

    let replies = run.replies();
    assert_eq!(replies.len(), 1, "exactly one reply, got {replies:?}");
    assert_eq!(replies[0]["content"], FALLBACK_LINE);
}

#[tokio::test]
async fn channel_message_that_does_not_mention_the_agent_stays_silent() {
    let run = run_turn(Turn {
        mentions_agent: false,
        ..Turn::mention(Place::ChannelTopLevel, AgentTurn::answers_with_text_only())
    })
    .await;

    assert!(
        run.replies().is_empty(),
        "silence is a valid ending when nobody asked the agent: {:?}",
        run.replies()
    );
}

#[tokio::test]
async fn turn_started_by_another_agent_stays_silent() {
    let run = run_turn(Turn {
        sender_is_agent: true,
        ..Turn::mention(Place::ChannelTopLevel, AgentTurn::answers_with_text_only())
    })
    .await;

    assert!(
        run.replies().is_empty(),
        "agent-to-agent chatter must never be answered by the harness: {:?}",
        run.replies()
    );
}
