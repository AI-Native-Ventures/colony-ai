#!/usr/bin/env python3
"""Run the hosted XCTest command with a bounded process-tree timeout."""

from __future__ import annotations

import argparse
import os
import signal
import subprocess
import sys
import tempfile
from pathlib import Path


def run_bounded(
    command: list[str], *, cwd: Path, log_path: Path, timeout_seconds: int
) -> int:
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with log_path.open("w", encoding="utf-8") as output:
        try:
            process = subprocess.Popen(
                command,
                cwd=cwd,
                stdout=output,
                stderr=subprocess.STDOUT,
                start_new_session=True,
            )
        except OSError as error:
            output.write(f"command could not start: {error}\n")
            return 127

        try:
            return process.wait(timeout=timeout_seconds)
        except subprocess.TimeoutExpired:
            output.write(f"\ncommand timed out after {timeout_seconds}s\n")
            output.flush()
            try:
                os.killpg(process.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                process.wait()
            return 124


def self_test() -> int:
    with tempfile.TemporaryDirectory(prefix="ios-runtime-proof-runner-") as temp_dir:
        root = Path(temp_dir)
        success_log = root / "success.log"
        success_status = run_bounded(
            [sys.executable, "-c", "print('bounded runner success')"],
            cwd=root,
            log_path=success_log,
            timeout_seconds=5,
        )
        if success_status != 0 or "bounded runner success" not in success_log.read_text():
            print("bounded runner success-path self-test failed", file=sys.stderr)
            return 1

        timeout_log = root / "timeout.log"
        timeout_status = run_bounded(
            [sys.executable, "-c", "import time; time.sleep(30)"],
            cwd=root,
            log_path=timeout_log,
            timeout_seconds=1,
        )
        if timeout_status != 124 or "timed out after 1s" not in timeout_log.read_text():
            print("bounded runner timeout-path self-test failed", file=sys.stderr)
            return 1

    print("iOS runtime proof runner self-test passed")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser()
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--timeout-seconds", type=int)
    parser.add_argument("--cwd", type=Path)
    parser.add_argument("--log-path", type=Path)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    if args.self_test:
        return self_test()

    command = args.command
    if command and command[0] == "--":
        command = command[1:]
    if (
        args.timeout_seconds is None
        or args.timeout_seconds < 1
        or args.timeout_seconds > 999
        or args.cwd is None
        or not args.cwd.is_dir()
        or args.log_path is None
        or not command
    ):
        parser.error(
            "provide a timeout from 1 to 999 seconds, an existing cwd, a log path, and a command"
        )
    return run_bounded(
        command,
        cwd=args.cwd,
        log_path=args.log_path,
        timeout_seconds=args.timeout_seconds,
    )


if __name__ == "__main__":
    raise SystemExit(main())
