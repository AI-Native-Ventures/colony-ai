import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { installMockBridge } from "../helpers/bridge";
import {
  mockOpenRouterUnlinked,
  openR17ConnectionSetup,
  r17Runtime,
} from "../helpers/onboarding";
import { waitForAnimations } from "../helpers/animations";

type Surface = "onboarding" | "settings";
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
  if (surface === "onboarding") {
    await openR17ConnectionSetup(page, { mock, runtimes: [runtime] });
    await mockOpenRouterUnlinked(page);
    await page
      .getByRole("radio", { name: "Colony Agent", exact: true })
      .click();
  } else {
    await installMockBridge(page, { ...mock, referenceWorkspace: true });
    await page.goto("/#/settings?section=agent-defaults");
    await expect(
      page.getByTestId("settings-global-agent-config"),
    ).toBeVisible();
  }
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
const savedConfig = (page: Page) => mockInvoke(page, "get_global_agent_config");
const saveCount = (page: Page) =>
  mockInvoke(page, "get_global_agent_config_set_call_count");
const openedUrls = (page: Page) =>
  mockInvoke(page, "get_e2e_opened_external_urls");
async function capture(
  page: Page,
  testInfo: TestInfo,
  subject: string,
  width: number,
) {
  const option = page.getByTestId("colony-credits-option");
  await option.scrollIntoViewIfNeeded();
  const box = await option.boundingBox();
  if (!box) throw new Error("Credits option has no visible bounds");
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
  await waitForAnimations(page);
  const path = testInfo.outputPath(`${subject}-${width}.png`);
  await page.screenshot({ path });
  await testInfo.attach(`${subject}-${width}`, {
    path,
    contentType: "image/png",
  });
}

for (const surface of ["onboarding", "settings"] as const) {
  for (const gate of ["flag", "gateway", "stripe"] as const) {
    test(`${surface}: ${gate} OFF keeps Coming soon with no paid action`, async ({
      page,
    }) => {
      const state = await setup(page, surface, { [gate]: false });
      const option = page.getByTestId("onboarding-credits-coming-soon");
      await expect(option).toContainText("Coming soon");
      await expect(option.getByRole("button")).toHaveCount(0);
      expect(await saveCount(page)).toBe(0);
      if (gate === "flag") expect(state.capabilities()).toBe(0);
    });
  }
  test(`${surface}: failed capability check retains retry and restores the real balance`, async ({
    page,
  }) => {
    const state = await setup(page, surface, { offline: true });
    const option = page.getByTestId("colony-credits-option");
    await expect(option.getByRole("alert")).toBeVisible();
    await expect(
      page.getByTestId("onboarding-credits-coming-soon"),
    ).toHaveCount(0);
    await expect(option).not.toContainText("Current balance");
    state.recover();
    await option.getByRole("button", { name: "Retry Colony credits" }).click();
    await expect(option).toContainText("Current balance: $12.50 USD");
  });
  test(`${surface}: zero balance buys through Stripe and waits for the server grant`, async ({
    page,
  }) => {
    const state = await setup(page, surface, { balance: 0 });
    const option = page.getByTestId("colony-credits-option");
    await expect(option).toContainText("Current balance: $0.00 USD");
    await expect(
      option.getByRole("button", { name: "Use Colony credits" }),
    ).toBeDisabled();
    await option.getByRole("button", { name: "Buy credits" }).click();
    const checkout = page.getByRole("dialog", { name: "Buy Colony credits" });
    await checkout
      .getByRole("radio", { name: "$5.00 USD $5.00 credits", exact: true })
      .check();
    await checkout
      .getByRole("button", { name: "Continue to checkout" })
      .click();
    await expect(checkout).toContainText("Waiting for payment confirmation");
    await expect(checkout).toContainText("Available balance: $0.00 USD");
    expect(await openedUrls(page)).toEqual([
      "https://checkout.stripe.com/c/pay/option-test",
    ]);
    expect(state.checkoutCalls).toHaveLength(1);
    state.settle();
    await checkout.getByRole("button", { name: "Check payment" }).click();
    await expect(checkout).toContainText("Available balance: $5.00 USD");
    await checkout.getByRole("button", { name: "Close", exact: true }).click();
    await expect(option).toContainText("Current balance: $5.00 USD");
    await expect(
      option.getByRole("button", { name: "Use Colony credits" }),
    ).toBeEnabled();
    expect(await saveCount(page)).toBe(0);
  });
  test(`${surface}: terms work by keyboard and pointer before a keyless proof and atomic save`, async ({
    page,
  }) => {
    await setup(page, surface, { delay: 1000 });
    const option = page.getByTestId("colony-credits-option");
    await expect(option).toContainText(
      "By buying or using Colony credits you agree to the Terms and Acceptable Use Policy.",
    );
    const terms = option.getByRole("link", { name: "Terms", exact: true });
    await terms.focus();
    await terms.press("Enter");
    await option
      .getByRole("link", { name: "Acceptable Use Policy", exact: true })
      .click();
    expect(await openedUrls(page)).toEqual([
      "https://policies.example/terms",
      "https://policies.example/use",
    ]);
    const select = option.getByRole("button", { name: "Use Colony credits" });
    await select.focus();
    await select.press("Enter");
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            window.__BUZZ_E2E_COMMAND_PAYLOADS__?.filter(
              (entry) => entry.command === "test_onboarding_connection",
            ).length,
        ),
      )
      .toBe(1);
    expect(await saveCount(page)).toBe(0);
    expect(await savedConfig(page)).toMatchObject(original);
    if (surface === "onboarding")
      await expect(
        page.getByTestId("onboarding-scene-connected"),
      ).toBeVisible();
    else
      await expect(page.getByTestId("agent-defaults-connection")).toContainText(
        "Colony credits selected",
      );
    expect(await savedConfig(page)).toEqual({
      env_vars: {},
      provider: "colony-credits",
      model: null,
      preferred_runtime: "buzz-agent",
    });
    expect(await saveCount(page)).toBe(1);
    const call = await page.evaluate(() =>
      window.__BUZZ_E2E_COMMAND_PAYLOADS__?.find(
        (entry) => entry.command === "test_onboarding_connection",
      ),
    );
    expect(call?.payload).toMatchObject({
      config: {
        provider: "colony-credits",
        preferred_runtime: "buzz-agent",
        model: null,
        env_vars: {},
      },
    });
  });
  for (const fault of ["proof", "save"] as const) {
    test(`${surface}: ${fault} failure never reports a saved credits connection`, async ({
      page,
    }) => {
      await setup(
        page,
        surface,
        fault === "proof"
          ? { proofError: "Out of credits. Buy credits, then try again." }
          : { saveError: "Settings could not be saved. Try again." },
      );
      await page
        .getByTestId("colony-credits-option")
        .getByRole("button", { name: "Use Colony credits" })
        .click();
      await expect(
        page
          .getByRole("alert")
          .filter({
            hasText:
              fault === "proof" ? "Out of credits" : "could not be saved",
          })
          .first(),
      ).toBeVisible();
      expect(await savedConfig(page)).toMatchObject(original);
      expect(await saveCount(page)).toBe(fault === "proof" ? 0 : 1);
      await expect(page.getByTestId("onboarding-scene-connected")).toHaveCount(
        0,
      );
      if (surface === "settings")
        await expect(
          page
            .getByTestId("colony-credits-option")
            .getByRole("button", { name: "Use Colony credits" }),
        ).toBeEnabled();
    });
  }
  test(`${surface}: refreshed capability revocation hides paid actions without losing alternatives`, async ({
    page,
  }) => {
    const state = await setup(page, surface);
    const option = page.getByTestId("colony-credits-option");
    await expect(option).toContainText("Current balance: $12.50 USD");
    state.disableStripe();
    await option.getByRole("button", { name: "Refresh balance" }).click();
    await expect(
      page.getByTestId("onboarding-credits-coming-soon"),
    ).toContainText("Coming soon");
    if (surface === "onboarding")
      await expect(
        page.getByRole("button", { name: "Skip for now", exact: true }),
      ).toBeEnabled();
  });
  for (const width of [1440, 390]) {
    test(`${surface}: configured credits at ${width}`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
      await setup(page, surface);
      const option = page.getByTestId("colony-credits-option");
      await expect(option).toContainText("Current balance: $12.50 USD");
      await expect(
        option.getByRole("button", { name: "Use Colony credits" }),
      ).toBeEnabled();
      await capture(page, testInfo, surface, width);
    });
  }
}
