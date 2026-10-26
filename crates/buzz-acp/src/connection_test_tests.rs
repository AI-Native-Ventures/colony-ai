use super::*;

#[test]
fn success_requires_a_completed_nonempty_turn_and_rejects_auth_or_quota_text() {
    // Public adapter failure reports: github.com/zed-industries/zed/issues/37976
    // and github.com/anthropics/claude-code/issues/12204. No owner transcript was read.
    for reply in [
        "",
        "Invalid API key, please run /login",
        "Invalid API key · Fix external API key",
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
fn production_limits() -> ProbeLimits {
    ProbeLimits::new(
        Duration::from_secs(DEFAULT_TIMEOUT_SECS),
        Duration::from_secs(SILENCE_SECS),
    )
}

#[test]
fn slow_or_briefly_failing_providers_get_busy_copy_not_sign_in_advice() {
    for error in [
        crate::AcpError::IdleTimeout(Duration::from_secs(SILENCE_SECS)),
        crate::AcpError::HardTimeout {
            silence: Duration::from_secs(1),
        },
        crate::AcpError::AgentError {
            code: -32603,
            message: "Internal error: Internal Server Error".into(),
        },
    ] {
        let error = anyhow::Error::from(error);
        assert!(transient(&error), "{error}");
        assert_eq!(error_result(&error)["error"], AI_BUSY);
    }
    let setup = anyhow::Error::from(crate::AcpError::AgentError {
        code: -32603,
        message: "Internal error: config file is invalid".into(),
    });
    assert!(!transient(&setup));
    assert!(error_result(&setup)["error"]
        .as_str()
        .expect("copy")
        .contains("sign-in"));
}

/// The text OpenCode logs when the free model's daily quota is used up.
const OPENCODE_FREE_LIMIT: &str = "AI_APICallError: Free usage limit reached. Free models work in OpenCode (https://opencode.ai); subscribe to OpenCode Go to keep going";
const FREE_LIMIT_COPY: &str = "Today's free AI limit is used up. Connect your own AI in Settings > Agents, or try again later.";

#[test]
fn the_free_quota_error_gets_plain_copy_and_a_stable_code_not_busy() {
    // Arrives as an agent error, whatever code or wrapper the adapter gives it.
    for (code, message) in [
        (-32603, OPENCODE_FREE_LIMIT.to_owned()),
        (-32603, format!("Internal error: {OPENCODE_FREE_LIMIT}")),
        (-32000, format!("llm: {OPENCODE_FREE_LIMIT}")),
    ] {
        let error = anyhow::Error::from(crate::AcpError::AgentError { code, message });
        assert!(!transient(&error), "{error}");
        let result = error_result(&error);
        assert_eq!(result["error"], FREE_LIMIT_COPY);
        assert_eq!(result["code"], "free_limit_reached");
        assert_ne!(result["error"], AI_BUSY);
    }
    // Arrives as the reply text of the hello turn.
    let reply = completed_reply(OPENCODE_FREE_LIMIT.into(), StopReason::EndTurn)
        .expect_err("the quota error is not a hello");
    let result = error_result(&reply);
    assert_eq!(result["error"], FREE_LIMIT_COPY);
    assert_eq!(result["code"], "free_limit_reached");
    // Even with a non-final stop reason, the cause is named.
    let cancelled = completed_reply(OPENCODE_FREE_LIMIT.into(), StopReason::Cancelled)
        .expect_err("not a hello");
    assert_eq!(error_result(&cancelled)["code"], "free_limit_reached");
}

#[test]
fn a_silent_failure_is_blamed_on_the_free_quota_only_when_opencode_logged_it() {
    for error in [
        crate::AcpError::IdleTimeout(Duration::from_secs(SILENCE_SECS)),
        crate::AcpError::AgentError {
            code: -32603,
            message: "Internal error: Internal Server Error".into(),
        },
    ] {
        let error = anyhow::Error::from(error);
        assert_eq!(error_result_with_log(&error, false)["error"], AI_BUSY);
        let logged = error_result_with_log(&error, true);
        assert_eq!(logged["error"], FREE_LIMIT_COPY);
        assert_eq!(logged["code"], "free_limit_reached");
    }
    let incomplete = completed_reply(String::new(), StopReason::EndTurn).expect_err("empty");
    assert_eq!(
        error_result_with_log(&incomplete, true)["code"],
        "free_limit_reached"
    );
    // A cause the harness named itself is never overruled by a log line.
    let rejected = anyhow::Error::from(crate::AcpError::AgentError {
        code: -32001,
        message: "llm auth: provider=OpenRouter; private body".into(),
    });
    let result = error_result_with_log(&rejected, true);
    assert!(result.get("code").is_none(), "{result}");
    assert!(result["error"]
        .as_str()
        .expect("copy")
        .contains("authentication"));
    let tool = anyhow::Error::from(ConnectionFailure("The harness requested a tool."));
    assert!(error_result_with_log(&tool, true).get("code").is_none());
}

#[test]
fn the_whole_budget_is_named_in_minutes() {
    assert_eq!(budget_words(Duration::from_secs(300)), "5 minutes");
    assert_eq!(budget_words(Duration::from_secs(40)), "40 seconds");
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
        &production_limits(),
        None,
        None,
        Instant::now(),
    )
    .await;
    assert!(!result.retry);
    let result = result.outcome;
    assert!(result["error"]
        .as_str()
        .expect("failure")
        .contains("Selected model is unavailable"));
    assert_eq!(result["code"], "model_unavailable");
    assert!(result.get("reply").is_none());
}

#[cfg(unix)]
#[tokio::test(start_paused = true)]
async fn inner_deadline_is_bound_to_the_actual_startup_path() {
    let mut client = fake_client("read _init; read _never").await;
    let started = tokio::time::Instant::now();
    // Shorter than the 60 s request timeout, so only the test budget can end it.
    let limits = ProbeLimits::new(Duration::from_secs(40), Duration::from_secs(SILENCE_SECS));
    let result = tokio::time::timeout(
        Duration::from_secs(50),
        bounded_probe(&mut client, None, &limits, None, None, Instant::now()),
    )
    .await
    .expect("inner timeout must finish first");
    assert!(!result.retry, "an exhausted budget is final");
    assert!(result.outcome["error"]
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
            &production_limits(),
            Some(path),
            None,
            Instant::now(),
        ),
    )
    .await
    .expect("cancel should be prompt");
    assert!(!result.retry, "a cancelled test must not start again");
    assert_eq!(result.outcome["error"], "Connection test cancelled.");
    assert!(result.outcome.get("reply").is_none());
}

/// Answers initialize and session/new, then stays silent after the prompt.
#[cfg(unix)]
const SILENT: &str = r#"
    read _init
    echo '{"jsonrpc":"2.0","id":0,"result":{"protocolVersion":1,"agentCapabilities":{}}}'
    read _session
    echo '{"jsonrpc":"2.0","id":1,"result":{"sessionId":"probe"}}'
    read _prompt
    read _never
"#;

/// Answers the prompt with an internal server error, like a busy free model.
#[cfg(unix)]
const SERVER_ERROR: &str = r#"
    read _init
    echo '{"jsonrpc":"2.0","id":0,"result":{"protocolVersion":1,"agentCapabilities":{}}}'
    read _session
    echo '{"jsonrpc":"2.0","id":1,"result":{"sessionId":"probe"}}'
    read _prompt
    echo '{"jsonrpc":"2.0","id":2,"error":{"code":-32603,"message":"Internal error: Internal Server Error"}}'
    read _never
"#;

/// Answers the prompt with a hello and a completed turn.
#[cfg(unix)]
const REPLIES: &str = r#"
    read _init
    echo '{"jsonrpc":"2.0","id":0,"result":{"protocolVersion":1,"agentCapabilities":{}}}'
    read _session
    echo '{"jsonrpc":"2.0","id":1,"result":{"sessionId":"probe"}}'
    read _prompt
    echo '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"probe","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"hello from attempt two"}}}}'
    echo '{"jsonrpc":"2.0","id":2,"result":{"stopReason":"end_turn"}}'
    read _never
"#;

/// Runs the production retry loop over scripted agents, one script per spawn.
#[cfg(unix)]
async fn run_scripts(scripts: &[&'static str]) -> (Value, usize) {
    let spawned = std::cell::Cell::new(0);
    let limits = ProbeLimits::new(Duration::from_secs(60), Duration::from_millis(300));
    let outcome = probe_with_retries(
        || {
            let index = spawned.get();
            spawned.set(index + 1);
            let script = scripts[index.min(scripts.len() - 1)];
            async move { Ok::<_, anyhow::Error>(fake_client(script).await) }
        },
        None,
        &limits,
        None,
        None,
        Instant::now(),
    )
    .await
    .expect("probe result");
    (outcome, spawned.get())
}

#[cfg(unix)]
#[tokio::test]
async fn a_silent_attempt_is_retried_on_a_fresh_agent() {
    let (outcome, spawned) = run_scripts(&[SILENT, REPLIES]).await;
    assert_eq!(outcome["reply"], "hello from attempt two", "{outcome}");
    assert_eq!(spawned, 2);
}

#[cfg(unix)]
#[tokio::test]
async fn a_provider_server_error_is_retried_on_a_fresh_agent() {
    let (outcome, spawned) = run_scripts(&[SERVER_ERROR, REPLIES]).await;
    assert_eq!(outcome["reply"], "hello from attempt two", "{outcome}");
    assert_eq!(spawned, 2);
}

#[cfg(unix)]
#[tokio::test]
async fn retries_stop_at_the_attempt_cap_with_busy_copy() {
    let (outcome, spawned) = run_scripts(&[SILENT]).await;
    assert_eq!(outcome["error"], AI_BUSY);
    assert_eq!(spawned, MAX_ATTEMPTS as usize);
}

/// OpenCode answers the hello with its quota error: no retry, plain copy.
#[cfg(unix)]
const FREE_LIMIT_ERROR: &str = r#"
    read _init
    echo '{"jsonrpc":"2.0","id":0,"result":{"protocolVersion":1,"agentCapabilities":{}}}'
    read _session
    echo '{"jsonrpc":"2.0","id":1,"result":{"sessionId":"probe"}}'
    read _prompt
    echo '{"jsonrpc":"2.0","id":2,"error":{"code":-32603,"message":"Internal error: AI_APICallError: Free usage limit reached. Free models work in OpenCode (https://opencode.ai); subscribe to OpenCode Go to keep going"}}'
    read _never
"#;

#[cfg(unix)]
#[tokio::test]
async fn the_free_quota_error_ends_the_test_at_once_with_plain_copy() {
    let (outcome, spawned) = run_scripts(&[FREE_LIMIT_ERROR, REPLIES]).await;
    assert_eq!(outcome["error"], FREE_LIMIT_COPY, "{outcome}");
    assert_eq!(outcome["code"], "free_limit_reached");
    assert_eq!(spawned, 1);
}

#[cfg(unix)]
#[tokio::test]
async fn a_setup_failure_is_not_retried() {
    let unavailable = r#"
        read _init
        echo '{"jsonrpc":"2.0","id":0,"result":{"protocolVersion":1,"agentCapabilities":{}}}'
        read _session
        echo '{"jsonrpc":"2.0","id":1,"result":{"sessionId":"probe","models":{"currentModelId":"default","availableModels":[{"modelId":"default","name":"Default"}]}}}'
        read _never
    "#;
    let spawned = std::cell::Cell::new(0);
    let limits = ProbeLimits::new(Duration::from_secs(60), Duration::from_millis(300));
    let outcome = probe_with_retries(
        || {
            spawned.set(spawned.get() + 1);
            async move { Ok::<_, anyhow::Error>(fake_client(unavailable).await) }
        },
        Some("missing-model"),
        &limits,
        None,
        None,
        Instant::now(),
    )
    .await
    .expect("probe result");
    assert_eq!(outcome["code"], "model_unavailable");
    assert_eq!(spawned.get(), 1);
}
