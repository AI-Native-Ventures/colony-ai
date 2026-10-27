use super::*;
use axum::{
    body::Bytes,
    http::{HeaderMap, StatusCode},
    routing::post,
    Json, Router,
};
use std::sync::{Arc, Mutex};

type Captured = Arc<Mutex<Vec<(HeaderMap, Vec<u8>)>>>;

async fn fake(status: u16, response: Value) -> (String, Captured, tokio::task::JoinHandle<()>) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let origin = format!("http://{}", listener.local_addr().unwrap());
    let captured: Captured = Arc::new(Mutex::new(Vec::new()));
    let copy = captured.clone();
    let router = Router::new().route(
        "/api/credits-gateway/managed-inference",
        post(move |headers: HeaderMap, body: Bytes| {
            let captured = copy.clone();
            let response = response.clone();
            async move {
                captured.lock().unwrap().push((headers, body.to_vec()));
                (StatusCode::from_u16(status).unwrap(), Json(response))
            }
        }),
    );
    let task = tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    (origin, captured, task)
}

fn prompt() -> Value {
    json!({"model":"must-not-reach-relay", "messages":[{"role":"user","content":"hello"}], "tools":[]})
}

#[tokio::test]
async fn production_transport_signs_exact_body_and_never_sends_a_provider_key() {
    let (origin, captured, task) = fake(
        200,
        json!({"choices":[{"message":{"content":"hello"}}],"chargedNanousd":"120"}),
    )
    .await;
    let keys = Keys::generate();
    let session = Uuid::new_v4();
    let gateway = CreditsGateway::new(
        &origin,
        &session.to_string(),
        keys.clone(),
        Some("test-admission".into()),
    )
    .unwrap();
    assert_eq!(
        gateway.complete(prompt()).await.unwrap()["chargedNanousd"],
        "120"
    );
    let calls = captured.lock().unwrap();
    assert_eq!(calls.len(), 1);
    let (headers, body) = &calls[0];
    let auth = headers["authorization"]
        .to_str()
        .unwrap()
        .strip_prefix("Nostr ")
        .unwrap();
    let event = nostr::Event::from_json(STANDARD.decode(auth).unwrap()).unwrap();
    event.verify().unwrap();
    assert_eq!(event.pubkey, keys.public_key());
    let tags: Vec<Vec<String>> = event
        .tags
        .iter()
        .map(|tag| tag.as_slice().to_vec())
        .collect();
    assert!(tags.contains(&vec!["payload".into(), hex::encode(Sha256::digest(body))]));
    assert!(tags.contains(&vec!["method".into(), "POST".into()]));
    assert!(tags.contains(&vec![
        "u".into(),
        format!("{origin}/api/credits-gateway/managed-inference")
    ]));
    assert_eq!(headers["x-auth-tag"], "test-admission");
    let sent: Value = serde_json::from_slice(body).unwrap();
    assert_eq!(sent["session_id"], session.to_string());
    assert!(Uuid::parse_str(sent["request_id"].as_str().unwrap()).is_ok());
    assert!(sent.get("model").is_none());
    assert!(sent.get("api_key").is_none());
    assert_eq!(sent.as_object().unwrap().len(), 4);
    task.abort();
}

#[tokio::test]
async fn production_refusals_are_typed_safe_and_never_retried() {
    for (status, body, refusal) in [
        (
            402,
            json!({"error":"DO_NOT_ECHO_PROVIDER_SECRET"}),
            CreditRefusal::OutOfCredits,
        ),
        (429, json!({}), CreditRefusal::Busy),
        (409, json!({}), CreditRefusal::Recovering),
        (
            409,
            json!({"error":"already_completed"}),
            CreditRefusal::AlreadyCompleted,
        ),
        (403, json!({}), CreditRefusal::Unauthorized),
        (503, json!({}), CreditRefusal::Unavailable),
        (
            503,
            json!({"error":"DO_NOT_ECHO_PROVIDER_SECRET","code":"daily_limit"}),
            CreditRefusal::DailyLimit,
        ),
        // Only the relay's machine code selects the daily-limit notice.
        (
            503,
            json!({"error":"Colony AI has reached its daily limit. Try again tomorrow."}),
            CreditRefusal::Unavailable,
        ),
        (
            200,
            json!({"error":"broken successful body"}),
            CreditRefusal::Recovering,
        ),
    ] {
        let (origin, captured, task) = fake(status, body).await;
        let gateway =
            CreditsGateway::new(&origin, &Uuid::new_v4().to_string(), Keys::generate(), None)
                .unwrap();
        let error = gateway.complete(prompt()).await.unwrap_err();
        assert!(matches!(error, AgentError::Credits(value) if value == refusal));
        assert!(!error.to_string().contains("DO_NOT_ECHO"));
        assert_eq!(error.json_rpc_code(), -32004);
        assert_eq!(captured.lock().unwrap().len(), 1);
        task.abort();
    }
}

#[tokio::test]
async fn an_image_is_described_and_a_turn_no_trim_can_fit_fails_before_spend() {
    let (origin, captured, task) = fake(200, json!({"choices":[]})).await;
    let gateway =
        CreditsGateway::new(&origin, &Uuid::new_v4().to_string(), Keys::generate(), None).unwrap();
    // A screenshot is not refused: the turn goes out with a line in its place.
    gateway
        .complete(json!({"messages":[
            {"role":"user","content":[{"type":"text","text":"look"},{"type":"image_url","image_url":{"url":"data:image/png;base64,AAAA"}}]}]}))
        .await
        .unwrap();
    {
        let calls = captured.lock().unwrap();
        let sent: Value = serde_json::from_slice(&calls[0].1).unwrap();
        assert_eq!(
            sent["messages"][0]["content"],
            format!("look\n{OMITTED_PART}")
        );
        assert!(!String::from_utf8_lossy(&calls[0].1).contains("AAAA"));
    }
    // A part with no type, and a newest turn bigger than the body, cannot be sent.
    for input in [
        json!({"messages":[{"role":"user","content":[{"text":"no type"}]}]}),
        json!({"messages":[{"role":"user","content":"x".repeat(1024 * 1024)}]}),
        json!({"messages":[]}),
    ] {
        assert!(matches!(
            gateway.complete(input).await,
            Err(AgentError::Credits(CreditRefusal::Unsupported))
        ));
    }
    assert_eq!(captured.lock().unwrap().len(), 1);
    task.abort();
}

#[test]
fn trimming_keeps_the_system_message_the_newest_turn_and_whole_tool_rounds() {
    let session = Uuid::new_v4();
    let mut messages = vec![json!({"role":"system","content":"rules"})];
    for i in 0..30 {
        messages.push(json!({"role":"user","content":format!("turn {i}")}));
        messages.push(json!({"role":"assistant","content":"","tool_calls":[{"id":format!("c{i}"),"type":"function","function":{"name":"shell","arguments":"{}"}}]}));
        messages.push(
            json!({"role":"tool","tool_call_id":format!("c{i}"),"content":"y".repeat(60_000)}),
        );
    }
    let body = fit_body(&session, messages, json!([])).unwrap();
    assert!(body.len() <= MAX_BODY_BYTES);
    let sent: Value = serde_json::from_slice(&body).unwrap();
    let kept = sent["messages"].as_array().unwrap();
    assert_eq!(kept[0]["content"], "rules");
    assert_eq!(kept[1]["role"], "user");
    assert_eq!(kept.last().unwrap()["tool_call_id"], "c29");
    assert_eq!((kept.len() - 1) % 3, 0, "only whole turns are kept");
}

#[test]
fn a_session_may_carry_a_thousand_messages_and_is_trimmed_past_that() {
    let session = Uuid::new_v4();
    let turns = |count: usize| {
        let mut messages = vec![json!({"role":"system","content":"rules"})];
        messages.extend((0..count).map(|i| json!({"role":"user","content":format!("m{i}")})));
        messages
    };
    let full = fit_body(&session, turns(MAX_MESSAGES - 1), json!([])).unwrap();
    let sent: Value = serde_json::from_slice(&full).unwrap();
    assert_eq!(sent["messages"].as_array().unwrap().len(), MAX_MESSAGES);
    let over = fit_body(&session, turns(MAX_MESSAGES + 10), json!([])).unwrap();
    let sent: Value = serde_json::from_slice(&over).unwrap();
    let kept = sent["messages"].as_array().unwrap();
    assert_eq!(kept.len(), MAX_MESSAGES);
    assert_eq!(kept[0]["role"], "system");
    assert_eq!(
        kept.last().unwrap()["content"],
        format!("m{}", MAX_MESSAGES + 9)
    );
}

#[tokio::test]
async fn production_transport_never_follows_redirects_or_replays_on_disconnect() {
    use axum::{extract::State, response::Redirect};
    use std::sync::atomic::{AtomicUsize, Ordering};
    let hits = Arc::new(AtomicUsize::new(0));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let origin = format!("http://{}", listener.local_addr().unwrap());
    let router = Router::new()
        .route(
            "/api/credits-gateway/managed-inference",
            post(|| async { Redirect::temporary("/leak") }),
        )
        .route(
            "/leak",
            post(|State(hits): State<Arc<AtomicUsize>>| async move {
                hits.fetch_add(1, Ordering::SeqCst);
                "leak"
            }),
        )
        .with_state(hits.clone());
    let task = tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    let gateway =
        CreditsGateway::new(&origin, &Uuid::new_v4().to_string(), Keys::generate(), None).unwrap();
    assert!(matches!(
        gateway.complete(prompt()).await,
        Err(AgentError::Credits(CreditRefusal::Unavailable))
    ));
    assert_eq!(hits.load(Ordering::SeqCst), 0);
    task.abort();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let origin = format!("http://{}", listener.local_addr().unwrap());
    let count = hits.clone();
    let task = tokio::spawn(async move {
        loop {
            let (socket, _) = listener.accept().await.unwrap();
            count.fetch_add(1, Ordering::SeqCst);
            drop(socket);
        }
    });
    let gateway =
        CreditsGateway::new(&origin, &Uuid::new_v4().to_string(), Keys::generate(), None).unwrap();
    assert!(matches!(
        gateway.complete(prompt()).await,
        Err(AgentError::Credits(CreditRefusal::Recovering))
    ));
    assert_eq!(hits.load(Ordering::SeqCst), 1);
    task.abort();
}

#[test]
fn origin_rejects_redirectable_credentials_paths_and_insecure_remote_hosts() {
    assert_eq!(
        gateway_origin("wss://relay.example/").unwrap(),
        "https://relay.example"
    );
    for invalid in [
        "ws://relay.example",
        "https://user@relay.example",
        "https://relay.example/other",
        "https://relay.example/?token=x",
        "ftp://relay.example",
    ] {
        assert!(gateway_origin(invalid).is_err(), "{invalid}");
    }
}

#[test]
fn text_and_tool_history_use_only_the_managed_contract() {
    let messages = text_messages(&json!([
        {"role":"assistant","content":[{"type":"text","text":"a"},{"type":"text","text":"b"}],"reasoning_content":"private", "tool_calls":[{"id":"call_1","type":"function","function":{"name":"read","arguments":"{}"},"extra":"private"}]},
        {"role":"tool","tool_call_id":"call_1","content":[{"type":"text","text":"result"}]}
    ])).unwrap();
    assert_eq!(messages[0]["content"], "ab");
    assert!(messages[0].get("reasoning_content").is_none());
    assert!(messages[0]["tool_calls"][0].get("extra").is_none());
    assert_eq!(messages[1]["tool_call_id"], "call_1");
    assert_eq!(messages[1]["content"], "result");
}
