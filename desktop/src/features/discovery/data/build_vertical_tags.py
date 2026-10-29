#!/usr/bin/env python3 -I
"""Build vertical-tags.json, the AI tag layer of Discovery search.

    python3 -I build_vertical_tags.py <verticals dir> <industry-taxonomy.json> <out>

<verticals dir> holds one `<type id>.json` per business type (the output of the
free Gemini tag pass). Files are read as data only. The result is compact JSON
keyed by type id:

    {"<id>": {"tags": [["sofa", "product"], ...], "search": [...], "sa": [...]}}

Rules: every taxonomy id needs a file and every file needs a taxonomy id (else
the build fails). Text is lower-cased and trimmed with inner spaces collapsed;
exact duplicates go; anything equal to the type label or an alias goes (the
name fields already carry those); an em or en dash anywhere in the input fails
the build. `possible_duplicates` and `usage` are not read.
"""

import json
import sys
from pathlib import Path

DASHES = ("—", "–")


class BuildError(Exception):
    pass


def clean(text, where):
    if not isinstance(text, str):
        raise BuildError(f"{where}: expected text, got {type(text).__name__}")
    for dash in DASHES:
        if dash in text:
            raise BuildError(f"{where}: dash character in {text!r}")
    return " ".join(text.lower().split())


def clean_list(values, where, skip):
    out = []
    seen = set(skip)
    for value in values or []:
        text = clean(value, where)
        if text and text not in seen:
            seen.add(text)
            out.append(text)
    return out


def build_type(type_row, source):
    where = type_row["id"]
    skip = {clean(type_row["label"], where)}
    skip.update(clean(alias, where) for alias in type_row.get("aliases") or [])
    tags = []
    seen = set(skip)
    for entry in source.get("tags") or []:
        text = clean(entry.get("tag"), f"{where} tag")
        kind = clean(entry.get("kind") or "", f"{where} kind")
        if text and text not in seen:
            seen.add(text)
            tags.append([text, kind])
    return {
        "tags": tags,
        "search": clean_list(source.get("search_terms"), f"{where} search", skip),
        "sa": clean_list(source.get("south_africa_terms"), f"{where} sa", skip),
    }


def build(verticals_dir, taxonomy_path):
    taxonomy = json.loads(Path(taxonomy_path).read_text(encoding="utf-8"))
    types = {row["id"]: row for row in taxonomy["types"]}
    files = {path.stem: path for path in Path(verticals_dir).glob("*.json")}
    missing = sorted(set(types) - set(files))
    unknown = sorted(set(files) - set(types))
    if missing:
        raise BuildError(f"{len(missing)} taxonomy ids have no file: {missing}")
    if unknown:
        raise BuildError(f"{len(unknown)} files have an unknown id: {unknown}")
    out = {}
    for type_id in sorted(types):
        source = json.loads(files[type_id].read_text(encoding="utf-8"))
        out[type_id] = build_type(types[type_id], source)
    return out


def main(argv):
    if len(argv) != 4:
        print(__doc__, file=sys.stderr)
        return 2
    try:
        result = build(argv[1], argv[2])
    except BuildError as error:
        print(f"build_vertical_tags: {error}", file=sys.stderr)
        return 1
    Path(argv[3]).write_text(
        json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    tags = sum(len(row["tags"]) for row in result.values())
    print(f"{len(result)} types, {tags} tags -> {argv[3]}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
