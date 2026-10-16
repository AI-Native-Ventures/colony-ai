# Start Free (local OpenCode) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new Colony user picks "Start free" on the Connect step, Colony installs its own pinned OpenCode on their computer, and their agents run on `opencode/deepseek-v4.1-flash-free` for $0; when OpenCode ends the offer, Colony stops and tells the user.

**Architecture:** OpenCode moves from a catalog-only preset to a known ACP runtime whose binary Colony downloads itself (pinned version, pinned SHA256, Colony app-data folder), reusing the managed Node.js download and extraction code. The free choice saves `provider: "opencode-free"`, which makes the desktop pass `BUZZ_ACP_REQUIRE_MODEL=1`, so buzz-acp refuses to run a turn on any model but the free one and posts a "Free AI has ended" notice instead of falling back. The onboarding Connect step gains a top-level "Start free" / "Use your own AI" choice; visuals come from a Codex screen pass.

**Tech Stack:** Rust (Tauri native host, buzz-acp crate), React 19 + TypeScript (desktop), Playwright e2e with the mock bridge, node:test unit tests.

**Spec:** `docs/superpowers/specs/2026-10-16-start-free-opencode-design.md`

## Global Constraints

- OpenCode CLI version pin: `v1.19.2`. Download base: `https://github.com/anomalyco/opencode/releases/download/v1.19.2/`.
- Archives and SHA256 (from the GitHub release digests, 16 Oct 2026):
  - darwin-arm64 `opencode-darwin-arm64.zip` `1c9da110bbf3e13c480e0a2e55f61b09ebdb33cfc67029b61ffbb9f8566d67cd`
  - darwin-x64 `opencode-darwin-x64-baseline.zip` `cae984e29ddb6a3c8ff906107552cad2f10569a3846af6a76882181f601cc006`
  - linux-x64 `opencode-linux-x64-baseline.tar.gz` `0f41386deb25608b3bfa4a17795f61782008d5e118eeba5093ade4e052be7ee2`
  - linux-arm64 `opencode-linux-arm64.tar.gz` `3f73a474065b4b7c4a64cef2395a6123ae1039c2e41f0acbe29ae6521b50df66`
  - windows-x64 `opencode-windows-x64-baseline.zip` `fb67adf313ebca3f82c8059df334b8ad1d0523ceec3216c4cffc3b9d35941c77`
  - windows-arm64 `opencode-windows-arm64.zip` `a4c6ce2e1bc0ed17acaa8c840b1c2c28f0e732b0b859dfeeab98feaa894aa182`
- Download cap: 80 MB. Install dir: `<dirs::data_dir()>/Colony/runtimes/opencode/v1.19.2/<platform>/` holding `opencode` (`opencode.exe` on Windows).
- Free model id: `opencode/deepseek-v4.1-flash-free`. Provider id: `opencode-free`. Runtime id: `opencode`, command `opencode`, args `["acp"]`.
- Runtime default env: `OPENCODE_CONFIG_CONTENT={"autoupdate":false,"share":"disabled"}`. The model is never put in this env.
- Strict-model env: `BUZZ_ACP_REQUIRE_MODEL=1`, set only when the effective provider is `opencode-free`.
- Copy, exact (no em dashes anywhere, owner rule):
  - Choice 1 title "Start free", body "Free AI on your computer. No account, no card.", fine print "Runs through OpenCode on your computer. Chats aren't stored or used for training. Free while OpenCode offers it."
  - Choice 2 title "Use your own AI", body "Claude Code or Codex subscription, or OpenRouter".
  - Setup progress title "Setting up free AI..."
  - Onboarding ended: "OpenCode's free AI has ended. Connect your own AI to continue."
  - Channel and status notice: "⚠️ Free AI has ended. OpenCode no longer offers the free model. Connect your own AI in Settings, then re-send your request." Status line (desktop): "Free AI has ended. Connect your own AI in Settings."
- Never call `opencode.ai` APIs from Colony code, never imitate the OpenCode client, never run OpenCode's install script, never edit shell profiles, never touch an `opencode` the user installed themselves.
- No local `cargo` (owner rule): Rust tests run in GitHub CI on the draft PR. Local checks allowed: `pnpm test` (node unit tests), `pnpm exec tsc --noEmit`, `pnpm exec biome check`, single Playwright specs after `pnpm build:e2e`, one heavy command at a time.
- Commits: `git commit -s`, message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Pushes for this branch: `LEFTHOOK_EXCLUDE=rust-tests,desktop-tauri-checks git push`.
- Never touch the owner's real HOME, `~/.colony`, `~/.buzz` or keychain in any test or proof.

## Review Focus

1. **User already has their own `opencode` on PATH.** Expected: Start free still installs and uses Colony's managed copy; the user's own binary and its config are untouched. Tests pinned in Task 2: `managed_command_path_prefers_managed_opencode` (resolution checks the managed folder first) and `installed_binary_check_requires_executable_file` (install readiness looks only at the managed folder, never PATH).
2. **Download interrupted or tampered.** Expected: wrong digest or oversize stream leaves no files in the install dir and the UI offers Retry and Use your own AI. Tests in Task 1 (`download_verified_rejects_digest_mismatch_and_removes_file`) and Task 6 e2e (`start free install failure offers retry and own AI`).
3. **Free model disappears after onboarding.** Expected: next turn posts the notice once for that turn, no retry loop, never runs on `big-pickle`. Tests in Task 4 (`require_model_refuses_missing_model`, `free_model_ended_notice_text`).
4. **User later switches to "Use your own AI" or another runtime.** Expected: `BUZZ_ACP_REQUIRE_MODEL` is gone for any provider but `opencode-free`. Test in Task 5 (`require_model_env_only_for_opencode_free`).
5. **Unsupported platform (for example linux-riscv).** Expected: Start free shows the install error with Use your own AI; nothing crashes. Test in Task 2 (`unsupported_platform_step_has_hint`).

---

### Task 0: Spike gate (DONE 16 Oct 2026)

Evidence, all in an isolated temp HOME on the owner's Mac, throwaway scripts in the coordinator scratchpad:

- Colony 1.0.8 `buzz-acp connection-test --json` with OpenCode v1.19.2 (`BUZZ_ACP_AGENT_COMMAND=<opencode> BUZZ_ACP_AGENT_ARGS=acp COLONY_CONNECTION_MODEL=opencode/deepseek-v4.1-flash-free`) returned `{"model":"opencode/deepseek-v4.1-flash-free","reply":"Hello! What shall we work on first?","totalMs":12587}`.
- Same with model `opencode/deepseek-v9-flash-free` returned `{"error":"Selected model is unavailable or this harness does not support model switching. Choose another model."}`.
- `opencode acp` on the free model with Colony 1.0.8 `buzz-dev-mcp` attached: wrote a file, ran `wc -c`, listed `colony-dev_read_file`, `colony-dev_shell`, `colony-dev_str_replace` and others. No permission prompts.
- With no model set, OpenCode's default is `opencode/big-pickle` (a model whose data may be used for training). `session/set_model` to a missing id returns `-32602 "Invalid params: model not found: <id>"` and the session stays on `big-pickle`; a missing model in `OPENCODE_CONFIG_CONTENT` is silently ignored. This is why Task 4 exists.
- v1.19.2 darwin-arm64 archive SHA256 matched the GitHub digest; the unpacked binary is 145 MB and runs.

---

### Task 1: Shared verified-archive helpers

Move the Node.js download and extraction code into a reusable module without changing Node.js behavior or error text.

**Files:**
- Create: `desktop/src-tauri/src/commands/agent_discovery/managed_archive.rs`
- Create: `desktop/src-tauri/src/commands/agent_discovery/managed_archive_tests.rs`
- Modify: `desktop/src-tauri/src/commands/agent_discovery/managed_node.rs` (functions `download_managed_node_archive` lines 361-424, `extract_managed_node_archive` 426-467, `validate_managed_node_zip_entries` 469-497, `extract_managed_node_zip` 499-531, `validate_managed_node_archive_entries` 533-560)
- Modify: `desktop/src-tauri/src/commands/agent_discovery.rs:993` (add `mod managed_archive;` above `mod managed_node;`)

**Interfaces:**
- Produces:
  - `pub(super) fn download_verified(url: &str, dest: &Path, expected_sha256: &str, max_bytes: u64, label: &str) -> Result<(), String>`
  - `pub(super) fn extract_archive(archive_path: &Path, dest_dir: &Path, filename: &str, label: &str) -> Result<(), String>`
  - `pub(super) fn validate_zip_entries(archive: &zip::ZipArchive<std::fs::File>, label: &str) -> Result<(), String>`

- [ ] **Step 1: Write the failing tests** in `managed_archive_tests.rs`

```rust
use super::*;
use std::io::Write;

fn zip_with(entries: &[(&str, &[u8])]) -> tempfile::NamedTempFile {
    let file = tempfile::NamedTempFile::new().unwrap();
    let mut zip = zip::ZipWriter::new(file.reopen().unwrap());
    for (name, body) in entries {
        zip.start_file(*name, zip::write::SimpleFileOptions::default()).unwrap();
        zip.write_all(body).unwrap();
    }
    zip.finish().unwrap();
    file
}

#[test]
fn extract_archive_unpacks_zip_root_binary() {
    let archive = zip_with(&[("opencode", b"#!/bin/sh\necho ok\n")]);
    let out = tempfile::tempdir().unwrap();
    extract_archive(archive.path(), out.path(), "opencode-darwin-arm64.zip", "OpenCode").unwrap();
    assert!(out.path().join("opencode").is_file());
}

#[test]
fn extract_archive_refuses_traversal_entry() {
    let archive = zip_with(&[("../escape", b"x")]);
    let out = tempfile::tempdir().unwrap();
    let err = extract_archive(archive.path(), out.path(), "x.zip", "OpenCode").unwrap_err();
    assert!(err.contains("OpenCode"), "{err}");
    assert!(!out.path().parent().unwrap().join("escape").exists());
}

#[test]
fn extract_archive_rejects_unknown_extension() {
    let out = tempfile::tempdir().unwrap();
    let err = extract_archive(out.path(), out.path(), "x.rar", "OpenCode").unwrap_err();
    assert_eq!(err, "unsupported managed OpenCode archive: x.rar");
}

#[test]
fn download_verified_rejects_digest_mismatch_and_removes_file() {
    let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
    let url = format!("http://{}/a.zip", server.server_addr().to_ip().unwrap());
    std::thread::spawn(move || {
        if let Ok(request) = server.recv() {
            let _ = request.respond(tiny_http::Response::from_data(b"not the pinned bytes".to_vec()));
        }
    });
    let dir = tempfile::tempdir().unwrap();
    let dest = dir.path().join("a.zip.download");
    let err = download_verified(&url, &dest, &"0".repeat(64), 1024, "OpenCode").unwrap_err();
    assert!(err.starts_with("download OpenCode hash mismatch"), "{err}");
    assert!(!dest.exists());
}

#[test]
fn download_verified_rejects_oversize_stream() {
    let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
    let url = format!("http://{}/a.zip", server.server_addr().to_ip().unwrap());
    std::thread::spawn(move || {
        if let Ok(request) = server.recv() {
            let _ = request.respond(tiny_http::Response::from_data(vec![7_u8; 4096]));
        }
    });
    let dir = tempfile::tempdir().unwrap();
    let dest = dir.path().join("a.zip.download");
    let err = download_verified(&url, &dest, &"0".repeat(64), 1024, "OpenCode").unwrap_err();
    assert!(err.contains("too large") || err.contains("exceeded max size"), "{err}");
    assert!(!dest.exists());
}
```

Before writing the two download tests, check `desktop/src-tauri/Cargo.toml` `[dev-dependencies]` for `tiny_http`. If it is absent, add `tiny_http = "0.12"` under `[dev-dependencies]` (test-only, no production dependency change).

- [ ] **Step 2: Implement `managed_archive.rs`**

Move the five functions listed above out of `managed_node.rs` into `managed_archive.rs` with these renames and changes, keeping every line of logic:
  - `download_managed_node_archive(url, dest, sha)` becomes `download_verified(url, dest, sha, max_bytes, label)`. Replace `MANAGED_NODE_MAX_BYTES` with `max_bytes` and every literal `Node.js` in messages with `{label}` (for example `format!("download {label} hash mismatch: expected {expected_sha256}, got {actual}")`). On the oversize-by-content-length path also `let _ = std::fs::remove_file(dest);` (the file is not created yet there, so this is a no-op kept for symmetry).
  - `extract_managed_node_archive` becomes `extract_archive(.., label)`; its last arm returns `Err(format!("unsupported managed {label} archive: {filename}"))`.
  - `validate_managed_node_zip_entries` becomes `validate_zip_entries(archive, label)`; `extract_managed_node_zip` becomes `extract_zip(archive, dest, label)`; `validate_managed_node_archive_entries` becomes `validate_tar_entries(archive, label)`. Same `Node.js` to `{label}` replacement in their messages.

Header of the new file:

```rust
//! Pinned download and safe extraction for Colony-managed runtimes (private
//! Node.js, OpenCode). Every archive is checked against a pinned SHA256 and a
//! size cap before anything is unpacked.
use sha2::{Digest, Sha256};
use std::path::Path;
use std::time::Duration;
use std::{io::Read, io::Write};

#[cfg(test)]
#[path = "managed_archive_tests.rs"]
mod tests;
```

In `managed_node.rs`, replace the moved bodies with calls, so Node.js messages stay byte-identical:

```rust
use super::managed_archive::{download_verified, extract_archive};

// in install_managed_node_runtime:
download_verified(&url, &archive_path, artifact.sha256, MANAGED_NODE_MAX_BYTES, "Node.js")?;
std::fs::create_dir_all(&temp_dir).map_err(|e| format!("create temp dir: {e}"))?;
extract_archive(&archive_path, &temp_dir, artifact.filename, "Node.js")?;

// kept for managed_node_tests.rs, which calls it six times:
fn validate_managed_node_zip_entries(
    archive: &zip::ZipArchive<std::fs::File>,
) -> Result<(), String> {
    super::managed_archive::validate_zip_entries(archive, "Node.js")
}
```

Remove now-unused imports from `managed_node.rs` (`Sha256`, `Digest`, `Read`, `Write`, `Duration` if no longer used there).

- [ ] **Step 3: Local static checks**

Run: `cd desktop && pnpm exec biome check src-tauri 2>/dev/null; git diff --stat`
Expected: only the three Rust files and possibly `Cargo.toml` changed. (No local cargo; compilation and the tests run in CI at Step 5.)

- [ ] **Step 4: Commit**

```bash
git add desktop/src-tauri/src/commands/agent_discovery.rs desktop/src-tauri/src/commands/agent_discovery/managed_archive.rs desktop/src-tauri/src/commands/agent_discovery/managed_archive_tests.rs desktop/src-tauri/src/commands/agent_discovery/managed_node.rs desktop/src-tauri/Cargo.toml
git commit -s -m "refactor(desktop): share pinned archive download and extraction

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Push and open the draft PR into develop; read CI**

```bash
LEFTHOOK_EXCLUDE=rust-tests,desktop-tauri-checks git push -u origin feat/start-free-opencode
GH_TOKEN=$(gh auth token -u nocodeafrica) gh pr create --draft --base develop --title "feat(desktop): Start free with a local OpenCode" --body-file "$SCRATCHPAD/pr-start-free-body.md"
```

Expected: "Desktop Tauri" Rust test job passes `managed_archive` tests and every existing `managed_node` test. If CI fails, fix and push before Task 2.

---

### Task 2: Managed OpenCode installer and managed path

**Files:**
- Create: `desktop/src-tauri/src/commands/agent_discovery/managed_opencode.rs`
- Create: `desktop/src-tauri/src/commands/agent_discovery/managed_opencode_tests.rs`
- Modify: `desktop/src-tauri/src/managed_agents/managed_node_paths.rs` (add OpenCode dir, extend `buzz_managed_command_path`)
- Modify: `desktop/src-tauri/src/commands/agent_discovery.rs` (add `mod managed_opencode;` and `use managed_opencode::ensure_managed_opencode_blocking;`)

**Interfaces:**
- Consumes: `download_verified`, `extract_archive` from Task 1.
- Produces:
  - `pub(crate) const MANAGED_OPENCODE_VERSION: &str = "v1.19.2";` (in `managed_node_paths.rs`, the single source for the path and the installer)
  - `pub(crate) fn buzz_managed_opencode_dir() -> Option<PathBuf>` returning `<data_dir>/Colony/runtimes/opencode/v1.19.2/<platform>`
  - `pub(crate) fn managed_binary_runtime(runtime_id: &str) -> bool` (true only for `"opencode"`)
  - `pub(super) fn ensure_managed_opencode_blocking() -> Result<(), Box<InstallStepResult>>`

- [ ] **Step 1: Write the failing tests** in `managed_opencode_tests.rs`

```rust
use super::*;

#[test]
fn artifact_table_pins_every_supported_platform() {
    let platforms: Vec<&str> = OPENCODE_ARTIFACTS.iter().map(|a| a.platform).collect();
    assert_eq!(
        platforms,
        ["darwin-arm64", "darwin-x64", "linux-x64", "linux-arm64", "windows-x64", "windows-arm64"]
    );
    for artifact in OPENCODE_ARTIFACTS {
        assert_eq!(artifact.sha256.len(), 64, "{}", artifact.platform);
        assert!(artifact.sha256.chars().all(|c| c.is_ascii_hexdigit()));
        assert!(artifact.filename.starts_with("opencode-"));
    }
}

#[test]
fn download_url_uses_pinned_release() {
    let artifact = OPENCODE_ARTIFACTS[0];
    assert_eq!(
        download_url(artifact),
        "https://github.com/anomalyco/opencode/releases/download/v1.19.2/opencode-darwin-arm64.zip"
    );
}

#[test]
fn unsupported_platform_step_has_hint() {
    let step = opencode_unsupported_step("linux", "riscv64");
    assert!(!step.success);
    assert!(step.stderr.contains("linux-riscv64"));
    assert_eq!(step.hint.as_deref(), Some("Choose Use your own AI to connect Claude Code, Codex or OpenRouter instead."));
}

#[test]
fn managed_binary_runtime_is_opencode_only() {
    assert!(crate::managed_agents::managed_binary_runtime("opencode"));
    assert!(!crate::managed_agents::managed_binary_runtime("codex"));
    assert!(!crate::managed_agents::managed_binary_runtime("buzz-agent"));
}

#[test]
fn installed_binary_check_requires_executable_file() {
    let dir = tempfile::tempdir().unwrap();
    assert!(!opencode_binary_ready(dir.path()));
    let bin = dir.path().join(opencode_binary_name());
    std::fs::write(&bin, b"x").unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert!(!opencode_binary_ready(dir.path()));
        std::fs::set_permissions(&bin, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
    assert!(opencode_binary_ready(dir.path()));
}
```

Add to the existing tests in `managed_node_paths.rs` (create `#[cfg(test)] mod tests` at the bottom if none):

```rust
#[test]
fn managed_command_path_prefers_managed_opencode() {
    // A command that is not on the allow-list never resolves here.
    assert!(buzz_managed_command_path("not-a-colony-tool", "not-a-colony-tool").is_none());
    // OpenCode is on the allow-list; it resolves only when the managed binary exists.
    let Some(dir) = buzz_managed_opencode_dir() else { return };
    let candidate = dir.join(if cfg!(windows) { "opencode.exe" } else { "opencode" });
    assert_eq!(
        buzz_managed_command_path("opencode", if cfg!(windows) { "opencode.exe" } else { "opencode" }).is_some(),
        is_executable_file(&candidate)
    );
}
```

- [ ] **Step 2: Implement `managed_node_paths.rs` additions**

```rust
pub(crate) const MANAGED_OPENCODE_VERSION: &str = "v1.19.2";

/// Runtimes whose binary Colony downloads itself instead of running an installer.
pub(crate) fn managed_binary_runtime(runtime_id: &str) -> bool {
    runtime_id == "opencode"
}

pub(crate) fn managed_opencode_platform() -> Option<&'static str> {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "aarch64") => Some("darwin-arm64"),
        ("macos", "x86_64") => Some("darwin-x64"),
        ("linux", "x86_64") => Some("linux-x64"),
        ("linux", "aarch64") => Some("linux-arm64"),
        ("windows", "x86_64") => Some("windows-x64"),
        ("windows", "aarch64") => Some("windows-arm64"),
        _ => None,
    }
}

pub(crate) fn buzz_managed_opencode_dir() -> Option<PathBuf> {
    let platform = managed_opencode_platform()?;
    dirs::data_dir().map(|dir| {
        dir.join("Colony")
            .join("runtimes")
            .join("opencode")
            .join(MANAGED_OPENCODE_VERSION)
            .join(platform)
    })
}
```

Extend `buzz_managed_command_path`: add `"opencode"` to the `matches!` allow-list, and push the OpenCode dir first so the managed copy wins over any other managed dir:

```rust
    let mut dirs = Vec::new();
    if command == "opencode" {
        if let Some(opencode_dir) = buzz_managed_opencode_dir() {
            dirs.push(opencode_dir);
        }
    }
    if let Some(managed_bin) = buzz_managed_npm_bin_dir() {
```

No export edit is needed: `desktop/src-tauri/src/managed_agents/mod.rs:95` already has `pub(crate) use managed_node_paths::*;`, so `MANAGED_OPENCODE_VERSION`, `managed_binary_runtime`, `managed_opencode_platform` and `buzz_managed_opencode_dir` are reachable as `crate::managed_agents::...`.

- [ ] **Step 3: Implement `managed_opencode.rs`**

```rust
//! Colony's own pinned OpenCode for "Start free". Downloaded from the
//! OpenCode GitHub release, checked against a pinned SHA256, unpacked into
//! Colony's app-data folder. Never runs OpenCode's install script and never
//! touches an OpenCode the user installed themselves.
use std::sync::{Mutex, OnceLock};

use super::managed_archive::{download_verified, extract_archive};
use crate::managed_agents::{
    buzz_managed_opencode_dir, managed_opencode_platform, InstallStepResult,
    MANAGED_OPENCODE_VERSION,
};

const OPENCODE_MAX_BYTES: u64 = 80 * 1024 * 1024;

#[derive(Debug, Clone, Copy)]
pub(super) struct OpenCodeArtifact {
    pub platform: &'static str,
    pub filename: &'static str,
    pub sha256: &'static str,
}

pub(super) const OPENCODE_ARTIFACTS: &[OpenCodeArtifact] = &[
    OpenCodeArtifact { platform: "darwin-arm64", filename: "opencode-darwin-arm64.zip", sha256: "1c9da110bbf3e13c480e0a2e55f61b09ebdb33cfc67029b61ffbb9f8566d67cd" },
    OpenCodeArtifact { platform: "darwin-x64", filename: "opencode-darwin-x64-baseline.zip", sha256: "cae984e29ddb6a3c8ff906107552cad2f10569a3846af6a76882181f601cc006" },
    OpenCodeArtifact { platform: "linux-x64", filename: "opencode-linux-x64-baseline.tar.gz", sha256: "0f41386deb25608b3bfa4a17795f61782008d5e118eeba5093ade4e052be7ee2" },
    OpenCodeArtifact { platform: "linux-arm64", filename: "opencode-linux-arm64.tar.gz", sha256: "3f73a474065b4b7c4a64cef2395a6123ae1039c2e41f0acbe29ae6521b50df66" },
    OpenCodeArtifact { platform: "windows-x64", filename: "opencode-windows-x64-baseline.zip", sha256: "fb67adf313ebca3f82c8059df334b8ad1d0523ceec3216c4cffc3b9d35941c77" },
    OpenCodeArtifact { platform: "windows-arm64", filename: "opencode-windows-arm64.zip", sha256: "a4c6ce2e1bc0ed17acaa8c840b1c2c28f0e732b0b859dfeeab98feaa894aa182" },
];

pub(super) fn download_url(artifact: OpenCodeArtifact) -> String {
    format!(
        "https://github.com/anomalyco/opencode/releases/download/{MANAGED_OPENCODE_VERSION}/{}",
        artifact.filename
    )
}

pub(super) fn opencode_binary_name() -> &'static str {
    if cfg!(windows) { "opencode.exe" } else { "opencode" }
}

pub(super) fn opencode_binary_ready(dir: &std::path::Path) -> bool {
    let path = dir.join(opencode_binary_name());
    let Ok(metadata) = path.metadata() else { return false };
    if !metadata.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        metadata.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    {
        true
    }
}

const OPENCODE_HINT: &str =
    "Choose Use your own AI to connect Claude Code, Codex or OpenRouter instead.";

pub(super) fn opencode_unsupported_step(os: &str, arch: &str) -> InstallStepResult {
    InstallStepResult {
        step: "opencode".to_string(),
        command: format!("Colony OpenCode {MANAGED_OPENCODE_VERSION}"),
        success: false,
        stdout: String::new(),
        stderr: format!("Start free is not available on {os}-{arch} yet."),
        exit_code: None,
        hint: Some(OPENCODE_HINT.to_string()),
    }
}

fn opencode_failed_step(stderr: String) -> InstallStepResult {
    InstallStepResult {
        step: "opencode".to_string(),
        command: format!("Colony OpenCode {MANAGED_OPENCODE_VERSION}"),
        success: false,
        stdout: String::new(),
        stderr,
        exit_code: None,
        hint: Some(format!(
            "Check your internet connection and try again. {OPENCODE_HINT}"
        )),
    }
}

fn install_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

/// Install Colony's pinned OpenCode if it is not already in place.
pub(super) fn ensure_managed_opencode_blocking() -> Result<(), Box<InstallStepResult>> {
    let (Some(platform), Some(final_dir)) = (managed_opencode_platform(), buzz_managed_opencode_dir()) else {
        return Err(Box::new(opencode_unsupported_step(
            std::env::consts::OS,
            std::env::consts::ARCH,
        )));
    };
    if opencode_binary_ready(&final_dir) {
        return Ok(());
    }
    let Some(artifact) = OPENCODE_ARTIFACTS.iter().copied().find(|a| a.platform == platform) else {
        return Err(Box::new(opencode_unsupported_step(std::env::consts::OS, std::env::consts::ARCH)));
    };
    let _guard = install_lock()
        .lock()
        .map_err(|_| Box::new(opencode_failed_step("OpenCode install lock poisoned".into())))?;
    if opencode_binary_ready(&final_dir) {
        return Ok(());
    }
    install(&final_dir, artifact).map_err(|err| Box::new(opencode_failed_step(err)))?;
    if opencode_binary_ready(&final_dir) {
        Ok(())
    } else {
        Err(Box::new(opencode_failed_step(
            "OpenCode was unpacked but its program is missing".into(),
        )))
    }
}

fn install(final_dir: &std::path::Path, artifact: OpenCodeArtifact) -> Result<(), String> {
    let parent = final_dir
        .parent()
        .ok_or("OpenCode install folder has no parent")?;
    std::fs::create_dir_all(parent).map_err(|e| format!("create OpenCode folder: {e}"))?;
    let temp_dir = parent.join(format!("{}.tmp", artifact.platform));
    let archive_path = parent.join(format!("{}.download", artifact.filename));
    if temp_dir.exists() {
        std::fs::remove_dir_all(&temp_dir).map_err(|e| format!("remove stale temp dir: {e}"))?;
    }
    let result = (|| {
        download_verified(&download_url(artifact), &archive_path, artifact.sha256, OPENCODE_MAX_BYTES, "OpenCode")?;
        std::fs::create_dir_all(&temp_dir).map_err(|e| format!("create temp dir: {e}"))?;
        extract_archive(&archive_path, &temp_dir, artifact.filename, "OpenCode")?;
        let binary = temp_dir.join(opencode_binary_name());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&binary, std::fs::Permissions::from_mode(0o755))
                .map_err(|e| format!("make OpenCode executable: {e}"))?;
        }
        if !binary.is_file() {
            return Err("OpenCode archive did not contain its program".to_string());
        }
        if final_dir.exists() {
            std::fs::remove_dir_all(final_dir).map_err(|e| format!("replace old OpenCode: {e}"))?;
        }
        std::fs::rename(&temp_dir, final_dir).map_err(|e| format!("install OpenCode: {e}"))
    })();
    let _ = std::fs::remove_file(&archive_path);
    let _ = std::fs::remove_dir_all(&temp_dir);
    result
}

#[cfg(test)]
#[path = "managed_opencode_tests.rs"]
mod tests;
```

- [ ] **Step 4: Commit and push; read CI**

```bash
git add desktop/src-tauri/src/commands/agent_discovery.rs desktop/src-tauri/src/commands/agent_discovery/managed_opencode.rs desktop/src-tauri/src/commands/agent_discovery/managed_opencode_tests.rs desktop/src-tauri/src/managed_agents/managed_node_paths.rs
git commit -s -m "feat(desktop): install a pinned OpenCode into Colony app data

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
LEFTHOOK_EXCLUDE=rust-tests,desktop-tauri-checks git push
```

Expected CI: new `managed_opencode` and `managed_node_paths` tests pass; clippy has no dead-code warning (Task 3 uses `ensure_managed_opencode_blocking`; if clippy flags it as unused before Task 3 lands, add Task 3 before pushing).

---

### Task 3: OpenCode as a known runtime

**Files:**
- Modify: `desktop/src-tauri/src/managed_agents/discovery/catalog.rs` (append an OpenCode `KnownAcpRuntime` after `buzz-agent`)
- Modify: `desktop/src-tauri/src/managed_agents/discovery/presets.rs:172-182` (delete the OpenCode `PresetHarness`)
- Modify: `desktop/src-tauri/src/managed_agents/discovery.rs:315-322` (`default_agent_args`) and `:989-990` (`can_auto_install`)
- Modify: `desktop/src-tauri/src/commands/agent_discovery.rs` (`install_acp_runtime_blocking`, before "Phase 1")
- Modify: `crates/buzz-acp/README.md:290` (OpenCode leaves the Tier-2 preset list)
- Test: `desktop/src-tauri/src/managed_agents/discovery/catalog_tests.rs` (create; wire with `#[cfg(test)] #[path = "catalog_tests.rs"] mod tests;` at the bottom of `catalog.rs`)

**Interfaces:**
- Consumes: `managed_binary_runtime`, `ensure_managed_opencode_blocking` (Task 2).
- Produces: `known_acp_runtime_exact("opencode")` returns the entry; discovery reports `can_auto_install: true`, `auth_status: not_applicable` once installed.

- [ ] **Step 1: Write the failing tests** in `catalog_tests.rs`

```rust
use super::KNOWN_ACP_RUNTIMES;

fn opencode() -> &'static super::KnownAcpRuntime {
    KNOWN_ACP_RUNTIMES.iter().find(|r| r.id == "opencode").expect("opencode runtime")
}

#[test]
fn opencode_is_a_known_runtime_with_acp_command() {
    let runtime = opencode();
    assert_eq!(runtime.commands, &["opencode"]);
    assert_eq!(runtime.label, "OpenCode");
    assert!(runtime.cli_install_commands.is_empty(), "no install script");
    assert!(runtime.auth_probe_args.is_none(), "no sign-in");
    assert!(runtime.supports_acp_model_switching);
}

#[test]
fn opencode_default_env_disables_updates_and_sharing_only() {
    assert_eq!(
        opencode().default_env,
        &[("OPENCODE_CONFIG_CONTENT", r#"{"autoupdate":false,"share":"disabled"}"#)]
    );
}

#[test]
fn opencode_is_no_longer_a_preset() {
    assert!(super::super::presets::PRESET_HARNESSES.iter().all(|p| p.id != "opencode"));
}
```

Add to the existing `discovery.rs` test module (search `mod tests` in `discovery.rs` or its `*_tests.rs` file and append):

```rust
#[test]
fn opencode_default_args_are_acp() {
    assert_eq!(normalize_agent_args("opencode", vec![]), vec!["acp".to_string()]);
    assert_eq!(normalize_agent_args("/Users/x/Library/Application Support/Colony/runtimes/opencode/v1.19.2/darwin-arm64/opencode", vec![]), vec!["acp".to_string()]);
}
```

(Check that `normalize_command_identity` reduces a full path to its basename; if it does not, keep only the first assertion.)

- [ ] **Step 2: Add the catalog entry** (append to `KNOWN_ACP_RUNTIMES` in `catalog.rs`)

```rust
    KnownAcpRuntime {
        id: "opencode",
        label: "OpenCode",
        commands: &["opencode"],
        aliases: &[],
        avatar_url: "",
        mcp_command: None,
        mcp_hooks: false,
        underlying_cli: None,
        cli_install_commands: &[],
        cli_install_commands_windows: &[],
        adapter_install_commands: &[],
        cli_install_instructions_url: "https://opencode.ai/docs",
        adapter_install_instructions_url: "",
        cli_install_hint: "Colony installs its own copy of OpenCode and talks to it through ACP (opencode acp).",
        adapter_install_hint: "",
        skill_dir: None,
        supports_acp_model_switching: true,
        model_env_var: None,
        provider_env_var: None,
        provider_locked: false,
        // Pin the downloaded binary and keep sharing off. The model is chosen
        // per agent through BUZZ_ACP_MODEL, never here, so Settings users can
        // run OpenCode with their own provider.
        default_env: &[("OPENCODE_CONFIG_CONTENT", r#"{"autoupdate":false,"share":"disabled"}"#)],
        config_file_path: None,
        config_file_format: None,
        supports_acp_native_config: false,
        thinking_env_var: None,
        effort_normalization: None, // opencode: no effort control in v1
        effort_accepted_values: None, // opencode: no effort control in v1
        max_tokens_env_var: None,
        context_limit_env_var: None,
        max_rounds_env_var: None,
        required_normalized_fields: &[],
        login_hint: None,
        auth_probe_args: None,
    },
```

If `avatar_url: ""` breaks an existing invariant test (search for `avatar_url.is_empty()` assertions), reuse the bundled logo constant pattern used by the other entries instead.

- [ ] **Step 3: Wire args, auto-install flag and install branch**

`discovery.rs` `default_agent_args`:

```rust
        "goose" | "opencode" => Some(vec!["acp".to_string()]),
```

`discovery.rs` near line 989:

```rust
    let can_auto_install = !runtime.cli_install_commands_for_os().is_empty()
        || !runtime.adapter_install_commands.is_empty()
        || crate::managed_agents::managed_binary_runtime(runtime.id);
```

`agent_discovery.rs` in `install_acp_runtime_blocking`, right after `let mut steps = Vec::new();`:

```rust
    // Colony downloads managed binaries itself (pinned, checksummed). They
    // never use the CLI/adapter installer phases below.
    if crate::managed_agents::managed_binary_runtime(runtime.id) {
        if let Err(step) = ensure_managed_opencode_blocking() {
            reporter.record_step(&mut steps, *step);
            return Ok(reporter.failed(steps));
        }
        crate::managed_agents::clear_resolve_cache();
        post_install_verification::run(runtime_id, &mut steps, &reporter);
        return Ok(InstallRuntimeResult {
            success: steps.iter().all(|step| step.success),
            steps,
            restarted_count: 0,
            failed_restart_count: 0,
            log_path: reporter.log_path(),
        });
    }
```

Delete the OpenCode `PresetHarness` block in `presets.rs` (lines 172-182) and update `crates/buzz-acp/README.md:290` to drop "OpenCode" from the Tier-2 list and add it to the known runtimes sentence.

- [ ] **Step 4: Desktop TypeScript catalog expectations**

Run: `cd desktop && grep -rn "\"opencode\"" src | grep -v test`
For each hit in `harnessConnectionOptions.ts` and `onboardingRuntimeSelection.ts`, leave the id lists as they are (OpenCode stays an API-style runtime in Settings and stays out of the subscription path). In `src/features/settings/ui/harnessCatalogCopy.ts`, change the OpenCode description to: "Colony's own OpenCode. Start free uses its free DeepSeek model; you can also use your own provider."

Run: `cd desktop && pnpm test 2>&1 | tail -5`
Expected: all node tests pass (update `harnessConnectionOptions.test.mjs` / `onboardingRuntimeSelection.test.mjs` only if they asserted OpenCode was a preset source).

- [ ] **Step 5: Commit, push, read CI**

```bash
git add -A desktop/src-tauri/src/managed_agents desktop/src-tauri/src/commands crates/buzz-acp/README.md desktop/src/features/settings/ui/harnessCatalogCopy.ts
git commit -s -m "feat(desktop): OpenCode is a known runtime with a managed install

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
LEFTHOOK_EXCLUDE=rust-tests,desktop-tauri-checks git push
```

Expected CI: catalog, discovery and existing preset tests pass.

---

### Task 4: buzz-acp refuses to fall back off the free model

**Files:**
- Modify: `crates/buzz-acp/src/config.rs` (Args near line 446, Config near line 584, and the Args to Config mapping)
- Modify: `crates/buzz-acp/src/pool.rs` (`OwnedAgent` struct near line 271; the two model-switch arms near lines 1652 and 1675)
- Modify: `crates/buzz-acp/src/lib.rs` (`OwnedAgent` literal near line 3095 and every other literal; prompt-result branch near line 4790)
- Modify: `crates/buzz-acp/src/provider_failure.rs` (new constants and fn)
- Modify: `crates/buzz-acp/src/connection_test.rs` (`error_result` adds a `code`)
- Test: `crates/buzz-acp/src/provider_failure.rs` (inline `#[cfg(test)]`), `crates/buzz-acp/src/pool.rs` `model_switch_tests` module (near line 11257)

**Interfaces:**
- Produces:
  - Env/flag `BUZZ_ACP_REQUIRE_MODEL` (bool, default false) as `Config.require_model`.
  - `OwnedAgent.require_desired_model: bool`.
  - `pub(crate) const FREE_MODEL_ENDED_PREFIX: &str = "free model ended: ";`
  - `pub(crate) fn free_model_ended_notice(error: &AcpError) -> Option<String>`
  - connection-test JSON `{"error": "...", "code": "model_unavailable"}` when the desired model is missing.

- [ ] **Step 1: Write the failing tests**

In `provider_failure.rs`:

```rust
#[cfg(test)]
mod free_model_tests {
    use super::*;

    #[test]
    fn free_model_ended_notice_text() {
        let error = AcpError::AgentError {
            code: -32002,
            message: format!("{FREE_MODEL_ENDED_PREFIX}opencode/deepseek-v4.1-flash-free"),
        };
        assert_eq!(
            free_model_ended_notice(&error).as_deref(),
            Some("⚠️ Free AI has ended. OpenCode no longer offers the free model. Connect your own AI in Settings, then re-send your request.")
        );
    }

    #[test]
    fn other_model_errors_are_not_free_model_ended() {
        let error = AcpError::AgentError { code: -32002, message: "model not found: gpt-x".into() };
        assert!(free_model_ended_notice(&error).is_none());
    }
}
```

In `pool.rs` `model_switch_tests`, add (reuse the module's existing scripted-ACP helpers; the shape below mirrors the existing `create_session_and_apply_model` tests near line 11074):

```rust
#[tokio::test]
async fn require_model_refuses_missing_model() {
    // session/new advertises only big-pickle; the desired free model is absent.
    let script = r#"IFS= read -r _new
printf '%s\n' '{"jsonrpc":"2.0","id":0,"result":{"sessionId":"sess-1","configOptions":[{"id":"model","category":"model","type":"select","currentValue":"opencode/big-pickle","options":[{"value":"opencode/big-pickle","name":"Big Pickle"}]}]}}'
sleep 5"#;
    let acp = AcpClient::spawn("bash", &["-c".to_string(), script.to_string()], &[], false)
        .await
        .expect("spawn scripted ACP");
    let mut agent = effort_agent(acp, None);
    agent.desired_model = Some("opencode/deepseek-v4.1-flash-free".into());
    agent.require_desired_model = true;
    let ctx = make_prompt_context_no_owner();
    let err = create_session_and_apply_model(
        &mut agent,
        &ctx,
        None,
        NewSessionChannelContext { huddle_instructions: None, canvas: None, name: None, scope: None, channel_type: None },
    )
    .await
    .expect_err("strict model must refuse the default model");
    match err {
        AcpError::AgentError { code, message } => {
            assert_eq!(code, -32002);
            assert_eq!(message, "free model ended: opencode/deepseek-v4.1-flash-free");
        }
        other => panic!("expected AgentError, got {other:?}"),
    }
}

#[tokio::test]
async fn without_require_model_missing_model_still_falls_back() {
    let script = r#"IFS= read -r _new
printf '%s\n' '{"jsonrpc":"2.0","id":0,"result":{"sessionId":"sess-1","configOptions":[{"id":"model","category":"model","type":"select","currentValue":"opencode/big-pickle","options":[{"value":"opencode/big-pickle","name":"Big Pickle"}]}]}}'
sleep 5"#;
    let acp = AcpClient::spawn("bash", &["-c".to_string(), script.to_string()], &[], false)
        .await
        .expect("spawn scripted ACP");
    let mut agent = effort_agent(acp, None);
    agent.desired_model = Some("opencode/deepseek-v4.1-flash-free".into());
    let ctx = make_prompt_context_no_owner();
    let sid = create_session_and_apply_model(
        &mut agent,
        &ctx,
        None,
        NewSessionChannelContext { huddle_instructions: None, canvas: None, name: None, scope: None, channel_type: None },
    )
    .await
    .expect("default behavior is unchanged");
    assert_eq!(sid, "sess-1");
}
```

If `effort_agent` or the config-option JSON shape differs from what `resolve_model_switch_method` reads, copy the exact `configOptions` fixture used by the nearest existing "not found" test in `model_switch_tests` and keep the assertions above.

- [ ] **Step 2: Implement config and agent field**

`config.rs` Args (next to `model`):

```rust
    /// Refuse to run a turn when the desired model is not offered, instead of
    /// falling back to the agent's default model. Set for Start free so a
    /// session never moves to a different OpenCode model.
    #[arg(long, env = "BUZZ_ACP_REQUIRE_MODEL", default_value_t = false)]
    pub require_model: bool,
```

`config.rs` Config: `pub require_model: bool,` with doc comment "See `Args::require_model`.", and in the Args to Config mapping `require_model: args.require_model,`.

`pool.rs` `OwnedAgent`:

```rust
    /// When true, a missing or rejected `desired_model` fails the session
    /// instead of continuing on the agent's default model (Start free).
    pub require_desired_model: bool,
```

Set it in every `OwnedAgent { .. }` literal: production literals in `lib.rs` get `require_desired_model: config.require_model,`; test literals get `require_desired_model: false,`. Find them all with `grep -n "desired_model_pending_ack:" crates/buzz-acp/src/*.rs`.

- [ ] **Step 3: Implement the strict arms in `create_session_and_apply_model`**

In the `ModelSwitchOutcome::Rejected` arm and the `None` arm, after the existing `agent.acp.observe(...)` call and before returning `None`, add:

```rust
                if agent.require_desired_model {
                    return Err(AcpError::AgentError {
                        code: -32002,
                        message: format!(
                            "{}{desired}",
                            crate::provider_failure::FREE_MODEL_ENDED_PREFIX
                        ),
                    });
                }
```

(In the `Rejected` arm the binding is also `desired`. Keep the existing `tracing::warn!` in the `None` arm.)

- [ ] **Step 4: Implement the notice and the prompt-result branch**

`provider_failure.rs`:

```rust
/// Message prefix for a session refused because the required model is gone.
pub(crate) const FREE_MODEL_ENDED_PREFIX: &str = "free model ended: ";

/// Channel notice when Start free's model is no longer offered.
pub(crate) fn free_model_ended_notice(error: &AcpError) -> Option<String> {
    match error {
        AcpError::AgentError { code: -32002, message } if message.starts_with(FREE_MODEL_ENDED_PREFIX) => Some(
            "⚠️ Free AI has ended. OpenCode no longer offers the free model. Connect your own AI in Settings, then re-send your request.".to_string(),
        ),
        _ => None,
    }
}
```

`lib.rs`, immediately before the existing `-32002 ... "model not found"` branch near line 4790:

```rust
            } else if let Some(content) = match &result.outcome {
                PromptOutcome::Error(error) => provider_failure::free_model_ended_notice(error),
                _ => None,
            } {
                // Start free never falls back to another model; retrying cannot help.
                tracing::warn!(
                    channel_id = %batch.channel_id,
                    events = batch.events.len(),
                    "dead-lettering batch immediately: required free model is gone"
                );
                spawn_failure_notice(rest_client, &batch, content);
```

Add a test next to the existing `assert_terminal_notice(-32002, ...)` cases near line 11085:

```rust
assert_terminal_notice(-32002, "free model ended: opencode/deepseek-v4.1-flash-free", "⚠️ Free AI has ended. OpenCode no longer offers the free model. Connect your own AI in Settings, then re-send your request.").await;
```

- [ ] **Step 5: Connection test code**

`connection_test.rs`: give the missing-model failure its own type so the code survives:

```rust
const MODEL_UNAVAILABLE: &str = "Selected model is unavailable or this harness does not support model switching. Choose another model.";
```

Use `bail!(ConnectionFailure(MODEL_UNAVAILABLE))` at the existing `None =>` site, and in `error_result`:

```rust
fn error_result(error: &anyhow::Error) -> Value {
    let failure = error.downcast_ref::<ConnectionFailure>();
    let notice = failure.map(ToString::to_string)
        .or_else(|| error.downcast_ref::<crate::AcpError>().and_then(crate::provider_failure::onboarding_notice))
        .unwrap_or_else(|| "Your agent could not reply. Check sign-in and usage, then try again.".to_string());
    if failure.is_some_and(|f| f.0 == MODEL_UNAVAILABLE) {
        json!({"error": notice, "code": "model_unavailable"})
    } else {
        json!({"error": notice})
    }
}
```

(Keep the existing fallback string exactly as it is in the file today; read lines 30-35 first and only add the `code` branch.) Add a unit test in the file's test module:

```rust
#[test]
fn missing_model_result_carries_code() {
    let error: anyhow::Error = ConnectionFailure(MODEL_UNAVAILABLE).into();
    assert_eq!(error_result(&error)["code"], "model_unavailable");
}
```

- [ ] **Step 6: Commit, push, read CI**

```bash
git add crates/buzz-acp/src
git commit -s -m "feat(acp): strict model mode stops instead of falling back

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
LEFTHOOK_EXCLUDE=rust-tests,desktop-tauri-checks git push
```

Expected CI: buzz-acp unit tests pass, including the three new ones and every existing `model_switch_tests` case.

---

### Task 5: Desktop passes strict mode for Start free

**Files:**
- Create: `desktop/src-tauri/src/managed_agents/start_free.rs` (+ `mod start_free;` and `pub(crate) use start_free::apply_start_free_env;` in `managed_agents/mod.rs`)
- Modify: `desktop/src-tauri/src/managed_agents/runtime.rs` (after the `BUZZ_ACP_MODEL` block near line 703)
- Modify: `desktop/src-tauri/src/commands/test_onboarding_connection.rs` (after the `BUZZ_ACP_MODEL` block near line 190)

**Interfaces:**
- Produces: `pub(crate) fn apply_start_free_env(command: &mut std::process::Command, provider: Option<&str>)`; `pub(crate) const START_FREE_PROVIDER: &str = "opencode-free";`

- [ ] **Step 1: Write the failing test** in `start_free.rs`

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn env_of(command: &std::process::Command, key: &str) -> Option<Option<String>> {
        command.get_envs().find(|(k, _)| *k == key).map(|(_, v)| v.map(|v| v.to_string_lossy().into_owned()))
    }

    #[test]
    fn require_model_env_only_for_opencode_free() {
        let mut free = std::process::Command::new("true");
        apply_start_free_env(&mut free, Some("opencode-free"));
        assert_eq!(env_of(&free, "BUZZ_ACP_REQUIRE_MODEL"), Some(Some("1".into())));

        let mut own = std::process::Command::new("true");
        own.env("BUZZ_ACP_REQUIRE_MODEL", "1");
        apply_start_free_env(&mut own, Some("openrouter"));
        assert_eq!(env_of(&own, "BUZZ_ACP_REQUIRE_MODEL"), Some(None), "removed for other providers");

        let mut none = std::process::Command::new("true");
        apply_start_free_env(&mut none, None);
        assert_eq!(env_of(&none, "BUZZ_ACP_REQUIRE_MODEL"), Some(None));
    }
}
```

- [ ] **Step 2: Implement**

```rust
//! Start free: the user's agents run on OpenCode's free model and must never
//! fall back to another model when that model disappears.

/// Provider id saved by the Start free onboarding choice.
pub(crate) const START_FREE_PROVIDER: &str = "opencode-free";

/// Set or clear buzz-acp's strict-model flag for the effective provider.
pub(crate) fn apply_start_free_env(command: &mut std::process::Command, provider: Option<&str>) {
    if provider.map(str::trim) == Some(START_FREE_PROVIDER) {
        command.env("BUZZ_ACP_REQUIRE_MODEL", "1");
    } else {
        command.env_remove("BUZZ_ACP_REQUIRE_MODEL");
    }
}
```

`runtime.rs` after the `BUZZ_ACP_MODEL` if/else:

```rust
    super::apply_start_free_env(&mut command, effective_provider.as_deref());
```

`test_onboarding_connection.rs` after its `BUZZ_ACP_MODEL` block:

```rust
    crate::managed_agents::apply_start_free_env(&mut command, config.provider.as_deref());
```

(The connection test already fails on a missing model through `COLONY_CONNECTION_MODEL`; the env keeps the two paths identical.)

- [ ] **Step 3: Commit, push, read CI**

```bash
git add desktop/src-tauri/src/managed_agents/start_free.rs desktop/src-tauri/src/managed_agents/mod.rs desktop/src-tauri/src/managed_agents/runtime.rs desktop/src-tauri/src/commands/test_onboarding_connection.rs
git commit -s -m "feat(desktop): Start free agents run in strict model mode

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
LEFTHOOK_EXCLUDE=rust-tests,desktop-tauri-checks git push
```

---

### Task 6: Start free onboarding (logic, screen pack, e2e)

The screen's look is designed by a Codex worker (owner rule, 11 Oct: Codex owns layout, look and components). This task fixes behavior, states, copy and test ids; the Codex pass may only change presentation inside those contracts.

**Files:**
- Create: `desktop/src/features/onboarding/ui/startFree.ts` (constants, config builder, error classification)
- Create: `desktop/src/features/onboarding/ui/startFree.test.mjs`
- Create: `desktop/src/features/onboarding/ui/StartFreePanel.tsx`
- Modify: `desktop/src/features/onboarding/ui/onboardingConnectionTest.ts` (carry `code`)
- Modify: `desktop/src/features/onboarding/ui/ConnectSetupStep.tsx` (top-level mode, free flow)
- Modify: `desktop/src/features/onboarding/ui/OnboardingConnectionContent.tsx` (render the mode choice above the existing shell)
- Modify: `desktop/src/features/agents/lib/friendlyAgentLastError.ts` (+ its `.test.mjs`)
- Modify: `desktop/src/testing/e2eBridge.ts` (`onboardingConnectionResult` type gains `code?: string`)
- Modify: `desktop/tests/helpers/onboarding.ts` (`R17RuntimeId` adds `"opencode"`; open-setup helper clicks "Use your own AI" unless `startFree: true`)
- Create: `desktop/tests/e2e/start-free-opencode.spec.ts`
- Modify: `desktop/src/features/agents/AGENTS.md` (onboarding contract: three things, Start free first)

**Interfaces:**
- Consumes: Rust `install_acp_runtime("opencode")`, `test_onboarding_connection` returning `code: "model_unavailable"`.
- Produces:
  - `export const START_FREE_RUNTIME_ID = "opencode"; export const START_FREE_PROVIDER = "opencode-free"; export const START_FREE_MODEL = "opencode/deepseek-v4.1-flash-free";`
  - `export function buildStartFreeConfig(current: GlobalAgentConfig): GlobalAgentConfig`
  - `export class OnboardingConnectionError extends Error { code?: string }`
  - `export function startFreeFailureKind(error: unknown): "ended" | "install" | "other"`

**Screen pack (contract for the Codex visual pass):**

| State | Shown when | Content | Actions (test id) |
| --- | --- | --- | --- |
| Mode choice | Connect step opens | Two radio options. "Start free" (selected by default, body and fine print from Global Constraints). "Use your own AI" (body from Global Constraints). | radio `onboarding-mode-free`, radio `onboarding-mode-own` |
| Free ready | Start free selected, idle | The fine print, primary button "Start free", secondary "Skip for now". | `start-free-continue`, `start-free-skip` |
| Installing | After Start free, while `install_acp_runtime` runs | Title "Setting up free AI...", the live install line from `useInstallOutputLine("opencode", true)`, no buttons except none (cannot cancel a download in v1). | region `start-free-installing` |
| Testing | After install, during the connection test | Existing "testing" scene (unchanged). | existing |
| Install failed | `install_acp_runtime` returned `success: false` or threw | The step's `hint` (or "Free AI could not be set up. Check your internet connection and try again."). | `start-free-retry`, `start-free-use-own` |
| Ended | Connection test error with `code === "model_unavailable"` | "OpenCode's free AI has ended. Connect your own AI to continue." | `start-free-use-own` |
| Use your own AI | Own selected | Today's Connect UI unchanged (runtime list, Colony Agent route, OpenRouter, Skip). | existing |

Keyboard: the two mode options form one roving radio group (arrow keys move and select, Home/End), matching `OnboardingConnectionContent.tsx`'s existing route group. One accessible name per option; the fine print is described by `aria-describedby`, not a second label.

- [ ] **Step 1: Write the failing unit tests** in `startFree.test.mjs`

```js
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildStartFreeConfig,
  OnboardingConnectionError,
  START_FREE_MODEL,
  startFreeFailureKind,
} from "./startFree.ts";

test("buildStartFreeConfig selects OpenCode, the free provider and the free model", () => {
  const config = buildStartFreeConfig({
    preferred_runtime: "claude",
    provider: "openrouter",
    model: "x",
    env_vars: { KEEP: "1" },
  });
  assert.equal(config.preferred_runtime, "opencode");
  assert.equal(config.provider, "opencode-free");
  assert.equal(config.model, START_FREE_MODEL);
  assert.deepEqual(config.env_vars, { KEEP: "1" });
});

test("startFreeFailureKind maps the model_unavailable code to ended", () => {
  assert.equal(
    startFreeFailureKind(new OnboardingConnectionError("gone", "model_unavailable")),
    "ended",
  );
  assert.equal(startFreeFailureKind(new Error("network")), "other");
});
```

Welcome readiness needs no code change: `agentReadiness.ts:83-95` already accepts a non-buzz runtime whose id matches a verified connection receipt. Pin it with a test appended to `agentReadiness.test.mjs` (follow that file's existing `runtime(...)` fixture helper and `resolveAgentReadiness` import):

```js
test("Start free OpenCode is ready at Welcome after a verified test", () => {
  const opencode = runtime("opencode", "available", "not_applicable");
  const result = resolveAgentReadiness(
    [opencode],
    { preferred_runtime: "opencode", provider: "opencode-free", model: "opencode/deepseek-v4.1-flash-free", env_vars: {} },
    "preferred",
    null,
    "opencode",
  );
  assert.equal(result.ready, true);
});
```

Run: `cd desktop && pnpm test 2>&1 | grep -E "startFree|Start free|fail" | head`
Expected: FAIL, cannot find module `./startFree.ts` (the readiness test already passes; it guards against a regression).

- [ ] **Step 2: Implement `startFree.ts`**

```ts
import type { GlobalAgentConfig } from "@/shared/api/types";

export const START_FREE_RUNTIME_ID = "opencode";
export const START_FREE_PROVIDER = "opencode-free";
export const START_FREE_MODEL = "opencode/deepseek-v4.1-flash-free";

/** A connection-test failure that keeps the native result's machine code. */
export class OnboardingConnectionError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = "OnboardingConnectionError";
    this.code = code;
  }
}

/** Start free always runs Colony's OpenCode on its free model. */
export function buildStartFreeConfig(
  current: GlobalAgentConfig,
): GlobalAgentConfig {
  return {
    ...current,
    preferred_runtime: START_FREE_RUNTIME_ID,
    provider: START_FREE_PROVIDER,
    model: START_FREE_MODEL,
  };
}

export function startFreeFailureKind(
  error: unknown,
): "ended" | "install" | "other" {
  if (error instanceof OnboardingConnectionError) {
    if (error.code === "model_unavailable") return "ended";
    if (error.code === "install_failed") return "install";
  }
  return "other";
}
```

In `onboardingConnectionTest.ts`, widen the invoke type to `OnboardingConnectionProof & { error?: string; code?: string }` and replace `if (proof.error) throw new Error(proof.error);` with `if (proof.error) throw new OnboardingConnectionError(proof.error, proof.code);` (import from `./startFree`).

Run: `cd desktop && pnpm test 2>&1 | tail -3`
Expected: PASS.

- [ ] **Step 3: Status copy**

In `friendlyAgentLastError.ts`, add a rule before the generic model-not-found rule: an error containing `"free model ended"` or `"Free AI has ended"` maps to `"Free AI has ended. Connect your own AI in Settings."`. Add the matching case to `friendlyAgentLastError.test.mjs`:

```js
test("free model ended shows the Start free status", () => {
  assert.equal(
    friendlyAgentLastError("free model ended: opencode/deepseek-v4.1-flash-free"),
    "Free AI has ended. Connect your own AI in Settings.",
  );
});
```

(Read the file first and follow its existing rule-table shape and export name.)

- [ ] **Step 4: Write the failing e2e spec** `tests/e2e/start-free-opencode.spec.ts`

```ts
import { expect, test } from "@playwright/test";
import { openR17ConnectionSetup, r17Runtime } from "../helpers/onboarding";

const opencodeMissing = r17Runtime("opencode", "not_installed", { status: "unknown" });
const opencodeInstalled = r17Runtime("opencode", "available", { status: "not_applicable" });

test("start free is the default and finishes with a real reply", async ({ page }) => {
  await openR17ConnectionSetup(page, {
    startFree: true,
    runtimes: [opencodeMissing],
    mock: {
      acpRuntimesCatalogAfterInstall: [opencodeInstalled],
      installAcpRuntimeResult: { success: true, steps: [], restarted_count: 0, failed_restart_count: 0 },
      onboardingConnectionResult: { reply: "Hello! What shall we work on first?", model: "opencode/deepseek-v4.1-flash-free", startupMs: 20, totalMs: 50 },
    },
  });
  await expect(page.getByTestId("onboarding-mode-free")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText("Free while OpenCode offers it.")).toBeVisible();
  await page.getByTestId("start-free-continue").click();
  await expect(page.getByText("Hello! What shall we work on first?")).toBeVisible();
});

test("start free install failure offers retry and own AI", async ({ page }) => {
  await openR17ConnectionSetup(page, {
    startFree: true,
    runtimes: [opencodeMissing],
    mock: {
      installAcpRuntimeResult: {
        success: false,
        steps: [{ step: "opencode", command: "Colony OpenCode v1.19.2", success: false, stdout: "", stderr: "download OpenCode HTTP 503", exit_code: null, hint: "Check your internet connection and try again. Choose Use your own AI to connect Claude Code, Codex or OpenRouter instead." }],
        restarted_count: 0,
        failed_restart_count: 0,
      },
    },
  });
  await page.getByTestId("start-free-continue").click();
  await expect(page.getByTestId("start-free-retry")).toBeVisible();
  await page.getByTestId("start-free-use-own").click();
  await expect(page.getByTestId("onboarding-mode-own")).toHaveAttribute("aria-checked", "true");
});

test("start free shows the ended screen when the free model is gone", async ({ page }) => {
  await openR17ConnectionSetup(page, {
    startFree: true,
    runtimes: [opencodeInstalled],
    mock: {
      onboardingConnectionResult: { error: "Selected model is unavailable or this harness does not support model switching. Choose another model.", code: "model_unavailable" },
    },
  });
  await page.getByTestId("start-free-continue").click();
  await expect(page.getByText("OpenCode's free AI has ended. Connect your own AI to continue.")).toBeVisible();
  await expect(page.getByText(/big-pickle/i)).toHaveCount(0);
});

test("mode choice is a keyboard radio group", async ({ page }) => {
  await openR17ConnectionSetup(page, { startFree: true, runtimes: [opencodeMissing] });
  await page.getByTestId("onboarding-mode-free").focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByTestId("onboarding-mode-own")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("onboarding-mode-own")).toBeFocused();
});
```

Check the exact mock field names (`acpRuntimesCatalogAfterInstall`, `installAcpRuntimeResult`) against `tests/helpers/bridge.ts:330-365` before running; adjust the spec, not the bridge, if a name differs.

Run: `cd desktop && pnpm build:e2e && pnpm exec playwright test tests/e2e/start-free-opencode.spec.ts --project=smoke`
Expected: FAIL (no `onboarding-mode-free`).

- [ ] **Step 5: Implement the flow**

`ConnectSetupStep.tsx`:
  - New state `const [mode, setMode] = React.useState<"free" | "own">("free");` and `const [freeState, setFreeState] = React.useState<"idle" | "installing" | "install-failed" | "ended">("idle");` plus `const [freeInstallHint, setFreeInstallHint] = React.useState<string | null>(null);`.
  - `startFree` handler:
    1. `setFreeState("installing")`; `const result = await installAcpRuntime(START_FREE_RUNTIME_ID);` (from `@/shared/api/tauri`).
    2. On `!result.success` (or a throw): `setFreeInstallHint(result.steps.at(-1)?.hint ?? "Free AI could not be set up. Check your internet connection and try again.")`, `setFreeState("install-failed")`, return.
    3. `await runtimes.refetch()`; then call the existing `continueWithRuntime` path with the Start free candidate. Extend `continueWithRuntime(creditsCandidate?: GlobalAgentConfig)` to `continueWithRuntime(candidateOverride?: { config: GlobalAgentConfig; runtimeId: string; credits: boolean })` so both credits and Start free pass an explicit config and runtime id:
       - `ColonyCreditsOption onSelect={(config) => continueWithRuntime({ config, runtimeId: "buzz-agent", credits: true })}`.
       - Start free passes `{ config: buildStartFreeConfig(globalConfig), runtimeId: START_FREE_RUNTIME_ID, credits: false }`.
       - Inside: `runtimeId = candidateOverride?.runtimeId ?? (colonyPath ? "buzz-agent" : selectedRuntimeId)`; the credits-only checks run only when `candidateOverride?.credits`; `buildOnboardingRuntimeCandidate(candidateOverride?.config ?? globalConfig, runtimeId, runtimes.data ?? [], candidateOverride || colonyPath ? undefined : selectedModel)`; the `!aiReady` early return is skipped when `candidateOverride` is set.
       - Rename `creditsAttempt` to `lastOverride` (type `typeof candidateOverride`) and keep the retry path `if (scene === "testing") void continueWithRuntime(lastOverride.current);`.
       - Check `buildOnboardingRuntimeCandidate` (`saveOnboardingRuntime.ts:7-31`): it resets model/provider when the runtime changes. For Start free the candidate already carries `preferred_runtime: "opencode"`, so the reset must not clear `START_FREE_MODEL`. Add a node test in `startFree.test.mjs` that `buildOnboardingRuntimeCandidate(buildStartFreeConfig(cfg), "opencode", [], undefined)` keeps provider `opencode-free` and model `START_FREE_MODEL`, and fix the helper if it fails.
    4. In the existing `catch (failure)`: if `mode === "free" && startFreeFailureKind(failure) === "ended"`, `setFreeState("ended")` and `setTestState("connect")` instead of the generic connection-error scene.
  - Render: when `mode === "free"`, render `<StartFreePanel state={freeState} hint={freeInstallHint} onStart={startFree} onRetry={startFree} onUseOwn={() => { setMode("own"); setFreeState("idle"); }} onSkip={() => onContinue()} />` in place of the existing connection content; when `mode === "own"`, render today's content unchanged.

`OnboardingConnectionContent.tsx` `ConnectionShell`: accept `mode` and `onModeChange` props and render the two-option radio group above the existing heading block; render the harness picker, routes and `content` only when `mode === "own"`. Copy the existing roving-radio keyboard handler for the new group.

`StartFreePanel.tsx`: renders the Free ready, Installing, Install failed and Ended states from the screen pack, with the exact copy and test ids. Use `useInstallOutputLine("opencode", state === "installing")` for the live line. Plain structure only; the Codex pass styles it.

`tests/helpers/onboarding.ts`: add `"opencode"` to `R17RuntimeId` with label `"OpenCode"`, add `startFree?: boolean` to `R17ConnectionSetupOptions`, and at the end of `openR17ConnectionSetup` click `getByTestId("onboarding-mode-own")` unless `options.startFree`, so every existing spec keeps testing today's UI.

Run: `cd desktop && pnpm exec tsc --noEmit && pnpm exec biome check --write src tests && pnpm build:e2e && pnpm exec playwright test tests/e2e/start-free-opencode.spec.ts --project=smoke`
Expected: 4 passed.

- [ ] **Step 6: Regression run (one heavy command at a time)**

Run: `cd desktop && pnpm exec playwright test tests/e2e/onboarding-agent-defaults.spec.ts tests/e2e/connect-polish.spec.ts tests/e2e/credits-gateway-option.spec.ts tests/e2e/openrouter-oauth.spec.ts tests/e2e/onboarding-two-paths-screenshots.spec.ts tests/e2e/onboarding.spec.ts --project=smoke`
then the same list with `--project=integration`.
Expected: all pass. Fix any spec that opened Connect without the helper by clicking `onboarding-mode-own` first.

- [ ] **Step 7: Commit and push**

```bash
git add desktop/src desktop/tests
git commit -s -m "feat(desktop): Start free is the first Connect choice

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
LEFTHOOK_EXCLUDE=rust-tests,desktop-tauri-checks git push
```

- [ ] **Step 8: Codex visual pass**

Dispatch one Codex worker (Superset workspace on this branch) with: this task's screen pack, the approved layout (Start free on top and selected, Use your own AI below), the existing Connect step styles in `onboardingCalibration.css`, and the rule "presentation only: keep copy, test ids, states and keyboard behavior". It commits to this branch; I re-run Step 5 and Step 6 commands after its commit.

---

### Task 7: Ship gate

- [ ] **Step 1:** Mark the PR ready only when every CI check is green (never merge red). Merge into develop with the REST merge pinned to the head sha.
- [ ] **Step 2:** Candidate: `release/1.0.9-candidate` = this branch head (based on main 1.0.8) + `bash scripts/bump-version.sh 1.0.9`; draft PR into main; wait for green.
- [ ] **Step 3:** Packaged gate on the candidate's macOS arm64 build, fresh app profile, never the owner's real profile:
  - Connect shows Start free selected; Start free downloads OpenCode into the managed folder (check the path and the binary's SHA of the archive in the install log); the connection test replies; Welcome follows.
  - An agent created at Welcome replies in a channel and completes a task that uses a tool.
  - Ended path: point a test config's model at `opencode/deepseek-v9-flash-free` and confirm the channel shows the Free AI has ended notice and the agent does not answer on `big-pickle`.
- [ ] **Step 4:** Proof page with screenshots (390 and 1440) and an honest NOT-verified list (Windows and Linux real machines, speed at busy hours). Then ask the owner to promote 1.0.9.
