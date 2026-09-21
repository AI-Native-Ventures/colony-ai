#![cfg(feature = "identity-system-keyring")]

use std::{
    fs,
    io::Write,
    path::PathBuf,
    process::{Command, Stdio},
    time::{SystemTime, UNIX_EPOCH},
};

use serde_json::{json, Value};

const PREFIX: &str = "@colony-native:";
const PRODUCTION_REGISTRY_DIGEST: &str =
    "452990462a124746a15d6ba7cdd0353e0183e7a3aa300e5b8b596e0439692204";
const PRODUCTION_MANIFEST_DIGEST: &str =
    "ff46bc9729c8e3dce602d5e1effb84d5aa6fff0b00231404c340b8e61aaa1e3d";
const PRODUCTION_PROFILE_ID: &str = "0000000000000001";

fn platform() -> &'static str {
    if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else {
        "linux"
    }
}

fn binary_path() -> PathBuf {
    std::env::var_os("COLONY_NATIVE_HOST_BIN")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_BIN_EXE_colony-native-host")))
}

fn wrong_anchor_root() -> (PathBuf, PathBuf) {
    let base = std::env::temp_dir().join(format!(
        "colony-production-wrong-anchor-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be after epoch")
            .as_nanos()
    ));
    let root = base
        .join("Colony")
        .join("dev")
        .join(PRODUCTION_PROFILE_ID)
        .join("normal");
    (base, root)
}

fn production_hello(root: &PathBuf) -> Value {
    json!({
        "type": "HELLO",
        "protocolVersion": 2,
        "profileId": PRODUCTION_PROFILE_ID,
        "sessionId": "production-dispatch",
        "generationId": 1,
        "buildId": "identity-production-dispatch",
        "registryDigest": PRODUCTION_REGISTRY_DIGEST,
        "identityLaunch": {
            "profileId": PRODUCTION_PROFILE_ID,
            "flavor": "normal",
            "platform": platform(),
            "userDataRoot": root,
            "identityMode": "explicit",
            "sharedIdentity": false,
            "resetProvenance": "not_attempted_fresh",
            "identityManifestDigest": PRODUCTION_MANIFEST_DIGEST
        }
    })
}

#[cfg(target_os = "macos")]
fn production_request(request_id: &str, session_id: &str) -> Value {
    json!({
        "type": "REQUEST",
        "protocolVersion": 2,
        "profileId": PRODUCTION_PROFILE_ID,
        "sessionId": session_id,
        "generationId": 1,
        "requestId": request_id,
        "capability": "identity-read",
        "method": "get_identity",
        "payload": {},
        "registryDigest": PRODUCTION_REGISTRY_DIGEST
    })
}

#[cfg(target_os = "macos")]
fn append_frame(buffer: &mut Vec<u8>, value: &Value) {
    buffer.extend_from_slice(PREFIX.as_bytes());
    buffer.extend_from_slice(&serde_json::to_vec(value).expect("frame serializes"));
    buffer.push(b'\n');
}

#[cfg(target_os = "macos")]
fn parse_frames(stdout: &[u8]) -> Vec<Value> {
    stdout
        .split(|byte| *byte == b'\n')
        .filter(|line| !line.is_empty())
        .map(|line| {
            assert!(line.starts_with(PREFIX.as_bytes()));
            serde_json::from_slice(&line[PREFIX.len()..]).expect("host frame parses")
        })
        .collect()
}

#[cfg(target_os = "macos")]
fn macos_production_root() -> PathBuf {
    PathBuf::from(
        std::env::var_os("COLONY_IDENTITY_PROOF_HOME")
            .or_else(|| std::env::var_os("HOME"))
            .expect("hosted proof supplies an isolated app-data home"),
    )
    .join("Library")
    .join("Application Support")
    .join("Colony")
    .join("dev")
    .join(PRODUCTION_PROFILE_ID)
    .join("normal")
}

#[cfg(target_os = "macos")]
fn run_production_child(
    root: &PathBuf,
    session_id: &str,
    request_id: &str,
) -> (bool, Vec<Value>, Vec<u8>) {
    let mut child = Command::new(binary_path())
        .arg("--identity-v2")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env_remove("COLONY_STAGE0_FAULT")
        .env_remove("COLONY_STAGE0_TEST_DEADLINE_MS")
        .env(
            "HOME",
            std::env::var_os("COLONY_IDENTITY_PROOF_HOME")
                .or_else(|| std::env::var_os("HOME"))
                .expect("hosted proof supplies an isolated app-data home"),
        )
        .spawn()
        .expect("production host should spawn");
    let mut input = Vec::new();
    let mut hello = production_hello(root);
    hello["sessionId"] = json!(session_id);
    append_frame(&mut input, &hello);
    append_frame(&mut input, &production_request(request_id, session_id));
    child
        .stdin
        .take()
        .expect("host stdin should be piped")
        .write_all(&input)
        .expect("host frames should write");
    let output = child
        .wait_with_output()
        .expect("production host should exit");
    (
        output.status.success(),
        parse_frames(&output.stdout),
        output.stderr,
    )
}

#[test]
fn production_binary_rejects_wrong_anchor_before_identity_side_effects() {
    for fault in ["exit-before-ready", "malformed-frame", "delay-response"] {
        let (base, root) = wrong_anchor_root();
        assert!(!base.exists());
        let mut child = Command::new(binary_path())
            .arg("--identity-v2")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .env_remove("BUZZ_RELAY_URL")
            .env("COLONY_STAGE0_FAULT", fault)
            .env("COLONY_STAGE0_TEST_DEADLINE_MS", "1")
            .spawn()
            .expect("production host should spawn");
        let frame = serde_json::to_vec(&production_hello(&root)).expect("HELLO serializes");
        let mut stdin = child.stdin.take().expect("host stdin should be piped");
        stdin.write_all(PREFIX.as_bytes()).expect("prefix writes");
        stdin.write_all(&frame).expect("frame writes");
        stdin.write_all(b"\n").expect("newline writes");
        stdin.flush().expect("frame flushes");
        drop(stdin);

        let output = child
            .wait_with_output()
            .expect("production host should exit");
        assert!(!output.status.success());
        assert!(output.stderr.len() <= 16 * 1024);
        let stderr = String::from_utf8_lossy(&output.stderr);
        let expected_error = if cfg!(target_os = "macos") {
            "identity_descriptor_rejected"
        } else {
            "identity_unavailable"
        };
        assert!(stderr.contains(expected_error), "{stderr}");
        assert!(!stderr.contains("private"));
        assert!(!stderr.contains("secret"));
        assert!(!base.exists(), "wrong anchor must not create a profile");
    }
}

#[cfg(target_os = "macos")]
#[test]
#[ignore = "writes only the disposable hosted test keychain; never run against a personal keychain"]
fn macos_production_binary_initializes_and_restarts_with_same_key() {
    let root = macos_production_root();
    assert!(
        !root.exists(),
        "hosted proof must start with an empty profile root"
    );

    let (first_success, first_frames, first_stderr) =
        run_production_child(&root, "macos-production-first", "identity-first");
    assert!(
        first_success,
        "first child failed: {}",
        String::from_utf8_lossy(&first_stderr)
    );
    assert!(first_stderr.len() <= 16 * 1024);
    assert!(first_frames.iter().any(|frame| frame["type"] == "READY"));
    assert!(first_frames
        .iter()
        .any(|frame| { frame["type"] == "EVENT" && frame["payload"]["state"] == "ready" }));
    let first_identity = first_frames
        .iter()
        .find(|frame| frame["type"] == "RESPONSE" && frame["requestId"] == "identity-first")
        .expect("first child should return identity metadata");
    assert_eq!(first_identity["outcome"], "ok");
    assert_eq!(first_identity["payload"]["storage"], "system-keyring");
    assert_eq!(first_identity["payload"]["lost"], false);
    assert_eq!(first_identity["payload"]["locked"], false);
    assert_eq!(first_identity["payload"]["reset_failed"], false);
    let first_pubkey = first_identity["payload"]["pubkey"]
        .as_str()
        .expect("first pubkey is public metadata")
        .to_string();

    let sidecar = root
        .parent()
        .expect("profile root has ownership parent")
        .join(format!(
            ".{PRODUCTION_PROFILE_ID}.identity-ownership-v1.json"
        ));
    let sidecar_text = fs::read_to_string(&sidecar).expect("initialized sidecar should exist");
    let sidecar_json: Value = serde_json::from_str(&sidecar_text).expect("sidecar is JSON");
    assert_eq!(sidecar_json["state"], "initialized");
    assert_eq!(
        sidecar_json["storage"]["lastDurableStorage"],
        "system-keyring"
    );
    assert!(!sidecar_text.contains("nsec"));
    assert!(!sidecar_text.contains("private"));

    let (restart_success, restart_frames, restart_stderr) =
        run_production_child(&root, "macos-production-restart", "identity-restart");
    assert!(
        restart_success,
        "restart child failed: {}",
        String::from_utf8_lossy(&restart_stderr)
    );
    assert!(restart_frames.iter().any(|frame| frame["type"] == "READY"));
    let restart_identity = restart_frames
        .iter()
        .find(|frame| frame["type"] == "RESPONSE" && frame["requestId"] == "identity-restart")
        .expect("restart child should return identity metadata");
    assert_eq!(restart_identity["payload"]["storage"], "system-keyring");
    assert_eq!(restart_identity["payload"]["pubkey"], first_pubkey);
    assert_eq!(restart_identity["payload"]["lost"], false);
    assert_eq!(restart_identity["payload"]["locked"], false);
    assert_eq!(restart_identity["payload"]["reset_failed"], false);
}

#[cfg(target_os = "macos")]
#[test]
#[ignore = "uses only the disposable hosted keychain configured by the macOS workflow"]
fn macos_production_binary_serializes_two_fresh_children() {
    let root = macos_production_root();
    assert!(
        !root.exists(),
        "race proof must start with an empty profile root"
    );

    let first = std::thread::spawn({
        let root = root.clone();
        move || run_production_child(&root, "macos-production-race-a", "identity-race-a")
    });
    let second = std::thread::spawn({
        let root = root.clone();
        move || run_production_child(&root, "macos-production-race-b", "identity-race-b")
    });
    let (first_success, first_frames, first_stderr) = first.join().expect("first child joins");
    let (second_success, second_frames, second_stderr) = second.join().expect("second child joins");
    assert!(
        first_success,
        "first race child failed: {}",
        String::from_utf8_lossy(&first_stderr)
    );
    assert!(
        second_success,
        "second race child failed: {}",
        String::from_utf8_lossy(&second_stderr)
    );
    let first_pubkey = first_frames
        .iter()
        .find(|frame| frame["type"] == "RESPONSE" && frame["requestId"] == "identity-race-a")
        .and_then(|frame| frame["payload"]["pubkey"].as_str())
        .expect("first race child returns metadata");
    let second_pubkey = second_frames
        .iter()
        .find(|frame| frame["type"] == "RESPONSE" && frame["requestId"] == "identity-race-b")
        .and_then(|frame| frame["payload"]["pubkey"].as_str())
        .expect("second race child returns metadata");
    assert_eq!(first_pubkey, second_pubkey);
}

#[cfg(target_os = "macos")]
#[test]
#[ignore = "uses only the disposable hosted keychain configured by the macOS workflow"]
fn macos_production_reserved_sidecar_blocks_before_b1() {
    let root = macos_production_root();
    assert!(
        !root.exists(),
        "reserved proof must start with an empty profile root"
    );
    let (success, _, stderr) =
        run_production_child(&root, "macos-production-reserve", "identity-reserve");
    assert!(
        success,
        "setup child failed: {}",
        String::from_utf8_lossy(&stderr)
    );

    let sidecar = root
        .parent()
        .expect("profile root has ownership parent")
        .join(format!(
            ".{PRODUCTION_PROFILE_ID}.identity-ownership-v1.json"
        ));
    let mut sidecar_json: Value =
        serde_json::from_str(&fs::read_to_string(&sidecar).expect("sidecar should exist"))
            .expect("sidecar is JSON");
    sidecar_json["state"] = json!("reserved");
    sidecar_json["storage"]["lastDurableStorage"] = json!("none");
    fs::write(
        &sidecar,
        serde_json::to_vec(&sidecar_json).expect("reserved sidecar serializes"),
    )
    .expect("reserved sidecar should be writable");
    let before = fs::read(&sidecar).expect("reserved sidecar should be readable");

    let (restart_success, restart_frames, restart_stderr) =
        run_production_child(&root, "macos-production-reserved", "identity-reserved");
    assert!(!restart_success);
    assert!(restart_frames.iter().all(|frame| frame["type"] != "READY"));
    assert!(String::from_utf8_lossy(&restart_stderr).contains("identity_namespace_unverified"));
    assert_eq!(
        fs::read(&sidecar).expect("reserved sidecar remains"),
        before
    );
    assert!(
        root.exists(),
        "reserved proof must not delete the profile root"
    );
}
