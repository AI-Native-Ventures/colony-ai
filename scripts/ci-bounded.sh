#!/usr/bin/env bash
# Run a command with a time limit per attempt and retry a hung or failed attempt.
#
# usage: scripts/ci-bounded.sh <seconds-per-attempt> <attempts> <command> [args...]
#
# A Hermit stub whose package download goes idle never returns (see
# docs/ci-hermit-hang.md) and leaves the step silent until the job timeout. Every
# attempt runs in its own process group, so a timeout kills the command and everything
# it started, hung stubs included, and the next attempt starts clean.
#
# Optional: CI_BOUNDED_PROGRESS_DIR and CI_BOUNDED_IDLE_SECONDS. When both are set an
# attempt also counts as hung once the size of that directory has not changed for that
# many seconds, so a slow download that keeps moving is left alone and an idle one is
# killed early.
#
# Exit status: the command's own status, or 124 when the last attempt was killed.
set -uo pipefail

if [ "$#" -lt 3 ]; then
  echo "usage: $0 <seconds-per-attempt> <attempts> <command> [args...]" >&2
  exit 2
fi
limit="$1"
attempts="$2"
shift 2

progress_dir="${CI_BOUNDED_PROGRESS_DIR:-}"
idle_limit="${CI_BOUNDED_IDLE_SECONDS:-0}"

dir_size() {
  du -sk "$progress_dir" 2>/dev/null | cut -f1
}

# Job control puts each background job in its own process group (pgid == pid).
set -m

attempt=1
while :; do
  "$@" &
  pid=$!
  started=$SECONDS
  timed_out=0
  reason=""
  last_size=""
  last_change=$SECONDS
  if [ -n "$progress_dir" ] && [ "$idle_limit" -gt 0 ]; then
    last_size=$(dir_size)
  fi
  while kill -0 "$pid" 2>/dev/null; do
    if [ $((SECONDS - started)) -ge "$limit" ]; then
      reason="ran for ${limit}s"
    elif [ -n "$last_size" ]; then
      size=$(dir_size)
      if [ "$size" != "$last_size" ]; then
        last_size="$size"
        last_change=$SECONDS
      elif [ $((SECONDS - last_change)) -ge "$idle_limit" ]; then
        reason="made no progress for ${idle_limit}s"
      fi
    fi
    if [ -n "$reason" ]; then
      timed_out=1
      echo "::warning::attempt $attempt of $attempts hung ($reason), killing it: $*"
      kill -TERM -- "-$pid" 2>/dev/null
      sleep 3
      kill -KILL -- "-$pid" 2>/dev/null
      break
    fi
    sleep 1
  done
  wait "$pid" 2>/dev/null
  status=$?
  if [ "$timed_out" -eq 1 ]; then
    status=124
  fi
  if [ "$status" -eq 0 ]; then
    exit 0
  fi
  if [ "$attempt" -ge "$attempts" ]; then
    echo "::error::$* failed after $attempts attempts (status $status)"
    exit "$status"
  fi
  echo "::warning::attempt $attempt of $attempts failed (status $status), retrying: $*"
  attempt=$((attempt + 1))
done
