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
