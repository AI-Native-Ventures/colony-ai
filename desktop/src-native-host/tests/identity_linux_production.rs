#![cfg(all(feature = "identity-system-keyring", target_os = "linux"))]

use std::{
    collections::HashMap,
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Child, Command, Output, Stdio},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use dbus_secret_service::{EncryptionType, SecretService};
use serde_json::{json, Value};

const PREFIX: &str = "@colony-native:";
const PRODUCTION_REGISTRY_DIGEST: &str =
    "452990462a124746a15d6ba7cdd0353e0183e7a3aa300e5b8b596e0439692204";
const PRODUCTION_MANIFEST_DIGEST: &str =
    "ff46bc9729c8e3dce602d5e1effb84d5aa6fff0b00231404c340b8e61aaa1e3d";
const PRODUCTION_PROFILE_ID: &str = "0000000000000001";
const PRODUCTION_KEYCHAIN_SERVICE: &str = "xyz.ainative.ventures.colony.dev.0000000000000001";
const CHILD_TIMEOUT: Duration = Duration::from_secs(12);
const CRASH_READY_TIMEOUT: Duration = Duration::from_secs(8);

fn binary_path() -> PathBuf {
    std::env::var_os("COLONY_NATIVE_HOST_BIN")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_BIN_EXE_colony-native-host")))
}

fn crash_binary_path() -> PathBuf {
    std::env::var_os("COLONY_IDENTITY_CRASH_BIN")
        .map(PathBuf::from)
        .expect("hosted Linux proof supplies the crash-test carrier")
}

fn config_home() -> PathBuf {
    PathBuf::from(
        std::env::var_os("XDG_CONFIG_HOME")
            .expect("hosted Linux proof supplies an isolated XDG_CONFIG_HOME"),
    )
}

fn proof_home() -> PathBuf {
    PathBuf::from(
        std::env::var_os("COLONY_IDENTITY_PROOF_HOME")
            .expect("hosted Linux proof supplies an isolated HOME"),
    )
}

fn production_root() -> PathBuf {
    config_home()
        .join("Colony")
        .join("dev")
        .join(PRODUCTION_PROFILE_ID)
        .join("normal")
}

fn production_parent() -> PathBuf {
    production_root()
        .parent()
        .expect("production profile root has a parent")
        .to_path_buf()
}

fn sidecar_path() -> PathBuf {
    production_parent().join(format!(
        ".{PRODUCTION_PROFILE_ID}.identity-ownership-v1.json"
    ))
}

fn production_hello(root: &Path, session_id: &str) -> Value {
    json!({
        "type": "HELLO",
        "protocolVersion": 2,
        "profileId": PRODUCTION_PROFILE_ID,
        "sessionId": session_id,
        "generationId": 1,
        "buildId": "identity-linux-production",
        "registryDigest": PRODUCTION_REGISTRY_DIGEST,
        "identityLaunch": {
            "profileId": PRODUCTION_PROFILE_ID,
            "flavor": "normal",
            "platform": "linux",
            "userDataRoot": root,
            "identityMode": "explicit",
            "sharedIdentity": false,
            "resetProvenance": "not_attempted_fresh",
            "identityManifestDigest": PRODUCTION_MANIFEST_DIGEST
        }
    })
}

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

fn append_frame(buffer: &mut Vec<u8>, value: &Value) {
    buffer.extend_from_slice(PREFIX.as_bytes());
    buffer.extend_from_slice(&serde_json::to_vec(value).expect("frame serializes"));
    buffer.push(b'\n');
}

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

fn base_command(binary: PathBuf) -> Command {
    let mut command = Command::new(binary);
    command
        .arg("--identity-v2")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env_remove("COLONY_STAGE0_FAULT")
        .env_remove("COLONY_STAGE0_TEST_DEADLINE_MS")
        .env("HOME", proof_home())
        .env("XDG_CONFIG_HOME", config_home());
    command
}

fn write_input(child: &mut Child, root: &Path, session_id: &str, request_id: &str) {
    let mut input = Vec::new();
    append_frame(&mut input, &production_hello(root, session_id));
    append_frame(&mut input, &production_request(request_id, session_id));
    child
        .stdin
        .take()
        .expect("host stdin should be piped")
        .write_all(&input)
        .expect("host frames should write");
}

fn wait_bounded(mut child: Child, timeout: Duration) -> Output {
    let deadline = Instant::now() + timeout;
    loop {
        if let Some(status) = child.try_wait().expect("host wait should succeed") {
            let mut stdout = Vec::new();
            let mut stderr = Vec::new();
            if let Some(mut pipe) = child.stdout.take() {
                pipe.read_to_end(&mut stdout)
                    .expect("host stdout should be readable");
            }
            if let Some(mut pipe) = child.stderr.take() {
                pipe.read_to_end(&mut stderr)
                    .expect("host stderr should be readable");
            }
            return Output {
                status,
                stdout,
                stderr,
            };
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            panic!("Linux production child exceeded bounded timeout");
        }
        thread::sleep(Duration::from_millis(20));
    }
}

fn run_production_child(
    root: &Path,
    session_id: &str,
    request_id: &str,
) -> (bool, Vec<Value>, Vec<u8>) {
    run_child_with_binary(binary_path(), root, session_id, request_id, None)
}

fn run_child_with_binary(
    binary: PathBuf,
    root: &Path,
    session_id: &str,
    request_id: &str,
    dbus_address: Option<&str>,
) -> (bool, Vec<Value>, Vec<u8>) {
    let mut child = base_command(binary);
    match dbus_address {
        Some(address) => {
            child.env("DBUS_SESSION_BUS_ADDRESS", address);
        }
        None => {
            // The hosted proof intentionally inherits the disposable
            // dbus-run-session address, never a user session.
        }
    }
    let mut child = child.spawn().expect("Linux production host should spawn");
    write_input(&mut child, root, session_id, request_id);
    let output = wait_bounded(child, CHILD_TIMEOUT);
    (
        output.status.success(),
        parse_frames(&output.stdout),
        output.stderr,
    )
}

fn crash_ready_path(stage: &str) -> PathBuf {
    std::env::temp_dir().join(format!(
        "colony-linux-identity-crash-{stage}-{}-{}.ready",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be after epoch")
            .as_nanos()
    ))
}

fn kill_production_child_at_stage(
    root: &Path,
    crash_arg: &str,
    ready_path: &Path,
    session_id: &str,
    request_id: &str,
) -> (bool, Vec<Value>, Vec<u8>) {
    let mut child = base_command(crash_binary_path());
    child
        .arg(crash_arg)
        .env("COLONY_IDENTITY_CRASH_READY_PATH", ready_path);
    let mut child = child.spawn().expect("Linux crash-test host should spawn");
    write_input(&mut child, root, session_id, request_id);

    let deadline = Instant::now() + CRASH_READY_TIMEOUT;
    while !ready_path.exists() && Instant::now() < deadline {
        thread::sleep(Duration::from_millis(20));
    }
    if !ready_path.exists() {
        let _ = child.kill();
        let output = wait_bounded(child, CHILD_TIMEOUT);
        panic!(
            "Linux crash-test host did not reach {crash_arg}: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    child
        .kill()
        .expect("Linux crash-test child should be killable");
    let output = wait_bounded(child, CHILD_TIMEOUT);
    (
        output.status.success(),
        parse_frames(&output.stdout),
        output.stderr,
    )
}

fn assert_no_secret_output(stderr: &[u8]) {
    assert!(stderr.len() <= 16 * 1024);
    let text = String::from_utf8_lossy(stderr).to_ascii_lowercase();
    assert!(!text.contains("nsec1"), "private identity material leaked");
    assert!(
        !text.contains("private_key"),
        "private identity field leaked"
    );
}

fn assert_namespace_rejection(frames: &[Value], stderr: &[u8]) {
    assert!(frames.iter().all(|frame| frame["type"] != "READY"));
    let text = String::from_utf8_lossy(stderr);
    assert!(
        text.contains("identity_namespace_unverified") || text.contains("identity_unavailable"),
        "expected bounded identity rejection"
    );
    assert_no_secret_output(stderr);
}

fn identity_response<'a>(frames: &'a [Value], request_id: &str) -> &'a Value {
    frames
        .iter()
        .find(|frame| frame["type"] == "RESPONSE" && frame["requestId"] == request_id)
        .expect("identity request should produce a response")
}

fn initialize_and_assert_ready(request_id: &str) -> String {
    let root = production_root();
    assert!(
        !root.exists(),
        "Linux proof must start with an empty profile root"
    );
    let (success, frames, stderr) =
        run_production_child(&root, &format!("linux-production-{request_id}"), request_id);
    assert!(
        success,
        "first child failed: {}",
        String::from_utf8_lossy(&stderr)
    );
    assert!(frames.iter().any(|frame| frame["type"] == "READY"));
    let response = identity_response(&frames, request_id);
    assert_eq!(response["outcome"], "ok");
    assert_eq!(response["payload"]["storage"], "system-keyring");
    assert_eq!(response["payload"]["lost"], false);
    assert_eq!(response["payload"]["locked"], false);
    assert_eq!(response["payload"]["reset_failed"], false);
    assert_no_secret_output(&stderr);
    response["payload"]["pubkey"]
        .as_str()
        .expect("identity response includes public key")
        .to_string()
}

#[test]
#[ignore = "uses only the disposable hosted Secret Service session"]
fn linux_production_binary_initializes_and_restarts_with_same_key() {
    let first_pubkey = initialize_and_assert_ready("identity-first");
    let sidecar_text =
        fs::read_to_string(sidecar_path()).expect("initialized sidecar should exist");
    let sidecar: Value = serde_json::from_str(&sidecar_text).expect("sidecar is JSON");
    assert_eq!(sidecar["state"], "initialized");
    assert_eq!(sidecar["storage"]["lastDurableStorage"], "system-keyring");
    assert!(!sidecar_text.contains("nsec"));
    assert!(!sidecar_text.contains("private"));

    let (success, frames, stderr) = run_production_child(
        &production_root(),
        "linux-production-restart",
        "identity-restart",
    );
    assert!(
        success,
        "restart child failed: {}",
        String::from_utf8_lossy(&stderr)
    );
    let response = identity_response(&frames, "identity-restart");
    assert_eq!(response["payload"]["storage"], "system-keyring");
    assert_eq!(response["payload"]["pubkey"], first_pubkey);
    assert_eq!(response["payload"]["lost"], false);
    assert_eq!(response["payload"]["locked"], false);
    assert_eq!(response["payload"]["reset_failed"], false);
    assert_no_secret_output(&stderr);
}

#[test]
#[ignore = "uses only the disposable hosted Secret Service session"]
fn linux_production_binary_serializes_two_fresh_children() {
    assert!(!production_root().exists(), "race proof starts fresh");
    let root = production_root();
    let first = thread::spawn({
        let root = root.clone();
        move || run_production_child(&root, "linux-production-race-a", "identity-race-a")
    });
    let second = thread::spawn({
        let root = root.clone();
        move || run_production_child(&root, "linux-production-race-b", "identity-race-b")
    });
    let (first_success, first_frames, first_stderr) = first.join().expect("first child joins");
    let (second_success, second_frames, second_stderr) = second.join().expect("second child joins");
    assert!(first_success, "first race child failed");
    assert!(second_success, "second race child failed");
    let first_pubkey = identity_response(&first_frames, "identity-race-a")["payload"]["pubkey"]
        .as_str()
        .expect("first race child returns public key");
    let second_pubkey = identity_response(&second_frames, "identity-race-b")["payload"]["pubkey"]
        .as_str()
        .expect("second race child returns public key");
    assert_eq!(first_pubkey, second_pubkey);
    assert_no_secret_output(&first_stderr);
    assert_no_secret_output(&second_stderr);
}

#[test]
#[ignore = "uses only the disposable hosted Secret Service session"]
fn linux_production_reserved_sidecar_blocks_before_b1() {
    initialize_and_assert_ready("identity-reserve");
    let sidecar = sidecar_path();
    let mut sidecar_json: Value =
        serde_json::from_str(&fs::read_to_string(&sidecar).expect("sidecar should exist"))
            .expect("sidecar is JSON");
    sidecar_json["state"] = json!("reserved");
    sidecar_json["storage"]["lastDurableStorage"] = json!("none");
    fs::write(
        &sidecar,
        serde_json::to_vec(&sidecar_json).expect("sidecar serializes"),
    )
    .expect("reserved sidecar should be writable");
    let before = fs::read(&sidecar).expect("reserved sidecar should be readable");

    let (success, frames, stderr) = run_production_child(
        &production_root(),
        "linux-production-reserved",
        "identity-reserved",
    );
    assert!(!success);
    assert_namespace_rejection(&frames, &stderr);
    assert_eq!(
        fs::read(&sidecar).expect("reserved sidecar remains"),
        before
    );
    assert!(
        production_root().exists(),
        "reserved proof must not delete root"
    );
}

#[test]
#[ignore = "uses only the disposable hosted Secret Service session"]
fn linux_production_process_kill_blocks_reserved_restarts() {
    let root = production_root();
    assert!(!root.exists(), "crash proof starts fresh");
    assert!(
        !production_parent().exists(),
        "crash proof namespace starts fresh"
    );

    let ready_after_reservation = crash_ready_path("after-reservation");
    let (success, frames, stderr) = kill_production_child_at_stage(
        &root,
        "--identity-v2-crash-after-reservation",
        &ready_after_reservation,
        "linux-production-crash-reservation",
        "identity-crash-reservation",
    );
    assert!(!success);
    assert!(frames.is_empty());
    assert_eq!(
        fs::read_to_string(&ready_after_reservation).unwrap_or_default(),
        "after-reservation"
    );
    fs::remove_file(&ready_after_reservation).expect("reservation readiness marker cleanup");
    assert!(
        !root.exists(),
        "reservation crash must precede B1 root creation"
    );
    let reserved_before_restart = fs::read(sidecar_path()).expect("reserved sidecar exists");
    let reserved_json: Value =
        serde_json::from_slice(&reserved_before_restart).expect("sidecar JSON");
    assert_eq!(reserved_json["state"], "reserved");
    assert_eq!(reserved_json["storage"]["lastDurableStorage"], "none");

    let (restart_success, restart_frames, restart_stderr) = run_production_child(
        &root,
        "linux-production-crash-reservation-restart",
        "identity-crash-reservation-restart",
    );
    assert!(!restart_success);
    assert_namespace_rejection(&restart_frames, &restart_stderr);
    assert_eq!(
        fs::read(sidecar_path()).expect("reserved sidecar remains"),
        reserved_before_restart
    );
    fs::remove_dir_all(production_parent()).expect("reservation namespace cleanup");

    let ready_after_b1 = crash_ready_path("after-b1");
    let (success, frames, stderr) = kill_production_child_at_stage(
        &root,
        "--identity-v2-crash-after-b1",
        &ready_after_b1,
        "linux-production-crash-b1",
        "identity-crash-b1",
    );
    assert!(!success);
    assert!(frames.is_empty());
    assert_eq!(
        fs::read_to_string(&ready_after_b1).unwrap_or_default(),
        "after-b1"
    );
    fs::remove_file(&ready_after_b1).expect("B1 readiness marker cleanup");
    assert!(root.exists(), "post-B1 crash retains profile root");
    let marker = root.join(colony_identity_kernel::migration_marker_name(
        PRODUCTION_KEYCHAIN_SERVICE,
        colony_identity_kernel::MIGRATION_MARKER_NAME,
    ));
    assert!(marker.exists(), "post-B1 crash retains migration marker");
    let reserved_after_b1 = fs::read(sidecar_path()).expect("post-B1 reserved sidecar exists");
    let reserved_after_b1_json: Value =
        serde_json::from_slice(&reserved_after_b1).expect("sidecar JSON");
    assert_eq!(reserved_after_b1_json["state"], "reserved");
    assert_eq!(
        reserved_after_b1_json["storage"]["lastDurableStorage"],
        "none"
    );

    let (restart_success, restart_frames, restart_stderr) = run_production_child(
        &root,
        "linux-production-crash-b1-restart",
        "identity-crash-b1-restart",
    );
    assert!(!restart_success);
    assert_namespace_rejection(&restart_frames, &restart_stderr);
    assert_eq!(
        fs::read(sidecar_path()).expect("post-B1 sidecar remains"),
        reserved_after_b1
    );
    assert_no_secret_output(&stderr);
    fs::remove_dir_all(production_parent()).expect("post-B1 namespace cleanup");
}

#[test]
#[ignore = "uses only the disposable hosted Secret Service session"]
fn linux_production_locked_service_fails_closed_before_b1() {
    initialize_and_assert_ready("identity-lock-setup");
    let service = SecretService::connect(EncryptionType::Plain).expect("Secret Service connects");
    let result = service
        .search_items(HashMap::from([
            ("service", PRODUCTION_KEYCHAIN_SERVICE),
            ("username", "secrets"),
            ("target", "default"),
        ]))
        .expect("exact service metadata search succeeds");
    if let Some(item) = result.unlocked.into_iter().next() {
        item.lock().expect("disposable identity item locks");
    } else {
        assert_eq!(result.locked.len(), 1, "exact item should be present once");
    }

    fs::remove_dir_all(production_parent()).expect("fresh locked proof namespace cleanup");
    let (success, frames, stderr) = run_production_child(
        &production_root(),
        "linux-production-locked",
        "identity-locked",
    );
    assert!(!success);
    assert_namespace_rejection(&frames, &stderr);
    assert!(
        !production_root().exists(),
        "locked service must block before B1 root"
    );
    assert!(
        !sidecar_path().exists(),
        "locked service must not create ownership sidecar"
    );
}

#[test]
#[ignore = "uses only the disposable hosted Secret Service session"]
fn linux_production_missing_service_fails_closed_before_b1() {
    let root = production_root();
    assert!(!root.exists(), "missing-service proof starts fresh");
    let invalid_bus = std::env::temp_dir().join(format!(
        "colony-linux-missing-bus-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be after epoch")
            .as_nanos()
    ));
    let address = format!("unix:path={}", invalid_bus.display());
    let (success, frames, stderr) = run_child_with_binary(
        binary_path(),
        &root,
        "linux-production-missing-service",
        "identity-missing-service",
        Some(&address),
    );
    assert!(!success);
    assert_namespace_rejection(&frames, &stderr);
    assert!(!root.exists(), "missing service must block before B1 root");
    assert!(
        !sidecar_path().exists(),
        "missing service must not create sidecar"
    );
}
