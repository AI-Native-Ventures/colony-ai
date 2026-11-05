import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures/lockedBrowserTest";
import { openR17ConnectionSetup, r17Runtime } from "../helpers/onboarding";

const bundled = r17Runtime("buzz-agent", "available", {
  status: "not_applicable",
});

async function stubFreeGateway(
  page: Page,
  answer: {
    status?: number;
    enabled?: boolean;
    freeModels?: string[];
    delayMs?: number;
  } = {},
) {
  const calls = { capabilities: 0, payments: 0 };
  await page.route("**/api/credits-gateway/capabilities", async (route) => {
    calls.capabilities += 1;
    if (answer.delayMs)
      await new Promise((resolve) => setTimeout(resolve, answer.delayMs));
    await route.fulfill({
      status: answer.status ?? 200,
      json: {
        enabled: answer.enabled ?? true,
        runtime: "colony",
        freeModels: answer.freeModels ?? ["openai/gpt-4.1-mini:free"],
      },
    });
  });
  await page.route("**/api/payments/**", async (route) => {
    calls.payments += 1;
    await route.fulfill({
      status: 500,
      json: { error: "paid route not expected" },
    });
  });
  return calls;
}

async function openStartFree(page: Page) {
  await openR17ConnectionSetup(page, {
    startFree: true,
    runtimes: [bundled],
    mock: {
      colonyCreditsGatewayEnabled: true,
      onboardingConnectionResult: {
        reply: "Hello! What shall we work on first?",
        model: "openai/gpt-4.1-mini:free",
        startupMs: 20,
        totalMs: 50,
      },
    },
  });
}

test("Start free uses Colony's stubbed gateway, saves a keyless free route, and needs no subscription", async ({
  page,
}) => {
  await openStartFree(page);
  const calls = await stubFreeGateway(page, {
    freeModels: ["openai/gpt-4.1-mini:free", "openai/gpt-4.1-mini"],
  });
  await expect(page.getByTestId("onboarding-mode-free")).toBeChecked();
  await expect(page.getByTestId("start-free-fine-print")).toContainText(
    "No subscription or customer API key is required.",
  );

  await page.getByTestId("onboarding-test-connection").click();
  await expect(
    page.getByText("Hello! What shall we work on first?"),
  ).toBeVisible();
  await expect(page.getByTestId("onboarding-scene-connected")).toBeVisible();

  const request = await page.evaluate(() =>
    window.__BUZZ_E2E_COMMAND_PAYLOADS__?.find(
      (entry) => entry.command === "test_onboarding_connection",
    ),
  );
  expect(request?.payload).toMatchObject({
    config: {
      preferred_runtime: "buzz-agent",
      provider: "colony-credits",
      model: "openai/gpt-4.1-mini:free",
    },
  });
  const saved = await page.evaluate(async () =>
    window.__BUZZ_E2E_INVOKE_MOCK_COMMAND__?.("get_global_agent_config", null),
  );
  expect(saved).toMatchObject({
    preferred_runtime: "buzz-agent",
    provider: "colony-credits",
    model: "openai/gpt-4.1-mini:free",
  });
  expect(calls.capabilities).toBe(1);
  expect(calls.payments).toBe(0);
});

test("Start free waits on the Colony gateway and can be retried after an outage", async ({
  page,
}) => {
  await openStartFree(page);
  let calls = await stubFreeGateway(page, { status: 503, delayMs: 500 });
  await page.getByTestId("onboarding-test-connection").click();
  await expect(page.getByTestId("start-free-installing")).toBeVisible();
  await expect(page.getByTestId("onboarding-mode-own")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Back" })).toBeDisabled();
  await expect(page.getByTestId("start-free-problem")).toContainText(
    "Colony free AI models could not be checked.",
  );
  await expect(page.getByTestId("onboarding-test-connection")).toHaveText(
    "Try again",
  );
  expect(calls.capabilities).toBe(1);

  await page.unroute("**/api/credits-gateway/capabilities");
  calls = await stubFreeGateway(page);
  await page.getByTestId("onboarding-test-connection").click();
  await expect(page.getByTestId("onboarding-scene-connected")).toBeVisible();
  expect(calls.capabilities).toBe(1);
});

test("Start free refuses to fall back to a paid model when no free model is configured", async ({
  page,
}) => {
  await openStartFree(page);
  const calls = await stubFreeGateway(page, {
    freeModels: ["openai/gpt-4.1-mini"],
  });
  await page.getByTestId("onboarding-test-connection").click();
  await expect(page.getByTestId("start-free-problem")).toContainText(
    "Colony free AI is not configured for this workspace.",
  );
  await expect(page.getByTestId("onboarding-test-connection")).toHaveText(
    "Try again",
  );
  expect(calls.capabilities).toBe(1);
  expect(calls.payments).toBe(0);
  const probes = await page.evaluate(() =>
    window.__BUZZ_E2E_COMMAND_PAYLOADS__?.filter(
      (entry) => entry.command === "test_onboarding_connection",
    ),
  );
  expect(probes).toHaveLength(0);
});
