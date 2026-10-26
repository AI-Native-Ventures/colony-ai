/**
 * The detached helper that swaps the macOS app bundle once Colony has quit.
 *
 * It is a plain `sh` script (not Node) because it runs while the app that
 * started it is gone and the bundle that holds Electron is being replaced.
 * Every value is single-quoted into the script text, so paths with spaces or
 * quotes are safe. The commands it runs (`open`, `xattr`, `codesign`) are
 * parameters so tests can stand in for them; production passes the system
 * binaries.
 */

export const HELPER_WAIT_SECONDS = 60;

export const HELPER_MESSAGES = Object.freeze({
  didNotQuit:
    "Colony did not quit in time, so the update was not installed. The current version is unchanged.",
  missingUpdate:
    "The prepared update was missing, so it was not installed. The current version is unchanged.",
  moveAside:
    "The current version could not be moved aside, so the update was not installed. The current version is unchanged.",
  moveIn:
    "The new version could not be put in place, so the update was not installed. The current version was restored.",
  restoreFailed:
    "The new version could not be put in place and the current version could not be restored. Download Colony again to repair it.",
  badSignature:
    "The new version failed its signature check after it was put in place, so the current version was restored.",
});

export function shellQuote(value) {
  const text = String(value);
  if (text.includes("\0")) throw new Error("Shell value contains a NUL byte.");
  return `'${text.replaceAll("'", `'\\''`)}'`;
}

/**
 * @param {object} options
 * @param {number} options.pid          Colony's process id; the swap waits for it to exit.
 * @param {string} options.bundlePath   The installed app, e.g. /Applications/Colony.app.
 * @param {string} options.stagedPath   The verified new app, on the same volume.
 * @param {string} options.previousPath Where the current app is parked during the swap.
 * @param {string} options.stageDir     Folder holding the staged files; removed at the end.
 * @param {string} options.resultPath   JSON file the next launch reads to report the outcome.
 * @param {string} options.logPath      Append-only log kept outside the stage folder.
 * @param {string} options.fromVersion
 * @param {string} options.toVersion
 * @param {string} [options.openCommand]
 * @param {string} [options.xattrCommand]
 * @param {string} [options.codesignCommand]
 * @param {number} [options.waitSeconds]
 */
export function renderSwapHelper({
  pid,
  bundlePath,
  stagedPath,
  previousPath,
  stageDir,
  resultPath,
  logPath,
  fromVersion,
  toVersion,
  openCommand = "/usr/bin/open",
  xattrCommand = "/usr/bin/xattr",
  codesignCommand = "/usr/bin/codesign",
  waitSeconds = HELPER_WAIT_SECONDS,
}) {
  if (!Number.isInteger(pid) || pid <= 1) {
    throw new Error("The helper needs the process id of the running app.");
  }
  const polls = Math.max(1, Math.round(waitSeconds * 5));
  return `#!/bin/sh
# Colony update helper: waits for Colony to quit, swaps the app, relaunches.
PID=${pid}
BUNDLE=${shellQuote(bundlePath)}
STAGED=${shellQuote(stagedPath)}
PREVIOUS=${shellQuote(previousPath)}
STAGE_DIR=${shellQuote(stageDir)}
RESULT=${shellQuote(resultPath)}
LOG=${shellQuote(logPath)}
FROM=${shellQuote(fromVersion)}
TO=${shellQuote(toVersion)}
OPEN=${shellQuote(openCommand)}
XATTR=${shellQuote(xattrCommand)}
CODESIGN=${shellQuote(codesignCommand)}

log() { printf '%s %s\\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$1" >> "$LOG" 2>/dev/null; }

# The result file is written whole or not at all, so a later launch never reads half of it.
write_result() {
  tmp="$RESULT.$$.tmp"
  printf '{"status":"%s","from":"%s","to":"%s","message":"%s"}\\n' "$1" "$FROM" "$TO" "$2" > "$tmp" && mv -f "$tmp" "$RESULT"
}

# The staged files and the parked old app go once the swap has settled.
cleanup_stage() {
  case "$STAGE_DIR" in
    /?*/.colony-update-*) rm -rf -- "$STAGE_DIR" ;;
  esac
}

# Every failure ends here: record it, then bring the current version back up.
fail_keep_old() {
  log "failed: $1"
  write_result failed "$1"
  "$OPEN" "$BUNDLE" >> "$LOG" 2>&1 || log "could not reopen the current version"
  cleanup_stage
  exit 1
}

log "waiting for pid $PID to exit"
polls=0
while kill -0 "$PID" 2>/dev/null; do
  polls=$((polls + 1))
  if [ "$polls" -gt ${polls} ]; then
    log "failed: pid $PID did not exit"
    write_result failed ${shellQuote(HELPER_MESSAGES.didNotQuit)}
    exit 1
  fi
  sleep 0.2
done

[ -d "$STAGED" ] || fail_keep_old ${shellQuote(HELPER_MESSAGES.missingUpdate)}
mkdir -p "$(dirname "$PREVIOUS")" || fail_keep_old ${shellQuote(HELPER_MESSAGES.moveAside)}

# One swap: park the old app, move the new one in, undo the first if the second fails.
mv "$BUNDLE" "$PREVIOUS" || fail_keep_old ${shellQuote(HELPER_MESSAGES.moveAside)}
if ! mv "$STAGED" "$BUNDLE"; then
  if mv "$PREVIOUS" "$BUNDLE"; then
    fail_keep_old ${shellQuote(HELPER_MESSAGES.moveIn)}
  fi
  log "critical: the previous app is parked at $PREVIOUS"
  write_result failed ${shellQuote(HELPER_MESSAGES.restoreFailed)}
  exit 1
fi

"$XATTR" -dr com.apple.quarantine "$BUNDLE" >> "$LOG" 2>&1 || log "no quarantine flag to clear"

if ! "$CODESIGN" --verify --deep --strict "$BUNDLE" >> "$LOG" 2>&1; then
  mv "$BUNDLE" "$PREVIOUS.rejected" && mv "$PREVIOUS" "$BUNDLE"
  fail_keep_old ${shellQuote(HELPER_MESSAGES.badSignature)}
fi

write_result installed ""
log "installed $TO over $FROM"
"$OPEN" "$BUNDLE" >> "$LOG" 2>&1 || log "could not open the new version"

# The new app is in place and opened; the parked old app and the staged files go.
cleanup_stage
exit 0
`;
}
