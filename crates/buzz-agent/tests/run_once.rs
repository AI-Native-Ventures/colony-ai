//! `buzz-agent run-once`: the tool-less, budgeted model call behind worker runs.
//!
//! Drives the real binary against a fake OpenAI-compatible server.

use std::path::Path;

use serde_json::{json, Value};
use tokio::net::TcpListener;

mod common;
use common::{spawn_capturing_llm, spawn_capturing_llm_with_status};

fn text_reply(content: &str, input_tokens: u64, output_tokens: u64) -> Value {
    json!({
        "id": "run-once", "object": "chat.completion", "model": "fake-model",
        "choices": [{
            "index": 0,
            "message": { "role": "assistant", "content": content },
            "finish_reason": "stop",
        }],
        "usage": {
            "prompt_tokens": input_tokens,
            "completion_tokens": output_tokens,
            "total_tokens": input_tokens + output_tokens,
        },
    })
}

fn tool_call_reply(name: &str, args: &Value) -> Value {
    json!({
        "id": "run-once-tool", "object": "chat.completion", "model": "fake-model",
        "choices": [{
            "index": 0,
            "message": {
                "role": "assistant", "content": null,
                "tool_calls": [{
                    "id": "call_1", "type": "function",
                    "function": { "name": name, "arguments": args.to_string() },
                }],
            },
            "finish_reason": "tool_calls",
        }],
        "usage": { "prompt_tokens": 50, "completion_tokens": 10, "total_tokens": 60 },
    })
}

struct Finished {
    report: Value,
    code: Option<i32>,
    output: Option<String>,
}

async fn run_once(
    base_url: &str,
    dir: &Path,
    prompt: &str,
    max_rounds: &str,
    max_output_tokens: &str,
    timeout_secs: &str,
) -> Finished {
    let prompt_file = dir.join("brief.txt");
    let output_file = dir.join("output.txt");
    std::fs::write(&prompt_file, prompt).unwrap();
    let output = tokio::process::Command::new(env!("CARGO_BIN_EXE_buzz-agent"))
        .arg("run-once")
        .arg("--prompt-file")
        .arg(&prompt_file)
        .arg("--output-file")
        .arg(&output_file)
        .args(["--max-rounds", max_rounds])
        .args(["--max-output-tokens", max_output_tokens])
        .args(["--timeout-secs", timeout_secs])
        .env("BUZZ_AGENT_PROVIDER", "openai")
        .env("OPENAI_COMPAT_API_KEY", "test")
        .env("OPENAI_COMPAT_MODEL", "fake-model")
        .env("OPENAI_COMPAT_BASE_URL", base_url)
        .env("BUZZ_AGENT_LLM_TIMEOUT_SECS", "30")
        .kill_on_drop(true)
        .output()
        .await
        .expect("run buzz-agent run-once");
    let stdout = String::from_utf8_lossy(&output.stdout);
    let line = stdout
        .lines()
        .rev()
        .find(|line| !line.trim().is_empty())
        .unwrap_or_else(|| {
            panic!(
                "run-once printed no result line; stderr: {}",
                String::from_utf8_lossy(&output.stderr)
            )
        });
    Finished {
        report: serde_json::from_str(line).expect("the result line is JSON"),
        code: output.status.code(),
        output: std::fs::read_to_string(&output_file).ok(),
    }
}

#[tokio::test]
async fn run_once_writes_output_and_usage() {
    let llm = spawn_capturing_llm(vec![text_reply("Ten guesthouses.", 120, 34)]).await;
    let dir = tempfile::tempdir().unwrap();

    let finished = run_once(
        &llm.url,
        dir.path(),
        "List ten guesthouses.",
        "4",
        "777",
        "30",
    )
    .await;

    assert_eq!(finished.code, Some(0));
    assert_eq!(finished.report["status"], "done");
    assert_eq!(finished.report["input_tokens"], 120);
    assert_eq!(finished.report["output_tokens"], 34);
    assert!(finished.report["error"].is_null());
    assert_eq!(finished.output.as_deref(), Some("Ten guesthouses."));

    let captured = llm.captured.lock().await;
    assert_eq!(captured.len(), 1);
    let request = &captured[0];
    let budget = request
        .get("max_completion_tokens")
        .or_else(|| request.get("max_tokens"));
    assert_eq!(
        budget,
        Some(&json!(777)),
        "the worker's token budget must reach the provider request"
    );
    assert!(
        request.to_string().contains("List ten guesthouses."),
        "the brief is the user message"
    );
}

#[tokio::test]
async fn run_once_has_no_tools() {
    let llm = spawn_capturing_llm(vec![
        tool_call_reply("shell", &json!({ "command": "rm -rf /" })),
        text_reply("Answer without tools.", 70, 12),
    ])
    .await;
    let dir = tempfile::tempdir().unwrap();

    let finished = run_once(&llm.url, dir.path(), "Do the research.", "4", "1000", "30").await;

    assert_eq!(
        finished.code,
        Some(0),
        "a refused tool call must not end the run"
    );
    assert_eq!(finished.report["status"], "done");
    assert_eq!(finished.output.as_deref(), Some("Answer without tools."));
    assert_eq!(
        finished.report["input_tokens"], 120,
        "usage of the refused round counts too"
    );

    let captured = llm.captured.lock().await;
    assert_eq!(captured.len(), 2);
    for (index, request) in captured.iter().enumerate() {
        assert!(
            request.get("tools").is_none(),
            "request {index} offered the model tools: {request}"
        );
    }
    assert!(
        captured[1]
            .to_string()
            .contains("You have no tools in this run"),
        "the model is told its tool call was refused"
    );
}

#[tokio::test]
async fn run_once_fails_when_the_model_only_ever_calls_tools() {
    let llm = spawn_capturing_llm(vec![
        tool_call_reply("shell", &json!({ "command": "ls" })),
        tool_call_reply("shell", &json!({ "command": "ls" })),
    ])
    .await;
    let dir = tempfile::tempdir().unwrap();

    let finished = run_once(&llm.url, dir.path(), "Do the research.", "2", "1000", "30").await;

    assert_eq!(finished.code, Some(1));
    assert_eq!(finished.report["status"], "failed");
    assert!(finished.report["error"]
        .as_str()
        .is_some_and(|error| error.contains("2 rounds")));
    assert_eq!(finished.output, None, "a failed run writes no answer");
}

#[tokio::test]
async fn run_once_times_out_with_failed_status() {
    // A server that accepts connections and never answers.
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move {
        let mut held = Vec::new();
        while let Ok((socket, _)) = listener.accept().await {
            held.push(socket);
        }
    });
    let dir = tempfile::tempdir().unwrap();

    let started = std::time::Instant::now();
    let finished = run_once(&url, dir.path(), "Do the research.", "4", "1000", "1").await;

    assert!(
        started.elapsed() < std::time::Duration::from_secs(20),
        "the run-level timeout, not the provider timeout, must end the run"
    );
    assert_eq!(finished.code, Some(1));
    assert_eq!(finished.report["status"], "failed");
    assert!(finished.report["error"]
        .as_str()
        .is_some_and(|error| error.contains("ran out of time")));
    assert_eq!(finished.output, None);
}

#[tokio::test]
async fn run_once_reports_a_provider_error_as_failed() {
    let llm = spawn_capturing_llm_with_status(vec![(
        400,
        json!({ "error": { "message": "bad request", "type": "invalid_request_error" } }),
    )])
    .await;
    let dir = tempfile::tempdir().unwrap();

    let finished = run_once(&llm.url, dir.path(), "Do the research.", "4", "1000", "30").await;

    assert_eq!(finished.code, Some(1));
    assert_eq!(finished.report["status"], "failed");
    assert!(finished.report["error"]
        .as_str()
        .is_some_and(|error| !error.is_empty()));
    assert_eq!(finished.output, None);
}
