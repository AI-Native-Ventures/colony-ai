import assert from "node:assert/strict";
import test from "node:test";

import { materializePersonaAndReadHireHead } from "./prebuiltHireParallel.ts";

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

test("persona preparation and the first hire-head read begin together", async () => {
  const persona = deferred();
  const head = deferred();
  let personaStarted = false;
  let headStarted = false;

  const result = materializePersonaAndReadHireHead({
    materializePersona: () => {
      personaStarted = true;
      return persona.promise;
    },
    readHireHead: () => {
      headStarted = true;
      return head.promise;
    },
  });

  assert.equal(personaStarted, true);
  assert.equal(headStarted, true);
  persona.resolve("persona-1");
  head.resolve({ status: "missing" });
  assert.deepEqual(await result, ["persona-1", { status: "missing" }]);
});
