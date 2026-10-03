import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { assertArtifactContract } from "./build-protected-feature-artifacts.mjs";

test("public Scout role does not admit protected Bestie content", () => {
  const root = mkdtempSync(path.join(tmpdir(), "colony-artifact-test-"));
  const ossOutput = path.join(root, "oss"),
    internalOutput = path.join(root, "internal");
  try {
    mkdirSync(ossOutput);
    mkdirSync(internalOutput);
    writeFileSync(
      path.join(internalOutput, "app.js"),
      "Try a personal agent that is always close at hand",
    );
    const output = path.join(ossOutput, "app.js");
    writeFileSync(output, "Scout: Chief of Staff");
    assert.doesNotThrow(() =>
      assertArtifactContract({ ossOutput, internalOutput }),
    );
    for (const content of ["Bestie", "builtin:bestie"]) {
      writeFileSync(output, content);
      assert.throws(
        () => assertArtifactContract({ ossOutput, internalOutput }),
        /protected Bestie/,
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
