#[tokio::test]
async fn connection_reply_uses_the_real_prompt_stream_and_ignores_other_sessions() {
    let script = r#"
        read -t 2 _init
        echo '{"jsonrpc":"2.0","id":0,"result":{"protocolVersion":1,"agentCapabilities":{}}}'
        read -t 2 _session
        echo '{"jsonrpc":"2.0","id":1,"result":{"sessionId":"connection"}}'
        read -t 2 _prompt
        echo '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"other","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"wrong"}}}}'
        echo '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"connection","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"hello"}}}}'
        echo '{"jsonrpc":"2.0","id":2,"result":{"stopReason":"end_turn"}}'
        sleep 1
    "#;
    let mut client = spawn_script(script).await;
    client.initialize().await.expect("initialize");
    let session = client
        .session_new_full("/tmp", vec![], None, None)
        .await
        .expect("session");
    client.capture_connection_reply(&session.session_id);
    let stop = client
        .session_prompt_with_idle_timeout(
            &session.session_id,
            "hello",
            std::time::Duration::from_secs(2),
            std::time::Duration::from_secs(3),
        )
        .await
        .expect("prompt");
    assert_eq!(stop, StopReason::EndTurn);
    assert_eq!(client.take_connection_reply(), "hello");
    client.shutdown().await;
}

#[tokio::test]
async fn connection_reply_is_bounded_and_resets_for_each_session() {
    let mut client = spawn_inert_client().await;
    client.capture_connection_reply("connection");
    let msg = serde_json::json!({"params":{"sessionId":"connection","update":{"sessionUpdate":"agent_message_chunk","content":{"text":format!("a{}", "é".repeat(5000))}}}});
    client.handle_session_update(&msg);
    let reply = client.take_connection_reply();
    assert_eq!(reply.len(), 8191);
    assert!(reply.starts_with("aé"));
    client.capture_connection_reply("next");
    client.handle_session_update(&msg);
    assert_eq!(client.take_connection_reply(), "");
    client.shutdown().await;
}

#[tokio::test]
async fn connection_permission_rejects_adapter_option_without_authorizing_a_tool() {
    let mut client = spawn_script("read reply; echo "$reply"; read _end").await;
    client.capture_connection_reply("probe");
    client.handle_permission_request(&serde_json::json!({"id": 42, "params": {"options": [
        {"kind": "allow_once", "optionId": "allow-tool"},
        {"kind": "reject_once", "optionId": "reject-tool"}
    ]}})).await.expect("permission response");
    let line = tokio::time::timeout(std::time::Duration::from_secs(2), client.reader.next()).await.expect("response deadline").expect("response line").expect("valid line");
    let response: serde_json::Value = serde_json::from_str(&line).expect("permission JSON");
    assert_eq!(response["result"]["outcome"]["outcome"], "selected");
    assert_eq!(response["result"]["outcome"]["optionId"], "reject-tool");
    assert!(client.connection_tool_requested());
    client.shutdown().await;
}

#[cfg(unix)]
#[tokio::test]
async fn probe_adapter_inherits_the_bounded_outer_harness_process_group() {
    use nix::unistd::{getpgid, Pid};
    let mut client = AcpClient::spawn_connection_probe("/bin/bash", &["-c".into(), "read _end".into()]).await.expect("probe child");
    let pid = client.child.id().expect("child pid");
    assert_eq!(getpgid(Some(Pid::from_raw(pid as i32))).expect("child group"), getpgid(None).expect("parent group"));
    client.shutdown().await;
}
