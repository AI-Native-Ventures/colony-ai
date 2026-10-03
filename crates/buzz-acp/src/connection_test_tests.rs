use super::*;

#[test]
fn success_requires_a_completed_nonempty_turn_and_rejects_auth_or_quota_text() {
    for reply in [
        "",
        "Invalid API key, please run /login",
        "Credit balance is too low",
        "Usage limit reached",
    ] {
        assert!(completed_reply(reply.into(), StopReason::EndTurn).is_err());
    }
    assert!(completed_reply("hello".into(), StopReason::Cancelled).is_err());
    assert_eq!(
        completed_reply("hello".into(), StopReason::EndTurn)
            .ok()
            .as_deref(),
        Some("hello")
    );
}

#[test]
fn negotiated_model_is_display_proof_and_provider_errors_are_safe_onboarding_copy() {
    assert_eq!(
        effective_model(
            &json!({"configOptions":[{"category":"model","currentValue":"actual-model"}]})
        )
        .as_deref(),
        Some("actual-model")
    );
    assert_eq!(effective_model(&json!({})), None);
    for (status, expected) in [
        (401, "authentication"),
        (402, "usage balance"),
        (403, "model access"),
    ] {
        let error = crate::AcpError::AgentError {
            code: -32000,
            message: format!("llm: provider=Anthropic; HTTP {status}: private upstream payload"),
        };
        let result = error_result(&error.into());
        let copy = result["error"].as_str().expect("error copy");
        assert!(copy.contains(expected), "{copy}");
        assert!(!copy.contains("private upstream"));
        assert!(!copy.contains('⚠'));
        assert!(!copy.contains("re-send"));
    }
}

#[cfg(unix)]
async fn fake_client(script: &str) -> AcpClient {
    AcpClient::spawn("/bin/bash", &["-c".into(), script.into()], &[], false)
        .await
        .expect("fake ACP child")
}

#[cfg(unix)]
#[tokio::test]
async fn unavailable_model_fails_the_production_probe_before_prompt() {
    let mut client = fake_client(r#"
        read _init
        echo '{"jsonrpc":"2.0","id":0,"result":{"protocolVersion":1,"agentCapabilities":{}}}'
        read _session
        echo '{"jsonrpc":"2.0","id":1,"result":{"sessionId":"probe","models":{"currentModelId":"default","availableModels":[{"modelId":"default","name":"Default"}]}}}'
        read _unexpected_prompt
    "#).await;
    let result = bounded_probe(
        &mut client,
        Some("missing-model"),
        DEFAULT_TIMEOUT_SECS,
        None,
        None,
        Instant::now(),
    )
    .await;
    assert!(result["error"]
        .as_str()
        .expect("failure")
        .contains("Selected model is unavailable"));
    assert!(result.get("reply").is_none());
}

#[cfg(unix)]
#[tokio::test(start_paused = true)]
async fn inner_deadline_is_bound_to_the_actual_startup_path() {
    let mut client = fake_client("read _init; read _never").await;
    let started = tokio::time::Instant::now();
    let result = tokio::time::timeout(
        Duration::from_secs(50),
        bounded_probe(
            &mut client,
            None,
            DEFAULT_TIMEOUT_SECS,
            None,
            None,
            Instant::now(),
        ),
    )
    .await
    .expect("inner timeout must finish first");
    assert!(result["error"]
        .as_str()
        .expect("failure")
        .contains("within 40 seconds"));
    assert!(started.elapsed() >= Duration::from_secs(40));
    assert!(started.elapsed() < Duration::from_secs(50));
}

#[cfg(unix)]
#[tokio::test]
async fn cancel_interrupts_startup_and_reaps_the_child() {
    let path = Path::new("/dev/null");
    let mut client = fake_client("read _init; read _never").await;
    let result = tokio::time::timeout(
        Duration::from_secs(2),
        bounded_probe(
            &mut client,
            None,
            DEFAULT_TIMEOUT_SECS,
            Some(path),
            None,
            Instant::now(),
        ),
    )
    .await
    .expect("cancel should be prompt");
    assert_eq!(result["error"], "Connection test cancelled.");
    assert!(result.get("reply").is_none());
}
