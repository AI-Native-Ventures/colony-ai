import { expect, test, type Page } from "@playwright/test";
import { installMockBridge } from "../helpers/bridge";
import { r17Runtime } from "../helpers/onboarding";

// Colony credits are the design's "Coming soon" card in onboarding and in
// Settings > Agents. The paid checkout flow has no screen in the lean scope.
type Surface = "settings";
const runtime = {
  ...r17Runtime("buzz-agent", "available", { status: "not_applicable" }),
  provider_env_var: "BUZZ_AGENT_PROVIDER",
  model_env_var: "BUZZ_AGENT_MODEL",
};
const original = {
  env_vars: {},
  provider: null,
  model: "old-model",
  preferred_runtime: "claude",
};
async function setup(
  page: Page,
  surface: Surface,
  options: {
    flag?: boolean;
    gateway?: boolean;
    stripe?: boolean;
    balance?: number;
    offline?: boolean;
    proofError?: string;
    delay?: number;
    saveError?: string;
  } = {},
) {
  let balance = options.balance ?? 1250;
  let offline = options.offline ?? false;
  let gateway = options.gateway ?? true;
  let stripe = options.stripe ?? true;
  let intent: Record<string, unknown> | undefined;
  const checkoutCalls: Record<string, unknown>[] = [];
  let capabilityCalls = 0;
  await page.route("**/api/credits-gateway/capabilities", (route) => {
    capabilityCalls++;
    return route.fulfill({
      status: offline ? 503 : 200,
      json: { enabled: gateway, runtime: "colony", model: "server-model" },
    });
  });
  await page.route("**/api/payments/**", (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (!path.endsWith("/packs"))
      expect(request.headers().authorization).toMatch(/^Nostr /);
    if (path.endsWith("/packs"))
      return route.fulfill({
        json: {
          enabled: stripe,
          provider: "stripe",
          policyUrls: {
            terms: "https://policies.example/terms",
            acceptableUse: "https://policies.example/use",
          },
          packs: [
            {
              id: "usd-5",
              name: "Credits",
              chargeMinorUnits: 500,
              chargeCurrency: "USD",
              grantUsdCents: 500,
            },
          ],
        },
      });
    if (path.endsWith("/balance"))
      return route.fulfill({ json: { balanceUsdCents: balance } });
    if (path.endsWith("/history"))
      return route.fulfill({
        json: { paymentIntents: intent ? [intent] : [] },
      });
    if (path.includes("/intents/")) return route.fulfill({ json: intent });
    if (path.endsWith("/checkout")) {
      const body = request.postDataJSON();
      checkoutCalls.push(body);
      expect(Object.keys(body).sort()).toEqual(["idempotencyKey", "packId"]);
      intent ??= {
        reference: "credits-option-payment",
        idempotencyKey: body.idempotencyKey,
        packId: body.packId,
        status: "pending",
        grantNanousd: "5000000000",
        createdAt: new Date().toISOString(),
      };
      return route.fulfill({
        json: {
          ...intent,
          authorizationMethod: "GET",
          authorizationUrl: "https://checkout.stripe.com/c/pay/option-test",
          authorizationFields: [],
        },
      });
    }
    throw new Error(`Unexpected payment path ${path}`);
  });
  const mock = {
    colonyCreditsGatewayEnabled: options.flag ?? true,
    accountLinked: true,
    globalAgentConfig: original,
    acpRuntimesCatalog: [runtime],
    onboardingConnectionDelayMs: options.delay,
    onboardingConnectionResult: options.proofError
      ? { error: options.proofError }
      : {
          reply:
            "Hello, welcome to your business. What shall we work on first?",
          model: "server-model",
          startupMs: 20,
          totalMs: 50,
        },
    setGlobalAgentConfigErrors: options.saveError
      ? [options.saveError]
      : undefined,
  };
  void surface;
  await installMockBridge(page, { ...mock, referenceWorkspace: true });
  await page.goto("/#/settings?section=agent-defaults");
  await expect(page.getByTestId("settings-global-agent-config")).toBeVisible();
  return {
    checkoutCalls,
    capabilities: () => capabilityCalls,
    recover() {
      offline = false;
    },
    disableGateway() {
      gateway = false;
    },
    disableStripe() {
      stripe = false;
    },
    settle() {
      if (!intent) throw new Error("No payment");
      intent.status = "paid";
      balance += 500;
    },
  };
}
async function mockInvoke(page: Page, command: string) {
  return page.evaluate(async (name) => {
    const bridge = window as unknown as Window & {
      __TAURI_INTERNALS__: { invoke(command: string): Promise<unknown> };
    };
    return bridge.__TAURI_INTERNALS__.invoke(name);
  }, command);
}
const saveCount = (page: Page) =>
  mockInvoke(page, "get_global_agent_config_set_call_count");
// Settings > Agents shows Colony credits as the design's disabled "Coming soon"
// card, as onboarding does: checkout is cut from the lean scope, so no gate
// turns the card into a paid action.
for (const gate of ["flag", "gateway", "stripe"] as const) {
  test(`settings: ${gate} OFF keeps Coming soon with no paid action`, async ({
    page,
  }) => {
    const state = await setup(page, "settings", { [gate]: false });
    const option = page.getByTestId("agent-way-credits");
    await expect(option).toContainText("Coming soon");
    await expect(
      option.getByRole("button", { name: "Buy credits" }),
    ).toBeDisabled();
    await expect(page.getByTestId("colony-credits-option")).toHaveCount(0);
    expect(await saveCount(page)).toBe(0);
    if (gate === "flag") expect(state.capabilities()).toBe(0);
  });
}

test("settings: Colony credits stay Coming soon even with every gate on", async ({
  page,
}) => {
  const state = await setup(page, "settings");
  const option = page.getByTestId("agent-way-credits");
  await expect(option).toContainText("Coming soon");
  await expect(
    option.getByRole("button", { name: "Buy credits" }),
  ).toBeDisabled();
  await expect(page.getByTestId("colony-credits-option")).toHaveCount(0);
  await expect(option).not.toContainText("Current balance");
  expect(await saveCount(page)).toBe(0);
  expect(state.capabilities()).toBe(0);
});
