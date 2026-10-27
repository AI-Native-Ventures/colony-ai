use super::*;
use crate::credits_gateway::CreditsGateway;
use axum::{body::Bytes, routing::post, Json, Router};
use std::sync::Mutex;

#[tokio::test]
async fn production_completion_and_summary_both_dispatch_to_private_credits_transport() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let origin = format!("http://{}", listener.local_addr().unwrap());
    let captured = Arc::new(Mutex::new(Vec::<Value>::new()));
    let copy = captured.clone();
    let router = Router::new().route("/api/credits-gateway/managed-inference", post(move |body: Bytes| {
        let captured = copy.clone();
        async move {
            captured.lock().unwrap().push(serde_json::from_slice(&body).unwrap());
            Json(json!({"choices":[{"message":{"role":"assistant","content":"credits result"},"finish_reason":"stop"}],"usage":{"prompt_tokens":4,"completion_tokens":2,"total_tokens":6}}))
        }
    }));
    let server = tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    let cfg = Config::for_discovery(Provider::ColonyCredits, String::new(), origin.clone(), None);
    let llm = Llm {
        credits: Some(
            CreditsGateway::new(
                &origin,
                &uuid::Uuid::new_v4().to_string(),
                nostr::Keys::generate(),
                None,
            )
            .unwrap(),
        ),
        http: Client::new(),
        auto_upgraded: AtomicBool::new(false),
        auth: Arc::new(StaticTokenSource::new(String::new())),
    };
    let response = llm
        .complete(
            &cfg,
            "system",
            &[HistoryItem::User("hello".into())],
            &[],
            "server-model",
        )
        .await
        .unwrap();
    assert_eq!(response.text, "credits result");
    assert_eq!(response.input_tokens, Some(4));
    assert_eq!(
        llm.summarize(&cfg, "summarize", "history", 100, "server-model")
            .await
            .unwrap(),
        "credits result"
    );
    let requests = captured.lock().unwrap();
    assert_eq!(requests.len(), 2);
    assert_ne!(requests[0]["request_id"], requests[1]["request_id"]);
    assert_eq!(requests[1]["messages"][0]["content"], "summarize");
    assert_eq!(requests[1]["messages"][1]["content"], "history");
    assert!(requests.iter().all(|r| r.get("model").is_none()));
    server.abort();
}

/// What a Scout session really sends. The prompt is the bytes `buzz-acp` gives
/// every agent (`DEFAULT_BASE_PROMPT`) and the tools are the 20 definitions the
/// shipped `buzz-dev-mcp` and Colony browser servers register, captured from the
/// real servers in `testdata/scout_tool_defs.json` (plus `load_skill` in a run).
mod scout_session {
    use super::*;
    use crate::types::{ToolCall, ToolResult, ToolResultContent};

    const BASE_PROMPT: &str = concat!(
        include_str!("../../../buzz-acp/src/base_prompt.md"),
        "\n",
        include_str!("../../../buzz-acp/src/voice.md"),
        "\n",
        include_str!("../../../buzz-acp/src/web_tasks.md")
    );

    pub(super) fn tools() -> Vec<ToolDef> {
        let defs: Vec<Value> =
            serde_json::from_str(include_str!("testdata/scout_tool_defs.json")).unwrap();
        defs.iter()
            .map(|def| ToolDef {
                name: def["name"].as_str().unwrap().to_owned(),
                description: def["description"].as_str().unwrap().to_owned(),
                input_schema: def["input_schema"].clone(),
            })
            .collect()
    }

    pub(super) fn system_prompt() -> String {
        format!("{BASE_PROMPT}\n\nYou are Scout, the owner's Chief of Staff.")
    }

    fn tool_round(i: usize, content: Vec<ToolResultContent>) -> [HistoryItem; 2] {
        [
            HistoryItem::Assistant {
                text: String::new(),
                tool_calls: vec![ToolCall {
                    provider_id: format!("call_{i}"),
                    name: "dev__shell".into(),
                    arguments: json!({"command": format!("ls -la /work/{i}")}),
                    provider_extra: Map::new(),
                }],
                reasoning_details: None,
            },
            HistoryItem::ToolResult(ToolResult {
                provider_id: format!("call_{i}"),
                content,
                is_error: false,
            }),
        ]
    }

    /// A user turn followed by `rounds` shell rounds, with the owner speaking up
    /// again every five rounds, then the next user message.
    pub(super) fn history(rounds: usize, result_bytes: usize) -> Vec<HistoryItem> {
        let mut items = vec![HistoryItem::User(
            "Go through the lead list and tell me who to call first.".into(),
        )];
        for i in 0..rounds {
            if i > 0 && i % 5 == 0 {
                items.push(HistoryItem::User(format!("Carry on with number {i}.")));
            }
            items.extend(tool_round(
                i,
                vec![ToolResultContent::Text("x".repeat(result_bytes))],
            ));
        }
        items.push(HistoryItem::User("Now summarise what you found.".into()));
        items
    }

    pub(super) fn history_with_screenshot() -> Vec<HistoryItem> {
        let mut items = vec![HistoryItem::User("What is on my screen?".into())];
        items.extend(tool_round(
            0,
            vec![
                ToolResultContent::Text("captured".into()),
                ToolResultContent::Image {
                    data: "A".repeat(200_000),
                    mime_type: "image/png".into(),
                },
            ],
        ));
        items.push(HistoryItem::User("And what does it say?".into()));
        items
    }

    pub(super) struct Gateway {
        pub llm: Llm,
        pub cfg: Config,
        pub sent: Arc<Mutex<Vec<(usize, Value)>>>,
        server: tokio::task::JoinHandle<()>,
    }
    impl Drop for Gateway {
        fn drop(&mut self) {
            self.server.abort();
        }
    }

    pub(super) async fn gateway() -> Gateway {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let sent = Arc::new(Mutex::new(Vec::new()));
        let copy = sent.clone();
        let router = Router::new().route(
            "/api/credits-gateway/managed-inference",
            post(move |body: Bytes| {
                let sent = copy.clone();
                async move {
                    let value: Value = serde_json::from_slice(&body).unwrap();
                    sent.lock().unwrap().push((body.len(), value));
                    Json(json!({"choices":[{"message":{"role":"assistant","content":"Done."},"finish_reason":"stop"}],"usage":{"prompt_tokens":4,"completion_tokens":2,"total_tokens":6}}))
                }
            }),
        );
        let server = tokio::spawn(async move {
            axum::serve(listener, router).await.unwrap();
        });
        let cfg =
            Config::for_discovery(Provider::ColonyCredits, String::new(), origin.clone(), None);
        let llm = Llm {
            credits: Some(
                CreditsGateway::new(
                    &origin,
                    &uuid::Uuid::new_v4().to_string(),
                    nostr::Keys::generate(),
                    None,
                )
                .unwrap(),
            ),
            http: Client::new(),
            auto_upgraded: AtomicBool::new(false),
            auth: Arc::new(StaticTokenSource::new(String::new())),
        };
        Gateway {
            llm,
            cfg,
            sent,
            server,
        }
    }

    impl Gateway {
        pub(super) async fn send(
            &self,
            history: &[HistoryItem],
        ) -> Result<LlmResponse, AgentError> {
            self.llm
                .complete(
                    &self.cfg,
                    &system_prompt(),
                    history,
                    &tools(),
                    "server-model",
                )
                .await
        }
    }
}

#[tokio::test]
async fn a_scout_session_that_has_used_tools_is_sent_not_refused() {
    let gateway = scout_session::gateway().await;
    // 100 shell rounds of 3 KB each: 203 messages and well over the old 64 KiB.
    let history = scout_session::history(100, 3_000);
    let response = gateway.send(&history).await.unwrap();
    assert_eq!(response.text, "Done.");
    let sent = gateway.sent.lock().unwrap();
    let (bytes, body) = &sent[0];
    assert!(*bytes > 64 * 1024, "a real session is bigger than 64 KiB");
    assert!(body["messages"].as_array().unwrap().len() > 128);
    assert_eq!(body["tools"].as_array().unwrap().len(), 20);
}

#[tokio::test]
async fn no_message_carries_a_null_field_the_relay_refuses() {
    let gateway = scout_session::gateway().await;
    // A user turn, two shell rounds and the next user turn: every role a real
    // session sends.
    gateway.send(&scout_session::history(2, 100)).await.unwrap();
    let sent = gateway.sent.lock().unwrap();
    let messages = sent[0].1["messages"].as_array().unwrap();
    assert_eq!(messages.len(), 7);
    for message in messages {
        // The relay reads a present `tool_calls` as a claim about the turn, so a
        // `null` on a system or user message got the whole request refused.
        assert!(
            message.as_object().unwrap().values().all(|v| !v.is_null()),
            "{message}"
        );
    }
    assert_eq!(
        messages[2]["tool_calls"][0]["function"]["name"],
        "dev__shell"
    );
}

#[tokio::test]
async fn a_screenshot_in_a_tool_result_is_described_not_refused() {
    let gateway = scout_session::gateway().await;
    gateway
        .send(&scout_session::history_with_screenshot())
        .await
        .unwrap();
    let sent = gateway.sent.lock().unwrap();
    let wire = sent[0].1.to_string();
    assert!(
        !wire.contains("image_url"),
        "the image never leaves the app"
    );
    assert!(!wire.contains("AAAA"), "no image bytes on the wire");
    assert!(wire.contains("And what does it say?"));
}

#[tokio::test]
async fn a_session_past_the_body_cap_drops_its_oldest_turns_instead_of_refusing() {
    let gateway = scout_session::gateway().await;
    // 40 rounds of 50 KB: about 2 MiB of history, the agent's own budget is 16 MiB.
    let history = scout_session::history(40, 50_000);
    gateway.send(&history).await.unwrap();
    let sent = gateway.sent.lock().unwrap();
    let (bytes, body) = &sent[0];
    assert!(*bytes <= 1024 * 1024, "sent {bytes} bytes");
    let messages = body["messages"].as_array().unwrap();
    assert_eq!(messages[0]["role"], "system");
    assert_eq!(
        messages[1]["role"], "user",
        "history restarts on a user turn"
    );
    assert_eq!(
        messages.last().unwrap()["content"],
        "Now summarise what you found."
    );
    // Nothing is orphaned: every tool result follows the call it answers.
    let mut calls = BTreeSet::new();
    for message in messages {
        for call in message["tool_calls"].as_array().into_iter().flatten() {
            calls.insert(call["id"].as_str().unwrap().to_owned());
        }
        if message["role"] == "tool" {
            assert!(calls.contains(message["tool_call_id"].as_str().unwrap()));
        }
    }
}
