import assert from "node:assert/strict";
import test from "node:test";

import { hasRequiredLinuxSandboxIsolation } from "./electron-stage0-sandbox.mjs";

const completeNamespaceIsolation = ["pid", "net", "user"];

test("accepts the complete renderer namespace/root isolation tuple", () => {
  assert.equal(
    hasRequiredLinuxSandboxIsolation(completeNamespaceIsolation, true),
    true,
  );
});

for (const [missing, namespaces] of [
  ["pid", ["net", "user"]],
  ["net", ["pid", "user"]],
  ["user", ["pid", "net"]],
]) {
  test(`rejects renderer isolation missing ${missing}`, () => {
    assert.equal(hasRequiredLinuxSandboxIsolation(namespaces, true), false);
  });
}

test("rejects a distinct namespace tuple without a distinct root", () => {
  assert.equal(
    hasRequiredLinuxSandboxIsolation(completeNamespaceIsolation, false),
    false,
  );
});
