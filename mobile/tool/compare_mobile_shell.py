#!/usr/bin/env python3
"""Create side-by-side reference comparisons of the shared mobile shell."""

from __future__ import annotations

import argparse
import struct
import zlib
from pathlib import Path


PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
DESTINATIONS = {
    "today": "today.png",
    "chats": "channels.png",
    "activity": "activity.png",
    "business": "business.png",
}
REFERENCE_SIZE = (390, 844)
BRAND_BAR_HEIGHT = 54
NAVIGATION_BAR_HEIGHT = 55
DIVIDER_WIDTH = 2


def _paeth(left: int, above: int, upper_left: int) -> int:
    prediction = left + above - upper_left
    distances = (
        abs(prediction - left),
        abs(prediction - above),
        abs(prediction - upper_left),
    )
    return (left, above, upper_left)[distances.index(min(distances))]


def read_png(path: Path) -> tuple[int, int, list[bytes]]:
    data = path.read_bytes()
    if not data.startswith(PNG_SIGNATURE):
        raise ValueError(f"Not a PNG file: {path}")

    width = height = bit_depth = color_type = None
    compressed = bytearray()
    offset = len(PNG_SIGNATURE)
    while offset < len(data):
        length = struct.unpack_from(">I", data, offset)[0]
        chunk_type = data[offset + 4 : offset + 8]
        chunk = data[offset + 8 : offset + 8 + length]
        offset += length + 12
        if chunk_type == b"IHDR":
            width, height, bit_depth, color_type, compression, filtering, interlace = (
                struct.unpack(">IIBBBBB", chunk)
            )
            if (bit_depth, color_type, compression, filtering, interlace) not in (
                (8, 2, 0, 0, 0),
                (8, 6, 0, 0, 0),
            ):
                raise ValueError(f"Unsupported PNG encoding in {path}")
        elif chunk_type == b"IDAT":
            compressed.extend(chunk)
        elif chunk_type == b"IEND":
            break

    if width is None or height is None or color_type is None:
        raise ValueError(f"Missing PNG header in {path}")

    channels = 3 if color_type == 2 else 4
    stride = width * channels
    decoded = zlib.decompress(compressed)
    rows: list[bytes] = []
    previous = bytearray(stride)
    offset = 0
    for _ in range(height):
        filter_type = decoded[offset]
        offset += 1
        source = decoded[offset : offset + stride]
        offset += stride
        row = bytearray(stride)
        for index, value in enumerate(source):
            left = row[index - channels] if index >= channels else 0
            above = previous[index]
            upper_left = previous[index - channels] if index >= channels else 0
            if filter_type == 0:
                predictor = 0
            elif filter_type == 1:
                predictor = left
            elif filter_type == 2:
                predictor = above
            elif filter_type == 3:
                predictor = (left + above) // 2
            elif filter_type == 4:
                predictor = _paeth(left, above, upper_left)
            else:
                raise ValueError(f"Unsupported PNG filter {filter_type} in {path}")
            row[index] = (value + predictor) & 0xFF
        previous = row
        rows.append(bytes(row))

    if channels == 3:
        rows = [
            b"".join(row[index : index + 3] + b"\xff" for index in range(0, len(row), 3))
            for row in rows
        ]
    return width, height, rows


def encode_png(width: int, rows: list[bytes]) -> bytes:
    height = len(rows)
    raw = b"".join(b"\0" + row for row in rows)

    def chunk(name: bytes, payload: bytes) -> bytes:
        body = name + payload
        return struct.pack(">I", len(payload)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    header = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    return (
        PNG_SIGNATURE
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(raw, level=6))
        + chunk(b"IEND", b"")
    )


def shell_rows(height: int, rows: list[bytes]) -> list[bytes]:
    footer_start = height - NAVIGATION_BAR_HEIGHT
    return rows[:BRAND_BAR_HEIGHT] + rows[footer_start:]


def compare(reference: Path, capture: Path, output: Path) -> None:
    ref_width, ref_height, ref_rows = read_png(reference)
    current_width, current_height, current_rows = read_png(capture)
    if (ref_width, ref_height) != REFERENCE_SIZE:
        raise ValueError(f"Expected {REFERENCE_SIZE} reference screenshot: {reference}")
    if (current_width, current_height) != REFERENCE_SIZE:
        raise ValueError(f"Expected {REFERENCE_SIZE} capture screenshot: {capture}")

    ref_chrome = shell_rows(ref_height, ref_rows)
    current_chrome = shell_rows(current_height, current_rows)
    divider = bytes((96, 96, 96, 255)) * DIVIDER_WIDTH
    panel_rows = [
        ref + divider + current
        for ref, current in zip(ref_chrome, current_chrome, strict=True)
    ]
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(encode_png(ref_width * 2 + DIVIDER_WIDTH, panel_rows))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--references",
        type=Path,
        default=Path("/Users/mac/worktrees/.lanes/phase2/evidence/mobile-reference"),
    )
    parser.add_argument("--captures", type=Path, default=Path("/tmp/colony-mobile-shell"))
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("/tmp/colony-mobile-shell/comparison"),
    )
    args = parser.parse_args()

    comparisons = 0
    missing: list[str] = []
    for destination, reference_name in DESTINATIONS.items():
        reference = args.references / reference_name
        capture = args.captures / "390x844" / "light" / f"{destination}.png"
        if not reference.is_file():
            missing.append(str(reference))
            continue
        if not capture.is_file():
            raise FileNotFoundError(f"Missing mobile capture: {capture}")
        output = args.output / f"390x844-light-{destination}-chrome-comparison.png"
        compare(reference, capture, output)
        comparisons += 1
        print(output)

    print(f"Created {comparisons} shared-shell comparisons.")
    print("Reference coverage found: 390x844 light only.")
    print("Dark and 412x915 reference screenshots were not supplied.")
    for path in missing:
        print(f"Missing reference: {path}")
    return 0 if comparisons else 1


if __name__ == "__main__":
    raise SystemExit(main())
