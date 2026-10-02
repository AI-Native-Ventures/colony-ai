import assert from "node:assert/strict";
import test from "node:test";

import { buildProductFeedbackEvent } from "./useSendFeedback.ts";

test("buildProductFeedbackEvent uses body and category tag", () => {
  assert.deepEqual(
    buildProductFeedbackEvent({ category: "bug", message: "  It broke  " }, []),
    { content: "It broke", tags: [["category", "bug"]] },
  );
});

test("buildProductFeedbackEvent keeps category and imeta tags", () => {
  const attachment = {
    url: "https://example.test/screenshot.png",
    sha256: "ab".repeat(32),
    size: 42,
    type: "image/png",
    uploaded: 42,
  };
  const result = buildProductFeedbackEvent(
    { category: "suggestion", message: "Useful feedback" },
    [attachment],
  );
  assert.match(result.content, /Useful feedback/);
  assert.deepEqual(
    result.tags.find((tag) => tag[0] === "category"),
    ["category", "suggestion"],
  );
  assert.equal(
    result.tags.some((tag) => tag[0] === "imeta"),
    true,
  );
});
