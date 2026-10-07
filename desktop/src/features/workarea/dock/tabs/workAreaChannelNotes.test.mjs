import assert from "node:assert/strict";
import { test } from "node:test";

import { canvasPreview, channelNotes } from "./workAreaChannelNotes.ts";

test("topic, purpose and canvas each become a note, in that order", () => {
  assert.deepEqual(
    channelNotes({
      topic: "Q1 targets",
      purpose: "Keep sales on one page",
      canvasContent: "# Launch plan\n\nBody",
    }),
    [
      { kind: "topic", text: "Q1 targets" },
      { kind: "purpose", text: "Keep sales on one page" },
      { kind: "canvas", preview: "Launch plan" },
    ],
  );
});

test("nothing stored means no notes, never a placeholder", () => {
  for (const input of [
    { topic: null, purpose: null, canvasContent: null },
    { topic: "  ", purpose: "", canvasContent: "" },
    { topic: undefined, purpose: undefined, canvasContent: "\n \n" },
  ]) {
    assert.deepEqual(channelNotes(input), []);
  }
});

test("only what is set is listed", () => {
  assert.deepEqual(
    channelNotes({ topic: "  Hello  ", purpose: null, canvasContent: null }),
    [{ kind: "topic", text: "Hello" }],
  );
  assert.deepEqual(
    channelNotes({ topic: null, purpose: null, canvasContent: "Just text" }),
    [{ kind: "canvas", preview: "Just text" }],
  );
});

test("the canvas preview skips blank lines and Markdown marks", () => {
  const cases = [
    ["\n\n## Heading one\nmore", "Heading one"],
    ["- first item\n- second", "first item"],
    ["> quoted line", "quoted line"],
    ["1. numbered", "numbered"],
    ["**Bold** start", "Bold start"],
    ["", ""],
  ];
  for (const [content, expected] of cases) {
    assert.equal(canvasPreview(content), expected, JSON.stringify(content));
  }
});

test("a long first line is bounded with an ellipsis", () => {
  const preview = canvasPreview("w".repeat(500));
  assert.equal(preview.length, 140);
  assert.ok(preview.endsWith("…"));
});
