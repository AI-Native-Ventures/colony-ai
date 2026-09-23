#!/usr/bin/env python3
"""Bounded adb UI automation for the hosted Android interop proof."""

from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
import time
import xml.etree.ElementTree as ET
from pathlib import Path


ARTIFACT_DIR = Path(os.environ.get("ANDROID_INTEROP_ARTIFACT_DIR", "android-interop-artifacts"))
REMOTE_UI = "/sdcard/android-interop-uiautomator.xml"
MAX_UI_BYTES = 2 * 1024 * 1024
BOUNDS = re.compile(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]")


class UiError(RuntimeError):
    pass


def serial() -> str:
    result = subprocess.run(
        ["adb", "devices"], capture_output=True, text=True, timeout=15, check=True
    )
    devices = [
        line.split()[0]
        for line in result.stdout.splitlines()[1:]
        if len(line.split()) >= 2
        and line.split()[1] == "device"
        and line.split()[0].startswith("emulator-")
    ]
    if len(devices) != 1:
        raise UiError(f"expected one online emulator, found {len(devices)}")
    return devices[0]


def adb(*args: str, timeout: int = 25) -> str:
    result = subprocess.run(
        ["adb", "-s", serial(), *args],
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )
    if result.returncode != 0:
        detail = (result.stderr or result.stdout).strip()[-1200:]
        raise UiError(f"adb {' '.join(args)} failed: {detail}")
    return result.stdout


def dump_xml() -> ET.Element:
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    adb("shell", "rm", "-f", REMOTE_UI)
    adb("shell", "uiautomator", "dump", REMOTE_UI, timeout=35)
    try:
        size = int(adb("shell", "wc", "-c", REMOTE_UI).strip().split()[0])
    except (IndexError, ValueError) as error:
        raise UiError("could not read uiautomator hierarchy size") from error
    if size <= 0 or size > MAX_UI_BYTES:
        raise UiError(f"uiautomator hierarchy size is outside 1..{MAX_UI_BYTES} bytes")
    try:
        result = subprocess.run(
            ["adb", "-s", serial(), "exec-out", "cat", REMOTE_UI],
            capture_output=True,
            timeout=15,
            check=False,
        )
    finally:
        adb("shell", "rm", "-f", REMOTE_UI)
    if result.returncode != 0 or not result.stdout.strip():
        raise UiError("uiautomator returned an empty hierarchy")
    (ARTIFACT_DIR / "ui-current.xml").write_bytes(result.stdout)
    try:
        return ET.fromstring(result.stdout)
    except ET.ParseError as error:
        raise UiError(f"uiautomator returned invalid XML: {error}") from error


def bounds(node: ET.Element) -> tuple[int, int, int, int]:
    match = BOUNDS.fullmatch(node.attrib.get("bounds", ""))
    if match is None:
        raise UiError("UI node does not have usable bounds")
    return tuple(int(value) for value in match.groups())


def node_values(node: ET.Element) -> list[str]:
    return [
        node.attrib.get(key, "")
        for key in ("text", "content-desc", "resource-id", "hint")
        if node.attrib.get(key)
    ]


def brief_tree(root: ET.Element | None, limit: int = 80) -> str:
    if root is None:
        return "no hierarchy"
    values = []
    for node in root.iter("node"):
        for value in node_values(node):
            if value not in values:
                values.append(value)
            if len(values) >= limit:
                return " | ".join(values)
    return " | ".join(values)


def text_nodes(root: ET.Element, needle: str, exact: bool) -> list[ET.Element]:
    matches = []
    for node in root.iter("node"):
        values = node_values(node)
        if any(value == needle if exact else needle in value for value in values):
            matches.append(node)
    return matches


def best_text_match(root: ET.Element, needle: str, exact: bool) -> ET.Element | None:
    matches = text_nodes(root, needle, exact)
    if not matches:
        return None
    clickable = [node for node in matches if node.attrib.get("clickable") == "true"]
    candidates = clickable or matches
    return min(
        candidates,
        key=lambda node: (bounds(node)[2] - bounds(node)[0])
        * (bounds(node)[3] - bounds(node)[1]),
    )


def wait_text(needle: str, exact: bool, timeout_seconds: int) -> ET.Element:
    deadline = time.monotonic() + timeout_seconds
    last_root: ET.Element | None = None
    while time.monotonic() < deadline:
        try:
            last_root = dump_xml()
            match = best_text_match(last_root, needle, exact)
            if match is not None:
                print(f"PASS ui-text-found value={needle}")
                return match
        except UiError as error:
            print(f"WAIT ui-dump-retry error={error}", file=sys.stderr)
        time.sleep(1)
    mode = "exact" if exact else "containing"
    raise UiError(
        f"timed out waiting for {mode} text {needle!r}; UI={brief_tree(last_root)}"
    )


def input_node(root: ET.Element) -> ET.Element | None:
    fields = [
        node
        for node in root.iter("node")
        if "edittext" in node.attrib.get("class", "").lower()
    ]
    if not fields:
        fields = [
            node
            for node in root.iter("node")
            if node.attrib.get("focusable") == "true"
            and node.attrib.get("clickable") == "true"
            and any("Message" in value or "Reply" in value for value in node_values(node))
        ]
    if not fields:
        return None
    return max(fields, key=lambda node: bounds(node)[2] - bounds(node)[0])


def wait_input(timeout_seconds: int) -> ET.Element:
    deadline = time.monotonic() + timeout_seconds
    last_root: ET.Element | None = None
    while time.monotonic() < deadline:
        try:
            last_root = dump_xml()
            field = input_node(last_root)
            if field is not None:
                print(f"PASS ui-input-ready hint={' '.join(node_values(field))}")
                return field
        except UiError as error:
            print(f"WAIT ui-dump-retry error={error}", file=sys.stderr)
        time.sleep(1)
    raise UiError(f"timed out waiting for message input; UI={brief_tree(last_root)}")


def tap_bounds(node: ET.Element, label: str) -> None:
    left, top, right, bottom = bounds(node)
    x = (left + right) // 2
    y = (top + bottom) // 2
    adb("shell", "input", "tap", str(x), str(y))
    print(f"UI_TAP label={label} x={x} y={y}")


def screen_size() -> tuple[int, int]:
    output = adb("shell", "wm", "size")
    match = re.search(r"(?:Physical|Override) size:\s*(\d+)x(\d+)", output)
    if match is None:
        raise UiError(f"could not parse emulator screen size: {output.strip()}")
    return int(match.group(1)), int(match.group(2))


def density_scale() -> float:
    output = adb("shell", "wm", "density")
    match = re.search(r"(?:Physical|Override) density:\s*(\d+)", output)
    return int(match.group(1)) / 160 if match else 1.0


def tap_send_button() -> None:
    root = dump_xml()
    field = input_node(root)
    if field is None:
        raise UiError("message input disappeared before send-button tap")
    _, top, _, bottom = bounds(field)
    field_y = (top + bottom) / 2
    width, _ = screen_size()
    scale = density_scale()
    candidates = []
    for node in root.iter("node"):
        if node.attrib.get("clickable") != "true" or node is field:
            continue
        x1, y1, x2, y2 = bounds(node)
        center_x = (x1 + x2) / 2
        center_y = (y1 + y2) / 2
        node_width = x2 - x1
        node_height = y2 - y1
        if (
            center_x >= width - 120 * scale
            and abs(center_y - field_y) <= 100 * scale
            and 0 < node_width <= 100 * scale
            and 0 < node_height <= 100 * scale
        ):
            candidates.append((abs(center_y - field_y), -center_x, node))
    if candidates:
        candidates.sort(key=lambda item: (item[0], item[1]))
        tap_bounds(candidates[0][2], "composer-send")
        return

    x = width - round(28 * scale)
    y = round(field_y)
    adb("shell", "input", "tap", str(x), str(y))
    print(f"UI_TAP label=composer-send-fallback x={x} y={y}")


def main() -> None:
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("dump")

    wait_text_parser = commands.add_parser("wait-text")
    wait_text_parser.add_argument("value")
    wait_text_parser.add_argument("--exact", action="store_true")
    wait_text_parser.add_argument("--timeout", type=int, default=90)

    tap_text_parser = commands.add_parser("tap-text")
    tap_text_parser.add_argument("value")
    tap_text_parser.add_argument("--exact", action="store_true")
    tap_text_parser.add_argument("--timeout", type=int, default=30)

    wait_input_parser = commands.add_parser("wait-input")
    wait_input_parser.add_argument("--timeout", type=int, default=90)

    tap_input_parser = commands.add_parser("tap-input")
    tap_input_parser.add_argument("--timeout", type=int, default=30)

    commands.add_parser("tap-send")
    args = parser.parse_args()

    if args.command == "dump":
        print(brief_tree(dump_xml()))
    elif args.command == "wait-text":
        wait_text(args.value, args.exact, args.timeout)
    elif args.command == "tap-text":
        tap_bounds(wait_text(args.value, args.exact, args.timeout), args.value)
    elif args.command == "wait-input":
        wait_input(args.timeout)
    elif args.command == "tap-input":
        tap_bounds(wait_input(args.timeout), "message-input")
    elif args.command == "tap-send":
        tap_send_button()


if __name__ == "__main__":
    try:
        main()
    except (UiError, subprocess.SubprocessError) as error:
        print(f"FAIL {error}", file=sys.stderr)
        sys.exit(1)
