#!/usr/bin/env bash
# Run a command with a time limit per attempt and retry a hung or failed attempt.
#
# usage: scripts/ci-bounded.sh <seconds-per-attempt> <attempts> <command> [args...]
#
# A Hermit stub that never returns (see docs/ci-hermit-hang.md) leaves the step
# silent until the job timeout. Every attempt runs in its own process group, so a
# timeout kills the command and everything it started, hung stubs included, and
# the next attempt starts clean. Exit status: the command's own status, or 124
# when the last attempt timed out.
set -uo pipefail

if [ "$#" -lt 3 ]; then
  echo "usage: $0 <seconds-per-attempt> <attempts> <command> [args...]" >&2
  exit 2
fi
limit="$1"
attempts="$2"
shift 2

# Job control puts each background job in its own process group (pgid == pid).
set -m

attempt=1
while :; do
  "$@" &
  pid=$!
  started=$SECONDS
  timed_out=0
  while kill -0 "$pid" 2>/dev/null; do
    if [ $((SECONDS - started)) -ge "$limit" ]; then
      timed_out=1
      echo "::warning::attempt $attempt of $attempts hung for ${limit}s, killing it: $*"
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
