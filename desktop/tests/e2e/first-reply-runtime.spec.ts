import { expect, test } from "@playwright/test";
import { openR17ConnectionSetup, r17Runtime } from "../helpers/onboarding";
import { waitForAnimations } from "../helpers/animations";
import { mkdir } from "node:fs/promises";

const claude = r17Runtime("claude", "available", { status: "logged_in" });
const codex = r17Runtime("codex", "available", { status: "logged_in" });

test("Connect waits for the actual reply, then pins the selected runtime and model", async ({
  page,
}) => {
  await openR17ConnectionSetup(page, {
    runtimes: [claude, codex],
    mock: {
      onboardingConnectionDelayMs: 400,
      onboardingConnectionResult: {
        reply: "A reply from the selected harness",
        model: "actual-model",
        startupMs: 80,
        totalMs: 400,
      },
    },
  });
  await page
    .getByTestId("onboarding-connect-runtime-codex")
    .getByRole("button", { name: /Codex/ })
    .click();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByTestId("onboarding-scene-testing")).toBeVisible();
  await expect(page.getByText("Connection verified")).toHaveCount(0);
  await expect(page.getByTestId("onboarding-scene-connected")).toBeVisible();
  await expect(page.locator(".reply")).toContainText(
    "A reply from the selected harness",
  );
  await expect(page.locator(".connection-meta")).toContainText(
    "Codex · actual-model",
  );
  const saved = await page.evaluate(async () =>
    window.__BUZZ_E2E_INVOKE_MOCK_COMMAND__?.("get_global_agent_config", null),
  );
  expect(saved).toMatchObject({
    preferred_runtime: "codex",
    model: "actual-model",
  });
});

for (const result of [
  { error: "Provider rejected authentication. Sign in again." },
  { reply: "", model: "actual-model" },
]) {
  test(`Connect rejects ${result.error ? "provider failure" : "an empty reply"}`, async ({
    page,
  }) => {
    await openR17ConnectionSetup(page, {
      runtimes: [claude],
      mock: { onboardingConnectionResult: result },
    });
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await expect(
      page.getByTestId("onboarding-scene-connection-error"),
    ).toBeVisible();
    await expect(page.getByText("Connection verified")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Try again", exact: true }),
    ).toBeVisible();
  });
}

test("cancelling ignores a late reply", async ({ page }) => {
  await openR17ConnectionSetup(page, {
    runtimes: [claude],
    mock: { onboardingConnectionDelayMs: 800 },
  });
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await page.getByRole("button", { name: "Cancel test" }).click();
  await expect(page.getByTestId("onboarding-scene-connect")).toBeVisible();
  await page.waitForTimeout(900);
  await expect(page.getByText("Connection verified")).toHaveCount(0);
});

for (const viewport of [
  { width: 1728, height: 1117 },
  { width: 1440, height: 900 },
]) {
  test(`first reply reference comparison ${viewport.width}`, async ({
    page,
    context,
  }) => {
    test.skip(
      !process.env.COLONY_REFERENCE_URL,
      "Local frozen-reference capture only",
    );
    await mkdir("test-results/first-reply-proof", { recursive: true });
    await page.setViewportSize(viewport);
    await openR17ConnectionSetup(page, {
      runtimes: [claude],
      mock: { onboardingConnectionDelayMs: 2000 },
    });
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await expect(page.getByTestId("onboarding-scene-testing")).toBeVisible();
    await waitForAnimations(page);
    await page.screenshot({
      path: `test-results/first-reply-proof/app-testing-${viewport.width}.png`,
    });
    await expect(page.getByTestId("onboarding-scene-connected")).toBeVisible();
    await waitForAnimations(page);
    await page.screenshot({
      path: `test-results/first-reply-proof/app-connected-${viewport.width}.png`,
    });
    const reference = await context.newPage();
    await reference.setViewportSize(viewport);
    for (const scene of ["testing", "connected"]) {
      await reference.goto(`${process.env.COLONY_REFERENCE_URL}#${scene}`);
      // The frozen prototype reads its route on load, not hashchange.
      await reference.reload();
      if (scene === "connected") await expect(reference.getByText("Connection verified")).toBeVisible();
      await waitForAnimations(reference);
      await reference.screenshot({
        path: `test-results/first-reply-proof/reference-${scene}-${viewport.width}.png`,
      });
    }
    await reference.close();
  });
}
