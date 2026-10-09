import { expect, test, type Page } from "@playwright/test";
import { installMockBridge } from "../helpers/bridge";

type Intent = {
  reference: string;
  idempotencyKey: string;
  packId: string;
  status: string;
  grantNanousd: string;
  createdAt: string;
};
async function setup(
  page: Page,
  options: {
    restored?: boolean;
    openerError?: string;
    disabled?: boolean;
  } = {},
) {
  let intent: Intent | undefined = options.restored
    ? {
        reference: "credit-restored",
        idempotencyKey: "fef3ef58-e0ca-40b0-9051-27bbce443635",
        packId: "usd-5",
        status: "pending",
        grantNanousd: "5000000000",
        createdAt: new Date().toISOString(),
      }
    : undefined;
  let balance = 0;
  const calls: Array<Record<string, unknown>> = [];
  await page.clock.install();
  await installMockBridge(page, {
    referenceWorkspace: true,
    accountLinked: true,
    openerError: options.openerError,
  });
  await page.route("**/api/payments/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path !== "/api/payments/packs")
      expect(request.headers().authorization).toMatch(/^Nostr /);
    if (path.endsWith("/packs"))
      return route.fulfill({
        json: {
          provider: "stripe",
          enabled: !options.disabled,
          packs: [500, 1500, 5000, 12000].map((cents) => ({
            id: `usd-${cents / 100}`,
            name: "Credits",
            chargeCurrency: "USD",
            chargeMinorUnits: cents,
            grantUsdCents: cents,
          })),
        },
      });
    if (path.endsWith("/balance"))
      return route.fulfill({ json: { balanceUsdCents: balance } });
    if (path.endsWith("/history"))
      return route.fulfill({
        json: { paymentIntents: intent ? [intent] : [] },
      });
    if (path.endsWith("/checkout")) {
      const body = request.postDataJSON();
      calls.push(body);
      expect(Object.keys(body).sort()).toEqual(["idempotencyKey", "packId"]);
      intent ??= {
        reference: "credit-test",
        idempotencyKey: body.idempotencyKey,
        packId: body.packId,
        status: "pending",
        grantNanousd: "5000000000",
        createdAt: new Date().toISOString(),
      };
      return route.fulfill({
        json: {
          reference: intent.reference,
          idempotencyKey: intent.idempotencyKey,
          status: intent.status,
          authorizationMethod: "GET",
          authorizationUrl: "https://checkout.stripe.com/c/pay/fake-session",
          authorizationFields: [],
        },
      });
    }
    throw new Error(`Unexpected payments path: ${path}`);
  });
  await page.goto("/#/power?section=checkout");
  await expect(page.getByTestId("power-checkout")).toBeVisible();
  return {
    calls,
    settle(status: "paid" | "failed" | "cancelled") {
      if (!intent) throw new Error("no intent");
      intent.status = status;
      if (status === "paid") balance = 500;
    },
  };
}

test("USD packs open system-browser checkout and wait for the server grant", async ({
  page,
}) => {
  const state = await setup(page);
  const checkout = page.getByTestId("power-checkout");
  for (const amount of ["5.00", "15.00", "50.00", "120.00"])
    await expect(
      checkout.getByRole("radio", {
        name: `$${amount} USD $${amount} credits`,
      }),
    ).toBeVisible();
  await checkout
    .getByRole("radio", { name: "$5.00 USD $5.00 credits", exact: true })
    .check();
  await checkout.getByRole("button", { name: "Continue to checkout" }).click();
  await expect(checkout).toContainText("Waiting for payment confirmation");
  await expect(checkout).toContainText("Available balance: $0.00 USD");
  const urls = await page.evaluate(async () => {
    const tauri = window as Window & {
      __TAURI_INTERNALS__: { invoke(command: string): Promise<string[]> };
    };
    return tauri.__TAURI_INTERNALS__.invoke("get_e2e_opened_external_urls");
  });
  expect(urls).toEqual(["https://checkout.stripe.com/c/pay/fake-session"]);
  expect(state.calls[0].packId).toBe("usd-5");
  state.settle("paid");
  await page.clock.fastForward(5000);
  await expect(checkout).toContainText(
    "Payment confirmed. Your credits are available.",
  );
  await expect(checkout).toContainText("Available balance: $5.00 USD");
});

test("restored pending payment keeps the original checkout and can be checked", async ({
  page,
}) => {
  const state = await setup(page, { restored: true });
  const checkout = page.getByTestId("power-checkout");
  await expect(checkout).toContainText("credit-restored");
  await expect(checkout.getByRole("radio").first()).toBeDisabled();
  await checkout.getByRole("button", { name: "Reopen checkout" }).click();
  expect(state.calls[0].idempotencyKey).toBe(
    "fef3ef58-e0ca-40b0-9051-27bbce443635",
  );
  state.settle("paid");
  await checkout.getByRole("button", { name: "Check payment" }).click();
  await expect(checkout).toContainText("Payment confirmed");
});

test("failed payment and browser opening error retain honest recovery controls", async ({
  page,
}) => {
  const state = await setup(page, { openerError: "Browser could not open" });
  const checkout = page.getByTestId("power-checkout");
  await checkout.getByRole("radio").first().check();
  await checkout.getByRole("button", { name: "Continue to checkout" }).click();
  await expect(checkout.getByRole("alert")).toContainText(
    "Browser could not open",
  );
  await expect(
    checkout.getByRole("button", { name: "Reopen checkout" }),
  ).toBeEnabled();
  state.settle("failed");
  await checkout.getByRole("button", { name: "Check payment" }).click();
  await expect(checkout).toContainText("Payment failed. No credits were added");
  await expect(checkout).toContainText("Available balance: $0.00 USD");
  await checkout.getByRole("button", { name: "Try again" }).click();
  await expect(
    checkout.getByRole("button", { name: "Continue to checkout" }),
  ).toBeEnabled();
});

test("disabled provider cannot start checkout", async ({ page }) => {
  const state = await setup(page, { disabled: true });
  await expect(page.getByTestId("power-checkout")).toContainText(
    "Credit checkout is unavailable",
  );
  await expect(
    page.getByRole("button", { name: "Continue to checkout" }),
  ).toHaveCount(0);
  expect(state.calls).toHaveLength(0);
});
