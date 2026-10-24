import assert from "node:assert/strict";
import test from "node:test";

import {
  JOB_TITLE_MAX_LENGTH,
  normalizeJobTitle,
  OWNER_JOB_TITLE,
  resolveJobTitle,
} from "./jobTitle.ts";

test("the published profile job title wins over the position title", () => {
  assert.equal(
    resolveJobTitle({
      profile: { jobTitle: "Designer" },
      positionTitle: "Account Manager",
    }),
    "Designer",
  );
});

test("an employee falls back to the company position title", () => {
  assert.equal(
    resolveJobTitle({
      profile: { jobTitle: null },
      positionTitle: "Bookkeeper",
    }),
    "Bookkeeper",
  );
});

test("the owner falls back to Founder, everyone else to nothing", () => {
  assert.equal(resolveJobTitle({ isOwner: true }), OWNER_JOB_TITLE);
  assert.equal(resolveJobTitle({ profile: { jobTitle: "  " } }), "");
  assert.equal(resolveJobTitle({}), "");
});

test("blank and oversized titles are normalised", () => {
  assert.equal(normalizeJobTitle("   "), "");
  assert.equal(normalizeJobTitle(null), "");
  assert.equal(normalizeJobTitle("  Client Partner "), "Client Partner");
  assert.equal(
    normalizeJobTitle("x".repeat(JOB_TITLE_MAX_LENGTH + 20)).length,
    JOB_TITLE_MAX_LENGTH,
  );
});
