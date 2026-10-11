import { expect, test } from "@playwright/test";
import { installMockBridge } from "../helpers/bridge";
import { waitForAnimations } from "../helpers/animations";
import {
  openR17BusinessSetup,
  completeR17BusinessSetup,
  mockOpenRouterUnlinked,
  openR17ConnectionSetup,
  r17Runtime,
} from "../helpers/onboarding";

const SHOT_DIR =
  process.env.COLONY_ONBOARDING_PROOF_DIR ?? "test-results/onboarding-design";

for (const viewport of [
  { width: 1728, height: 1117 },
  { width: 1440, height: 900 },
]) {
  test(`approved account entry and business screens at ${viewport.width}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await installMockBridge(
      page,
      { accountLinked: true },
      { skipCommunitySeed: true, skipOnboardingSeed: true },
    );
    await page.goto("/");
    await expect(page.getByTestId("onboarding-scene-account")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Let’s get you started." }),
    ).toBeVisible();
    await expect(
      page.getByText("Chief of Staff", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Here to help", { exact: true })).toBeVisible();
    await expect(page.getByTestId("onboarding-display-name")).toHaveCount(0);
    await expect(
      page.locator(
        '[data-testid^="community-profile-"], [data-testid^="community-team-intro-"], [data-testid="community-avatar-open"]',
      ),
    ).toHaveCount(0);
    await expect(
      page.locator('img[src*="starter-team"],img[src*="buzz-wordmark"]'),
    ).toHaveCount(0);
    await expect(page.locator(".scout-ant svg").first()).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Create account", exact: true }),
    ).toHaveCSS("line-height", "normal");
    await waitForAnimations(page);
    await page.screenshot({
      path: `${SHOT_DIR}/runtime-account-${viewport.width}.png`,
    });
  });
  test(`business and connection preserve Scout at ${viewport.width}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await openR17BusinessSetup(page);
    await expect(page.getByText("Your turn", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Let’s get to know your business." }),
    ).toBeVisible();
    await waitForAnimations(page);
    await page.screenshot({
      path: `${SHOT_DIR}/runtime-business-${viewport.width}.png`,
    });
    await page.getByLabel("Business name").focus();
    await expect(
      page.getByRole("heading", { name: "What’s your business called?" }),
    ).toBeVisible();
    await completeR17BusinessSetup(page);
    await expect(
      page.getByRole("heading", { name: "Let’s connect your first agent." }),
    ).toBeVisible();
    await expect(page.getByText("Your turn", { exact: true })).toBeVisible();
    await waitForAnimations(page);
    await page.screenshot({
      path: `${SHOT_DIR}/runtime-connect-${viewport.width}.png`,
    });
  });
}

test("Scout retains the frozen pose without animation in reduced motion", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await installMockBridge(
    page,
    { accountLinked: true },
    { skipCommunitySeed: true, skipOnboardingSeed: true },
  );
  await page.goto("/");
  const body = page.locator(".scout-ant svg .body").first();
  await expect(body).toHaveAttribute("transform", /translate/);
  const pose = await body.getAttribute("transform");
  await page.waitForTimeout(120);
  expect(await body.getAttribute("transform")).toBe(pose);
});

test("connection choices preserve keyboard and pointer radio behavior", async ({
  page,
}) => {
  await installMockBridge(
    page,
    { accountLinked: true },
    { skipCommunitySeed: true, skipOnboardingSeed: true },
  );
  await openR17BusinessSetup(page);
  await completeR17BusinessSetup(page);
  const group = page.getByRole("radiogroup", { name: "AI connection" });
  await expect(group.getByRole("radio")).toHaveCount(2);
  const subscriptions = group.getByRole("radio", {
    name: "Claude Code or Codex",
    exact: true,
  });
  const colonyAgent = group.getByRole("radio", {
    name: "Colony Agent",
    exact: true,
  });
  await expect(subscriptions).toBeChecked();
  await subscriptions.focus();
  await page.keyboard.press("ArrowRight");
  await expect(colonyAgent).toBeChecked();
  await expect(colonyAgent).toBeFocused();
  await expect(subscriptions).toHaveAttribute("tabindex", "-1");
  await page.keyboard.press("ArrowRight");
  await expect(subscriptions).toBeChecked();
  await expect(subscriptions).toBeFocused();
  await page.keyboard.press("End");
  await expect(colonyAgent).toBeChecked();
  await page.keyboard.press("Home");
  await expect(subscriptions).toBeChecked();
  await colonyAgent.click();
  await expect(colonyAgent).toBeChecked();
  await expect(page.getByTestId("openrouter-connection")).toBeVisible();
});

for (const viewport of [
  { width: 1728, height: 1117 },
  { width: 1440, height: 900 },
]) {
  test(`reply-gated first run renders testing, connected and app at ${viewport.width}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await openR17ConnectionSetup(page, {
      runtimes: [r17Runtime("claude", "available", { status: "logged_in" })],
      mock: {
        onboardingConnectionDelayMs: 4000,
        onboardingConnectionResult: {
          reply: "Hello Lerato, I’m here. What shall we work on first?",
          model: "Sonnet",
          startupMs: 80,
          totalMs: 4000,
        },
      },
    });
    await expect(
      page.getByTestId("onboarding-connect-runtime-claude"),
    ).toContainText("Subscription could not be checked");
    await waitForAnimations(page);
    await page.screenshot({
      path: `${SHOT_DIR}/runtime-connect-ready-${viewport.width}.png`,
    });
    await page.getByRole("button", { name: /^Connect / }).click();
    await expect(page.getByTestId("onboarding-scene-testing")).toBeVisible();
    await expect(page.getByTestId("app-sidebar")).toHaveCount(0);
    await waitForAnimations(page);
    await page.screenshot({
      path: `${SHOT_DIR}/runtime-testing-${viewport.width}.png`,
    });
    await expect(page.getByTestId("onboarding-scene-connected")).toBeVisible();
    await expect(
      page.getByText("First reply received", { exact: true }),
    ).toBeVisible();
    await expect(page.locator(".reply")).toContainText("Hello Lerato");
    await waitForAnimations(page);
    await page.screenshot({
      path: `${SHOT_DIR}/runtime-connected-${viewport.width}.png`,
    });
    await page
      .getByRole("button", { name: "Open my Colony", exact: true })
      .click();
    await expect(page.getByTestId("app-sidebar")).toBeVisible();
    await expect(page.getByTestId("community-onboarding-flow")).toHaveCount(0);
    await expect(page.getByTestId("onboarding-display-name")).toHaveCount(0);
    await expect(
      page.locator(
        '[data-testid^="community-profile-"], [data-testid^="community-team-intro-"], [data-testid="community-avatar-open"]',
      ),
    ).toHaveCount(0);
    await waitForAnimations(page);
    await page.screenshot({
      path: `${SHOT_DIR}/runtime-workspace-${viewport.width}.png`,
    });
  });
}

for (const viewport of [
  { width: 1728, height: 1117 },
  { width: 1440, height: 900 },
]) {
  test(`Colony Agent offers OpenRouter and unavailable credits at ${viewport.width}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await openR17ConnectionSetup(page, {
      runtimes: [
        r17Runtime("claude", "available", { status: "logged_in" }),
        r17Runtime("buzz-agent", "available", { status: "not_applicable" }),
      ],
    });
    await waitForAnimations(page);
    await page.screenshot({
      path: `${SHOT_DIR}/runtime-two-paths-${viewport.width}.png`,
    });
    await mockOpenRouterUnlinked(page);
    await page
      .getByRole("radio", { name: "Colony Agent", exact: true })
      .click();
    const colonyAgent = page.getByTestId("onboarding-colony-agent");
    await expect(
      colonyAgent.getByRole("button", {
        name: "Connect OpenRouter",
        exact: true,
      }),
    ).toBeEnabled();
    await expect(
      colonyAgent.getByTestId("onboarding-credits-coming-soon"),
    ).toContainText("Coming soon");
    await expect(page.getByTestId("onboarding-provider-key")).toHaveCount(0);
    await expect(page.getByLabel("Model", { exact: true })).toHaveCount(0);
    await expect(page.locator(".harness-state")).toHaveText("Included");
    await expect(page.locator(".harness-picker-copy strong")).toHaveText(
      "Colony Agent",
    );
    await expect(
      page.getByRole("button", { name: "Skip for now", exact: true }),
    ).toBeEnabled();
    await expect(page.locator(".form-content .lede[role=status]")).toHaveCount(
      0,
    );
    await waitForAnimations(page);
    await page.screenshot({
      path: `${SHOT_DIR}/runtime-colony-agent-${viewport.width}.png`,
    });
  });
}

for (const viewport of [
  { width: 1728, height: 1117 },
  { width: 1440, height: 900 },
]) {
  test(`reply failure keeps a focused recovery scene at ${viewport.width}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await openR17ConnectionSetup(page, {
      runtimes: [r17Runtime("claude", "available", { status: "logged_in" })],
      mock: {
        onboardingConnectionResult: {
          error: "Provider rejected authentication. Sign in again.",
        },
      },
    });
    await page.getByRole("button", { name: /^Connect / }).click();
    await expect(
      page.getByTestId("onboarding-scene-connection-error"),
    ).toBeVisible();
    await expect(
      page
        .getByRole("main")
        .getByRole("heading", { name: "No reply just yet.", exact: true }),
    ).toBeFocused();
    await expect(page.getByTestId("app-sidebar")).toHaveCount(0);
    await waitForAnimations(page);
    await page.screenshot({
      path: `${SHOT_DIR}/runtime-connection-error-${viewport.width}.png`,
    });
  });
}
