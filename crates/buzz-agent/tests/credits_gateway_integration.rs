//! Real ACP child, isolated config and synthetic relay identity. No paid provider.
use axum::{body::Bytes, http::StatusCode, routing::post, Json, Router};
use serde_json::{json, Value};
use std::{
    process::Stdio,
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

async fn receive(stdout: &mut BufReader<tokio::process::ChildStdout>, id: u64) -> Value {
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let mut line = String::new();
            assert!(
                stdout.read_line(&mut line).await.unwrap() > 0,
                "ACP child exited"
            );
            let value: Value = serde_json::from_str(&line).unwrap();
            if value["id"] == id {
                return value;
            }
        }
    })
    .await
    .unwrap()
}

#[tokio::test]
async fn real_acp_child_uses_keyless_gateway_and_stops_on_credit_refusal() {
    for status in [200u16, 402, 409, 429, 503] {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let captured = Arc::new(Mutex::new(Vec::<Value>::new()));
        let copy = captured.clone();
        let router = Router::new().route("/api/credits-gateway/managed-inference", post(move |body: Bytes| {
            let captured = copy.clone();
            async move {
                captured.lock().unwrap().push(serde_json::from_slice(&body).unwrap());
                (StatusCode::from_u16(status).unwrap(), Json(if status == 200 {
                    json!({"model":"server-model","choices":[{"message":{"role":"assistant","content":"gateway reply"},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":2,"total_tokens":12},"chargedNanousd":"120"})
                } else { json!({"error":"must-not-leak-upstream-body"}) }))
            }
        }));
        let server = tokio::spawn(async move {
            axum::serve(listener, router).await.unwrap();
        });
        let root = tempfile::tempdir().unwrap();
        let keys = nostr::Keys::generate();
        let session = uuid::Uuid::new_v4();
        let mut child = tokio::process::Command::new(env!("CARGO_BIN_EXE_buzz-agent"))
            .env_clear()
            .env("HOME", root.path())
            .env("USERPROFILE", root.path())
            .env("BUZZ_AGENT_CONFIG_DIR", root.path())
            .env("BUZZ_AGENT_PROVIDER", "colony-credits")
            .env("COLONY_CREDITS_GATEWAY", "1")
            .env("COLONY_CREDITS_SESSION_ID", session.to_string())
            .env("COLONY_CREDITS_MODEL", "server-model")
            .env("BUZZ_RELAY_URL", &origin)
            .env("BUZZ_PRIVATE_KEY", keys.secret_key().to_secret_hex())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .unwrap();
        let mut stdin = child.stdin.take().unwrap();
        let mut stdout = BufReader::new(child.stdout.take().unwrap());
        let messages = [
            json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1,"clientCapabilities":{}}}),
            json!({"jsonrpc":"2.0","id":2,"method":"session/new","params":{"cwd":root.path(),"mcpServers":[]}}),
        ];
        let mut acp_session = String::new();
        for message in messages {
            stdin
                .write_all(format!("{message}\n").as_bytes())
                .await
                .unwrap();
            stdin.flush().await.unwrap();
            let response = receive(&mut stdout, message["id"].as_u64().unwrap()).await;
            assert!(response.get("error").is_none(), "{response}");
            if message["id"] == 2 {
                acp_session = response["result"]["sessionId"].as_str().unwrap().to_owned();
            }
        }
        let message = json!({"jsonrpc":"2.0","id":3,"method":"session/prompt","params":{"sessionId":acp_session,"prompt":[{"type":"text","text":"hello"}]}});
        stdin
            .write_all(format!("{message}\n").as_bytes())
            .await
            .unwrap();
        stdin.flush().await.unwrap();
        let response = receive(&mut stdout, 3).await;
        if status == 200 {
            assert!(response.get("error").is_none(), "{response}");
        } else {
            assert_eq!(response["error"]["code"], -32004, "{response}");
            assert!(!response.to_string().contains("must-not-leak"));
            if status == 402 {
                assert!(response["error"]["message"]
                    .as_str()
                    .unwrap()
                    .contains("Out of credits. Top up"));
            }
        }
        {
            let requests = captured.lock().unwrap();
            assert_eq!(requests.len(), 1, "status {status} replayed");
            assert_eq!(requests[0]["session_id"], session.to_string());
            assert!(requests[0].get("model").is_none());
        }
        child.start_kill().unwrap();
        child.wait().await.unwrap();
        server.abort();
    }
}

#[tokio::test]
async fn credits_provider_cannot_start_without_flag_and_managed_authorization() {
    for flag in [None, Some("1")] {
        let root = tempfile::tempdir().unwrap();
        let mut command = tokio::process::Command::new(env!("CARGO_BIN_EXE_buzz-agent"));
        command
            .env_clear()
            .env("HOME", root.path())
            .env("USERPROFILE", root.path())
            .env("BUZZ_AGENT_CONFIG_DIR", root.path())
            .env("BUZZ_AGENT_PROVIDER", "colony-credits")
            .env("BUZZ_RELAY_URL", "https://relay.invalid")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        if let Some(flag) = flag {
            command.env("COLONY_CREDITS_GATEWAY", flag);
        }
        let status = tokio::time::timeout(Duration::from_secs(5), command.status())
            .await
            .unwrap()
            .unwrap();
        assert!(!status.success());
    }
}
