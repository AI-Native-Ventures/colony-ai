use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitStatus, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use crate::{client::BuzzClient, error::CliError, DesignCmd};
use nostr::{EventBuilder, Kind, Tag};

const NODE_VERSION: &str = "v24.18.0";
const NODE_ARCHIVE_MAX_BYTES: u64 = 90 * 1024 * 1024;
const NODE_RUNTIME_TIMEOUT: Duration = Duration::from_secs(6 * 60);
const DESIGN_COMMAND_TIMEOUT: Duration = Duration::from_secs(120 * 60);
const HELPER_SOURCE: &str = include_str!("../../../../scripts/open-design/colony-design.mjs");

#[derive(Clone, Copy)]
struct NodeArtifact {
    platform: &'static str,
    filename: &'static str,
    sha256: &'static str,
}

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
const NODE_ARTIFACT: Option<NodeArtifact> = Some(NodeArtifact {
    platform: "darwin-arm64",
    filename: "node-v24.18.0-darwin-arm64.tar.gz",
    sha256: "e1a97e14c99c803e96c7339403282ea05a499c32f8d83defe9ef5ec66f979ed1",
});

#[cfg(all(target_os = "macos", target_arch = "x86_64"))]
const NODE_ARTIFACT: Option<NodeArtifact> = Some(NodeArtifact {
    platform: "darwin-x64",
    filename: "node-v24.18.0-darwin-x64.tar.gz",
    sha256: "dfd0dbd3e721503434df7b7205e719f61b3a3a31b2bcf9729b8b91fea240f080",
});

#[cfg(not(any(
    all(target_os = "macos", target_arch = "aarch64"),
    all(target_os = "macos", target_arch = "x86_64")
)))]
const NODE_ARTIFACT: Option<NodeArtifact> = None;

pub async fn dispatch(command: &DesignCmd) -> Result<(), CliError> {
    let (status, stdout, stderr) = invoke_helper(command)?;
    if !status.success() {
        let message = parse_helper_error(&stderr)
            .unwrap_or_else(|| format!("Open Design command failed: {}", tail(&stderr)));
        return Err(CliError::Other(message));
    }
    let output = String::from_utf8_lossy(&stdout);
    if !output.trim().is_empty() {
        print!("{}", output);
    }
    Ok(())
}

pub async fn dispatch_authenticated(
    command: &DesignCmd,
    client: &BuzzClient,
) -> Result<(), CliError> {
    let (status, stdout, stderr) = invoke_helper(command)?;
    if !status.success() {
        let message = parse_helper_error(&stderr)
            .unwrap_or_else(|| format!("Open Design command failed: {}", tail(&stderr)));
        return Err(CliError::Other(message));
    }
    let DesignCmd::Run { .. } = command else {
        let output = String::from_utf8_lossy(&stdout);
        if !output.trim().is_empty() {
            print!("{}", output);
        }
        return Ok(());
    };
    let mut result: serde_json::Value = serde_json::from_slice(&stdout)
        .map_err(|_| CliError::Other("Open Design returned invalid review data.".into()))?;
    let project_id = result
        .get("id")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| CliError::Other("Open Design returned no project id.".into()))?;
    let channel = result
        .get("channel")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| CliError::Usage("Create the design with --channel <current-channel-uuid> so Colony can post its owner review card.".into()))?;
    let channel_id = uuid::Uuid::parse_str(channel)
        .map_err(|_| CliError::Usage("The design review channel id is invalid.".into()))?;
    let title = result
        .get("title")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("Design ready for review");
    let runtime = result
        .get("runtime")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("unknown");
    let card = serde_json::json!({
        "type": "colony-design-review",
        "projectId": project_id,
        "title": title,
        "runtime": runtime,
        "engine": "Open Design 0.25.1",
        "status": "ready_for_review",
    });
    let channel_tag = channel_id.to_string();
    let builder = EventBuilder::new(
        Kind::Custom(buzz_core::kind::KIND_STREAM_MESSAGE as u16),
        serde_json::to_string(&card).map_err(|error| CliError::Other(error.to_string()))?,
    )
    .tags([
        Tag::parse(["h", channel_tag.as_str()])
            .map_err(|error| CliError::Other(format!("channel tag error: {error}")))?,
        Tag::parse(["colony-design", project_id])
            .map_err(|error| CliError::Other(format!("design tag error: {error}")))?,
    ]);
    let event = client.sign_event(builder)?;
    let event_id = event.id.to_hex();
    client.submit_event(event).await.map_err(|error| {
        CliError::Other(format!(
            "The design is ready, but Colony could not post its review card. Run `buzz design run {project_id}` again to retry delivery: {error}"
        ))
    })?;
    if let Some(object) = result.as_object_mut() {
        object.insert("reviewCardEventId".into(), serde_json::json!(event_id));
        object.insert("reviewCardPosted".into(), serde_json::Value::Bool(true));
    }
    println!("{result}");
    Ok(())
}

fn invoke_helper(command: &DesignCmd) -> Result<(ExitStatus, Vec<u8>, Vec<u8>), CliError> {
    let app_root = dirs::data_dir()
        .ok_or_else(|| CliError::Other("Colony app data directory is unavailable".into()))?
        .join("Colony");
    let design_root = app_root.join("design");
    std::fs::create_dir_all(&design_root).map_err(|error| {
        CliError::Other(format!("could not create design data directory: {error}"))
    })?;
    let node = ensure_node(&app_root)?;
    let helper = design_root.join("runtime").join("colony-design.mjs");
    if let Some(parent) = helper.parent() {
        std::fs::create_dir_all(parent).map_err(|error| {
            CliError::Other(format!(
                "could not create Open Design runtime folder: {error}"
            ))
        })?;
    }
    write_helper(&helper)?;

    let args = command_args(command);
    let mut child = Command::new(&node);
    child.arg(&helper).args(&args);
    child.env("COLONY_DESIGN_DATA_DIR", &design_root);
    for key in [
        "COLONY_DESIGN_OD",
        "COLONY_DESIGN_TEST_MODE",
        "COLONY_DESIGN_TEST_CHILD_TIMEOUT_MS",
        "STUB_GATEWAY_URL",
    ] {
        child.env_remove(key);
    }
    child.env_remove("COLONY_WORKER_AGENT_BIN");
    if let Some(agent) = bundled_buzz_agent_path() {
        child.env("COLONY_WORKER_AGENT_BIN", agent);
    }
    child.env("COLONY_MANAGED_NODE", &node);
    let node_bin = node.parent().unwrap_or(Path::new("/usr/bin"));
    let corepack = node_bin.join("corepack");
    if corepack.is_file() {
        child.env("COLONY_COREPACK", &corepack);
    }
    let old_path = std::env::var_os("PATH").unwrap_or_default();
    let mut paths = vec![node_bin.to_path_buf()];
    paths.extend(std::env::split_paths(&old_path));
    let path = std::env::join_paths(paths).map_err(|error| {
        CliError::Other(format!(
            "could not configure Open Design runtime path: {error}"
        ))
    })?;
    child.env("PATH", path);
    run_bounded(&mut child, DESIGN_COMMAND_TIMEOUT)
}

fn bundled_buzz_agent_path() -> Option<PathBuf> {
    let invoked = std::env::args_os().next().map(PathBuf::from);
    let executable = std::env::current_exe().ok();
    let resolved = executable
        .as_ref()
        .and_then(|path| std::fs::canonicalize(path).ok());
    [invoked, executable, resolved]
        .into_iter()
        .flatten()
        .filter_map(|program| program.parent().map(Path::to_path_buf))
        .map(|directory| directory.join("buzz-agent"))
        .find(|candidate| candidate.is_file())
}

fn command_args(command: &DesignCmd) -> Vec<String> {
    match command {
        DesignCmd::New {
            name,
            brief,
            runtime,
            channel,
        } => {
            let mut args = vec![
                "new".to_string(),
                "--name".to_string(),
                name.clone(),
                "--brief".to_string(),
                brief.clone(),
                "--runtime".to_string(),
                runtime.as_str().to_string(),
            ];
            if let Some(channel) = channel {
                args.extend(["--channel".to_string(), channel.clone()]);
            }
            args
        }
        DesignCmd::Run { project_id, prompt } => {
            let mut args = vec!["run".to_string(), project_id.clone()];
            if let Some(prompt) = prompt {
                args.extend(["--prompt".to_string(), prompt.clone()]);
            }
            args
        }
        DesignCmd::Status { project_id } => vec!["status".to_string(), project_id.clone()],
        DesignCmd::Preview { project_id } => vec!["preview".to_string(), project_id.clone()],
        DesignCmd::Export {
            project_id,
            format,
            out,
        } => {
            let mut args = vec![
                "export".to_string(),
                project_id.clone(),
                "--format".to_string(),
                format.clone(),
            ];
            if let Some(out) = out {
                args.extend(["--out".to_string(), out.to_string_lossy().into_owned()]);
            }
            args
        }
        DesignCmd::Stop { project_id } => vec!["stop".to_string(), project_id.clone()],
    }
}

fn write_helper(path: &Path) -> Result<(), CliError> {
    if path.exists() {
        let existing = std::fs::read_to_string(path).map_err(|error| {
            CliError::Other(format!("could not read Open Design helper: {error}"))
        })?;
        if existing == HELPER_SOURCE {
            return Ok(());
        }
    }
    let temp = path.with_extension(format!("{}.tmp", std::process::id()));
    std::fs::write(&temp, HELPER_SOURCE)
        .map_err(|error| CliError::Other(format!("could not write Open Design helper: {error}")))?;
    std::fs::rename(&temp, path)
        .map_err(|error| CliError::Other(format!("could not activate Open Design helper: {error}")))
}

fn ensure_node(app_root: &Path) -> Result<PathBuf, CliError> {
    if let Some(path) = managed_node_path(app_root) {
        if node_is_pinned(&path) {
            return Ok(path);
        }
    }
    let artifact = NODE_ARTIFACT.ok_or_else(|| {
        CliError::Other(format!(
            "Open Design does not have a managed Node.js package for {}-{}",
            std::env::consts::OS,
            std::env::consts::ARCH
        ))
    })?;
    install_node(app_root, artifact)?;
    managed_node_path(app_root)
        .filter(|path| node_is_pinned(path))
        .ok_or_else(|| {
            CliError::Other("Colony could not verify its managed Node.js runtime".into())
        })
}

fn managed_node_path(app_root: &Path) -> Option<PathBuf> {
    let artifact = NODE_ARTIFACT?;
    let root = app_root
        .join("runtimes")
        .join("node")
        .join(NODE_VERSION)
        .join(artifact.platform);
    #[cfg(windows)]
    let node = root.join("node.exe");
    #[cfg(not(windows))]
    let node = root.join("bin").join("node");
    Some(node)
}

fn node_is_pinned(path: &Path) -> bool {
    Command::new(path)
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .ok()
        .is_some_and(|output| {
            output.status.success()
                && String::from_utf8_lossy(&output.stdout).trim() == NODE_VERSION
        })
}

fn install_node(app_root: &Path, artifact: NodeArtifact) -> Result<(), CliError> {
    install_node_with_curl(app_root, artifact, Path::new("curl"))
}

fn install_node_with_curl(
    app_root: &Path,
    artifact: NodeArtifact,
    curl_command: &Path,
) -> Result<(), CliError> {
    let runtime_root = app_root.join("runtimes").join("node");
    std::fs::create_dir_all(&runtime_root).map_err(|error| {
        CliError::Other(format!("could not create managed Node folder: {error}"))
    })?;
    let staging = runtime_root.join(format!("{NODE_VERSION}-{}-install", artifact.platform));
    let archive = runtime_root.join(artifact.filename);
    if staging.exists() {
        std::fs::remove_dir_all(&staging).map_err(|error| {
            CliError::Other(format!("could not clear old Node install: {error}"))
        })?;
    }
    std::fs::create_dir_all(&staging).map_err(|error| {
        CliError::Other(format!("could not create Node staging folder: {error}"))
    })?;
    let url = format!(
        "https://nodejs.org/dist/{NODE_VERSION}/{}",
        artifact.filename
    );
    let mut curl = Command::new(curl_command);
    curl.args([
        "--fail",
        "--location",
        "--silent",
        "--show-error",
        "--connect-timeout",
        "10",
        "--max-time",
        "300",
        "--max-filesize",
        &NODE_ARCHIVE_MAX_BYTES.to_string(),
        "--output",
    ])
    .arg(&archive)
    .arg(url);
    let (status, _, stderr) = run_bounded(&mut curl, NODE_RUNTIME_TIMEOUT)?;
    if !status.success() {
        return Err(CliError::Other(format!(
            "Colony could not download Node.js: {}",
            tail(&stderr)
        )));
    }
    let actual = sha256_file(&archive)?;
    if actual != artifact.sha256 {
        let _ = std::fs::remove_file(&archive);
        let _ = std::fs::remove_dir_all(&staging);
        return Err(CliError::Other(
            "Colony Node.js archive checksum did not match".into(),
        ));
    }
    let mut tar = Command::new("tar");
    tar.arg("-xzf").arg(&archive).arg("-C").arg(&staging);
    let (status, _, stderr) = run_bounded(&mut tar, NODE_RUNTIME_TIMEOUT)?;
    let _ = std::fs::remove_file(&archive);
    if !status.success() {
        return Err(CliError::Other(format!(
            "Colony could not extract Node.js: {}",
            tail(&stderr)
        )));
    }
    let extracted = staging.join(artifact.filename.trim_end_matches(".tar.gz"));
    if !extracted.join("bin/node").is_file() || !extracted.join("bin/corepack").is_file() {
        return Err(CliError::Other(
            "Colony Node.js archive was missing node or corepack".into(),
        ));
    }
    let final_dir = runtime_root.join(NODE_VERSION).join(artifact.platform);
    if let Some(parent) = final_dir.parent() {
        std::fs::create_dir_all(parent).map_err(|error| {
            CliError::Other(format!(
                "could not create Node runtime version folder: {error}"
            ))
        })?;
    }
    if final_dir.exists() {
        std::fs::remove_dir_all(&final_dir).map_err(|error| {
            CliError::Other(format!(
                "could not replace incomplete Node runtime: {error}"
            ))
        })?;
    }
    std::fs::rename(&extracted, &final_dir)
        .map_err(|error| CliError::Other(format!("could not activate managed Node.js: {error}")))?;
    std::fs::remove_dir_all(&staging).map_err(|error| {
        CliError::Other(format!("could not clean Node staging folder: {error}"))
    })?;
    Ok(())
}

fn sha256_file(path: &Path) -> Result<String, CliError> {
    use sha2::{Digest, Sha256};
    let mut file = std::fs::File::open(path).map_err(|error| {
        CliError::Other(format!(
            "could not read downloaded Node.js archive: {error}"
        ))
    })?;
    let mut hash = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer).map_err(|error| {
            CliError::Other(format!("could not verify Node.js archive: {error}"))
        })?;
        if read == 0 {
            break;
        }
        hash.update(&buffer[..read]);
    }
    Ok(hex::encode(hash.finalize()))
}

fn run_bounded(
    command: &mut Command,
    timeout: Duration,
) -> Result<(ExitStatus, Vec<u8>, Vec<u8>), CliError> {
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    let mut child = command.spawn().map_err(|error| {
        CliError::Other(format!("could not start managed design process: {error}"))
    })?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| CliError::Other("design stdout is unavailable".into()))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| CliError::Other("design stderr is unavailable".into()))?;
    let stdout_thread = thread::spawn(move || read_capped(stdout, 1024 * 1024));
    let stderr_thread = thread::spawn(move || read_capped(stderr, 64 * 1024));
    let started = Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|error| {
            CliError::Other(format!("could not read design process status: {error}"))
        })? {
            break status;
        }
        if started.elapsed() >= timeout {
            kill_process_tree(child.id());
            let _ = child.kill();
            let _ = child.wait();
            let _ = stdout_thread.join();
            let _ = stderr_thread.join();
            return Err(CliError::Other(
                "Open Design stopped after reaching its process time limit".into(),
            ));
        }
        thread::sleep(Duration::from_millis(100));
    };
    let stdout = stdout_thread
        .join()
        .map_err(|_| CliError::Other("design stdout reader stopped".into()))?;
    let stderr = stderr_thread
        .join()
        .map_err(|_| CliError::Other("design stderr reader stopped".into()))?;
    Ok((status, stdout, stderr))
}

fn read_capped(mut reader: impl Read, limit: usize) -> Vec<u8> {
    let mut output = Vec::with_capacity(limit.min(8192));
    let mut buffer = [0_u8; 8192];
    loop {
        match reader.read(&mut buffer) {
            Ok(0) | Err(_) => break,
            Ok(count) => {
                let remaining = limit.saturating_sub(output.len());
                output.extend_from_slice(&buffer[..count.min(remaining)]);
            }
        }
    }
    output
}

fn kill_process_tree(pid: u32) {
    #[cfg(unix)]
    {
        let group = format!("-{pid}");
        let _ = Command::new("/bin/kill")
            .args(["-KILL", group.as_str()])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    #[cfg(windows)]
    {
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
}

fn parse_helper_error(stderr: &[u8]) -> Option<String> {
    let text = String::from_utf8_lossy(stderr);
    text.lines().rev().find_map(|line| {
        let value = serde_json::from_str::<serde_json::Value>(line).ok()?;
        let message = value.get("message")?.as_str()?;
        Some(message.to_string())
    })
}

fn tail(bytes: &[u8]) -> String {
    let text = String::from_utf8_lossy(bytes);
    let text = text.trim();
    if text.len() <= 1024 {
        text.to_string()
    } else {
        text.chars()
            .rev()
            .take(1024)
            .collect::<String>()
            .chars()
            .rev()
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::DesignRuntime;
    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;

    #[test]
    fn open_design_version_and_source_checksum_are_pinned() {
        assert!(HELPER_SOURCE.contains("5a0c47777975ddb91d09c1c16b423a3ef74bf572"));
        assert!(HELPER_SOURCE
            .contains("b6c577544d74d1d3aa3352651219a1cdbe91749bcc5587e37d06e489c0c0ff01"));
    }

    #[test]
    fn cli_argument_mapping_keeps_start_free_on_colony_gateway_adapter() {
        let command = DesignCmd::New {
            name: "Landing page".into(),
            brief: "A crisp landing page for a local design studio.".into(),
            runtime: DesignRuntime::ColonyBuzzAgent,
            channel: Some("9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50".into()),
        };
        let args = command_args(&command);
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--runtime", "colony-buzz-agent"]));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--brief", "A crisp landing page for a local design studio."]));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--channel", "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50"]));
    }

    #[test]
    fn helper_output_and_errors_are_bounded() {
        let oversized = vec![b'x'; 80 * 1024];
        assert!(tail(&oversized).len() <= 1024);
        assert_eq!(read_capped(&b"abc"[..], 2), b"ab");
        assert_eq!(
            parse_helper_error(
                br#"{"error":"OWNER_APPROVAL_REQUIRED","message":"Approve the design first."}"#
            ),
            Some("Approve the design first.".into()),
        );
    }

    #[cfg(unix)]
    #[test]
    fn checksum_mismatch_cleans_unactivated_node_staging() {
        let temp = tempfile::tempdir().unwrap();
        let curl = temp.path().join("corrupt-curl");
        std::fs::write(
            &curl,
            "#!/bin/sh\noutput=\"\"\nwhile [ \"$#\" -gt 0 ]; do\n  if [ \"$1\" = \"--output\" ]; then output=\"$2\"; break; fi\n  shift\ndone\nprintf corrupt > \"$output\"\n",
        )
        .unwrap();
        let mut permissions = std::fs::metadata(&curl).unwrap().permissions();
        permissions.set_mode(0o700);
        std::fs::set_permissions(&curl, permissions).unwrap();
        let artifact = NodeArtifact {
            platform: "test",
            filename: "node-test.tar.gz",
            sha256: "0000000000000000000000000000000000000000000000000000000000000000",
        };

        let error = install_node_with_curl(temp.path(), artifact, &curl).unwrap_err();

        assert!(error
            .to_string()
            .contains("Node.js archive checksum did not match"));
        let runtime_root = temp.path().join("runtimes").join("node");
        assert!(!runtime_root.join("v24.18.0-test-install").exists());
        assert!(!runtime_root.join("node-test.tar.gz").exists());
    }
}
