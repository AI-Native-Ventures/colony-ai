import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  loadVerticalTagsFrom,
  resetVerticalTagsForTest,
  searchCatalogue,
  setVerticalTags,
  verticalTagsLoaded,
} from "./taxonomy.ts";

const dataDir = new URL("./data/", import.meta.url);
const tagData = JSON.parse(
  fs.readFileSync(new URL("vertical-tags.json", dataDir), "utf8"),
);
const taxonomyPath = new URL("industry-taxonomy.json", dataDir);
const buildScript = new URL("build_vertical_tags.py", dataDir);

function rows(query) {
  return searchCatalogue("businesses", query, null);
}
function ids(query) {
  return rows(query).map((row) => row.id);
}
function withTags(run) {
  setVerticalTags(tagData);
  try {
    run();
  } finally {
    resetVerticalTagsForTest();
  }
}

test("sofa lists furniture manufacturers once the tags are in", () => {
  resetVerticalTagsForTest();
  const before = ids("sofa");
  withTags(() => {
    assert.ok(ids("sofa").includes("furniture-manufacturers"));
    // Only a tag of this type holds "bespoke sofa frame".
    assert.ok(ids("bespoke sofa frame").includes("custom-furniture-makers"));
  });
  // Fails without the tag layer wired into buildSearchIndex (the `tags` / `names` fields).
  assert.ok(!before.includes("furniture-manufacturers"));
});

test("a tag-only hit lists its type with the matched tag, at most two", () => {
  withTags(() => {
    const row = rows("chesterfield sofa").find(
      (entry) => entry.id === "antique-and-vintage-furniture-dealers",
    );
    assert.deepEqual(row.tagMatches, ["chesterfield sofa"]);
    const sofa = rows("sofa").find(
      (entry) => entry.id === "furniture-manufacturers",
    );
    assert.ok(sofa.tagMatches.length >= 1 && sofa.tagMatches.length <= 2);
    assert.ok(sofa.tagMatches.every((tag) => tag.includes("sofa")));
  });
});

test("a South African term from the data lists its type", () => {
  const type = "prepared-animal-feeds-manufacturers";
  assert.ok(tagData[type].sa.includes("braaikuikenvoer"));
  withTags(() => {
    assert.ok(ids("braaikuikenvoer").includes(type));
    assert.ok(ids("spaza").includes("convenience-stores"));
  });
  assert.ok(!ids("braaikuikenvoer").includes(type));
});

test("guest house still lists Guesthouses and inns first", () => {
  withTags(() => {
    assert.equal(ids("guest house")[0], "guesthouses-and-inns");
    assert.equal(ids("pharmacy")[0], "pharmacies-and-drugstores");
  });
});

test("a type whose name matches outranks one matched only by a tag", () => {
  withTags(() => {
    const found = ids("sofa");
    const byName = found.indexOf("sofa-couch-retailers");
    const byTag = found.indexOf("furniture-manufacturers");
    assert.equal(byName, 0);
    assert.ok(byTag > byName);
    // Search terms and aliases rank before tags: this type has a search term
    // for "sofa", the antiques dealer only a tag, and the dealer comes first
    // in the catalogue.
    assert.ok(byTag < found.indexOf("antique-and-vintage-furniture-dealers"));
    const saas = ids("saas");
    assert.equal(saas[0], "saas-providers");
    assert.ok(saas.indexOf("cybersecurity-software-vendors") > 0);
    assert.equal(
      rows("sofa").find((row) => row.id === "sofa-couch-retailers").tagMatches,
      undefined,
    );
  });
});

test("tags not loaded: old results, no throw", () => {
  resetVerticalTagsForTest();
  assert.equal(verticalTagsLoaded(), false);
  assert.doesNotThrow(() => rows("sofa"));
  assert.equal(ids("guest house")[0], "guesthouses-and-inns");
  assert.ok(rows("sofa").every((row) => row.tagMatches === undefined));
});

test("a failed load keeps the old fields and is not retried", async () => {
  resetVerticalTagsForTest();
  let calls = 0;
  const failing = () => {
    calls += 1;
    return Promise.reject(new Error("chunk missing"));
  };
  assert.equal(await loadVerticalTagsFrom(failing), false);
  assert.equal(await loadVerticalTagsFrom(failing), false);
  assert.equal(calls, 1);
  assert.equal(verticalTagsLoaded(), false);
  assert.ok(!ids("sofa").includes("furniture-manufacturers"));
  resetVerticalTagsForTest();
});

test("a successful load installs the tags and drops the stale index", async () => {
  resetVerticalTagsForTest();
  assert.ok(!ids("sofa").includes("furniture-manufacturers"));
  assert.equal(
    await loadVerticalTagsFrom(() => Promise.resolve(tagData)),
    true,
  );
  assert.ok(ids("sofa").includes("furniture-manufacturers"));
  resetVerticalTagsForTest();
});

test("search speed over the full tag data", () => {
  const queries = [
    "sofa",
    "spaza",
    "saas",
    "braai",
    "guest house",
    "pharmacy",
    "hotel",
    "plumber",
    "accounting",
    "bakery",
    "solar panel",
    "car wash",
    "dentist",
    "b&b",
    "tyre",
    "welding",
    "catering",
    "hair",
    "so",
    "furniture manufacturers",
  ];
  withTags(() => {
    rows("warm up");
    const start = performance.now();
    for (const query of queries) rows(query);
    const average = (performance.now() - start) / queries.length;
    console.log(
      `search: ${queries.length} queries, ${average.toFixed(2)} ms average per keystroke`,
    );
    // Target is under 10 ms; the gate is loose so a busy CI box does not flake.
    assert.ok(average < 40, `average ${average.toFixed(2)} ms`);
  });
});

test("the built file keeps every type, has no dashes and drops label duplicates", () => {
  const taxonomy = JSON.parse(fs.readFileSync(taxonomyPath, "utf8"));
  assert.equal(Object.keys(tagData).length, taxonomy.types.length);
  const raw = fs.readFileSync(new URL("vertical-tags.json", dataDir), "utf8");
  assert.ok(!raw.includes("—") && !raw.includes("–"));
  for (const type of taxonomy.types) {
    const entry = tagData[type.id];
    const own = new Set([
      type.label.toLowerCase(),
      ...(type.aliases ?? []).map((alias) => alias.toLowerCase()),
    ]);
    const seen = new Set();
    for (const [tag] of entry.tags) {
      assert.equal(tag, tag.trim().toLowerCase(), type.id);
      assert.ok(!own.has(tag), `${type.id} keeps own name ${tag}`);
      assert.ok(!seen.has(tag), `${type.id} repeats ${tag}`);
      seen.add(tag);
    }
  }
});

function runBuild(verticals, taxonomy, out) {
  return spawnSync(
    "python3",
    ["-I", buildScript.pathname, verticals, taxonomy, out],
    { encoding: "utf8" },
  );
}

function fixture(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vertical-tags-"));
  const verticals = path.join(dir, "verticals");
  fs.mkdirSync(verticals);
  const taxonomy = path.join(dir, "taxonomy.json");
  fs.writeFileSync(
    taxonomy,
    JSON.stringify({
      types: [
        { id: "a-type", label: "A Type", aliases: ["Alias One"] },
        { id: "b-type", label: "B Type" },
      ],
    }),
  );
  for (const [name, body] of Object.entries(files))
    fs.writeFileSync(
      path.join(verticals, `${name}.json`),
      JSON.stringify(body),
    );
  return { dir, verticals, taxonomy, out: path.join(dir, "out.json") };
}

const goodA = {
  tags: [
    { tag: "  Sofa ", kind: "product" },
    { tag: "sofa", kind: "service" },
    { tag: "A TYPE", kind: "term" },
    { tag: "alias one", kind: "term" },
  ],
  search_terms: ["Couch", "couch"],
  south_africa_terms: ["Braai"],
  possible_duplicates: ["ignored"],
};

test("build script: lowercases, trims, drops duplicates and own names", () => {
  const f = fixture({ "a-type": goodA, "b-type": { tags: [] } });
  const run = runBuild(f.verticals, f.taxonomy, f.out);
  assert.equal(run.status, 0, run.stderr);
  const built = JSON.parse(fs.readFileSync(f.out, "utf8"));
  assert.deepEqual(built["a-type"], {
    tags: [["sofa", "product"]],
    search: ["couch"],
    sa: ["braai"],
  });
});

test("build script: a missing file fails", () => {
  const f = fixture({ "a-type": goodA });
  const run = runBuild(f.verticals, f.taxonomy, f.out);
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /no file.*b-type/);
  assert.ok(!fs.existsSync(f.out));
});

test("build script: an unknown id fails", () => {
  const f = fixture({ "a-type": goodA, "b-type": goodA, "c-type": goodA });
  const run = runBuild(f.verticals, f.taxonomy, f.out);
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /unknown id.*c-type/);
});

test("build script: a dash character fails", () => {
  const f = fixture({
    "a-type": { tags: [{ tag: "sofa — bed", kind: "product" }] },
    "b-type": { tags: [] },
  });
  const run = runBuild(f.verticals, f.taxonomy, f.out);
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /dash/);
});

test("build script reproduces the committed file when the source folder is given", (t) => {
  const source = process.env.VERTICAL_TAGS_SOURCE;
  if (!source)
    return t.skip("set VERTICAL_TAGS_SOURCE to the verticals folder");
  const out = path.join(os.tmpdir(), `vertical-tags-${process.pid}.json`);
  execFileSync("python3", [
    "-I",
    buildScript.pathname,
    source,
    taxonomyPath.pathname,
    out,
  ]);
  assert.equal(
    fs.readFileSync(out, "utf8"),
    fs.readFileSync(new URL("vertical-tags.json", dataDir), "utf8"),
  );
});
