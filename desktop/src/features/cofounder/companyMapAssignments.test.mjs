import assert from "node:assert/strict";
import test from "node:test";

import {
  companyMapJobIsScoutLed,
  companyMapScoutCoverageSentence,
} from "./companyMapAssignments.ts";

test("Scout job ownership follows the approved map and open slots", () => {
  assert.equal(
    companyMapJobIsScoutLed("operations", "Delivery", "covered_by_scout"),
    true,
  );
  assert.equal(companyMapJobIsScoutLed("sales", "Outreach", "filled"), false);
  assert.equal(companyMapJobIsScoutLed("finance", "Quotes", "empty"), true);
  assert.equal(companyMapJobIsScoutLed("finance", "Deposits", "filled"), true);
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
    "Scout does Quotes, Deposits and Recurring plans.",
  );
  assert.equal(
    companyMapScoutCoverageSentence("customer_success", "empty"),
    "Scout does its jobs for now.",
  );
  assert.equal(
    companyMapScoutCoverageSentence("sales", "empty"),
    "Scout suggests hiring a Business development.",
  );
});
