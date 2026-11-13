import assert from "node:assert/strict";
import test from "node:test";

import { companyMapJobConnectorState } from "./companyMapConnectorState.ts";

test("jobs without dedicated screens keep the wire of their runner", () => {
  const cases = [
    ["sales", "Calls", "filled", "on"],
    ["sales", "Calls", "empty", "off"],
    ["finance", "Recurring plans", "empty", "on"],
    ["customer_success", "Renewals", "empty", "on"],
    ["customer_success", "Upsell", "empty", "on"],
    ["customer_success", "Reviews", "empty", "on"],
    ["brand", "Website", "empty", "on"],
    ["brand", "Portfolio", "empty", "on"],
    ["brand", "Marketing", "empty", "on"],
  ];

  for (const [functionId, jobName, slotState, expected] of cases) {
    const state = companyMapJobConnectorState(
      functionId,
      jobName,
      slotState,
      false,
      false,
    );
    assert.equal(state, expected, `${functionId}:${jobName}`);
    assert.notEqual(state, "seat", `${functionId}:${jobName} is not a seat`);
  }
});

test("a current job becomes live only when its part is live and it waits", () => {
  assert.equal(
    companyMapJobConnectorState("sales", "Calls", "filled", true, true),
    "live",
  );
  assert.equal(
    companyMapJobConnectorState("sales", "Calls", "filled", true, false),
    "on",
  );
});
