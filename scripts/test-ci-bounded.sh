#!/usr/bin/env bash
# Contract for scripts/ci-bounded.sh: a hung attempt is killed with everything it
# started and retried, a flaky command passes on a later attempt, and the exit
# status tells a hang (124) from a failure.
set -uo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
bounded="$root/scripts/ci-bounded.sh"
work=$(mktemp -d)
fail=0

trap 'rm -rf "$work"' EXIT

check() {
  if [ "$2" != "$3" ]; then
    echo "FAIL: $1 (expected '$3', got '$2')" >&2
    fail=1
  else
    echo "ok: $1"
  fi
}

# 1. A command that succeeds runs once.
"$bounded" 5 3 sh -c 'echo run >> "$1"' sh "$work/once" >/dev/null 2>&1
check "success exits 0" "$?" "0"
check "success runs once" "$(wc -l < "$work/once" | tr -d ' ')" "1"

# 2. A flaky command passes on the second attempt.
"$bounded" 5 3 sh -c 'echo run >> "$1"; [ "$(wc -l < "$1" | tr -d " ")" -ge 2 ]' sh "$work/flaky" >/dev/null 2>&1
check "flaky command exits 0" "$?" "0"
check "flaky command ran twice" "$(wc -l < "$work/flaky" | tr -d ' ')" "2"

# 3. A failing command keeps its own status after the last attempt.
"$bounded" 5 2 sh -c 'echo run >> "$1"; exit 7' sh "$work/failing" >/dev/null 2>&1
check "failure keeps its status" "$?" "7"
check "failure used every attempt" "$(wc -l < "$work/failing" | tr -d ' ')" "2"

# 4. A hung command, with a hung grandchild, is killed and retried; 124 when it never recovers.
hang='echo run >> "$1"; sh -c "echo \$\$ >> \"$2\"; sleep 120" & wait'
started=$SECONDS
"$bounded" 2 2 sh -c "$hang" sh "$work/hung" "$work/pids" >/dev/null 2>&1
check "hang exits 124" "$?" "124"
check "hang was retried" "$(wc -l < "$work/hung" | tr -d ' ')" "2"
check "hang returned quickly" "$([ $((SECONDS - started)) -lt 30 ] && echo yes || echo no)" "yes"
sleep 1
alive=0
while read -r gpid; do
  if kill -0 "$gpid" 2>/dev/null; then alive=$((alive + 1)); fi
done < "$work/pids"
check "hung grandchildren are gone" "$alive" "0"

# 5. A hung first attempt followed by a healthy one passes.
healthy='echo run >> "$1"; if [ "$(wc -l < "$1" | tr -d " ")" -eq 1 ]; then sleep 120; fi'
"$bounded" 2 3 sh -c "$healthy" sh "$work/recover" >/dev/null 2>&1
check "recovery exits 0" "$?" "0"
check "recovery ran twice" "$(wc -l < "$work/recover" | tr -d ' ')" "2"

exit "$fail"
