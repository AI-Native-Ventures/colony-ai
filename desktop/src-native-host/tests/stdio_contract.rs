use std::{
    io::{self, BufRead, BufReader, Read, Write},
    process::{Child, ChildStdin, Command, ExitStatus, Stdio},
    time::Duration,
};

use serde_json::{json, Value};

const PREFIX: &str = "@colony-native:";
const PROFILE_ID: &str = "0000000000000001";
const SESSION_ID: &str = "session-contract-1";
const FRAME_LIMIT: usize = 16_777_216;

struct Harness {
    child: Child,
    stdin: Option<ChildStdin>,
    stdout: Option<BufReader<std::process::ChildStdout>>,
}

impl Harness {
    fn spawn(fault: Option<&str>, deadline_ms: Option<u64>) -> Self {
        Self::spawn_with_relay_url(fault, deadline_ms, None)
    }

    fn spawn_with_relay_url(
        fault: Option<&str>,
        deadline_ms: Option<u64>,
        relay_url: Option<&str>,
    ) -> Self {
        let mut command = Command::new(env!("CARGO_BIN_EXE_colony-native-host"));
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .env_remove("BUZZ_RELAY_URL")
            .env_remove("COLONY_STAGE0_FAULT")
            .env_remove("COLONY_STAGE0_TEST_DEADLINE_MS");
        if let Some(fault) = fault {
            command.env("COLONY_STAGE0_FAULT", fault);
        }
        if let Some(deadline_ms) = deadline_ms {
            command.env("COLONY_STAGE0_TEST_DEADLINE_MS", deadline_ms.to_string());
        }
        if let Some(relay_url) = relay_url {
            command.env("BUZZ_RELAY_URL", relay_url);
        }
        let mut child = command.spawn().expect("host process should spawn");
        let stdin = child.stdin.take().expect("host stdin should be piped");
        let stdout = child.stdout.take().expect("host stdout should be piped");
        Self {
            child,
            stdin: Some(stdin),
            stdout: Some(BufReader::new(stdout)),
        }
    }

    fn send(&mut self, value: Value) -> io::Result<()> {
        let encoded = serde_json::to_vec(&value).map_err(io::Error::other)?;
        let stdin = self
            .stdin
            .as_mut()
            .ok_or_else(|| io::Error::new(io::ErrorKind::BrokenPipe, "stdin closed"))?;
        stdin.write_all(PREFIX.as_bytes())?;
        stdin.write_all(&encoded)?;
        stdin.write_all(b"\n")?;
        stdin.flush()
    }

    fn send_raw(&mut self, bytes: &[u8]) -> io::Result<()> {
        let stdin = self
            .stdin
            .as_mut()
            .ok_or_else(|| io::Error::new(io::ErrorKind::BrokenPipe, "stdin closed"))?;
        stdin.write_all(bytes)?;
        stdin.flush()
    }

    fn read_value(&mut self) -> Value {
        let mut line = Vec::new();
        self.stdout
            .as_mut()
            .expect("host stdout should be open")
            .read_until(b'\n', &mut line)
            .expect("host stdout should be readable");
        assert!(!line.is_empty(), "expected a host frame, got EOF");
        assert!(
            line.ends_with(b"\n"),
            "host frame must be newline terminated"
        );
        assert!(
            line.starts_with(PREFIX.as_bytes()),
            "unexpected host prefix"
        );
        serde_json::from_slice(&line[PREFIX.len()..line.len() - 1])
            .expect("host frame should contain valid JSON")
    }

    fn read_raw_line(&mut self) -> Vec<u8> {
        let mut line = Vec::new();
        self.stdout
            .as_mut()
            .expect("host stdout should be open")
            .read_until(b'\n', &mut line)
            .expect("host stdout should be readable");
        line
    }

    fn close_stdin(&mut self) {
        self.stdin.take();
    }

    fn close_stdout(&mut self) {
        self.stdout.take();
    }

    fn finish(mut self) -> ExitStatus {
        self.close_stdin();
        let mut remaining = Vec::new();
        if let Some(stdout) = self.stdout.as_mut() {
            stdout
                .read_to_end(&mut remaining)
                .expect("host stdout should close");
        }
        self.child.wait().expect("host process should exit")
    }

    fn finish_without_extra_output(mut self) -> ExitStatus {
        self.close_stdin();
        let mut remaining = Vec::new();
        if let Some(stdout) = self.stdout.as_mut() {
            stdout
                .read_to_end(&mut remaining)
                .expect("host stdout should close");
        }
        assert!(
            remaining.is_empty(),
            "host emitted more than one terminal frame"
        );
        self.child.wait().expect("host process should exit")
    }

    fn wait_for_exit_bounded(&mut self, timeout: Duration) -> ExitStatus {
        let started = std::time::Instant::now();
        loop {
            if let Some(status) = self
                .child
                .try_wait()
                .expect("host status should be readable")
            {
                return status;
            }
            assert!(
                started.elapsed() < timeout,
                "host did not exit within {timeout:?} while stdin remained open"
            );
            std::thread::sleep(Duration::from_millis(10));
        }
    }
}

impl Drop for Harness {
    fn drop(&mut self) {
        if self.child.try_wait().ok().flatten().is_none() {
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
    }
}

fn hello(generation: u64) -> Value {
    json!({
        "type": "HELLO",
        "protocolVersion": 1,
        "profileId": PROFILE_ID,
        "sessionId": SESSION_ID,
        "generationId": generation,
        "buildId": "contract-tests"
    })
}

fn rehello(generation: u64) -> Value {
    json!({
        "type": "REHELLO",
        "protocolVersion": 1,
        "profileId": PROFILE_ID,
        "sessionId": SESSION_ID,
        "generationId": generation,
        "buildId": "contract-tests"
    })
}

fn request(request_id: &str, generation: u64) -> Value {
    json!({
        "type": "REQUEST",
        "protocolVersion": 1,
        "profileId": PROFILE_ID,
        "sessionId": SESSION_ID,
        "generationId": generation,
        "requestId": request_id,
        "capability": "health-safe",
        "method": "get_default_relay_url",
        "payload": {}
    })
}

fn cancel(request_id: &str, generation: u64) -> Value {
    json!({
        "type": "CANCEL",
        "protocolVersion": 1,
        "profileId": PROFILE_ID,
        "sessionId": SESSION_ID,
        "generationId": generation,
        "requestId": request_id
    })
}

fn bind_initial(host: &mut Harness) {
    host.send(hello(1)).expect("HELLO should be accepted");
    let ready = host.read_value();
    assert_eq!(ready["type"], "READY");
    assert_eq!(ready["generationId"], 1);
    assert_eq!(ready["profileId"], PROFILE_ID);
    assert_eq!(ready["sessionId"], SESSION_ID);
    assert_eq!(
        ready["registryDigest"],
        "1242953f4a5baf1995ee18bac140ca16178a06205771d8a65ab0a9a39bb0ac49"
    );

    let event = host.read_value();
    assert_eq!(event["type"], "EVENT");
    assert_eq!(event["event"], "host_lifecycle");
    assert_eq!(event["payload"]["state"], "ready");
    assert_eq!(event["sequence"], 1);
}

fn assert_error(response: &Value, request_id: &str, generation: u64, outcome: &str, code: &str) {
    assert_eq!(response["type"], "RESPONSE");
    assert_eq!(response["requestId"], request_id);
    assert_eq!(response["generationId"], generation);
    assert_eq!(response["outcome"], outcome);
    assert_eq!(response["error"]["code"], code);
}

#[test]
fn initial_bind_orders_lifecycle_before_health_response_and_honors_trimmed_override() {
    let mut host = Harness::spawn(None, None);
    bind_initial(&mut host);
    host.send(request("health-1", 1))
        .expect("health request should be accepted");
    let response = host.read_value();
    assert_eq!(response["type"], "RESPONSE");
    assert_eq!(response["outcome"], "ok");
    assert_eq!(response["payload"]["relayUrl"], "ws://localhost:3000");
    assert!(host.finish().success());

    let mut host = Harness::spawn_with_relay_url(None, None, Some("  wss://relay.example/  "));
    bind_initial(&mut host);
    host.send(request("health-override", 1))
        .expect("health request should be accepted");
    let response = host.read_value();
    assert_eq!(response["payload"]["relayUrl"], "wss://relay.example/");
    assert!(host.finish().success());
}

#[test]
fn repeated_rebinds_are_monotonic_and_duplicate_current_rebind_is_idempotent() {
    let mut host = Harness::spawn(None, None);
    bind_initial(&mut host);

    host.send(rehello(2))
        .expect("first rebind should be accepted");
    let rebound = host.read_value();
    assert_eq!(rebound["type"], "REBOUND");
    assert_eq!(rebound["generationId"], 2);
    let event = host.read_value();
    assert_eq!(event["generationId"], 2);
    assert_eq!(event["sequence"], 2);

    host.send(rehello(2))
        .expect("duplicate current rebind should be accepted");
    let duplicate = host.read_value();
    assert_eq!(duplicate["type"], "REBOUND");
    assert_eq!(duplicate["generationId"], 2);

    host.send(rehello(3))
        .expect("second rebind should be accepted");
    let rebound = host.read_value();
    assert_eq!(rebound["generationId"], 3);
    let event = host.read_value();
    assert_eq!(event["generationId"], 3);
    assert_eq!(event["sequence"], 3);
    assert!(host.finish().success());
}

#[test]
fn held_old_response_is_terminally_fenced_before_rebound_and_never_replayed() {
    let mut host = Harness::spawn(Some("delay-response"), None);
    bind_initial(&mut host);
    host.send(request("held", 1))
        .expect("delayed request should be accepted");
    host.send(rehello(2)).expect("rebind should be accepted");

    let old = host.read_value();
    assert_error(&old, "held", 1, "outcome_unknown", "renderer_rebound");
    let rebound = host.read_value();
    assert_eq!(rebound["type"], "REBOUND");
    assert_eq!(rebound["generationId"], 2);
    let event = host.read_value();
    assert_eq!(event["generationId"], 2);
    assert_eq!(event["sequence"], 2);

    host.send(request("fresh", 2))
        .expect("post-rebind request should be accepted");
    let fresh = host.read_value();
    assert_eq!(fresh["requestId"], "fresh");
    assert_eq!(fresh["outcome"], "ok");
    assert_eq!(fresh["generationId"], 2);
    assert!(host.finish().success());
}

#[test]
fn duplicate_ids_and_generation_errors_are_deterministic_without_replay() {
    let mut host = Harness::spawn(None, None);
    bind_initial(&mut host);

    host.send(rehello(2)).expect("rebind should be accepted");
    assert_eq!(host.read_value()["type"], "REBOUND");
    assert_eq!(host.read_value()["sequence"], 2);

    host.send(request("stale", 1))
        .expect("stale request is framed");
    assert_error(&host.read_value(), "stale", 2, "error", "stale_generation");
    host.send(request("future", 3))
        .expect("future request is framed");
    assert_error(
        &host.read_value(),
        "future",
        2,
        "error",
        "future_generation",
    );

    host.send(request("duplicate", 2))
        .expect("first request should be accepted");
    assert_eq!(host.read_value()["outcome"], "ok");
    host.send(request("duplicate", 2))
        .expect("duplicate request should be framed");
    assert_error(
        &host.read_value(),
        "duplicate",
        2,
        "error",
        "duplicate_request_id",
    );

    let mut unknown_capability = request("unknown-capability", 2);
    unknown_capability["capability"] = json!("domain");
    host.send(unknown_capability)
        .expect("unknown capability should be framed");
    assert_error(
        &host.read_value(),
        "unknown-capability",
        2,
        "error",
        "unknown_capability",
    );

    let mut bad_payload = request("bad-payload", 2);
    bad_payload["payload"] = json!({"unexpected": true});
    host.send(bad_payload)
        .expect("bad payload should be framed");
    assert_error(
        &host.read_value(),
        "bad-payload",
        2,
        "error",
        "invalid_payload",
    );
    assert!(host.finish().success());
}

#[test]
fn unique_request_ids_at_retention_cap_have_bounded_replay_semantics() {
    const SEEN_REQUEST_LIMIT: usize = 128 * 32;

    let mut host = Harness::spawn(None, None);
    bind_initial(&mut host);
    for index in 0..SEEN_REQUEST_LIMIT {
        let request_id = format!("seen-{index}");
        host.send(request(&request_id, 1))
            .expect("request within the retention cap should be framed");
        let response = host.read_value();
        assert_eq!(response["requestId"], request_id);
        assert_eq!(response["outcome"], "ok");
    }

    let over_cap = "over-cap";
    host.send(request(over_cap, 1))
        .expect("the first over-cap request should be framed");
    assert_error(&host.read_value(), over_cap, 1, "error", "host_busy");
    host.send(request(over_cap, 1))
        .expect("the repeated over-cap request should be framed");
    assert_error(&host.read_value(), over_cap, 1, "error", "host_busy");

    host.send(request("seen-0", 1))
        .expect("an accepted identifier should remain replay-fenced");
    assert_error(
        &host.read_value(),
        "seen-0",
        1,
        "error",
        "duplicate_request_id",
    );
    assert!(host.finish().success());
}

#[test]
fn stale_and_future_rehello_frames_fail_closed() {
    for generation in [0_u64, 3_u64] {
        let mut host = Harness::spawn(None, None);
        bind_initial(&mut host);
        host.send(rehello(generation))
            .expect("invalid rebind should be framed");
        let status = host.finish();
        assert!(
            !status.success(),
            "generation {generation} should be rejected"
        );
    }
}

#[test]
fn oversized_identifier_and_bad_initial_binding_fail_before_dispatch() {
    let oversized_id = "x".repeat(129);
    let mut host = Harness::spawn(None, None);
    let mut oversized = hello(1);
    oversized["buildId"] = json!(oversized_id);
    host.send(oversized)
        .expect("oversized identifier should be framed");
    assert!(!host.finish().success());

    let mut host = Harness::spawn(None, None);
    let mut wrong_profile = hello(1);
    wrong_profile["profileId"] = json!("old-colony-profile");
    host.send(wrong_profile)
        .expect("wrong profile should be framed");
    assert!(!host.finish().success());
}

#[test]
fn unknown_frame_and_wrong_session_fail_closed_without_dispatch() {
    let mut host = Harness::spawn(None, None);
    bind_initial(&mut host);
    let unknown = json!({
        "type": "NOT_REGISTERED",
        "protocolVersion": 1,
        "profileId": PROFILE_ID,
        "sessionId": SESSION_ID,
        "generationId": 1
    });
    host.send(unknown).expect("unknown frame should be framed");
    assert!(!host.finish().success());

    let mut host = Harness::spawn(None, None);
    bind_initial(&mut host);
    let mut wrong_session = request("wrong-session", 1);
    wrong_session["sessionId"] = json!("another-session");
    host.send(wrong_session)
        .expect("wrong session should be framed");
    assert!(!host.finish().success());
}

#[test]
fn fatal_frames_exit_with_parent_stdin_left_open() {
    let cases = vec![
        (
            "unknown frame",
            json!({
                "type": "NOT_REGISTERED",
                "protocolVersion": 1,
                "profileId": PROFILE_ID,
                "sessionId": SESSION_ID,
                "generationId": 1
            }),
        ),
        ("wrong session", {
            let mut frame = request("wrong-session-open", 1);
            frame["sessionId"] = json!("another-session");
            frame
        }),
        ("stale rehello", rehello(0)),
    ];

    for (label, frame) in cases {
        let mut host = Harness::spawn(None, None);
        bind_initial(&mut host);
        host.send(frame).expect("fatal frame should be framed");
        let status = host.wait_for_exit_bounded(Duration::from_secs(2));
        assert_eq!(
            status.code(),
            Some(2),
            "{label} should terminate the host while stdin remains open"
        );
    }
}

#[test]
fn non_reading_parent_cannot_make_host_buffers_unbounded() {
    let mut host = Harness::spawn(None, None);
    host.send(hello(1)).expect("HELLO should be framed");

    let mut attempted = 0_usize;
    for index in 0..512 {
        let request_id = format!("pressure-{index}");
        if host.send(request(&request_id, 1)).is_err() {
            break;
        }
        attempted += 1;
    }
    assert!(
        attempted > 0,
        "the bounded pressure vector should reach the host"
    );

    let status = host.wait_for_exit_bounded(Duration::from_secs(2));
    assert_eq!(
        status.code(),
        Some(2),
        "a non-reading parent must trigger bounded output backpressure failure"
    );
}

#[test]
fn fatal_failure_rejects_pending_work_once_before_bounded_exit() {
    let cases = vec![
        (
            "malformed",
            None,
            Some(format!("{PREFIX}{{not-json}}\n").into_bytes()),
        ),
        (
            "wrong binding",
            Some({
                let mut frame = request("fatal-wrong-binding", 1);
                frame["sessionId"] = json!("another-session");
                frame
            }),
            None,
        ),
        (
            "dispatch",
            Some(json!({
                "type": "NOT_REGISTERED",
                "protocolVersion": 1,
                "profileId": PROFILE_ID,
                "sessionId": SESSION_ID,
                "generationId": 1
            })),
            None,
        ),
    ];

    for (label, frame, raw_frame) in cases {
        let mut host = Harness::spawn(Some("delay-response"), None);
        bind_initial(&mut host);
        host.send(request("fatal-pending", 1))
            .expect("delayed request should be accepted");
        let fatal_started = std::time::Instant::now();
        if let Some(frame) = frame {
            host.send(frame).expect("fatal frame should be framed");
        } else if let Some(raw_frame) = raw_frame {
            host.send_raw(&raw_frame)
                .expect("malformed frame should reach the host");
        }

        let terminal = host.read_value();
        assert_error(&terminal, "fatal-pending", 1, "error", "host_unavailable");
        assert!(
            fatal_started.elapsed() < Duration::from_secs(1),
            "{label} terminal response exceeded the bounded shutdown window"
        );
        let status = host.finish_without_extra_output();
        assert_eq!(status.code(), Some(2), "{label} should fail closed");
    }
}

#[test]
fn idle_non_reading_parent_hits_active_writer_deadline() {
    let relay_url = format!("wss://{}", "r".repeat(96 * 1024));
    let mut host = Harness::spawn_with_relay_url(None, Some(50), Some(&relay_url));
    bind_initial(&mut host);
    host.send(request("large-write", 1))
        .expect("large response request should be framed");

    let status = host.wait_for_exit_bounded(Duration::from_secs(2));
    assert_eq!(
        status.code(),
        Some(2),
        "an idle blocked writer must hit its active progress deadline"
    );
}

#[test]
fn closed_stdout_causes_bounded_transport_failure() {
    let mut host = Harness::spawn(None, Some(100));
    bind_initial(&mut host);
    host.close_stdout();
    host.send(request("closed-output", 1))
        .expect("request should reach the host before the output failure");

    let status = host.wait_for_exit_bounded(Duration::from_secs(2));
    assert_eq!(
        status.code(),
        Some(2),
        "a closed output pipe must fail closed within a bounded interval"
    );
}

#[test]
fn malformed_oversized_deep_and_invalid_utf8_input_is_rejected_before_dispatch() {
    let malformed_cases: Vec<Vec<u8>> = vec![
        format!("{PREFIX}{{not-json}}\n").into_bytes(),
        b"missing-prefix\n".to_vec(),
        [PREFIX.as_bytes(), b"\xff\n"].concat(),
    ];
    for malformed in malformed_cases {
        let mut host = Harness::spawn(None, None);
        let _ = host.send_raw(&malformed);
        assert!(!host.finish().success());
    }

    let mut oversized = Vec::with_capacity(FRAME_LIMIT + 1);
    oversized.extend_from_slice(PREFIX.as_bytes());
    oversized.extend(std::iter::repeat_n(b' ', FRAME_LIMIT));
    oversized.push(b'\n');
    let mut host = Harness::spawn(None, None);
    let _ = host.send_raw(&oversized);
    assert!(!host.finish().success());

    let nested = format!("{}0{}", "[".repeat(33), "]".repeat(33));
    let deep = format!(
        "{PREFIX}{{\"type\":\"HELLO\",\"protocolVersion\":1,\"profileId\":\"{PROFILE_ID}\",\"sessionId\":\"{SESSION_ID}\",\"generationId\":1,\"buildId\":\"contract-tests\",\"payload\":{nested}}}\n"
    );
    let mut host = Harness::spawn(None, None);
    host.send_raw(deep.as_bytes())
        .expect("deep frame should reach the host");
    assert!(!host.finish().success());
}

#[test]
fn delayed_request_times_out_once_when_deadline_expires() {
    let mut host = Harness::spawn(Some("delay-response"), Some(25));
    bind_initial(&mut host);
    host.send(request("timeout", 1))
        .expect("delayed request should be accepted");
    let response = host.read_value();
    assert_error(&response, "timeout", 1, "error", "timeout");
    assert!(host.finish().success());
}

#[test]
fn cancel_is_best_effort_and_prevents_the_delayed_completion() {
    let mut host = Harness::spawn(Some("delay-response"), None);
    bind_initial(&mut host);
    host.send(request("cancel-me", 1))
        .expect("delayed request should be accepted");
    host.send(cancel("cancel-me", 1))
        .expect("cancel should be accepted");
    let response = host.read_value();
    assert_error(&response, "cancel-me", 1, "cancelled", "cancelled");
    assert!(host.finish().success());
}

#[test]
fn eof_rejects_pending_work_and_is_the_explicit_shutdown_mechanism() {
    let mut host = Harness::spawn(Some("delay-response"), None);
    bind_initial(&mut host);
    host.send(request("eof", 1))
        .expect("delayed request should be accepted");
    host.close_stdin();
    let response = host.read_value();
    assert_error(&response, "eof", 1, "error", "host_unavailable");
    assert!(host.finish().success());
}

#[test]
fn early_exit_and_malformed_faults_are_bounded_process_only_failures() {
    let mut early = Harness::spawn(Some("exit-before-ready"), None);
    let early_status = early.finish();
    assert_eq!(early_status.code(), Some(17));

    let mut malformed = Harness::spawn(Some("malformed-frame"), None);
    let line = malformed.read_raw_line();
    assert!(line.starts_with(PREFIX.as_bytes()));
    assert!(serde_json::from_slice::<Value>(&line[PREFIX.len()..line.len() - 1]).is_err());
    assert!(malformed.finish().success());
}

#[test]
fn startup_and_pipe_shutdown_complete_within_the_bounded_grace_window() {
    let started = std::time::Instant::now();
    let mut host = Harness::spawn(None, None);
    bind_initial(&mut host);
    assert!(started.elapsed() < Duration::from_secs(2));
    host.close_stdin();
    let shutdown_started = std::time::Instant::now();
    assert!(host.finish().success());
    assert!(shutdown_started.elapsed() < Duration::from_secs(2));
}
