use super::*;

fn finished_install(dir: &Path) {
    std::fs::create_dir_all(dir.join("usr").join("bin")).unwrap();
    std::fs::create_dir_all(dir.join("cmd")).unwrap();
    std::fs::write(dir.join("usr").join("bin").join("bash.exe"), b"bash").unwrap();
    std::fs::write(dir.join("cmd").join("git.exe"), b"git").unwrap();
    std::fs::write(dir.join(MANAGED_GIT_MARKER), expected_marker()).unwrap();
}

#[test]
fn artifact_table_pins_the_64_bit_windows_build() {
    assert_eq!(MANAGED_GIT_ARTIFACTS.len(), 1);
    let artifact = MANAGED_GIT_ARTIFACTS[0];
    assert_eq!(artifact.platform, "windows-x64");
    assert_eq!(artifact.sha256.len(), 64);
    assert!(artifact.sha256.chars().all(|c| c.is_ascii_hexdigit()));
    assert_eq!(
        artifact.filename,
        format!("MinGit-{MANAGED_GIT_VERSION}-64-bit.zip")
    );
    assert!(MANAGED_GIT_RELEASE_TAG.starts_with('v'));
}

#[test]
fn download_url_comes_from_the_pinned_git_for_windows_release() {
    assert_eq!(
        managed_git_download_url(MANAGED_GIT_ARTIFACTS[0]),
        "https://github.com/git-for-windows/git/releases/download/v2.56.0.windows.4/MinGit-2.56.0.4-64-bit.zip"
    );
}

#[test]
fn only_64_bit_windows_gets_a_managed_download() {
    assert_eq!(platform_label("windows", "x86_64"), Some("windows-x64"));
    assert_eq!(platform_label("windows", "aarch64"), None);
    assert_eq!(platform_label("windows", "x86"), None);
    assert_eq!(platform_label("macos", "aarch64"), None);
    assert_eq!(platform_label("macos", "x86_64"), None);
    assert_eq!(platform_label("linux", "x86_64"), None);
}

#[test]
fn every_supported_platform_has_an_artifact() {
    // The label helper and the artifact table must agree, or a supported PC
    // would resolve a folder that can never be installed.
    if let Some(platform) = managed_git_platform() {
        assert!(MANAGED_GIT_ARTIFACTS.iter().any(|a| a.platform == platform));
        assert!(managed_git_artifact().is_some());
    } else {
        assert!(managed_git_artifact().is_none());
        assert!(!managed_git_install_supported());
    }
}

#[test]
fn folder_sits_under_the_colony_runtimes_folder_per_version() {
    let dir = managed_git_dir_in(Path::new("data"), "windows-x64");
    let parts: Vec<_> = dir.iter().map(|part| part.to_string_lossy()).collect();
    assert_eq!(
        parts,
        [
            "data",
            "Colony",
            "runtimes",
            "mingit",
            "2.56.0.4",
            "windows-x64"
        ]
    );
}

#[test]
fn a_missing_or_partial_install_has_no_bash() {
    let dir = tempfile::tempdir().unwrap();
    assert_eq!(managed_git_bash_in(dir.path()), None);

    // Files without the marker are an interrupted unpack.
    finished_install(dir.path());
    std::fs::remove_file(dir.path().join(MANAGED_GIT_MARKER)).unwrap();
    assert_eq!(managed_git_bash_in(dir.path()), None);
}

#[test]
fn an_install_of_another_version_is_not_used() {
    let dir = tempfile::tempdir().unwrap();
    finished_install(dir.path());
    std::fs::write(dir.path().join(MANAGED_GIT_MARKER), "mingit 1.0.0.1").unwrap();
    assert_eq!(managed_git_bash_in(dir.path()), None);
}

#[test]
fn an_install_missing_bash_or_git_is_not_used() {
    let dir = tempfile::tempdir().unwrap();
    finished_install(dir.path());
    std::fs::remove_file(dir.path().join("cmd").join("git.exe")).unwrap();
    assert_eq!(managed_git_bash_in(dir.path()), None);

    finished_install(dir.path());
    std::fs::remove_file(dir.path().join("usr").join("bin").join("bash.exe")).unwrap();
    assert_eq!(managed_git_bash_in(dir.path()), None);
}

#[test]
fn a_finished_install_gives_its_bash() {
    let dir = tempfile::tempdir().unwrap();
    finished_install(dir.path());
    assert_eq!(
        managed_git_bash_in(dir.path()),
        Some(dir.path().join("usr").join("bin").join("bash.exe"))
    );
}

#[test]
fn a_bash_already_on_the_pc_always_wins() {
    let managed = Some(PathBuf::from("managed-bash"));
    assert_eq!(
        plan_windows_shell(true, managed, true),
        WindowsShell::System
    );
    assert_eq!(plan_windows_shell(true, None, true), WindowsShell::System);
}

#[test]
fn colonys_own_bash_is_used_when_there_is_no_other() {
    assert_eq!(
        plan_windows_shell(false, Some(PathBuf::from("managed-bash")), true),
        WindowsShell::Managed(PathBuf::from("managed-bash"))
    );
    // Even where a download is not offered, an installed copy still works.
    assert_eq!(
        plan_windows_shell(false, Some(PathBuf::from("managed-bash")), false),
        WindowsShell::Managed(PathBuf::from("managed-bash"))
    );
}

#[test]
fn a_download_is_offered_only_when_nothing_else_exists() {
    assert_eq!(
        plan_windows_shell(false, None, true),
        WindowsShell::Downloadable
    );
    assert_eq!(
        plan_windows_shell(false, None, false),
        WindowsShell::Missing
    );
}

#[test]
fn the_agent_is_pointed_at_colonys_bash_only_when_no_other_bash_exists() {
    let mut env = BTreeMap::new();
    apply_managed_git_bash(&mut env, false, Some(PathBuf::from("m").join("bash.exe")));
    assert_eq!(
        env.get(GIT_BASH_ENV).map(String::as_str),
        Some(PathBuf::from("m").join("bash.exe").to_str().unwrap())
    );

    // Git for Windows is on the PC: nothing is added.
    let mut env = BTreeMap::new();
    apply_managed_git_bash(&mut env, true, Some(PathBuf::from("m").join("bash.exe")));
    assert!(!env.contains_key(GIT_BASH_ENV));

    // Nothing installed: nothing is added.
    let mut env = BTreeMap::new();
    apply_managed_git_bash(&mut env, false, None);
    assert!(!env.contains_key(GIT_BASH_ENV));
}

#[test]
fn a_working_user_override_is_never_replaced() {
    let mut env = BTreeMap::new();
    env.insert(GIT_BASH_ENV.to_string(), "user-bash".to_string());
    // The caller measured the env, found the override usable, and says so.
    apply_managed_git_bash(&mut env, true, Some(PathBuf::from("m").join("bash.exe")));
    assert_eq!(env[GIT_BASH_ENV], "user-bash");
}

#[test]
fn a_dead_user_override_gives_way_to_colonys_bash() {
    let mut env = BTreeMap::new();
    env.insert(GIT_BASH_ENV.to_string(), "gone-bash".to_string());
    // The caller measured the env and the override no longer resolves.
    apply_managed_git_bash(&mut env, false, Some(PathBuf::from("m").join("bash.exe")));
    assert_eq!(
        env[GIT_BASH_ENV],
        PathBuf::from("m").join("bash.exe").display().to_string()
    );
}
