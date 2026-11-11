import assert from "node:assert/strict";
import test from "node:test";

import {
  eligibleStartDeliveryPlaybooks,
  hasRunningJobForClient,
  startDeliveryOwnerStepNumbers,
} from "./startDelivery.ts";

function playbook({
  id,
  status = "active",
  version = 1,
  functionId = "operations",
  steps = [],
}) {
  return {
    playbookId: id,
    status,
    version,
    current: { title: id, summary: "", functionId, steps },
  };
}

function step(ownerKind, approvalPoint = null) {
  return { owner: { kind: ownerKind }, approvalPoint };
}

test("eligible delivery playbooks are active, approved, and prefer Operations", () => {
  const operations = playbook({ id: "operations" });
  const sales = playbook({ id: "sales", functionId: "sales" });
  const proposed = playbook({ id: "proposed", status: "proposed" });
  const unapproved = playbook({
    id: "unapproved",
    version: 0,
    functionId: null,
  });
  const noCurrentVersion = playbook({ id: "no-current", functionId: null });
  noCurrentVersion.current = null;

  assert.deepEqual(
    eligibleStartDeliveryPlaybooks([
      sales,
      proposed,
      unapproved,
      operations,
      noCurrentVersion,
    ]).map((item) => item.playbookId),
    ["operations"],
  );
});

test("when no eligible playbook is marked Operations, all eligible playbooks remain", () => {
  const sales = playbook({ id: "sales", functionId: "sales" });
  const unassigned = playbook({ id: "unassigned", functionId: null });
  const proposed = playbook({
    id: "proposed-operations",
    status: "proposed",
  });

  assert.deepEqual(
    eligibleStartDeliveryPlaybooks([sales, unassigned, proposed]).map(
      (item) => item.playbookId,
    ),
    ["sales", "unassigned"],
  );
});

test("owner steps and approval points are listed once in playbook order", () => {
  const approvalPoint = { kind: "taste", prompt: "Pick one" };
  const delivery = playbook({
    id: "delivery",
    steps: [
      step("lead_agent"),
      step("owner"),
      step("worker"),
      step("owner", approvalPoint),
      step("function"),
      step("worker"),
      step("lead_agent", approvalPoint),
    ],
  });

  assert.deepEqual(startDeliveryOwnerStepNumbers(delivery), [2, 4, 7]);
  assert.deepEqual(
    startDeliveryOwnerStepNumbers(playbook({ id: "no-owner-steps" })),
    [],
  );
});

test("duplicate guard trims and compares names without case sensitivity", () => {
  const jobs = [
    { title: "  melville manor guesthouse ", status: "running" },
    { title: "Finished client", status: "completed" },
  ];

  assert.equal(hasRunningJobForClient(jobs, "Melville Manor Guesthouse"), true);
  assert.equal(hasRunningJobForClient(jobs, "Finished client"), false);
  assert.equal(hasRunningJobForClient(jobs, "  "), false);
  assert.equal(
    hasRunningJobForClient(
      [{ title: "Melville  Manor Guesthouse", status: "running" }],
      "Melville Manor Guesthouse",
    ),
    false,
  );
});
