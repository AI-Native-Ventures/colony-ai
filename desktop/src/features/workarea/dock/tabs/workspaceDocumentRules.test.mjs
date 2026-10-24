import assert from "node:assert/strict";
import { test } from "node:test";

import { chipTone, remarkCallouts } from "./workspaceDocumentRules.ts";

const text = (value) => ({ type: "text", value });
const heading = (depth, value) => ({
  type: "heading",
  depth,
  children: [text(value)],
});
const paragraph = (value) => ({ type: "paragraph", children: [text(value)] });

test("an Open questions section becomes a callout up to the next heading of its level", () => {
  const tree = {
    type: "root",
    children: [
      heading(1, "Plan"),
      paragraph("Intro"),
      heading(2, "Open questions"),
      paragraph("One"),
      heading(3, "Detail"),
      paragraph("Two"),
      heading(2, "Next steps"),
      paragraph("Three"),
    ],
  };
  remarkCallouts()(tree);
  assert.deepEqual(
    tree.children.map((node) => node.type),
    ["heading", "paragraph", "colonyCallout", "heading", "paragraph"],
  );
  const callout = tree.children[2];
  assert.equal(callout.data.hName, "aside");
  assert.deepEqual(
    callout.children.map((node) => node.type),
    ["heading", "paragraph", "heading", "paragraph"],
  );
});

test("other headings are left alone, and the match ignores case and a colon", () => {
  const plain = {
    type: "root",
    children: [heading(2, "Questions"), paragraph("x")],
  };
  remarkCallouts()(plain);
  assert.deepEqual(
    plain.children.map((node) => node.type),
    ["heading", "paragraph"],
  );
  const loud = {
    type: "root",
    children: [heading(2, "OPEN QUESTIONS:"), paragraph("x")],
  };
  remarkCallouts()(loud);
  assert.equal(loud.children[0].type, "colonyCallout");
});

test("chip colour comes from the word", () => {
  assert.equal(chipTone("Lead"), "ok");
  assert.equal(chipTone(" approved "), "ok");
  assert.equal(chipTone("Draft"), "need");
  assert.equal(chipTone("Needs review"), "need");
  assert.equal(chipTone("Blocked"), "bad");
  assert.equal(chipTone("Seasonal"), "neutral");
});
