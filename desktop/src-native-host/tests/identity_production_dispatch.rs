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
        assert!(stderr.contains("identity_descriptor_rejected"), "{stderr}");
        assert!(!stderr.contains("private"));
        assert!(!stderr.contains("secret"));
        assert!(!base.exists(), "wrong anchor must not create a profile");
    }
}
