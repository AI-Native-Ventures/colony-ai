import assert from "node:assert/strict";
import test from "node:test";

import { FUNCTION_DETAILS } from "./functions.ts";

test("each company job has one current ownership location", () => {
  assert.equal(FUNCTION_DETAILS.finance.subFunctions.includes("Quotes"), false);
  assert.equal(
    FUNCTION_DETAILS.customer_success.subFunctions.includes("Renewals"),
    false,
  );
  assert.equal(FUNCTION_DETAILS.sales.subFunctions.includes("Quotes"), true);
});
