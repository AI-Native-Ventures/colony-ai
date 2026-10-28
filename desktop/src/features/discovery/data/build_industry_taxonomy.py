#!/usr/bin/env python3 -I
"""Build industry-taxonomy.json from the Discovery v4 catalogue.

    python3 -I build_industry_taxonomy.py <prototype-v4/data.js> <legacy-bridge.json>

Reads both inputs as data only (nothing from them is executed). The catalogue
is `window.DISCOVERY_DATA = {...};`; the JSON object after the `=` is parsed.
The legacy 34-industry / 531-vertical list lives in source/ and supplies the
South Africa market notes and the old ids saved campaigns may still hold.

Output keeps only search and display fields: ids, labels, a description, the
aliases and the industries each type sits in (own industry first). No cover images, class codes or
review state.
"""

import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent

# Old industry id -> v4 hub that carries on the same idea. Only the twelve
# industries the board features have a note worth keeping.
HUB_FOR_LEGACY_INDUSTRY = {
    "fashion-apparel": "fashion-accessories",
    "home-living": "home-garden",
    "healthcare": "healthcare",
    "legal": "legal",
    "financial-services": "finance-investment",
    "real-estate": "real-estate",
    "technology": "technology-software",
    "construction": "construction-trades",
    "education": "education-training",
    "hospitality": "travel-tourism",
    "food-beverage": "food-beverage",
    "beauty-wellness": "beauty-wellness",
}


def norm(text):
    text = text.lower().replace("&", " and ")
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", text)).strip()


def load_catalogue(path):
    source = Path(path).read_text(encoding="utf-8")
    start = source.index("=") + 1
    return json.loads(source[start:].strip().rstrip(";"))


def main(data_js, bridge_json):
    data = load_catalogue(data_js)
    bridge = json.loads(Path(bridge_json).read_text(encoding="utf-8"))
    legacy = json.loads((HERE / "source/legacy-industry-taxonomy.json").read_text())

    types = {t["id"]: t for t in data["types"]}
    redirects = data["canonicalRedirects"]

    def settle(type_id):
        seen = set()
        while type_id in redirects and type_id not in seen:
            seen.add(type_id)
            type_id = redirects[type_id]
        return type_id if type_id in types else None

    by_name = {}
    for t in data["types"]:
        for name in [t["label"], *t["aliases"]]:
            by_name.setdefault(norm(name), set()).add(t["id"])

    exact = {}
    for row in bridge:
        ids = row["candidate_type_ids"]
        if len(ids) == 1:
            exact[row["legacy_vertical_id"]] = ids[0]

    legacy_rows = [
        (c, v) for c in legacy for v in c["verticals"]
    ]
    legacy_map = {}
    sources = {"same-id": 0, "bridge": 0, "label": 0, "none": 0}
    for _, v in legacy_rows:
        target = None
        if settle(v["id"]):
            target, how = settle(v["id"]), "same-id"
        elif v["id"] in exact and settle(exact[v["id"]]):
            target, how = settle(exact[v["id"]]), "bridge"
        else:
            hits = by_name.get(norm(v["label"]), set())
            if len(hits) == 1:
                target, how = settle(next(iter(hits))), "label"
        if target:
            sources[how] += 1
        else:
            sources["none"] += 1
        legacy_map[v["id"]] = target

    notes, old_names = {}, {}
    for _, v in legacy_rows:
        target = legacy_map[v["id"]]
        if not target:
            continue
        if v.get("description") and target not in notes:
            notes[target] = v["description"]
        old_names.setdefault(target, []).append(v["label"])

    out_types = []
    for t in data["types"]:
        aliases = []
        for name in [*t["aliases"], *old_names.get(t["id"], [])]:
            if norm(name) != norm(t["label"]) and name not in aliases:
                aliases.append(name)
        entry = {
            "id": t["id"],
            "label": t["label"],
            "description": notes.get(t["id"]) or t["definition"],
            # The first industry is the type's own; conditional hub links
            # (e.g. "has online ordering") are not browse routes and stay out.
            "industries": t["hub_ids"],
        }
        if aliases:
            entry["aliases"] = aliases
        out_types.append(entry)

    legacy_descriptions = {c["id"]: c.get("description") for c in legacy}
    industries = []
    for hub in data["hubs"]:
        industry = {"id": hub["id"], "label": hub["label"]}
        for old_id, hub_id in HUB_FOR_LEGACY_INDUSTRY.items():
            if hub_id == hub["id"] and legacy_descriptions.get(old_id):
                industry["description"] = legacy_descriptions[old_id]
        industries.append(industry)

    output = {
        "industries": industries,
        "types": out_types,
        "redirects": redirects,
        "legacy": legacy_map,
    }
    (HERE / "industry-taxonomy.json").write_text(
        json.dumps(output, ensure_ascii=False, indent=1) + "\n", encoding="utf-8"
    )
    print(
        f"{len(industries)} industries, {len(out_types)} types, "
        f"{len(notes)} market notes kept, legacy {sources}"
    )


if __name__ == "__main__":
    main(*sys.argv[1:3])
