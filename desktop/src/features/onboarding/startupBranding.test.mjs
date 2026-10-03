import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
test("startup and switch gates cannot import retired bee loaders", () => {
  const app = readFileSync(
    new URL("../../app/App.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(app, /import[^;]*(?:BuzzMark|FlappingBee|FuzzyLogo)/s);
  assert.match(app, /<ScoutLoader/);
});
