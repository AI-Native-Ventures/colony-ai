#![cfg(feature = "identity-file-only")]

use std::{
    fs,
    io::{self, BufRead, BufReader, Read, Write},
    path::PathBuf,
    process::{Child, ChildStderr, ChildStdin, Command, ExitStatus, Stdio},
    thread,
};

use serde_json::{json, Value};

const PREFIX: &str = "@colony-native:";
const PROFILE_ID: &str = "colony-b2a-test-profile";
const SESSION_ID: &str = "identity-v2-session";
const REGISTRY_DIGEST: &str = "1032c9f29dee5495099ebf951133bf3cf80c144e39476af39bb67fe62dee3565";
const STDERR_CAPTURE_LIMIT: usize = 16 * 1024;

struct Finished {
    status: ExitStatus,
    stderr: Vec<u8>,
}

struct Harness {
    child: Child,
    stdin: Option<ChildStdin>,
    stdout: Option<BufReader<std::process::ChildStdout>>,
    stderr: Option<thread::JoinHandle<Vec<u8>>>,
}

impl Harness {
    fn spawn() -> Self {
        Self::spawn_with(None, None)
    }

    fn spawn_with(fault: Option<&str>, deadline_ms: Option<u64>) -> Self {
        let mut command = Command::new(env!("CARGO_BIN_EXE_colony-native-host"));
        command
            .arg("--identity-v2-test")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .env_remove("BUZZ_RELAY_URL")
            .env_remove("COLONY_STAGE0_FAULT")
            .env_remove("COLONY_STAGE0_TEST_DEADLINE_MS");
        if let Some(fault) = fault {
            command.env("COLONY_STAGE0_FAULT", fault);
        }
        if let Some(deadline_ms) = deadline_ms {
            command.env("COLONY_STAGE0_TEST_DEADLINE_MS", deadline_ms.to_string());
        }
        let mut child = command.spawn().expect("host process should spawn");
        let stdin = child.stdin.take().expect("host stdin should be piped");
        let stdout = child.stdout.take().expect("host stdout should be piped");
        let stderr = child.stderr.take().expect("host stderr should be piped");
        let stderr = thread::spawn(move || drain_stderr(stderr));
        Self {
            child,
            stdin: Some(stdin),
            stdout: Some(BufReader::new(stdout)),
            stderr: Some(stderr),
        }
    }

    fn send(&mut self, value: Value) -> io::Result<()> {
        let encoded = serde_json::to_vec(&value).map_err(io::Error::other)?;
        self.send_raw(&encoded)
    }

    fn send_raw(&mut self, json_bytes: &[u8]) -> io::Result<()> {
        let stdin = self
            .stdin
            .as_mut()
            .ok_or_else(|| io::Error::new(io::ErrorKind::BrokenPipe, "stdin closed"))?;
        stdin.write_all(PREFIX.as_bytes())?;
        stdin.write_all(json_bytes)?;
        stdin.write_all(b"\n")?;
        stdin.flush()
    }

    fn read_value(&mut self) -> Value {
        let mut line = Vec::new();
        self.stdout
            .as_mut()
            .expect("host stdout should be open")
            .read_until(b'\n', &mut line)
            .expect("host stdout should be readable");
        assert!(!line.is_empty(), "expected host frame, got EOF");
        assert!(
            line.starts_with(PREFIX.as_bytes()),
            "unexpected host prefix"
        );
        serde_json::from_slice(&line[PREFIX.len()..line.len() - 1])
            .expect("host frame should contain JSON")
    }

    fn close_stdin(&mut self) {
        self.stdin.take();
    }

    fn finish(self) -> ExitStatus {
        self.finish_with_stderr().status
    }

    fn finish_with_stderr(mut self) -> Finished {
        self.close_stdin();
        let mut remaining = Vec::new();
        if let Some(stdout) = self.stdout.as_mut() {
            stdout
                .read_to_end(&mut remaining)
                .expect("host stdout should close");
        }
        let status = self.child.wait().expect("host process should exit");
        let stderr = self
            .stderr
            .take()
            .expect("stderr drain should be present")
            .join()
            .expect("stderr drain should finish");
        Finished { status, stderr }
    }
}

impl Drop for Harness {
    fn drop(&mut self) {
        if self.child.try_wait().ok().flatten().is_none() {
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
        if let Some(stderr) = self.stderr.take() {
            let _ = stderr.join();
        }
    }
}

fn drain_stderr(mut stderr: ChildStderr) -> Vec<u8> {
    let mut captured = Vec::new();
    let mut buffer = [0_u8; 1024];
    loop {
        match stderr.read(&mut buffer) {
            Ok(0) | Err(_) => break,
            Ok(read) => {
                let remaining = STDERR_CAPTURE_LIMIT.saturating_sub(captured.len());
                captured.extend_from_slice(&buffer[..read.min(remaining)]);
            }
        }
    }
    captured
}

fn platform() -> &'static str {
    if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else {
        "linux"
    }
}

fn fresh_root(label: &str) -> PathBuf {
    let root = std::env::temp_dir().join(format!(
        "colony-b2a-{label}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock should be after epoch")
            .as_nanos()
    ));
    assert!(!root.exists());
    root
}

fn assert_stderr_safe(stderr: &[u8]) {
    assert!(stderr.len() <= STDERR_CAPTURE_LIMIT);
    let text = String::from_utf8_lossy(stderr);
    assert!(!text.contains("@colony-native:"));
    assert!(!text.contains(PROFILE_ID));
    assert!(!text.contains("identity-v2-contract"));
    assert!(!text.contains("userDataRoot"));
    // B1 currently emits a public-key diagnostic during its preserved
    // initialization path. Reject private-key material and raw custody data,
    // while keeping that existing public metadata behavior visible.
    assert!(!text.contains("nsec"));
    assert!(!text.contains("private"));
    assert!(!text.contains("secret"));
    assert!(!text.contains("key material"));
    assert!(!text.contains("backend"));
}

fn cancel(request_id: &str, generation: u64) -> Value {
    json!({
        "type": "CANCEL",
        "protocolVersion": 2,
        "profileId": PROFILE_ID,
        "sessionId": SESSION_ID,
        "generationId": generation,
        "requestId": request_id,
        "registryDigest": REGISTRY_DIGEST
    })
}

fn hello(root: &PathBuf) -> Value {
    json!({
        "type": "HELLO",
        "protocolVersion": 2,
        "profileId": PROFILE_ID,
        "sessionId": SESSION_ID,
        "generationId": 1,
        "buildId": "identity-v2-contract",
        "registryDigest": REGISTRY_DIGEST,
        "identityLaunch": {
            "profileId": PROFILE_ID,
            "flavor": "test",
            "platform": platform(),
            "userDataRoot": root,
            "identityMode": "explicit",
            "sharedIdentity": false,
            "resetProvenance": "not_attempted_fresh"
        }
    })
}

fn rehello(generation: u64) -> Value {
    json!({
        "type": "REHELLO",
        "protocolVersion": 2,
        "profileId": PROFILE_ID,
        "sessionId": SESSION_ID,
        "generationId": generation,
        "buildId": "identity-v2-contract",
        "registryDigest": REGISTRY_DIGEST
    })
}

fn request(request_id: &str, generation: u64, capability: &str, method: &str) -> Value {
    json!({
        "type": "REQUEST",
        "protocolVersion": 2,
        "profileId": PROFILE_ID,
        "sessionId": SESSION_ID,
        "generationId": generation,
        "requestId": request_id,
        "capability": capability,
        "method": method,
        "payload": {},
        "registryDigest": REGISTRY_DIGEST
    })
}

fn bind(host: &mut Harness, root: &PathBuf) {
    host.send(hello(root)).expect("v2 HELLO should be framed");
    let ready = host.read_value();
    assert_eq!(ready["type"], "READY");
    assert_eq!(ready["protocolVersion"], 2);
    assert_eq!(ready["registryDigest"], REGISTRY_DIGEST);
    assert_eq!(
        ready["payload"]["capabilities"],
        json!(["health-safe", "identity-mode", "identity-read"])
    );
    let event = host.read_value();
    assert_eq!(event["type"], "EVENT");
    assert_eq!(event["payload"]["state"], "ready");
    assert_eq!(event["event"], "host_lifecycle");
    assert_eq!(event["sequence"], 1);
    assert_eq!(event["registryDigest"], REGISTRY_DIGEST);
}

#[test]
fn v2_initializes_file_only_identity_named_metadata_rebinds_and_restarts() {
    let root = fresh_root("lifecycle");
    let mut host = Harness::spawn();
    bind(&mut host, &root);

    host.send(request("mode-1", 1, "identity-mode", "is_shared_identity"))
        .expect("mode request should be framed");
    assert_eq!(host.read_value()["payload"]["value"], false);

    host.send(request("identity-1", 1, "identity-read", "get_identity"))
        .expect("identity request should be framed");
    let first = host.read_value();
    let first_pubkey = first["payload"]["pubkey"]
        .as_str()
        .expect("pubkey should be public metadata")
        .to_string();
    assert!(!first_pubkey.is_empty());
    assert_eq!(first["payload"]["reset_failed"], false);
    assert!(first["payload"].get("nsec").is_none());

    host.send(request(
        "health-1",
        1,
        "health-safe",
        "get_default_relay_url",
    ))
    .expect("health request should be framed");
    assert_eq!(host.read_value()["outcome"], "ok");

    host.send(rehello(2)).expect("rebind should be framed");
    assert_eq!(host.read_value()["type"], "REBOUND");
    assert_eq!(host.read_value()["payload"]["state"], "rebound");
    host.send(request("identity-2", 2, "identity-read", "get_identity"))
        .expect("post-rebind identity request should be framed");
    assert_eq!(host.read_value()["payload"]["pubkey"], first_pubkey);
    assert!(host.finish().success());

    let mut restarted = Harness::spawn();
    bind(&mut restarted, &root);
    restarted
        .send(request(
            "identity-restart",
            1,
            "identity-read",
            "get_identity",
        ))
        .expect("restart identity request should be framed");
    assert_eq!(restarted.read_value()["payload"]["pubkey"], first_pubkey);
    assert!(restarted.finish().success());
    fs::remove_dir_all(root).expect("synthetic profile should be removable");
}

#[test]
fn v2_delayed_request_times_out_once_without_a_late_result() {
    let root = fresh_root("timeout");
    let mut host = Harness::spawn_with(Some("delay-response"), Some(25));
    bind(&mut host, &root);

    host.send(request(
        "delayed-1",
        1,
        "health-safe",
        "get_default_relay_url",
    ))
    .expect("delayed request should be framed");
    let timeout = host.read_value();
    assert_eq!(timeout["requestId"], "delayed-1");
    assert_eq!(timeout["outcome"], "error");
    assert_eq!(timeout["error"]["code"], "timeout");

    host.send(request(
        "after-timeout",
        1,
        "health-safe",
        "get_default_relay_url",
    ))
    .expect("post-timeout request should be framed");
    let after = host.read_value();
    assert_eq!(after["requestId"], "after-timeout");
    assert_eq!(after["outcome"], "ok");

    let finished = host.finish_with_stderr();
    assert!(finished.status.success());
    assert_stderr_safe(&finished.stderr);
    fs::remove_dir_all(root).expect("synthetic profile should be removable");
}

#[test]
fn v2_rebind_fences_pending_work_and_allows_generation_two_metadata() {
    let root = fresh_root("rebind-pending");
    let mut host = Harness::spawn_with(Some("delay-response"), None);
    bind(&mut host, &root);
    host.send(request(
        "pending-before-rebind",
        1,
        "health-safe",
        "get_default_relay_url",
    ))
    .expect("pending request should be framed");
    host.send(rehello(2)).expect("rebind should be framed");

    let terminal = host.read_value();
    assert_eq!(terminal["requestId"], "pending-before-rebind");
    assert_eq!(terminal["generationId"], 1);
    assert_eq!(terminal["outcome"], "outcome_unknown");
    assert_eq!(terminal["error"]["code"], "renderer_rebound");

    let rebound = host.read_value();
    assert_eq!(rebound["type"], "REBOUND");
    assert_eq!(rebound["generationId"], 2);
    let lifecycle = host.read_value();
    assert_eq!(lifecycle["type"], "EVENT");
    assert_eq!(lifecycle["generationId"], 2);
    assert_eq!(lifecycle["payload"]["state"], "rebound");
    assert_eq!(lifecycle["event"], "host_lifecycle");

    host.send(request(
        "generation-two",
        2,
        "identity-read",
        "get_identity",
    ))
    .expect("generation-two metadata request should be framed");
    let metadata = host.read_value();
    assert_eq!(metadata["requestId"], "generation-two");
    assert_eq!(metadata["generationId"], 2);
    assert_eq!(metadata["outcome"], "ok");
    assert!(metadata["payload"]["pubkey"].as_str().is_some());

    let finished = host.finish_with_stderr();
    assert!(finished.status.success());
    assert_stderr_safe(&finished.stderr);
    fs::remove_dir_all(root).expect("synthetic profile should be removable");
}

#[test]
fn v2_cancel_duplicate_and_generation_fences_are_terminal_and_bounded() {
    let root = fresh_root("ids");
    let mut host = Harness::spawn_with(Some("delay-response"), None);
    bind(&mut host, &root);

    host.send(request(
        "cancel-me",
        1,
        "health-safe",
        "get_default_relay_url",
    ))
    .expect("cancelled request should be framed");
    host.send(cancel("cancel-me", 1))
        .expect("cancel should be framed");
    let cancelled = host.read_value();
    assert_eq!(cancelled["requestId"], "cancel-me");
    assert_eq!(cancelled["outcome"], "cancelled");
    assert_eq!(cancelled["error"]["code"], "cancelled");

    host.send(request(
        "duplicate-id",
        1,
        "health-safe",
        "get_default_relay_url",
    ))
    .expect("first duplicate candidate should be framed");
    assert_eq!(host.read_value()["outcome"], "ok");
    host.send(request(
        "duplicate-id",
        1,
        "health-safe",
        "get_default_relay_url",
    ))
    .expect("duplicate request should be framed");
    let duplicate = host.read_value();
    assert_eq!(duplicate["outcome"], "error");
    assert_eq!(duplicate["error"]["code"], "duplicate_request_id");

    host.send(rehello(2)).expect("rebind should be framed");
    assert_eq!(host.read_value()["type"], "REBOUND");
    assert_eq!(host.read_value()["payload"]["state"], "rebound");

    host.send(request(
        "stale-id",
        1,
        "health-safe",
        "get_default_relay_url",
    ))
    .expect("stale request should be framed");
    let stale = host.read_value();
    assert_eq!(stale["error"]["code"], "stale_generation");
    host.send(request(
        "future-id",
        3,
        "health-safe",
        "get_default_relay_url",
    ))
    .expect("future request should be framed");
    let future = host.read_value();
    assert_eq!(future["error"]["code"], "future_generation");

    let finished = host.finish_with_stderr();
    assert!(finished.status.success());
    assert_stderr_safe(&finished.stderr);
    fs::remove_dir_all(root).expect("synthetic profile should be removable");
}

#[test]
fn v2_parser_and_inflight_limits_fail_closed_with_bounded_errors() {
    let mut oversized = Harness::spawn();
    oversized
        .send_raw(&vec![b'0'; 8_388_609])
        .expect("oversized frame should be writable");
    let oversized_result = oversized.finish_with_stderr();
    assert!(!oversized_result.status.success());
    assert_stderr_safe(&oversized_result.stderr);
    assert!(String::from_utf8_lossy(&oversized_result.stderr).contains("json_too_large"));

    let mut deep = Harness::spawn();
    let deep_json = format!("{}0{}", "[".repeat(33), "]".repeat(33));
    deep.send_raw(deep_json.as_bytes())
        .expect("deep frame should be writable");
    let deep_result = deep.finish_with_stderr();
    assert!(!deep_result.status.success());
    assert_stderr_safe(&deep_result.stderr);
    assert!(String::from_utf8_lossy(&deep_result.stderr).contains("json_too_deep"));

    let root = fresh_root("inflight");
    let mut host = Harness::spawn_with(Some("hold-responses"), Some(10_000));
    bind(&mut host, &root);
    let request_ids = (0..128)
        .map(|index| format!("inflight-{index}"))
        .collect::<Vec<_>>();
    for request_id in &request_ids {
        host.send(request(
            request_id,
            1,
            "health-safe",
            "get_default_relay_url",
        ))
        .expect("in-flight request should be framed");
    }
    host.send(request(
        "inflight-over-limit",
        1,
        "health-safe",
        "get_default_relay_url",
    ))
    .expect("over-limit request should be framed");
    let busy = host.read_value();
    assert_eq!(busy["requestId"], "inflight-over-limit");
    assert_eq!(busy["error"]["code"], "host_busy");

    for request_id in request_ids {
        host.send(cancel(&request_id, 1))
            .expect("in-flight cancellation should be framed");
        let cancelled = host.read_value();
        assert_eq!(cancelled["requestId"], request_id);
        assert_eq!(cancelled["error"]["code"], "cancelled");
    }
    let finished = host.finish_with_stderr();
    assert!(finished.status.success());
    assert_stderr_safe(&finished.stderr);
    fs::remove_dir_all(root).expect("synthetic profile should be removable");
}

#[test]
fn invalid_descriptor_fails_before_profile_creation() {
    let root = fresh_root("invalid");
    let mut frame = hello(&root);
    frame["identityLaunch"]["sharedIdentity"] = json!(true);
    let mut host = Harness::spawn();
    host.send(frame)
        .expect("invalid descriptor should be framed");
    let finished = host.finish_with_stderr();
    assert!(!finished.status.success());
    assert_stderr_safe(&finished.stderr);
    assert!(String::from_utf8_lossy(&finished.stderr).contains("identity_descriptor_rejected"));
    assert!(
        !root.exists(),
        "rejected descriptor must not create a profile"
    );
}

#[test]
fn strict_v2_rejects_unknown_duplicate_mixed_and_wrong_digest_frames() {
    let root = fresh_root("strict");
    let mut unknown = serde_json::to_vec(&hello(&root)).expect("HELLO serializes");
    unknown.pop();
    unknown.extend_from_slice(b",\"unexpected\":true}");
    let mut host = Harness::spawn();
    host.send_raw(&unknown)
        .expect("unknown field should be framed");
    let finished = host.finish_with_stderr();
    assert!(!finished.status.success());
    assert_stderr_safe(&finished.stderr);
    assert!(String::from_utf8_lossy(&finished.stderr).contains("invalid_json"));

    let mut duplicate = Harness::spawn();
    duplicate
        .send_raw(br#"{"type":"HELLO","protocolVersion":2,"protocolVersion":2}"#)
        .expect("duplicate field should be framed");
    let finished = duplicate.finish_with_stderr();
    assert!(!finished.status.success());
    assert_stderr_safe(&finished.stderr);
    assert!(String::from_utf8_lossy(&finished.stderr).contains("invalid_json"));

    let mut mixed = Harness::spawn();
    let mut mixed_bytes = serde_json::to_vec(&hello(&root)).expect("HELLO serializes");
    mixed_bytes.pop();
    mixed_bytes.extend_from_slice(b",\"protocolVersion\":1}");
    mixed
        .send_raw(&mixed_bytes)
        .expect("mixed version should frame");
    let finished = mixed.finish_with_stderr();
    assert!(!finished.status.success());
    assert_stderr_safe(&finished.stderr);
    assert!(String::from_utf8_lossy(&finished.stderr).contains("invalid_json"));

    let mut wrong_digest = hello(&root);
    wrong_digest["registryDigest"] = json!("0".repeat(64));
    let mut wrong = Harness::spawn();
    wrong
        .send(wrong_digest)
        .expect("wrong digest should be framed");
    let finished = wrong.finish_with_stderr();
    assert!(!finished.status.success());
    assert_stderr_safe(&finished.stderr);
    assert!(String::from_utf8_lossy(&finished.stderr).contains("registry_mismatch"));
    let _ = fs::remove_dir_all(root);
}

#[test]
fn v1_health_launch_remains_the_default_even_when_identity_is_compiled() {
    let mut command = Command::new(env!("CARGO_BIN_EXE_colony-native-host"));
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .env_remove("BUZZ_RELAY_URL")
        .env_remove("COLONY_STAGE0_FAULT")
        .env_remove("COLONY_STAGE0_TEST_DEADLINE_MS");
    let mut child = command.spawn().expect("host process should spawn");
    let mut stdin = child.stdin.take().expect("host stdin should be piped");
    let mut stdout = BufReader::new(child.stdout.take().expect("host stdout should be piped"));
    let frame = json!({
        "type": "HELLO",
        "protocolVersion": 1,
        "profileId": "0000000000000001",
        "sessionId": "v1-default",
        "generationId": 1,
        "buildId": "v1-contract"
    });
    stdin.write_all(PREFIX.as_bytes()).expect("prefix writes");
    stdin
        .write_all(&serde_json::to_vec(&frame).expect("frame serializes"))
        .expect("frame writes");
    stdin.write_all(b"\n").expect("newline writes");
    stdin.flush().expect("frame flushes");
    let mut line = Vec::new();
    stdout
        .read_until(b'\n', &mut line)
        .expect("READY should be readable");
    assert!(line.starts_with(PREFIX.as_bytes()));
    let ready: Value =
        serde_json::from_slice(&line[PREFIX.len()..line.len() - 1]).expect("READY should be JSON");
    assert_eq!(ready["protocolVersion"], 1);
    let mut lifecycle = Vec::new();
    stdout
        .read_until(b'\n', &mut lifecycle)
        .expect("lifecycle should be readable");
    drop(stdin);
    let status = child.wait().expect("host should exit");
    assert!(status.success());
}
