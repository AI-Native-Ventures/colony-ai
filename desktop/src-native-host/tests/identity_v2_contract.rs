#![cfg(feature = "identity-file-only")]

use std::{
    fs,
    io::{self, BufRead, BufReader, Read, Write},
    path::PathBuf,
    process::{Child, ChildStdin, Command, ExitStatus, Stdio},
};

use serde_json::{json, Value};

const PREFIX: &str = "@colony-native:";
const PROFILE_ID: &str = "colony-b2a-test-profile";
const SESSION_ID: &str = "identity-v2-session";
const REGISTRY_DIGEST: &str = "a7e63821a0e3fe9bd0e5d32428d12c521d39665dab9749c8d78bd7ba663e6394";

struct Harness {
    child: Child,
    stdin: Option<ChildStdin>,
    stdout: Option<BufReader<std::process::ChildStdout>>,
}

impl Harness {
    fn spawn() -> Self {
        let mut command = Command::new(env!("CARGO_BIN_EXE_colony-native-host"));
        command
            .arg("--identity-v2-test")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .env_remove("BUZZ_RELAY_URL")
            .env_remove("COLONY_STAGE0_FAULT")
            .env_remove("COLONY_STAGE0_TEST_DEADLINE_MS");
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
}

impl Drop for Harness {
    fn drop(&mut self) {
        if self.child.try_wait().ok().flatten().is_none() {
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
    }
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
fn invalid_descriptor_fails_before_profile_creation() {
    let root = fresh_root("invalid");
    let mut frame = hello(&root);
    frame["identityLaunch"]["sharedIdentity"] = json!(true);
    let mut host = Harness::spawn();
    host.send(frame)
        .expect("invalid descriptor should be framed");
    assert!(!host.finish().success());
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
    assert!(!host.finish().success());

    let mut duplicate = Harness::spawn();
    duplicate
        .send_raw(br#"{"type":"HELLO","protocolVersion":2,"protocolVersion":2}"#)
        .expect("duplicate field should be framed");
    assert!(!duplicate.finish().success());

    let mut mixed = Harness::spawn();
    let mut mixed_bytes = serde_json::to_vec(&hello(&root)).expect("HELLO serializes");
    mixed_bytes.pop();
    mixed_bytes.extend_from_slice(b",\"protocolVersion\":1}");
    mixed
        .send_raw(&mixed_bytes)
        .expect("mixed version should frame");
    assert!(!mixed.finish().success());

    let mut wrong_digest = hello(&root);
    wrong_digest["registryDigest"] = json!("0".repeat(64));
    let mut wrong = Harness::spawn();
    wrong
        .send(wrong_digest)
        .expect("wrong digest should be framed");
    assert!(!wrong.finish().success());
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
