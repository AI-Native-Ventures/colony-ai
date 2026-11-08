import assert from "node:assert/strict";
import test from "node:test";

import {
  customerPriceFromProviderCost,
  formatCustomerPrice,
  providerCostFromCustomerPrice,
} from "./discoveryCustomerPricing.ts";

test("Discovery presents provider costs at the ten-times customer price", () => {
  assert.equal(customerPriceFromProviderCost(0.003), 0.03);
  assert.equal(customerPriceFromProviderCost(0.06), 0.6);
  assert.equal(customerPriceFromProviderCost(0.3), 3);
  assert.equal(formatCustomerPrice(0.3), "US$3.00");
});

test("Discovery converts customer approval amounts back to provider storage", () => {
  assert.equal(providerCostFromCustomerPrice(0.03), 0.003);
  assert.equal(providerCostFromCustomerPrice(0.6), 0.06);
  assert.equal(providerCostFromCustomerPrice(3), 0.3);
});

test("Discovery price conversion round-trips the continuation approval", () => {
  const providerAdditionalBudget = 0.06;
  const customerApproval = customerPriceFromProviderCost(
    providerAdditionalBudget,
  );

  assert.equal(customerApproval, 0.6);
  assert.equal(
    providerCostFromCustomerPrice(customerApproval),
    providerAdditionalBudget,
  );
});
