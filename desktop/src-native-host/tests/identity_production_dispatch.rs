#![cfg(feature = "identity-system-keyring")]

use std::{
    fs,
    io::Write,
    path::PathBuf,
    process::{Command, Stdio},
    time::{SystemTime, UNIX_EPOCH},
};

#[cfg(target_os = "macos")]
use std::{
    path::Path,
    thread,
    time::{Duration, Instant},
};

use serde_json::{json, Value};

const PREFIX: &str = "@colony-native:";
const PRODUCTION_REGISTRY_DIGEST: &str =
    "452990462a124746a15d6ba7cdd0353e0183e7a3aa300e5b8b596e0439692204";
const PRODUCTION_MANIFEST_DIGEST: &str =
    "ff46bc9729c8e3dce602d5e1effb84d5aa6fff0b00231404c340b8e61aaa1e3d";
const PRODUCTION_PROFILE_ID: &str = "0000000000000001";
#[cfg(target_os = "macos")]
const PRODUCTION_KEYCHAIN_SERVICE: &str = "xyz.ainative.ventures.colony.dev.0000000000000001";

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
        // The workflow configures the disposable User-domain default inside
        // this same isolated HOME. This keeps the production app-data anchor,
        // Security.framework preferences, and keychain selection aligned
        // without adding a production-only keychain override.
        .env(
            "HOME",
            std::env::var_os("COLONY_IDENTITY_PROOF_HOME")
                .expect("hosted proof supplies an isolated keychain home"),
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

#[cfg(target_os = "macos")]
fn crash_binary_path() -> PathBuf {
    std::env::var_os("COLONY_IDENTITY_CRASH_BIN")
        .map(PathBuf::from)
        .expect("hosted proof supplies the crash-test carrier")
}

#[cfg(target_os = "macos")]
fn kill_production_child_at_stage(
    root: &Path,
    crash_arg: &str,
    ready_path: &Path,
    session_id: &str,
    request_id: &str,
) -> (bool, Vec<Value>, Vec<u8>) {
    let mut child = Command::new(crash_binary_path())
        .arg("--identity-v2")
        .arg(crash_arg)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env_remove("COLONY_STAGE0_FAULT")
        .env_remove("COLONY_STAGE0_TEST_DEADLINE_MS")
        .env(
            "HOME",
            std::env::var_os("COLONY_IDENTITY_PROOF_HOME")
                .expect("hosted proof supplies an isolated keychain home"),
        )
        .env("COLONY_IDENTITY_CRASH_READY_PATH", ready_path)
        .spawn()
        .expect("crash-test host should spawn");
    let mut input = Vec::new();
    let mut hello = production_hello(&root.to_path_buf());
    hello["sessionId"] = json!(session_id);
    append_frame(&mut input, &hello);
    append_frame(&mut input, &production_request(request_id, session_id));
    child
        .stdin
        .take()
        .expect("crash-test host stdin should be piped")
        .write_all(&input)
        .expect("crash-test host frames should write");

    let deadline = Instant::now() + Duration::from_secs(5);
    while !ready_path.exists() && Instant::now() < deadline {
        thread::sleep(Duration::from_millis(20));
    }
    if !ready_path.exists() {
        let _ = child.kill();
        let output = child
            .wait_with_output()
            .expect("crash-test host should exit after readiness timeout");
        panic!(
            "crash-test host did not reach {}: {}",
            crash_arg,
            sanitized_diagnostic(&output.stderr)
        );
    }

    child.kill().expect("crash-test child should be killable");
    let output = child
        .wait_with_output()
        .expect("crash-test child should exit after kill");
    (
        output.status.success(),
        parse_frames(&output.stdout),
        output.stderr,
    )
}

#[cfg(target_os = "macos")]
fn crash_ready_path(stage: &str) -> PathBuf {
    std::env::temp_dir().join(format!(
        "colony-identity-crash-{stage}-{}-{}.ready",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be after epoch")
            .as_nanos()
    ))
}

#[cfg(target_os = "macos")]
fn sanitized_diagnostic(stderr: &[u8]) -> String {
    if stderr.len() > 16 * 1024 {
        return "diagnostic=unavailable".to_string();
    }
    let text = String::from_utf8_lossy(stderr);
    for line in text.lines() {
        let Some(fields) = line.strip_prefix("identity_diagnostic ") else {
            continue;
        };
        let mut values = [None; 7];
        for field in fields.split_whitespace() {
            let Some((name, value)) = field.split_once('=') else {
                values = [None; 7];
                break;
            };
            let index = match name {
                "probe" => 0,
                "write" => 1,
                "readback" => 2,
                "marker" => 3,
                "failure" => 4,
                "backend" => 5,
                "status" => 6,
                _ => {
                    values = [None; 7];
                    break;
                }
            };
            if values[index].is_some() {
                values = [None; 7];
                break;
            }
            let allowed = match index {
                0 => matches!(
                    value,
                    "not_attempted"
                        | "missing"
                        | "present"
                        | "locked"
                        | "unavailable"
                        | "corrupt"
                        | "error"
                ),
                1 | 3 => matches!(value, "not_attempted" | "ok" | "error"),
                2 => matches!(
                    value,
                    "not_attempted"
                        | "exact"
                        | "missing"
                        | "mismatch"
                        | "locked"
                        | "unavailable"
                        | "corrupt"
                        | "error"
                ),
                4 => matches!(
                    value,
                    "none" | "probe" | "prewrite_read" | "write" | "readback" | "marker"
                ),
                5 => matches!(
                    value,
                    "not_attempted"
                        | "no_entry"
                        | "no_storage_access"
                        | "platform_failure"
                        | "other"
                ),
                6 => {
                    (value == "not_attempted" || value == "none")
                        || (value.len() <= 11 && value.parse::<i32>().is_ok())
                }
                _ => false,
            };
            if !allowed {
                values = [None; 7];
                break;
            }
            values[index] = Some(value);
        }
        if let [Some(probe), Some(write), Some(readback), Some(marker), Some(failure), Some(backend), Some(status)] =
            values
        {
            return format!(
                "diagnostic probe={probe} write={write} readback={readback} marker={marker} failure={failure} backend={backend} status={status}"
            );
        }
    }
    "diagnostic=unavailable".to_string()
}

fn contains_stable_error(stderr: &[u8], expected: &str) -> bool {
    String::from_utf8_lossy(stderr)
        .lines()
        .any(|line| line.contains(expected))
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
        let expected_error = if cfg!(any(target_os = "macos", target_os = "linux")) {
            "identity_descriptor_rejected"
        } else {
            "identity_unavailable"
        };
        assert!(
            contains_stable_error(&output.stderr, expected_error),
            "expected stable rejection code"
        );
        assert!(!contains_stable_error(&output.stderr, "private"));
        assert!(!contains_stable_error(&output.stderr, "secret"));
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
        sanitized_diagnostic(&first_stderr)
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
    assert_eq!(
        first_identity["payload"]["storage"],
        "system-keyring",
        "unexpected first storage; {}",
        sanitized_diagnostic(&first_stderr)
    );
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
        sanitized_diagnostic(&restart_stderr)
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
        sanitized_diagnostic(&first_stderr)
    );
    assert!(
        second_success,
        "second race child failed: {}",
        sanitized_diagnostic(&second_stderr)
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
        sanitized_diagnostic(&stderr)
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
    assert!(contains_stable_error(
        &restart_stderr,
        "identity_namespace_unverified"
    ));
    assert_eq!(
        fs::read(&sidecar).expect("reserved sidecar remains"),
        before
    );
    assert!(
        root.exists(),
        "reserved proof must not delete the profile root"
    );
}

#[cfg(target_os = "macos")]
#[test]
#[ignore = "kills only the dedicated hosted crash-test carrier and uses its disposable keychain"]
fn macos_production_process_kill_blocks_reserved_restarts() {
    let root = macos_production_root();
    let profile_parent = root.parent().expect("profile root has parent");
    assert!(
        !root.exists(),
        "crash proof must start with an empty profile root"
    );
    assert!(
        !profile_parent.exists(),
        "crash proof must start with an empty profile namespace"
    );

    let ready_after_reservation = crash_ready_path("after-reservation");
    let (first_success, first_frames, _first_stderr) = kill_production_child_at_stage(
        &root,
        "--identity-v2-crash-after-reservation",
        &ready_after_reservation,
        "macos-production-crash-reservation",
        "identity-crash-reservation",
    );
    assert!(!first_success);
    assert!(first_frames.is_empty());
    assert_eq!(
        fs::read_to_string(&ready_after_reservation).expect("reservation readiness marker"),
        "after-reservation"
    );
    assert!(
        !root.exists(),
        "reservation crash must precede B1 root creation"
    );
    let sidecar = profile_parent.join(format!(
        ".{PRODUCTION_PROFILE_ID}.identity-ownership-v1.json"
    ));
    let reserved_before_restart = fs::read(&sidecar).expect("reserved sidecar should exist");
    let reserved_json: Value =
        serde_json::from_slice(&reserved_before_restart).expect("reserved sidecar is JSON");
    assert_eq!(reserved_json["state"], "reserved");
    assert_eq!(reserved_json["storage"]["lastDurableStorage"], "none");

    let (restart_success, restart_frames, restart_stderr) = run_production_child(
        &root,
        "macos-production-crash-reservation-restart",
        "identity-crash-reservation-restart",
    );
    assert!(!restart_success);
    assert!(restart_frames.iter().all(|frame| frame["type"] != "READY"));
    assert!(contains_stable_error(
        &restart_stderr,
        "identity_namespace_unverified"
    ));
    assert_eq!(
        fs::read(&sidecar).expect("reserved sidecar remains"),
        reserved_before_restart
    );
    fs::remove_file(&ready_after_reservation).expect("reservation readiness marker cleanup");
    fs::remove_dir_all(profile_parent).expect("reserved profile namespace cleanup");

    let ready_after_b1 = crash_ready_path("after-b1");
    let (second_success, second_frames, second_stderr) = kill_production_child_at_stage(
        &root,
        "--identity-v2-crash-after-b1",
        &ready_after_b1,
        "macos-production-crash-b1",
        "identity-crash-b1",
    );
    assert!(!second_success);
    assert!(second_frames.is_empty());
    assert_eq!(
        fs::read_to_string(&ready_after_b1).expect("B1 readiness marker"),
        "after-b1"
    );
    assert!(root.exists(), "post-B1 crash must retain the profile root");
    let marker = root.join(colony_identity_kernel::migration_marker_name(
        PRODUCTION_KEYCHAIN_SERVICE,
        colony_identity_kernel::MIGRATION_MARKER_NAME,
    ));
    assert!(
        marker.exists(),
        "post-B1 crash must follow marker read-back"
    );
    let reserved_after_b1 = fs::read(&sidecar).expect("post-B1 reserved sidecar");
    let reserved_after_b1_json: Value =
        serde_json::from_slice(&reserved_after_b1).expect("post-B1 sidecar is JSON");
    assert_eq!(reserved_after_b1_json["state"], "reserved");
    assert_eq!(
        reserved_after_b1_json["storage"]["lastDurableStorage"],
        "none"
    );

    let (restart_success, restart_frames, restart_stderr) = run_production_child(
        &root,
        "macos-production-crash-b1-restart",
        "identity-crash-b1-restart",
    );
    assert!(!restart_success);
    assert!(restart_frames.iter().all(|frame| frame["type"] != "READY"));
    assert!(contains_stable_error(
        &restart_stderr,
        "identity_namespace_unverified"
    ));
    assert_eq!(
        fs::read(&sidecar).expect("post-B1 reserved sidecar remains"),
        reserved_after_b1
    );
    assert!(!second_stderr
        .windows(b"private".len())
        .any(|window| window.eq_ignore_ascii_case(b"private")));
    fs::remove_file(&ready_after_b1).expect("B1 readiness marker cleanup");
    fs::remove_dir_all(profile_parent).expect("post-B1 profile namespace cleanup");
}
