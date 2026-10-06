//! Running agents: nothing moves under them.

use super::*;
use crate::managed_agents::{ManagedAgentRuntimeKey, ManagedAgentRuntimeReceipt};

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
        &|pid, _| pid != 10,
    );

    assert_eq!(live.pids, vec![7]);
    assert_eq!(
        live.unreadable, 0,
        "a stale or foreign file is not unreadable"
    );
    let missing =
        boot::live_agent_pids_in(&dir.path().join("missing"), INSTANCE, &|_| true, &|_, _| {
            true
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
            &crate::managed_agents::process_has_buzz_marker,
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
        "running={} marker={} unreadable={}",
        crate::managed_agents::process_is_running(pid),
        crate::managed_agents::process_has_buzz_marker(pid, INSTANCE),
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

    let live = boot::live_agent_pids_in(&receipts, INSTANCE, &|_| false, &|_, _| false);
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
