/// Probes a freshly written script, retrying while the probe reports `None`.
///
/// Exec of a just-written script can fail with ETXTBSY on Linux when another
/// test thread forks while the write descriptor is still open (the fork child
/// holds it until its own exec), and an oversubscribed runner can push the
/// child past the 5 s probe deadline. Both surface as `None`, so tests that
/// expect a version retry a bounded number of times. A real parse or spawn
/// regression still returns `None` on every attempt. Returns the result and
/// the elapsed time of the final attempt.
pub(super) fn probe_fresh_script(
    bin: &std::path::Path,
) -> (Option<(u64, u64, u64)>, std::time::Duration) {
    probe_until_version(|| super::super::probe_codex_acp_version(bin))
}

/// Runs `probe` up to three times while it reports `None`, for the same
/// reasons as [`probe_fresh_script`]. Returns the last result and the elapsed
/// time of the final attempt.
pub(super) fn probe_until_version(
    mut probe: impl FnMut() -> Option<(u64, u64, u64)>,
) -> (Option<(u64, u64, u64)>, std::time::Duration) {
    let mut result = (None, std::time::Duration::ZERO);
    for _ in 0..3 {
        let start = std::time::Instant::now();
        result = (probe(), start.elapsed());
        if result.0.is_some() {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    result
}
