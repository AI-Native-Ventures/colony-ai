#!/usr/bin/env python3
"""Bounded, host-testable assertions for the Android runtime harness."""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path
from xml.etree import ElementTree

LABELS = ("Welcome to Buzz", "Scan a QR code")
MAX_INPUT_BYTES = 4 * 1024 * 1024
PACKAGE_RE = re.compile(r"[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+")
CLASS_RE = re.compile(
    r"(?:\.[A-Za-z_][A-Za-z0-9_]*|[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)"
)
FOREGROUND_MARKERS = (
    "mCurrentFocus=",
    "mFocusedApp=",
    "mResumedActivity:",
    "mTopResumedActivity:",
)
WINDOW_HEADER_RE = re.compile(
    r"^\s*Window #\d+\s+Window\{[^}]*\bu\d+\s+([^\s}]+)\}:"
)
COMPONENT_PACKAGE_RE = re.compile(
    r"(?<![A-Za-z0-9_.])([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+)/"
)


def valid_package(package: str) -> bool:
    return PACKAGE_RE.fullmatch(package) is not None


def valid_component(package: str, component: str) -> bool:
    if not valid_package(package):
        return False
    prefix, separator, activity = component.partition("/")
    return (
        separator == "/"
        and prefix == package
        and CLASS_RE.fullmatch(activity) is not None
    )


def ui_has_labels(xml_text: str, expected_package: str) -> bool:
    """Require exact labels whose package is expected or inherited from it."""

    try:
        root = ElementTree.fromstring(xml_text)
    except ElementTree.ParseError:
        return False

    found: set[str] = set()

    def visit(node: ElementTree.Element, inherited_package: str | None) -> None:
        package = node.attrib.get("package") or inherited_package
        if package == expected_package:
            label = node.attrib.get("content-desc")
            if label in LABELS:
                found.add(label)
        for child in node:
            visit(child, package)

    visit(root, None)
    return set(LABELS).issubset(found)


def foreground_has_package(dumpsys_text: str, expected_package: str) -> bool:
    """Require expected focused/resumed or visible-window package ownership.

    Android API 35 no longer emits the older focus markers in every
    ``dumpsys window windows`` response. Its window blocks still identify the
    activity component and expose ``isOnScreen``/``isVisible``; use that shape
    only when no explicit focus marker is present.
    """

    focused_lines = [
        line
        for line in dumpsys_text.splitlines()
        if any(marker in line for marker in FOREGROUND_MARKERS)
    ]
    if focused_lines:
        focused_packages: list[str] = []
        for line in focused_lines:
            packages = COMPONENT_PACKAGE_RE.findall(line)
            if len(packages) != 1:
                return False
            focused_packages.append(packages[0])
        return all(package == expected_package for package in focused_packages)

    current_component: str | None = None
    on_screen = False
    visible = False
    visible_application_packages: set[str] = set()

    def record_visible_application() -> None:
        if current_component is None or not (on_screen and visible):
            return
        package, separator, _ = current_component.partition("/")
        if separator == "/" and valid_package(package):
            visible_application_packages.add(package)

    for line in dumpsys_text.splitlines():
        header = WINDOW_HEADER_RE.match(line)
        if header:
            record_visible_application()
            current_component = header.group(1)
            on_screen = False
            visible = False
            continue
        if current_component is not None:
            on_screen = on_screen or "isOnScreen=true" in line
            visible = visible or "isVisible=true" in line

    record_visible_application()
    return visible_application_packages == {expected_package}


def read_bounded(path: Path) -> str:
    if path.stat().st_size > MAX_INPUT_BYTES:
        raise ValueError(f"input is larger than {MAX_INPUT_BYTES} bytes")
    return path.read_text(encoding="utf-8")


def read_stdin_bounded() -> str:
    text = sys.stdin.read(MAX_INPUT_BYTES + 1)
    if len(text.encode("utf-8")) > MAX_INPUT_BYTES:
        raise ValueError(f"input is larger than {MAX_INPUT_BYTES} bytes")
    return text


def old_unbound_label_grep_would_pass(xml_text: str) -> bool:
    """Model the pre-review assertion for the negative regression fixture."""

    return all(f'content-desc="{label}"' in xml_text for label in LABELS)


def run_self_test() -> None:
    package = "xyz.block.buzz.mobile"
    valid_xml = f"""<hierarchy package=\"{package}\">
  <node class=\"android.view.View\" content-desc=\"Welcome to Buzz\" />
  <node class=\"android.widget.Button\" content-desc=\"Scan a QR code\" />
</hierarchy>"""
    wrong_package_xml = valid_xml.replace(package, "com.android.launcher3")
    invalid_xml = f'<hierarchy package="{package}"><node content-desc="Welcome to Buzz">'
    valid_foreground = (
        "mCurrentFocus=Window{abc u0 xyz.block.buzz.mobile/.MainActivity}"
    )
    wrong_foreground = "mCurrentFocus=Window{abc u0 com.android.launcher3/.Launcher}"
    api35_visible_foreground = """Window #8 Window{abc u0 xyz.block.buzz.mobile/.MainActivity}:
  mHasSurface=true isReadyForDisplay=true
  isOnScreen=true
  isVisible=true
Window #9 Window{def u0 com.google.android.apps.nexuslauncher/.NexusLauncherActivity}:
  isOnScreen=false
  isVisible=false
"""
    wrong_api35_visible_foreground = api35_visible_foreground.replace(
        "xyz.block.buzz.mobile/.MainActivity",
        "com.google.android.apps.nexuslauncher/.NexusLauncherActivity",
    )
    competing_api35_visible_foreground = api35_visible_foreground.replace(
        "isOnScreen=false\n  isVisible=false",
        "isOnScreen=true\n  isVisible=true",
    )
    conflicting_foreground = (
        "mCurrentFocus=Window{abc u0 xyz.block.buzz.mobile/.MainActivity}\n"
        "mFocusedApp=Window{def u0 com.android.launcher3/.Launcher}"
    )

    assert ui_has_labels(valid_xml, package)
    assert not ui_has_labels(wrong_package_xml, package)
    assert not ui_has_labels(invalid_xml, package)
    assert foreground_has_package(valid_foreground, package)
    assert not foreground_has_package(wrong_foreground, package)
    assert foreground_has_package(api35_visible_foreground, package)
    assert not foreground_has_package(wrong_api35_visible_foreground, package)
    assert not foreground_has_package(competing_api35_visible_foreground, package)
    assert not foreground_has_package(conflicting_foreground, package)
    assert valid_component(package, f"{package}/.MainActivity")
    assert not valid_component(package, "com.example.other/.MainActivity")

    # The old grep-only assertion would accept the wrong-package fixture.
    assert old_unbound_label_grep_would_pass(wrong_package_xml)

    print("android-runtime-proof-parser self-test passed")
    print("wrong-package labels: old assertion would pass; package-aware parser rejected")
    print("wrong foreground: UI labels valid; foreground assertion rejected")
    print("API-35 visible window: expected package accepted; wrong package rejected")
    print("ambiguous visible/conflicting foreground: rejected")
    print("mismatched component: component-prefix assertion rejected")
    print("stale/invalid XML: XML-aware parser rejected")
    print("valid package/component/foreground/UI: accepted")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser()
    parser.add_argument("--self-test", action="store_true")
    subparsers = parser.add_subparsers(dest="mode")

    component = subparsers.add_parser("component")
    component.add_argument("--package", required=True)
    component.add_argument("--component", required=True)

    foreground = subparsers.add_parser("foreground")
    foreground.add_argument("--package", required=True)

    ui = subparsers.add_parser("ui")
    ui.add_argument("--package", required=True)
    ui.add_argument("xml", type=Path)
    return parser


def main() -> int:
    args = build_parser().parse_args()
    if args.self_test:
        run_self_test()
        return 0

    if args.mode == "component":
        result = valid_component(args.package, args.component)
    elif args.mode == "foreground":
        try:
            result = foreground_has_package(read_stdin_bounded(), args.package)
        except ValueError as error:
            print(f"android runtime foreground rejected: {error}", file=sys.stderr)
            return 1
    elif args.mode == "ui":
        try:
            result = ui_has_labels(read_bounded(args.xml), args.package)
        except (OSError, ValueError, UnicodeError) as error:
            print(f"android runtime UI rejected: {error}", file=sys.stderr)
            return 1
    else:
        build_parser().error("choose --self-test or a parser mode")

    if not result:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
