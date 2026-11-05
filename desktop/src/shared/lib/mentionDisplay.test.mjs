import assert from "node:assert/strict";
import test from "node:test";
import {
  formatLegacyMentionDisplayLabel,
  formatMentionDisplayLabel,
} from "./mentionDisplay.ts";

const KEY = `150b20bd${"a".repeat(52)}15dc`;

test("mention display replaces legacy key labels with a neutral owner suffix", () => {
  for (const suffix of ["", " 2", " 10"]) {
    assert.equal(
      formatMentionDisplayLabel(`Bad Janet (${KEY})${suffix}`, KEY),
      `Bad Janet (teammate)${suffix}`,
    );
  }
  assert.equal(formatMentionDisplayLabel(KEY, KEY), "AI employee");
  assert.equal(
    formatMentionDisplayLabel(KEY.toUpperCase(), KEY),
    "AI employee",
  );
});

test("display redacts bound and unbound legacy identity labels", () => {
  for (const [label, key] of [
    [`Bad Janet (${KEY})`, undefined],
    [`Bad Janet (${KEY})`, "b".repeat(64)],
    [`Bad Janet (${KEY})`, "bad-key"],
  ]) {
    assert.equal(formatMentionDisplayLabel(label, key), "Bad Janet (teammate)");
  }
});

test("display redacts raw identities even inside malformed legacy labels", () => {
  assert.equal(
    formatMentionDisplayLabel(`Bad Janet (${KEY}) 1`, KEY),
    "Bad Janet (AI employee) 1",
  );
  assert.equal(
    formatMentionDisplayLabel(`Bad Janet (${KEY}) notes`, KEY),
    "Bad Janet (AI employee) notes",
  );
  assert.equal(
    formatMentionDisplayLabel(`Release ${KEY}`, KEY),
    "Release AI employee",
  );
  assert.equal(formatMentionDisplayLabel("Bad Janet", KEY), "Bad Janet");
});

test("legacy clipboard display uses the same safe rendering rule", () => {
  for (const suffix of ["", " 2", " 10"]) {
    assert.equal(
      formatLegacyMentionDisplayLabel(`Bad Janet (${KEY})${suffix}`, KEY),
      `Bad Janet (teammate)${suffix}`,
    );
  }
  assert.equal(formatLegacyMentionDisplayLabel(KEY, KEY), "AI employee");
});

test("legacy keys do not survive as distinguishable visible mention labels", () => {
  const other = KEY.replace("aaaa", "bbbb");
  assert.notEqual(KEY, other);
  assert.equal(
    formatMentionDisplayLabel(`Scout (${KEY})`, KEY),
    formatMentionDisplayLabel(`Scout (${other})`, other),
  );
  assert.equal(
    formatMentionDisplayLabel(`Scout (${KEY})`, other),
    "Scout (teammate)",
  );
});
