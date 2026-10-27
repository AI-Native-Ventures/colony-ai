import { expect, test, type Page } from "@playwright/test";
import { installMockBridge, TEST_IDENTITIES } from "../helpers/bridge";
import {
  openR17BusinessSetup,
  r17Runtime,
  seedActiveIdentity,
  startR17AccountAuth,
} from "../helpers/onboarding";

// C3-JUDGE-AI: a person with no AI tools signs in and never sees Connect when
// the relay says their account uses the Colony Agent for free. Every other
// case keeps today's Connect screen. Gateway answers are faked at the network.

const TRANSACTION_KEY = "buzz-community-onboarding-transaction.v1";
const OWNER = { ...TEST_IDENTITIES.tyler, username: "" };

const bundled = r17Runtime("buzz-agent", "available", {
  status: "not_applicable",
});
const noClaude = r17Runtime("claude", "not_installed", { status: "unknown" });
const signedInClaude = r17Runtime("claude", "available", {
  status: "logged_in",
});

type Gateway = {
  enabled?: boolean;
  freeAiConfigured?: boolean;
  freeAi?: boolean;
  accessStatus?: number;
  /** Capabilities answer 404, like a relay older than the gateway. */
  missing?: boolean;
};

async function fakeGateway(page: Page, gateway: Gateway = {}) {
  const requests: string[] = [];
  await page.route("**/api/credits-gateway/capabilities", (route) => {
    requests.push("capabilities");
    if (gateway.missing) return route.fulfill({ status: 404, json: {} });
    return route.fulfill({
      json: {
        enabled: gateway.enabled ?? true,
        runtime: "colony",
        model: "openai/gpt-4.1-mini",
        freeAiConfigured: gateway.freeAiConfigured ?? true,
      },
    });
  });
  await page.route("**/api/credits-gateway/access", (route) => {
    requests.push("access");
    // Only a signed request may ask, and it asks as a GET.
    expect(route.request().method()).toBe("GET");
    expect(route.request().headers().authorization).toMatch(/^Nostr /);
    if (gateway.accessStatus)
      return route.fulfill({ status: gateway.accessStatus, json: {} });
    return route.fulfill({ json: { freeAi: gateway.freeAi ?? true } });
  });
  return requests;
}

const mock = (extra: Record<string, unknown> = {}) => ({
  colonyCreditsGatewayEnabled: true,
  acpRuntimesCatalog: [bundled, noClaude],
  ...extra,
});

async function fillBusinessAndContinue(page: Page) {
  await page.getByLabel("Business name").fill("North Star");
  await page.getByLabel("Website").fill("northstar.example");
  await page
    .getByLabel("What does your business do?")
    .fill("An independent design studio.");
  await page.locator("#business-logo").setInputFiles({
    name: "north-star.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="8" fill="#6f56a8"/></svg>',
    ),
  });
  const continueButton = page.getByRole("button", { name: "Continue" });
  await expect(continueButton).toBeEnabled();
  await continueButton.click();
}

async function savedConfig(page: Page) {
  return page.evaluate(() =>
    window.__BUZZ_E2E_INVOKE_MOCK_COMMAND__?.("get_global_agent_config", null),
  );
}

async function transaction(page: Page) {
  return page.evaluate(
    (key) => JSON.parse(window.localStorage.getItem(key) ?? "null"),
    TRANSACTION_KEY,
  );
}

async function commandPayloads(page: Page, command: string) {
  return page.evaluate(
    (name) =>
      (window.__BUZZ_E2E_COMMAND_PAYLOADS__ ?? []).filter(
        (entry) => entry.command === name,
      ),
    command,
  );
}

async function signInAsReturningOwner(page: Page, options: Gateway = {}) {
  await startR17AccountAuth(page, { mock: mock() });
  const requests = await fakeGateway(page, options);
  await page.route("**/api/communities/mine", (route) =>
    route.fulfill({
      json: {
        owner_pubkey: "deadbeef".repeat(8),
        communities: [
          {
            id: "owned-business",
            name: "Owned Business",
            slug: "owned-business",
            normalized_host: "owned-business.example.test",
            owner_pubkey: "deadbeef".repeat(8),
          },
        ],
      },
    }),
  );
  await page.getByLabel("Email address").fill("judge@example.com");
  await page
    .getByRole("textbox", { name: "Password" })
    .fill("correct-horse-12");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByTestId("onboarding-business-owned-business"),
  ).toBeVisible();
  return requests;
}

test.describe("free Colony AI for judges", () => {
  test("a new account with no AI tools skips Connect and gets the Colony Agent", async ({
    page,
  }) => {
    const reply = "Hi, I am Scout, running on Colony's own AI.";
    await openR17BusinessSetup(page, {
      mock: mock({
        onboardingConnectionResult: {
          reply,
          model: "openai/gpt-4.1-mini",
          startupMs: 20,
          totalMs: 50,
        },
      }),
    });
    const requests = await fakeGateway(page, { freeAi: true });
    await fillBusinessAndContinue(page);

    await expect
      .poll(() => transaction(page))
      .toMatchObject({
        source: "first-community",
        firstCommunityPage: "create",
      });
    await expect(page.getByTestId("onboarding-scene-connect")).toHaveCount(0);
    expect(await savedConfig(page)).toMatchObject({
      preferred_runtime: "buzz-agent",
      provider: "colony-credits",
      model: null,
    });
    // One real proof turn ran, and nothing in the saved config is a key.
    expect(
      await commandPayloads(page, "test_onboarding_connection"),
    ).toHaveLength(1);
    expect(JSON.stringify(await savedConfig(page))).not.toMatch(/KEY|sk-or/i);
    expect(requests).toEqual(["capabilities", "access"]);
    // The real first reply from the gateway reaches Scout's Welcome thread.
    await expect(page.getByTestId("app-sidebar")).toBeVisible();
    await expect(page.getByText(reply).first()).toBeVisible();
  });

  test("a returning owner on a new Mac skips Connect and opens the business", async ({
    page,
  }) => {
    await signInAsReturningOwner(page);
    await page.getByTestId("onboarding-business-owned-business").click();

    await expect
      .poll(() => transaction(page))
      .toMatchObject({
        source: "first-community",
        firstCommunityPage: "owned",
        businessCommunityId: "owned-business",
        relayUrl: "wss://owned-business.example.test",
      });
    await expect(page.getByTestId("onboarding-scene-connect")).toHaveCount(0);
    expect(await savedConfig(page)).toMatchObject({
      preferred_runtime: "buzz-agent",
      provider: "colony-credits",
    });
  });

  test("the Welcome owner path also skips Connect", async ({ page }) => {
    await seedActiveIdentity(page, OWNER);
    await page.addInitScript((pubkey) => {
      window.localStorage.setItem(
        `buzz-machine-onboarding-complete.v2:${pubkey}`,
        "true",
      );
    }, OWNER.pubkey);
    await installMockBridge(page, mock(), {
      relayWsUrl: "ws://localhost:3000",
      skipOnboardingSeed: true,
      skipCommunitySeed: true,
    });
    await fakeGateway(page);
    await page.route("**/api/communities/mine", (route) =>
      route.fulfill({
        json: {
          owner_pubkey: OWNER.pubkey,
          communities: [
            {
              id: "owned-business",
              name: "Owned Business",
              slug: "owned-business",
              normalized_host: "owned-business.example.test",
              owner_pubkey: OWNER.pubkey,
            },
          ],
        },
      }),
    );
    await page.goto("/");
    await page.getByTestId("existing-choice-owner").check();
    await page.getByTestId("welcome-owned-business-owned-business").click();

    await expect
      .poll(() => transaction(page))
      .toMatchObject({
        firstCommunityPage: "owned",
        businessCommunityId: "owned-business",
      });
    await expect(page.getByTestId("onboarding-scene-connect")).toHaveCount(0);
    expect(await savedConfig(page)).toMatchObject({
      provider: "colony-credits",
    });
  });

  for (const [name, gateway, extra] of [
    ["the gateway is off on the relay", { enabled: false }, {}],
    ["an older relay has no gateway route", { missing: true }, {}],
    ["no free account is configured", { freeAiConfigured: false }, {}],
    ["this account is not on the free list", { freeAi: false }, {}],
    ["the access check cannot be answered", { accessStatus: 503 }, {}],
    [
      "this build was made without the gateway flag",
      {},
      { colonyCreditsGatewayEnabled: false },
    ],
  ] as const) {
    test(`today's Connect screen stays when ${name}`, async ({ page }) => {
      await openR17BusinessSetup(page, { mock: mock(extra) });
      await fakeGateway(page, gateway);
      await fillBusinessAndContinue(page);

      await expect(page.getByTestId("onboarding-scene-connect")).toBeVisible();
      expect(await savedConfig(page)).toMatchObject({
        preferred_runtime: null,
        provider: null,
      });
      expect(
        await commandPayloads(page, "test_onboarding_connection"),
      ).toHaveLength(0);
    });
  }

  test("Claude Code signed in keeps today's Connect screen, even for a free account", async ({
    page,
  }) => {
    await openR17BusinessSetup(page, {
      mock: mock({ acpRuntimesCatalog: [bundled, signedInClaude] }),
    });
    await fakeGateway(page, { freeAi: true });
    await fillBusinessAndContinue(page);

    await expect(page.getByTestId("onboarding-scene-connect")).toBeVisible();
    expect(await savedConfig(page)).toMatchObject({ provider: null });
    expect(
      await commandPayloads(page, "test_onboarding_connection"),
    ).toHaveLength(0);
  });

  test("a failed proof falls back to the Connect screen instead of blocking", async ({
    page,
  }) => {
    await openR17BusinessSetup(page, {
      mock: mock({
        onboardingConnectionResult: { error: "The gateway could not answer." },
      }),
    });
    await fakeGateway(page, { freeAi: true });
    await fillBusinessAndContinue(page);

    await expect(page.getByTestId("onboarding-scene-connect")).toBeVisible();
    expect(await savedConfig(page)).toMatchObject({ provider: null });
    expect(await transaction(page)).toBeNull();
  });

  test("a returning owner who is not free still sees Connect", async ({
    page,
  }) => {
    await signInAsReturningOwner(page, { freeAi: false });
    await page.getByTestId("onboarding-business-owned-business").click();
    await expect(page.getByTestId("onboarding-scene-connect")).toBeVisible();
  });
});
