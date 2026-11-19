import assert from "node:assert/strict";
import test from "node:test";

import {
  companyMapJobDoer,
  companyMapJobIsScoutLed,
  companyMapScoutCoverageSentence,
} from "./companyMapAssignments.ts";

test("the production job-doer rule gives every unassigned job to Scout", () => {
  assert.deepEqual(
    companyMapJobDoer(
      { functionId: "sales", state: "filled", leadPubkey: "head-pubkey" },
      "specialist-pubkey",
    ),
    { kind: "specialist", pubkey: "specialist-pubkey" },
  );
  assert.deepEqual(
    companyMapJobDoer({
      functionId: "sales",
      state: "filled",
      leadPubkey: "head-pubkey",
    }),
    { kind: "head", pubkey: "head-pubkey" },
  );
  assert.deepEqual(
    companyMapJobDoer({
      functionId: "finance",
      state: "empty",
      leadPubkey: null,
    }),
    { kind: "scout" },
  );
});

test("Scout job ownership follows the one shared map rule", () => {
  assert.equal(
    companyMapJobIsScoutLed("operations", "Delivery", "covered_by_scout"),
    true,
  );
  assert.equal(companyMapJobIsScoutLed("sales", "Outreach", "filled"), false);
  assert.equal(companyMapJobIsScoutLed("finance", "Invoices", "empty"), true);
  assert.equal(companyMapJobIsScoutLed("finance", "Deposits", "filled"), false);
  assert.equal(
    companyMapJobIsScoutLed("finance", "Recurring plans", "empty"),
    true,
  );
  assert.equal(
    companyMapJobIsScoutLed("customer_success", "Client chats", "empty"),
    true,
  );
  assert.equal(
    companyMapJobIsScoutLed("customer_success", "Client chats", "filled"),
    false,
  );
  assert.equal(companyMapJobIsScoutLed("brand", "Website", "empty"), true);
  assert.equal(companyMapJobIsScoutLed("brand", "Website", "filled"), false);
});

test("empty part cards say which jobs Scout covers", () => {
  assert.equal(
    companyMapScoutCoverageSentence("finance", "empty"),
    "Scout does its jobs for now.",
  );
  assert.equal(
    companyMapScoutCoverageSentence("customer_success", "empty"),
    "Scout does its jobs for now.",
  );
  assert.equal(
    companyMapScoutCoverageSentence("sales", "empty"),
    "Scout does its jobs for now.",
  );
  assert.equal(
    companyMapScoutCoverageSentence("sales", "filled"),
    "Sales lead does its jobs.",
  );
});
