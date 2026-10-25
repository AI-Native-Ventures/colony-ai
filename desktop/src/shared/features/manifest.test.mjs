import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const manifest = JSON.parse(
  readFileSync(
    new URL("../../../../preview-features.json", import.meta.url),
    "utf8",
  ),
);

test("cut experiments are not offered in the preview features manifest", () => {
  const ids = manifest.features.map(({ id }) => id);

  for (const cut of ["projects", "workflows", "pulse", "forum"]) {
    assert.ok(!ids.includes(cut), `${cut} must not be a preview feature`);
  }
});
