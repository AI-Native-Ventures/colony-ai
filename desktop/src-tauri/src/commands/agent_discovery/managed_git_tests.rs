use super::*;
use crate::managed_agents::{managed_git_bash_in, MANAGED_GIT_ARTIFACTS};
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::sync::Arc;

/// A small stand-in for the MinGit zip: the files `complete_tree` requires.
fn mingit_like_zip() -> Vec<u8> {
    zip_bytes(&[
        ("cmd/git.exe", b"git"),
        ("usr/bin/sh.exe", b"GNU bash stand-in"),
        ("usr/bin/msys-2.0.dll", b"dll"),
        ("usr/bin/ls.exe", b"ls"),
        ("LICENSE.txt", b"GNU GENERAL PUBLIC LICENSE"),
        ("ucrt64/share/licenses/curl/LICENSE", b"curl"),
    ])
}

fn zip_bytes(entries: &[(&str, &[u8])]) -> Vec<u8> {
    let mut buf: Vec<u8> = Vec::new();
    {
        let mut writer = zip::ZipWriter::new(std::io::Cursor::new(&mut buf));
        let opts = zip::write::SimpleFileOptions::default();
        for (name, body) in entries {
            writer.start_file(*name, opts).unwrap();
            writer.write_all(body).unwrap();
        }
        writer.finish().unwrap();
    }
    buf
}

fn write_zip(dir: &Path, name: &str, bytes: &[u8]) -> std::path::PathBuf {
    let path = dir.join(name);
    std::fs::write(&path, bytes).unwrap();
    path
}

fn digest(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

/// Serve one HTTP response with `body` on localhost and return its URL.
fn serve_once(body: Vec<u8>) -> String {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    std::thread::spawn(move || {
        if let Ok((mut stream, _)) = listener.accept() {
            let mut request = [0_u8; 2048];
            let _ = stream.read(&mut request);
            let header = format!(
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            );
            let _ = stream.write_all(header.as_bytes());
            let _ = stream.write_all(&body);
        }
    });
    format!("http://{addr}/MinGit.zip")
}

fn test_artifact(sha256: &'static str) -> ManagedGitArtifact {
    ManagedGitArtifact {
        platform: "windows-x64",
        filename: "MinGit-test-64-bit.zip",
        sha256,
    }
}

fn leaked(text: String) -> &'static str {
    Box::leak(text.into_boxed_str())
}

fn collecting_observer() -> (LineObserver, Arc<Mutex<Vec<String>>>) {
    let lines = Arc::new(Mutex::new(Vec::new()));
    let sink = lines.clone();
    let observer: LineObserver = Arc::new(move |line: &str| sink.lock().unwrap().push(line.into()));
    (observer, lines)
}

#[test]
fn progress_lines_are_throttled_to_four_megabytes_and_the_end() {
    let last = Cell::new(0);
    let total = Some(38 * MB);
    assert_eq!(progress_line(MB, total, &last), None);
    assert_eq!(
        progress_line(4 * MB, total, &last).as_deref(),
        Some("Downloading shell tools: 4 of 38 MB")
    );
    assert_eq!(progress_line(6 * MB, total, &last), None);
    assert_eq!(
        progress_line(38 * MB, total, &last).as_deref(),
        Some("Downloading shell tools: 38 of 38 MB")
    );
    let last = Cell::new(0);
    assert_eq!(
        progress_line(5 * MB, None, &last).as_deref(),
        Some("Downloading shell tools: 5 MB")
    );
}

#[test]
fn unsupported_pc_step_says_so_plainly_and_points_to_git_for_windows() {
    let step = unsupported_step();
    assert!(!step.success);
    assert_eq!(step.step, MANAGED_GIT_UNSUPPORTED_STEP);
    assert_eq!(
        step.stderr,
        "Colony cannot set up its shell tools on this PC yet."
    );
    let hint = step.hint.unwrap();
    assert!(hint.contains("https://git-scm.com/download/win"), "{hint}");
}

#[test]
fn failed_step_tells_the_person_to_retry_and_names_the_fallback() {
    let step = failed_step("download shell tools request failed: dns".into());
    assert!(!step.success);
    assert_eq!(step.step, MANAGED_GIT_STEP);
    assert_eq!(step.stderr, "download shell tools request failed: dns");
    let hint = step.hint.unwrap();
    assert!(
        hint.starts_with("Check your internet connection and try again."),
        "{hint}"
    );
    assert!(hint.contains("install Git for Windows"), "{hint}");
    assert!(!hint.contains('\u{2014}'), "no em dash: {hint}");
}

#[test]
fn unpacking_makes_a_folder_the_resolver_accepts() {
    let work = tempfile::tempdir().unwrap();
    let archive = write_zip(work.path(), "m.zip", &mingit_like_zip());
    let final_dir = work.path().join("final");
    let temp_dir = work.path().join("final.tmp");

    unpack_into_place(&final_dir, &temp_dir, &archive, "MinGit-test-64-bit.zip").unwrap();

    // The same reader the host uses to find the shell accepts what we wrote.
    let bash = managed_git_bash_in(&final_dir).expect("finished install");
    assert_eq!(bash, final_dir.join("usr").join("bin").join("bash.exe"));
    // bash.exe is a byte for byte copy of sh.exe.
    assert_eq!(
        std::fs::read(&bash).unwrap(),
        std::fs::read(final_dir.join("usr").join("bin").join("sh.exe")).unwrap()
    );
    assert_eq!(
        std::fs::read_to_string(final_dir.join(MANAGED_GIT_MARKER)).unwrap(),
        expected_marker()
    );
    assert!(!temp_dir.exists(), "temp folder was renamed into place");
}

#[test]
fn gits_license_files_stay_and_a_notice_is_added() {
    let work = tempfile::tempdir().unwrap();
    let archive = write_zip(work.path(), "m.zip", &mingit_like_zip());
    let final_dir = work.path().join("final");
    unpack_into_place(
        &final_dir,
        &work.path().join("final.tmp"),
        &archive,
        "MinGit-test-64-bit.zip",
    )
    .unwrap();

    assert_eq!(
        std::fs::read_to_string(final_dir.join("LICENSE.txt")).unwrap(),
        "GNU GENERAL PUBLIC LICENSE"
    );
    assert!(final_dir
        .join("ucrt64")
        .join("share")
        .join("licenses")
        .join("curl")
        .join("LICENSE")
        .is_file());
    let notice = std::fs::read_to_string(final_dir.join("COLONY-NOTICE.txt")).unwrap();
    assert!(notice.contains("MinGit 2.56.0.4"), "{notice}");
    assert!(notice.contains("GNU General Public License"), "{notice}");
    assert!(notice.contains("LICENSE.txt"), "{notice}");
    assert!(notice.contains("https://github.com/git-for-windows/git"));
    assert!(!notice.contains('\u{2014}'), "no em dash");
}

#[test]
fn an_archive_missing_a_required_file_installs_nothing_and_keeps_the_old_install() {
    for missing in REQUIRED_FILES {
        let work = tempfile::tempdir().unwrap();
        let all: Vec<(&str, &[u8])> = vec![
            ("cmd/git.exe", b"git"),
            ("usr/bin/sh.exe", b"bash"),
            ("usr/bin/msys-2.0.dll", b"dll"),
            ("LICENSE.txt", b"license"),
        ];
        let entries: Vec<(&str, &[u8])> = all
            .into_iter()
            .filter(|(name, _)| name != missing)
            .collect();
        let archive = write_zip(work.path(), "m.zip", &zip_bytes(&entries));
        let final_dir = work.path().join("final");
        std::fs::create_dir_all(&final_dir).unwrap();
        std::fs::write(final_dir.join("previous.txt"), b"keep").unwrap();

        let err = unpack_into_place(
            &final_dir,
            &work.path().join("final.tmp"),
            &archive,
            "MinGit-test-64-bit.zip",
        )
        .unwrap_err();

        assert!(err.contains(missing), "{missing}: {err}");
        assert!(final_dir.join("previous.txt").is_file(), "{missing}");
        assert!(managed_git_bash_in(&final_dir).is_none(), "{missing}");
    }
}

#[test]
fn an_archive_that_escapes_its_folder_is_refused() {
    let work = tempfile::tempdir().unwrap();
    let archive = write_zip(
        work.path(),
        "m.zip",
        &zip_bytes(&[("../escape.txt", b"x"), ("cmd/git.exe", b"git")]),
    );
    let final_dir = work.path().join("final");
    let err = unpack_into_place(
        &final_dir,
        &work.path().join("final.tmp"),
        &archive,
        "MinGit-test-64-bit.zip",
    )
    .unwrap_err();
    assert!(err.contains("path traversal"), "{err}");
    assert!(!work.path().join("escape.txt").exists());
    assert!(!final_dir.exists());
}

#[test]
fn a_pinned_download_installs_and_reports_progress() {
    let work = tempfile::tempdir().unwrap();
    let bytes = mingit_like_zip();
    let artifact = test_artifact(leaked(digest(&bytes)));
    let url = serve_once(bytes);
    let final_dir = work
        .path()
        .join("mingit")
        .join("2.56.0.4")
        .join("windows-x64");
    let (observer, lines) = collecting_observer();

    install(&final_dir, artifact, &url, Some(&observer)).unwrap();

    assert!(managed_git_bash_in(&final_dir).is_some());
    let lines = lines.lock().unwrap().clone();
    assert_eq!(
        lines.last().map(String::as_str),
        Some("Unpacking shell tools")
    );
    assert!(
        lines
            .iter()
            .any(|l| l.starts_with("Downloading shell tools:")),
        "{lines:?}"
    );
    // No download or temp leftovers next to the finished folder.
    let leftovers: Vec<_> = std::fs::read_dir(final_dir.parent().unwrap())
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    assert_eq!(leftovers, ["windows-x64"]);
}

#[test]
fn a_download_that_fails_the_pinned_hash_installs_nothing() {
    let work = tempfile::tempdir().unwrap();
    let bytes = mingit_like_zip();
    let artifact = test_artifact(leaked(digest(b"some other file")));
    let url = serve_once(bytes);
    let final_dir = work.path().join("mingit").join("windows-x64");

    let err = install(&final_dir, artifact, &url, None).unwrap_err();

    assert!(err.contains("hash mismatch"), "{err}");
    assert!(!final_dir.exists());
    let leftovers: Vec<_> = std::fs::read_dir(final_dir.parent().unwrap())
        .unwrap()
        .collect();
    assert!(leftovers.is_empty(), "{leftovers:?}");
}

#[test]
fn an_unreachable_download_fails_with_a_message_and_leaves_nothing() {
    let work = tempfile::tempdir().unwrap();
    // A port nothing listens on: bind, note the port, drop the listener.
    let port = std::net::TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port();
    let artifact = test_artifact(leaked(digest(b"x")));
    let final_dir = work.path().join("mingit").join("windows-x64");

    let err = install(
        &final_dir,
        artifact,
        &format!("http://127.0.0.1:{port}/MinGit.zip"),
        None,
    )
    .unwrap_err();

    assert!(
        err.starts_with("download shell tools request failed"),
        "{err}"
    );
    assert!(!final_dir.exists());
}

#[test]
fn the_pinned_artifact_is_the_one_the_installer_will_ask_for() {
    let artifact = MANAGED_GIT_ARTIFACTS[0];
    assert!(managed_git_download_url(artifact).ends_with(artifact.filename));
}

#[test]
fn renaming_retries_then_gives_up_with_the_last_error() {
    let work = tempfile::tempdir().unwrap();
    let missing = work.path().join("nothing-here");
    let started = std::time::Instant::now();
    let err = rename_with_retry_using(
        &missing,
        &work.path().join("target"),
        3,
        Duration::from_millis(20),
    )
    .unwrap_err();
    assert_eq!(err.kind(), std::io::ErrorKind::NotFound);
    // Two pauses between three attempts.
    assert!(started.elapsed() >= Duration::from_millis(40));

    let from = work.path().join("from");
    std::fs::create_dir(&from).unwrap();
    rename_with_retry_using(&from, &work.path().join("to"), 3, Duration::from_millis(20)).unwrap();
    assert!(work.path().join("to").is_dir());
}

#[cfg(not(windows))]
#[test]
fn shell_tools_are_never_wanted_off_windows() {
    assert!(!managed_git_wanted());
}

/// Downloads the real pinned MinGit and runs it. Needs the network and a
/// Windows PC, so it is skipped by default and run by the Windows CI job
/// (`cargo test ... -- --ignored managed_git_live`).
#[cfg(windows)]
#[test]
#[ignore = "downloads the real MinGit; run on the Windows CI runner"]
fn managed_git_live_download_installs_and_runs_bash() {
    let temp = tempfile::tempdir().unwrap();
    // The next CI step runs the agent's shell tool against this same folder.
    let final_dir = std::env::var_os("COLONY_LIVE_MINGIT_DIR")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| temp.path().join("mingit"));
    if final_dir.exists() {
        std::fs::remove_dir_all(&final_dir).unwrap();
    }
    let artifact = MANAGED_GIT_ARTIFACTS[0];
    let (observer, lines) = collecting_observer();

    install(
        &final_dir,
        artifact,
        &managed_git_download_url(artifact),
        Some(&observer),
    )
    .expect("real MinGit download, hash check and unpack");

    let bash = managed_git_bash_in(&final_dir).expect("finished install");
    println!("progress: {:?}", lines.lock().unwrap());

    // A clean environment: no Git for Windows on PATH, only the system folder.
    let system_root = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".into());
    let run = |program: &Path, args: &[&str]| {
        let output = std::process::Command::new(program)
            .args(args)
            .env_clear()
            .env("SystemRoot", &system_root)
            .env("PATH", format!("{system_root}\\System32"))
            .output()
            .expect("spawn");
        (
            output.status.success(),
            String::from_utf8_lossy(&output.stdout).into_owned(),
            String::from_utf8_lossy(&output.stderr).into_owned(),
        )
    };

    let (ok, out, err) = run(&bash, &["-c", "echo $BASH_VERSION"]);
    assert!(ok && !out.trim().is_empty(), "bash --version: {out} {err}");
    let (ok, out, err) = run(&final_dir.join("cmd").join("git.exe"), &["--version"]);
    assert!(ok && out.starts_with("git version"), "git: {out} {err}");
    // Run as bash.exe, bash keeps its full feature set; run as sh.exe it would
    // switch to POSIX mode. `shopt` is a builtin, so no other program is needed.
    let (ok, out, err) = run(&bash, &["-c", "shopt -qo posix && echo posix || echo bash"]);
    assert!(ok && out.trim() == "bash", "bash mode: {out} {err}");
}
