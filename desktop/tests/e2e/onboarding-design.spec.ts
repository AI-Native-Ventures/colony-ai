import { expect, test } from "@playwright/test";
import { installMockBridge } from "../helpers/bridge";
import { waitForAnimations } from "../helpers/animations";
import {
  openR17BusinessSetup,
  completeR17BusinessSetup,
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
    await expect(page.locator("body")).not.toContainText(
      /Welcome to Buzz|Build your profile|Meet your starter team|Take me to Buzz/,
    );
    await expect(
      page.locator('img[src*="starter-team"],img[src*="buzz-wordmark"]'),
    ).toHaveCount(0);
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
