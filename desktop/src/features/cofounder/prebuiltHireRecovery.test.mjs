import assert from "node:assert/strict";
import test from "node:test";

import { findRecoverablePrebuiltHire } from "./prebuiltHireRecovery.ts";

const oldHireId = "11111111-1111-4111-8111-111111111111";
const activeHireId = "22222222-2222-4222-8222-222222222222";

function head(hireId, status) {
  return {
    dTag: `company:hire:${hireId}`,
    event: { id: `${hireId}-event` },
    head: {
      proposal: { hireId, title: "Head of Sales" },
      status,
    },
  };
}

test("terminal slot-intent audit records cannot hide a newer recoverable head", async () => {
  const calls = [];
  const recovered = await findRecoverablePrebuiltHire(
    [
      { hireId: oldHireId, functionId: "sales", eventId: "old" },
      { hireId: activeHireId, functionId: "sales", eventId: "active" },
    ],
    "sales",
    async (hireId) => {
      calls.push(hireId);
      return hireId === oldHireId
        ? head(oldHireId, "denied")
        : head(activeHireId, "approved");
    },
  );

  assert.deepEqual(calls, [oldHireId, activeHireId]);
  assert.equal(recovered?.head.head.proposal.hireId, activeHireId);
});
