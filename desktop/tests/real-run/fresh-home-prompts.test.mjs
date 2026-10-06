import assert from "node:assert/strict";
import test from "node:test";
import { scanText } from "./brand-scan.mjs";
import { PROMPTS, selectPrompts } from "./fresh-home-prompts.mjs";

test("there are seven distinct prompts", () => {
  assert.equal(PROMPTS.length, 7);
  assert.equal(new Set(PROMPTS.map((p) => p.id)).size, 7);
  assert.equal(new Set(PROMPTS.map((p) => p.text)).size, 7);
  for (const p of PROMPTS) {
    assert.ok(p.text.startsWith(" "), `prompt ${p.id} follows the mention`);
    assert.ok(p.text.trim().length > 40, `prompt ${p.id} is a real request`);
    assert.ok(p.maxSeconds >= 60 && p.maxSeconds <= 180, `prompt ${p.id} cap`);
  }
});

test("no prompt can read as a leak: the scanner finds nothing failing in what we type", () => {
  for (const p of PROMPTS)
    assert.deepEqual(
      scanText(p.text, "chat").filter((f) => f.severity === "fail"),
      [],
      `prompt ${p.id}`,
    );
});

test("the set exercises tools, files and commands", () => {
  const all = PROMPTS.map((p) => p.text.toLowerCase()).join("\n");
  for (const word of [
    "channels",
    "post",
    "file",
    "search",
    "team",
    "commands",
    "folder",
  ])
    assert.ok(all.includes(word), word);
  assert.ok(
    PROMPTS.some((p) => p.expandTools),
    "one prompt expands tool groups",
  );
  assert.ok(
    PROMPTS.some((p) => p.openDetails),
    "one prompt opens Show details",
  );
  assert.ok(
    PROMPTS.some((p) => p.openPanel),
    "one prompt opens the session panel",
  );
});

test("selectPrompts honours an explicit list and defaults to all", () => {
  assert.equal(selectPrompts(undefined).length, 7);
  assert.deepEqual(
    selectPrompts("2, 4").map((p) => p.id),
    [2, 4],
  );
  assert.deepEqual(selectPrompts("99"), []);
});
