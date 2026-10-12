//! The full-disk watch and the plain problem words.

use std::io::Write;

use super::watch::{contains_ledger_failure, read_window, DiskWatch, MAX_LOG_SCAN_BYTES};
use super::{problem_detail, ProblemKind};

#[test]
fn the_log_window_reads_only_new_bytes_and_at_most_64_kib() {
    assert_eq!(read_window(100, 40), (40, 60));
    assert_eq!(read_window(40, 40), (40, 0));
    assert_eq!(
        read_window(10, 40),
        (0, 10),
        "a replaced log is read from the start"
    );
    let len = 10 * MAX_LOG_SCAN_BYTES;
    assert_eq!(
        read_window(len, 0),
        (len - MAX_LOG_SCAN_BYTES, MAX_LOG_SCAN_BYTES)
    );
}

#[test]
fn the_wake_ledger_failure_line_is_found() {
    assert!(contains_ledger_failure(
        b"2026-10-11T09:00:00Z WARN buzz_acp: wake ledger could not be saved; new turns wait until it can\n"
    ));
    assert!(!contains_ledger_failure(b"wake ledger saved\n"));
}

#[test]
fn a_full_disk_is_reported_once_every_ten_minutes() {
    let dir = tempfile::tempdir().expect("temp dir");
    let log = dir.path().join("agent.log");
    std::fs::write(
        &log,
        b"wake ledger could not be saved; from an earlier run\n",
    )
    .expect("write");
    let mut watch = DiskWatch::default();
    let pubkey = "ab".repeat(32);

    assert!(
        !watch.check(&pubkey, &log, 1_000),
        "lines written before the watch began are not reported"
    );
    let mut file = std::fs::OpenOptions::new()
        .append(true)
        .open(&log)
        .expect("open");
    file.write_all(b"wake ledger could not be saved; new turns wait until it can\n")
        .expect("append");
    assert!(watch.check(&pubkey, &log, 1_002));
    file.write_all(b"wake ledger could not be saved; new turns wait until it can\n")
        .expect("append");
    assert!(
        !watch.check(&pubkey, &log, 1_032),
        "repeated within ten minutes"
    );
    file.write_all(b"wake ledger could not be saved; new turns wait until it can\n")
        .expect("append");
    assert!(watch.check(&pubkey, &log, 1_602));
}

#[test]
fn problem_details_are_plain_words() {
    for kind in [
        ProblemKind::StartFailed,
        ProblemKind::Crashed,
        ProblemKind::CrashLoop,
        ProblemKind::CreditsOut,
        ProblemKind::DiskFull,
    ] {
        let detail = problem_detail(kind, "Naledi");
        for banned in ["Buzz", "Fizz", "Honey", "\u{2014}", "/", "error", "exit"] {
            assert!(!detail.contains(banned), "{kind:?}: {detail}");
        }
    }
    assert_eq!(
        problem_detail(ProblemKind::DiskFull, "Naledi"),
        "This computer is almost out of space, so Naledi is waiting."
    );
}

#[test]
fn a_ledger_warning_split_across_two_ticks_is_still_reported() {
    let dir = tempfile::tempdir().expect("dir");
    let log = dir.path().join("agent.log");
    std::fs::write(&log, b"").expect("write");
    let mut watch = DiskWatch::default();
    assert!(!watch.check("employee", &log, 1000));
    let mut file = std::fs::OpenOptions::new()
        .append(true)
        .open(&log)
        .expect("open");
    file.write_all(b"wake ledger could ").expect("append");
    assert!(!watch.check("employee", &log, 1002));
    file.write_all(b"not be saved\n").expect("append");
    assert!(watch.check("employee", &log, 1004));
}

#[test]
fn a_failed_log_read_is_retried_from_the_same_cursor() {
    let dir = tempfile::tempdir().expect("dir");
    let log = dir.path().join("agent.log");
    std::fs::write(&log, b"").expect("write");
    let mut watch = DiskWatch::default();
    assert!(!watch.check("employee", &log, 1000));
    std::fs::write(&log, b"wake ledger could not be saved\n").expect("write");
    assert!(!watch.check_with("employee", &log, 1002, |_, _, _| {
        Err(std::io::Error::other("temporary read failure"))
    }));
    assert!(watch.check("employee", &log, 1004));
}
