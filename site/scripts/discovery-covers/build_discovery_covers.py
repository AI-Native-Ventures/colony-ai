#!/usr/bin/env python3
"""Convert the approved Discovery v4 PNG maps into the site's WebP package.

The JavaScript inputs are parsed as JSON data. They are never imported or run.
"""

from __future__ import annotations

import argparse
import io
import json
import math
from pathlib import Path
from typing import Any

from PIL import Image, ImageOps


SIZES = (640, 1200)
EXPECTED_INDUSTRIES = 51
EXPECTED_TYPES = 869
SOURCE_SIZE = (1536, 1024)


def read_json_assignment(path: Path) -> Any:
    text = path.read_text(encoding="utf-8")
    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end < start:
        raise ValueError(f"Could not find a JSON object in {path.name}")
    try:
        return json.loads(text[start : end + 1])
    except json.JSONDecodeError as error:
        raise ValueError(f"{path.name} is not a JSON data object: {error}") from error


def source_entries(
    mapping: dict[str, str],
    prototype_dir: Path,
    allowed_roots: list[Path],
) -> list[tuple[str, Path]]:
    entries: list[tuple[str, Path]] = []
    for asset_id, relative_path in mapping.items():
        source = (prototype_dir / relative_path).resolve()
        if source.suffix.lower() != ".png":
            raise ValueError(f"Expected a PNG for {asset_id}: {source}")
        if not any(source.is_relative_to(root) for root in allowed_roots):
            raise ValueError(f"Mapped source is outside the approved image roots: {source}")
        if not source.is_file():
            raise FileNotFoundError(f"Missing source image for {asset_id}: {source}")
        entries.append((asset_id, source))
    return entries


def mapped_assets(
    prototype_dir: Path,
    allowed_roots: list[Path],
) -> list[tuple[str, Path]]:
    data = read_json_assignment(prototype_dir / "data.js")
    industries = read_json_assignment(prototype_dir / "images.js")
    types = read_json_assignment(prototype_dir / "vertical-images.js")

    if not isinstance(data, dict) or not isinstance(data.get("hubs"), list):
        raise ValueError("data.js does not contain the expected v4 hubs catalogue")
    if not isinstance(data.get("types"), list):
        raise ValueError("data.js does not contain the expected v4 types catalogue")

    industry_ids = {entry["id"] for entry in data["hubs"]}
    type_ids = {entry["id"] for entry in data["types"]}
    if len(industry_ids) != EXPECTED_INDUSTRIES:
        raise ValueError(f"Expected {EXPECTED_INDUSTRIES} industries, found {len(industry_ids)}")
    if len(type_ids) != EXPECTED_TYPES:
        raise ValueError(f"Expected {EXPECTED_TYPES} canonical types, found {len(type_ids)}")
    if set(industries) != industry_ids:
        raise ValueError("Industry cover IDs do not match the v4 data.js industries")
    if set(types) != type_ids:
        missing = sorted(type_ids - set(types))
        extra = sorted(set(types) - type_ids)
        raise ValueError(f"Vertical image map mismatch. Missing: {missing[:5]}; extra: {extra[:5]}")
    overlap = industry_ids & type_ids
    if overlap:
        raise ValueError(f"Industry and type IDs collide: {sorted(overlap)[:5]}")

    entries = source_entries(industries, prototype_dir, allowed_roots)
    entries.extend(source_entries(types, prototype_dir, allowed_roots))
    return entries


def encode_image(source: Path, width: int, quality: int) -> bytes:
    with Image.open(source) as image:
        oriented = ImageOps.exif_transpose(image)
        if oriented.size != SOURCE_SIZE:
            raise ValueError(f"Unexpected dimensions for {source.name}: {oriented.size}")
        height = round(oriented.height * width / oriented.width)
        resized = oriented.resize((width, height), Image.Resampling.LANCZOS).convert("RGB")
        buffer = io.BytesIO()
        resized.save(buffer, format="WEBP", quality=quality, method=6)
        return buffer.getvalue()


def evenly_spaced_sample(
    entries: list[tuple[str, Path]], count: int
) -> list[tuple[str, Path]]:
    if count <= 0 or count >= len(entries):
        return entries
    if count == 1:
        return [entries[len(entries) // 2]]
    indices = {round(index * (len(entries) - 1) / (count - 1)) for index in range(count)}
    return [entries[index] for index in sorted(indices)]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prototype-dir", required=True, type=Path)
    parser.add_argument("--source-root", required=True, action="append", type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--quality", default=50, type=int)
    parser.add_argument("--max-total-mb", default=30, type=float)
    parser.add_argument("--sample-count", type=int)
    args = parser.parse_args()

    if not 1 <= args.quality <= 100:
        parser.error("--quality must be between 1 and 100")
    prototype_dir = args.prototype_dir.resolve()
    source_roots = [root.resolve() for root in args.source_root]
    entries = mapped_assets(prototype_dir, source_roots)
    selected = evenly_spaced_sample(entries, args.sample_count or 0)

    output_bytes: list[tuple[Path, bytes]] = []
    for asset_id, source in selected:
        for width in SIZES:
            filename = f"{asset_id}-{width}.webp"
            output_bytes.append((args.output_dir / filename, encode_image(source, width, args.quality)))

    total_bytes = sum(len(content) for _, content in output_bytes)
    if args.sample_count:
        projected = math.ceil(total_bytes * len(entries) / len(selected))
        print(
            f"Sampled {len(selected)} of {len(entries)} pictures at quality {args.quality}: "
            f"{total_bytes:,} bytes; projected full set {projected:,} bytes "
            f"({projected / 1_000_000:.2f} MB)."
        )
        return

    max_total_bytes = round(args.max_total_mb * 1_000_000)
    if total_bytes > max_total_bytes:
        raise SystemExit(
            f"WebP set is {total_bytes:,} bytes ({total_bytes / 1_000_000:.2f} MB), "
            f"above the {args.max_total_mb:.0f} MB limit. Lower --quality and retry."
        )

    expected_names = {path.name for path, _ in output_bytes}
    if args.output_dir.exists():
        existing_names = {path.name for path in args.output_dir.iterdir() if path.is_file()}
        unexpected = existing_names - expected_names
        if unexpected:
            raise ValueError(f"Unexpected files already exist in output directory: {sorted(unexpected)[:5]}")

    args.output_dir.mkdir(parents=True, exist_ok=True)
    for path, content in output_bytes:
        if len(content) > 25 * 1024 * 1024:
            raise ValueError(f"{path.name} exceeds the site's 25 MiB per-file limit")
        path.write_bytes(content)

    print(
        f"Wrote {len(entries)} pictures at {SIZES[0]} and {SIZES[1]} widths "
        f"({len(output_bytes)} WebP files), quality {args.quality}, "
        f"{total_bytes:,} bytes ({total_bytes / 1_000_000:.2f} MB, "
        f"{total_bytes / (1024 * 1024):.2f} MiB)."
    )


if __name__ == "__main__":
    main()
