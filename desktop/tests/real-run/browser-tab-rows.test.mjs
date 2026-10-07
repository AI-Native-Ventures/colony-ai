import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  METADATA_ADDRESSES,
  cookieNames,
  downloadsVerdict,
  escapedFiles,
  findByName,
  isInside,
  newNames,
  refusedAddresses,
  stuckCommunity,
} from "./browser-tab-rows.mjs";
// The same policy the packaged app ships: every proof address must be refused
// by it, or the row would pass for the wrong reason.
import { checkedUrl } from "../../electron/browser-host-policy.mjs";

test("every address the proof expects to be refused is refused by the real host policy", () => {
  for (const url of [
    ...refusedAddresses("http://127.0.0.1:4000"),
    ...METADATA_ADDRESSES,
  ])
    assert.throws(() => checkedUrl(url), url);
});

test("the ordinary web and private addresses the proof relies on are not refused", () => {
  for (const url of [
    "http://127.0.0.1:4000/probe",
    "https://example.com/",
    "http://192.168.1.1/",
  ])
    assert.doesNotThrow(() => checkedUrl(url), url);
});

test("isInside is strict: the folder itself, siblings and parents are outside", () => {
  const downloads = "/tmp/h/Downloads";
  assert.equal(isInside(downloads, "/tmp/h/Downloads/a.txt"), true);
  assert.equal(isInside(downloads, "/tmp/h/Downloads/sub/a.txt"), true);
  assert.equal(isInside(downloads, "/tmp/h/Downloads"), false);
  assert.equal(isInside(downloads, "/tmp/h/a.txt"), false);
  assert.equal(isInside(downloads, "/tmp/h/Downloads2/a.txt"), false);
  assert.equal(isInside(downloads, "/tmp/h/Downloads/../a.txt"), false);
});

test("downloads verdict accepts only the proof's own complete files, in the expected number", () => {
  const sizes = {
    "report.txt": 21,
    "report (1).txt": 21,
    "colony-real-run-escape.txt": 9,
  };
  const added = Object.keys(sizes);
  assert.deepEqual(downloadsVerdict({ added, sizes, expectedCount: 3 }), {
    ok: true,
    problems: [],
  });
  const bad = (override, expectedCount = 3) =>
    downloadsVerdict({
      added: override.added ?? added,
      sizes: override.sizes ?? sizes,
      expectedCount,
    });
  assert.match(
    bad({ added: [...added, "stray.txt"] }, 4).problems[0],
    /unexpected files: stray\.txt/u,
  );
  assert.match(
    bad({ added: [...added, "report.txt.crdownload"] }, 4).problems.join(),
    /partial downloads/u,
  );
  assert.match(
    bad({ sizes: { ...sizes, "report.txt": 0 } }).problems[0],
    /empty placeholders left: report\.txt/u,
  );
  assert.match(
    bad({ added: added.slice(0, 2) }).problems[0],
    /expected 3 new files, found 2/u,
  );
});

test("newNames reports only what appeared", () => {
  assert.deepEqual(newNames(["a", "b"], new Set(["a", "b", "d", "c"])), [
    "c",
    "d",
  ]);
  assert.deepEqual(newNames([], new Set()), []);
});

test("findByName is bounded, ignores symlinks, and escapedFiles keeps only files outside the folder", (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "rows-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, "home", "Downloads"), { recursive: true });
  mkdirSync(path.join(root, "elsewhere"), { recursive: true });
  writeFileSync(path.join(root, "home", "Downloads", "x-marker.txt"), "a");
  writeFileSync(path.join(root, "home", "x-marker.txt"), "b");
  writeFileSync(path.join(root, "elsewhere", "y-marker"), "c");
  symlinkSync(path.join(root, "elsewhere"), path.join(root, "home", "link"));
  const { hits, truncated } = findByName(root, "marker");
  assert.equal(truncated, false);
  assert.equal(hits.length, 3);
  const downloads = path.join(root, "home", "Downloads");
  assert.deepEqual(
    escapedFiles(hits, downloads).sort(),
    [
      path.join(root, "elsewhere", "y-marker"),
      path.join(root, "home", "x-marker.txt"),
    ].sort(),
  );
  assert.equal(findByName(root, "marker", { maxEntries: 2 }).truncated, true);
  assert.deepEqual(findByName(path.join(root, "missing"), "marker").hits, []);
});

test("cookie names and the stuck community are plain data", () => {
  assert.deepEqual(cookieNames([{ name: "scope" }, { name: "x" }]), [
    "scope",
    "x",
  ]);
  const community = stuckCommunity("c1");
  assert.equal(community.id, "c1");
  assert.match(community.relayUrl, /^ws:\/\/127\.0\.0\.1:1$/u);
  assert.ok(!("token" in community) && !("nsec" in community));
});
