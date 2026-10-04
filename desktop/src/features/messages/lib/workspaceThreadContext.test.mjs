import assert from "node:assert/strict";
import test from "node:test";
import { parseWorkspaceThreadContext } from "./workspaceThreadContext.ts";

test("plain reference thread context keeps its title and prose", () => {
  assert.deepEqual(
    parseWorkspaceThreadContext("# October launch\n\nVersion 3 reads better."),
    { title: "October launch", description: "Version 3 reads better." },
  );
  assert.equal(parseWorkspaceThreadContext("No heading"), null);
});
test("rich thread heads use the production Markdown row instead of a flattened paragraph", () => {
  for (const body of [
    "Read `DAY1_VIDEO_PACK.md`",
    "- One\n- Two",
    "1. One\n2. Two",
    "[File](https://example.com/file)",
    "**Strong**",
    "## Section\nParagraph",
    "```js\nconst done = true;\n```",
    "<strong>Text</strong>",
  ]) {
    assert.equal(
      parseWorkspaceThreadContext(`# Scout deliverables\n\n${body}`),
      null,
      body,
    );
  }
  assert.equal(
    parseWorkspaceThreadContext("# `DAY1_VIDEO_PACK.md`\nDescription"),
    null,
  );
});
