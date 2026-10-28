import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";
import { installDiscoveryImageMocks } from "../helpers/discoveryImages";

test("campaign prospect logos use fixture websites and retain the letter fallback", async ({
  page,
}) => {
  const { logoRequests } = await installDiscoveryImageMocks(page, {
    failLogoDomains: ["form-field.example"],
  });
  await installMockBridge(page, { referenceWorkspace: true });
  await page.goto("/#/campaign", { waitUntil: "domcontentloaded" });

  const campaign = page.getByTestId("w10-campaign-page");
  await expect(campaign).toBeVisible();
  await expect(
    campaign.getByRole("heading", {
      name: "Independent brands needing social support",
    }),
  ).toBeVisible();

  const logos = campaign.locator(".business-logo-mark img");
  if (!process.env.COLONY_LOGO_DEV_TOKEN) {
    await expect(campaign.locator(".business-logo-fallback")).not.toHaveCount(
      0,
    );
    await expect(logos).toHaveCount(0);
    expect(logoRequests.size).toBe(0);
    return;
  }

  await expect(logos).not.toHaveCount(0);
  await expect(logos.first()).toHaveAttribute("loading", "lazy");
  await expect(logos.first()).toHaveAttribute("alt", "The Olive House");
  const firstLogoUrl = new URL((await logos.first().getAttribute("src")) ?? "");
  expect(firstLogoUrl.searchParams.get("token")).not.toBeNull();
  expect(firstLogoUrl.pathname).toBe("/the-olive-house.example");
  await expect(logos.first()).toHaveJSProperty("naturalWidth", 64);

  const failedLogoRow = campaign
    .getByRole("row")
    .filter({ hasText: "Form & Field" });
  await failedLogoRow.scrollIntoViewIfNeeded();
  await expect(failedLogoRow.locator(".business-logo-fallback")).toHaveText(
    "F",
  );
  expect(logoRequests).toContain("form-field.example");
  expect(logoRequests.size).toBeGreaterThan(1);

  await page.evaluate(() => window.scrollTo(0, 0));
  await waitForAnimations(page);
  mkdirSync("test-results/screenshots", { recursive: true });
  await campaign.screenshot({
    animations: "disabled",
    path: "test-results/screenshots/discovery-prospect-logos.png",
  });
});
