//! Exercise discovery through the real MCP client and actual model requests.

use std::time::{Duration, Instant};

use serde_json::json;

mod common;
use common::{openai_text, openai_tool_call, spawn_capturing_llm, Harness};

async fn scenario(initial: usize, next: usize, failure: Option<&str>) {
    let temp = tempfile::tempdir().unwrap();
    let trigger = temp.path().join("change");
    let responses = if next > 0 && failure.is_none() {
        vec![
            openai_text("waiting"),
            openai_tool_call("call-new", "fixture__new_0", json!({})),
            openai_text("done"),
        ]
    } else {
        vec![openai_text("waiting"), openai_text("done")]
    };
    let llm = spawn_capturing_llm(responses).await;
    let mut h = Harness::spawn(&llm.url).await;
    h.send(
        "initialize",
        json!({"protocolVersion":1,"clientCapabilities":{}}),
    )
    .await;
    h.recv().await;
    let mut env = vec![
        json!({"name":"DISCOVERY_TRIGGER", "value":trigger.to_str().unwrap()}),
        json!({"name":"DISCOVERY_INITIAL", "value":initial.to_string()}),
        json!({"name":"DISCOVERY_NEXT", "value":next.to_string()}),
    ];
    if failure == Some("hang") {
        env.push(json!({"name":"DISCOVERY_HANG", "value":"1"}));
    }
    if failure == Some("pagination") {
        env.push(json!({"name":"DISCOVERY_PAGINATION_LOOP", "value":"1"}));
    }
    h.send("session/new", json!({
        "cwd":temp.path().to_str().unwrap(),
        "mcpServers":[{"name":"fixture", "command":env!("CARGO_BIN_EXE_fake-mcp-discovery"), "args":[], "env":env}]
    })).await;
    let created = h
        .recv_until(|v| v.get("result").is_some() || v.get("error").is_some())
        .await;
    let sid = created["result"]["sessionId"]
        .as_str()
        .expect("session created")
        .to_owned();
    let first = h
        .send(
            "session/prompt",
            json!({"sessionId":sid,"prompt":[{"type":"text","text":"wait"}]}),
        )
        .await;
    h.recv_until(|v| v["id"] == first).await;
    assert_eq!(llm.captured.lock().await.len(), 1);

    // Trigger between prompts in the SAME session. The handler diagnostic
    // establishes delivery before the next request without sleeps or retries.
    std::fs::write(&trigger, "change").unwrap();
    h.wait_for_stderr("MCP tool list changed", Duration::from_secs(5))
        .await;
    let start = Instant::now();
    let second = h
        .send(
            "session/prompt",
            json!({"sessionId":sid,"prompt":[{"type":"text","text":"continue"}]}),
        )
        .await;
    let finished = h.recv_until_approving(|v| v["id"] == second).await;
    let requests = llm.captured.lock().await;
    if let Some(kind) = failure {
        assert!(
            finished.get("error").is_some(),
            "refresh must propagate: {finished}"
        );
        assert_eq!(requests.len(), 1, "no model call with stale discovery");
        let error = finished["error"]["message"].as_str().unwrap();
        if kind == "hang" {
            assert!(error.contains("timeout"), "{error}");
            assert!(start.elapsed() < Duration::from_secs(8));
        } else if kind == "pagination" {
            assert!(error.contains("pagination"), "{error}");
        } else {
            assert!(error.contains("too many tools"), "{error}");
        }
    } else {
        let original = requests[0]["tools"].as_array().map(Vec::len).unwrap_or(0);
        assert_eq!(original, initial);
        let tools = requests[1]["tools"].as_array().cloned().unwrap_or_default();
        assert_eq!(
            tools.len(),
            next,
            "next request must contain the refreshed list"
        );
        for (i, tool) in tools.iter().enumerate() {
            assert_eq!(tool["function"]["name"], format!("fixture__new_{i}"));
            assert_eq!(tool["function"]["description"], "new description");
        }
        if next > 0 {
            assert_eq!(
                requests.len(),
                3,
                "new tools must also resolve for execution"
            );
            assert!(requests[2]["messages"].as_array().unwrap().iter().any(|m| {
                m["role"] == "tool"
                    && m["content"]
                        .as_str()
                        .is_some_and(|s| s.contains("called refreshed tool"))
            }));
        }
    }
    drop(requests);
    h.shutdown().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn grant_notification_adds_fifteen_tools_to_next_model_request() {
    scenario(0, 15, None).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn changed_list_replaces_metadata_and_call_routing() {
    scenario(1, 2, None).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn revoke_notification_removes_tools_from_next_model_request() {
    scenario(1, 0, None).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn refresh_timeout_does_not_send_stale_model_request() {
    scenario(1, 2, Some("hang")).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn refresh_retains_session_tool_limit() {
    scenario(1, 129, Some("limit")).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn refresh_rejects_repeating_pagination_without_a_model_request() {
    scenario(1, 1, Some("pagination")).await;
}
