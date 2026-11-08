/**
 * Discovery stores provider costs so historic campaigns retain their original
 * accounting. Customer-facing amounts are ten times those stored values.
 * This module is display and form-boundary only: it does not bill a customer.
 */
export const DISCOVERY_CUSTOMER_PRICE_MULTIPLIER = 10;

function nonNegativeFinite(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

/** Converts one provider-cost amount into the customer price in US dollars. */
export function customerPriceFromProviderCost(providerCostUsd: number): number {
  return (
    Math.round(
      nonNegativeFinite(providerCostUsd) *
        DISCOVERY_CUSTOMER_PRICE_MULTIPLIER *
        100,
    ) / 100
  );
}

/** Converts a customer-entered amount back to the provider-cost storage unit. */
export function providerCostFromCustomerPrice(
  customerPriceUsd: number,
): number {
  return (
    Math.round(
      (nonNegativeFinite(customerPriceUsd) /
        DISCOVERY_CUSTOMER_PRICE_MULTIPLIER) *
        10_000,
    ) / 10_000
  );
}

/** Formats a stored provider-cost amount for a customer-facing Discovery UI. */
export function formatCustomerPrice(providerCostUsd: number): string {
  return `US$${customerPriceFromProviderCost(providerCostUsd).toFixed(2)}`;
}
