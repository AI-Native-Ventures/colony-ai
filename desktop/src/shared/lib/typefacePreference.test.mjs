import assert from "node:assert/strict";
import test from "node:test";

import { parseTypeface } from "./typefacePreference.ts";

test("only Inter and the system face replace the default typeface", () => {
  assert.equal(parseTypeface("inter"), "inter");
  assert.equal(parseTypeface("system"), "system");
  assert.equal(parseTypeface("manrope"), "manrope");
  assert.equal(parseTypeface("comic-sans"), "manrope");
  assert.equal(parseTypeface(null), "manrope");
  assert.equal(parseTypeface(undefined), "manrope");
});
