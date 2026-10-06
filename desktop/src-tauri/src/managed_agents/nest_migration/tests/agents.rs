//! Running agents: nothing moves under them.

use super::*;
use crate::managed_agents::{
    classify_environ, ManagedAgentRuntimeKey, ManagedAgentRuntimeReceipt, MarkerProbe,
};

/// Write a runtime receipt the way the app does when it spawns an agent.
fn write_receipt(dir: &Path, key_byte: u8, pid: u32, instance: &str) {
    let key = ManagedAgentRuntimeKey::new(
        format!("{key_byte:02x}").repeat(32),
        "wss://relay.example.com",
    )
    .unwrap();
    let receipt = ManagedAgentRuntimeReceipt {
        key: key.clone(),
        pid,
        desktop_instance_id: instance.to_string(),
        started_at: "2026-10-06T00:00:00Z".to_string(),
    };
    write(
        &dir.join(format!("{}.json", key.runtime_id())),
        &serde_json::to_vec(&receipt).unwrap(),
    );
}

#[test]
fn live_agents_defer_the_move_and_nothing_changes() {
    let env = Env::owner_shaped();
    let before = manifest(&env.home);

    let report = run_migration(&env.input(true, &[4242]), &RealFs);

    assert_eq!(report.outcome, Outcome::DeferredRunningAgents);
    assert_eq!(manifest(&env.home), before);
    assert!(!env.state.exists());
    // The next launch, with the agents gone, moves.
    assert_eq!(env.run().outcome, Outcome::Migrated);
}

#[test]
fn live_agents_roll_an_interrupted_run_back_instead_of_continuing_it() {
    for at in [3usize, 8, 12] {
        let env = Env::owner_shaped();
        let original = manifest(&env.home);
        assert!(run_until_crash(&env, at, false));

        let report = run_migration(&env.input(true, &[4242]), &RealFs);

        assert!(
            matches!(&report.outcome, Outcome::RolledBack(reason) if reason == "running-agents"),
            "{at}: {:?}",
            report.outcome
        );
        assert_eq!(manifest(&env.home), original, "{at}");
    }
}

#[test]
fn only_live_receipts_of_this_install_count() {
    let dir = TempDir::new().unwrap();
    write_receipt(dir.path(), 1, 7, INSTANCE); // running, ours
    write_receipt(dir.path(), 2, 8, INSTANCE); // not running
    write_receipt(dir.path(), 3, 9, "xyz.block.buzz.app.dev"); // another install
    write(&dir.path().join("junk.json"), b"{ not a receipt");
    write(&dir.path().join("old.pid"), b"7\n"); // the same agent, older file
    write(&dir.path().join("reused.pid"), b"10\n"); // pid reused by something else

    let live = boot::live_agent_pids_in(
        dir.path(),
        INSTANCE,
        &|pid| matches!(pid, 7 | 9 | 10),
        &|pid, _| {
            if pid == 10 {
                MarkerProbe::Foreign
            } else {
                MarkerProbe::Ours
            }
        },
    );

    assert_eq!(live.pids, vec![7]);
    assert_eq!(
        live.unreadable, 0,
        "a stale or foreign file is not unreadable"
    );
    let missing =
        boot::live_agent_pids_in(&dir.path().join("missing"), INSTANCE, &|_| true, &|_, _| {
            MarkerProbe::Ours
        });
    assert_eq!(missing, boot::LiveAgents::default());
}

#[test]
fn a_real_running_agent_is_found_by_its_receipt_and_blocks_the_move() {
    use std::io::{BufRead, BufReader};
    use std::process::{Command, Stdio};
    use std::time::{Duration, Instant};

    let env = Env::owner_shaped();
    let receipts = env.data.join("agents").join("agent-pids");
    // An agent the way the app starts one: working folder is the nest, marked
    // with the install's ownership variable. The shell prints only once it is
    // fully started and then waits on its stdin, so it stays alive until it is
    // killed. Scanning straight after `spawn` would be a race: until `execve`
    // has finished building the new process image, `/proc/<pid>/environ` reads
    // empty and the ownership marker cannot be seen.
    let mut child = Command::new("/bin/sh")
        .args(["-c", "echo ready; read _line"])
        .env("BUZZ_MANAGED_AGENT", INSTANCE)
        .current_dir(env.old())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .expect("spawn sh");
    let mut ready = String::new();
    BufReader::new(child.stdout.take().expect("piped stdout"))
        .read_line(&mut ready)
        .expect("read the ready line");
    assert_eq!(ready.trim(), "ready", "the agent stand-in did not start");
    let pid = child.id();
    write_receipt(&receipts, 1, pid, INSTANCE);
    let find = || {
        boot::live_agent_pids_in(
            &receipts,
            INSTANCE,
            &crate::managed_agents::process_is_running,
            &crate::managed_agents::probe_buzz_marker,
        )
    };

    // Bounded wait for the scan to see the live agent; a real miss still fails.
    let deadline = Instant::now() + Duration::from_secs(10);
    let mut live = find();
    while !live.pids.contains(&pid) && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(50));
        live = find();
    }
    assert_eq!(
        live.pids,
        vec![pid],
        "running={} marker={:?} unreadable={}",
        crate::managed_agents::process_is_running(pid),
        crate::managed_agents::probe_buzz_marker(pid, INSTANCE),
        live.unreadable
    );
    let before = manifest(&env.home);
    let report = run_migration(&env.input(true, &live.pids), &RealFs);
    assert_eq!(report.outcome, Outcome::DeferredRunningAgents);
    assert_eq!(manifest(&env.home), before);

    child.kill().unwrap();
    child.wait().unwrap();
    let gone = find();
    assert_eq!(
        gone,
        boot::LiveAgents::default(),
        "a dead agent no longer blocks the move"
    );
    let report = run_migration(&env.input(true, &gone.pids), &RealFs);
    assert_eq!(report.outcome, Outcome::Migrated);
}

#[test]
fn an_agent_record_that_cannot_be_read_defers_the_move() {
    let env = Env::owner_shaped();
    let receipts = env.data.join("agents").join("agent-pids");
    write(&receipts.join("locked.json"), b"{}");
    fs::set_permissions(
        receipts.join("locked.json"),
        fs::Permissions::from_mode(0o000),
    )
    .unwrap();
    // Root reads anything; only assert where the mode bites.
    let bites = fs::read(receipts.join("locked.json")).is_err();

    let live = boot::live_agent_pids_in(&receipts, INSTANCE, &|_| false, &|_, _| {
        MarkerProbe::Unknown
    });
    fs::set_permissions(
        receipts.join("locked.json"),
        fs::Permissions::from_mode(0o600),
    )
    .unwrap();
    if !bites {
        return;
    }
    assert_eq!(live.unreadable, 1);
    assert!(live.pids.is_empty());

    let before = manifest(&env.home);
    let input = MigrationInput {
        unreadable_agent_records: live.unreadable,
        ..env.input(true, &[])
    };
    assert_eq!(
        run_migration(&input, &RealFs).outcome,
        Outcome::DeferredRunningAgents
    );
    assert_eq!(manifest(&env.home), before);
}

/// An agent record for pid 7 of this install, probed through `classify_environ`
/// the way the real probe classifies an environment read. No process is started.
fn blocks_when(alive: bool, read: impl Fn() -> std::io::Result<Vec<u8>>) -> bool {
    let dir = TempDir::new().unwrap();
    write_receipt(dir.path(), 1, 7, INSTANCE);
    let live = boot::live_agent_pids_in(dir.path(), INSTANCE, &move |_| alive, &|_, instance| {
        classify_environ(read(), instance)
    });
    let blocked = live.pids == vec![7];
    // Whatever was decided, the migration obeys it end to end.
    let env = Env::owner_shaped();
    let before = manifest(&env.home);
    let report = run_migration(&env.input(true, &live.pids), &RealFs);
    if blocked {
        assert_eq!(report.outcome, Outcome::DeferredRunningAgents);
        assert_eq!(manifest(&env.home), before, "nothing may move");
    } else {
        assert_eq!(report.outcome, Outcome::Migrated);
    }
    blocked
}

fn environ_of(entries: &[&str]) -> Vec<u8> {
    let mut bytes = Vec::new();
    for entry in entries {
        bytes.extend_from_slice(entry.as_bytes());
        bytes.push(0);
    }
    bytes
}

#[test]
fn an_alive_agent_whose_environment_reads_empty_blocks_the_move() {
    // A freshly spawned agent reads empty until execve has finished.
    assert!(blocks_when(true, || Ok(Vec::new())));
}

#[test]
fn an_alive_agent_whose_environment_cannot_be_read_blocks_the_move() {
    for code in [13, 1, 5] {
        assert!(
            blocks_when(true, move || Err(std::io::Error::from_raw_os_error(code))),
            "errno {code}"
        );
    }
}

#[test]
fn an_alive_process_with_a_readable_foreign_marker_is_a_reused_pid_and_is_ignored() {
    assert!(!blocks_when(true, || Ok(environ_of(&[
        "PATH=/usr/bin",
        "BUZZ_MANAGED_AGENT=xyz.block.buzz.app.dev",
    ]))));
    assert!(!blocks_when(true, || Ok(environ_of(&["PATH=/usr/bin"]))));
}

#[test]
fn an_alive_agent_with_this_installs_marker_blocks_the_move() {
    assert!(blocks_when(true, || Ok(environ_of(&[
        "BUZZ_MANAGED_AGENT=xyz.block.buzz.app"
    ]))));
}

#[test]
fn a_dead_pid_is_ignored_whatever_its_environment_says() {
    assert!(!blocks_when(false, || Ok(environ_of(&[
        "BUZZ_MANAGED_AGENT=xyz.block.buzz.app"
    ]))));
    assert!(!blocks_when(false, || Ok(Vec::new())));
    assert!(!blocks_when(false, || Err(
        std::io::Error::from_raw_os_error(13)
    )));
}

#[test]
fn a_process_that_vanished_between_the_checks_is_ignored() {
    assert!(!blocks_when(true, || Err(std::io::Error::from(
        std::io::ErrorKind::NotFound
    ))));
}

#[test]
fn the_whole_truth_table_fails_closed() {
    let cases = [
        (false, MarkerProbe::Ours, false),
        (false, MarkerProbe::Unknown, false),
        (false, MarkerProbe::Foreign, false),
        (false, MarkerProbe::Gone, false),
        (true, MarkerProbe::Ours, true),
        (true, MarkerProbe::Unknown, true),
        (true, MarkerProbe::Foreign, false),
        (true, MarkerProbe::Gone, false),
    ];
    for (alive, probe, blocks) in cases {
        let decided = boot::agent_blocks_move(7, INSTANCE, &move |_| alive, &move |_, _| probe);
        assert_eq!(decided, blocks, "alive={alive} probe={probe:?}");
    }
}

#[test]
fn the_migration_runs_before_anything_that_starts_agents_and_never_starts_one() {
    // The boot order in lib.rs: migrate, choose the folder, reset, create the
    // nest, and only then mark agent restore as pending.
    let lib = include_str!("../../../lib.rs");
    let at = |needle: &str| {
        lib.find(needle)
            .unwrap_or_else(|| panic!("lib.rs no longer contains {needle}"))
    };
    let migrate = at("nest_migration::run_at_boot(");
    let choose = at("managed_agents::init_nest_dir(");
    let reset = at("crate::reset::run_boot_reset(");
    let create = at("ensure_nest()");
    let restore = at("managed_agent_restore_pending");
    assert!(migrate < choose, "migrate before the folder is chosen");
    assert!(choose < reset && reset < create, "then reset, then create");
    assert!(create < restore, "agents are restored last");

    // The migration itself has no way to start or restore an agent.
    for (file, source) in [
        ("mod.rs", include_str!("../mod.rs")),
        ("boot.rs", include_str!("../boot.rs")),
        ("journal.rs", include_str!("../journal.rs")),
        ("scan.rs", include_str!("../scan.rs")),
    ] {
        for forbidden in [
            "Command::new",
            ".spawn(",
            "restore_managed_agents",
            "start_managed_agent",
            "spawn_agent",
        ] {
            assert!(
                !source.contains(forbidden),
                "{file} must not use {forbidden}"
            );
        }
    }
}
