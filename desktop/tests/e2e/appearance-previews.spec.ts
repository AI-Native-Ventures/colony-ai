import { expect, test, type Page } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";

async function openAppearance(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("buzz-theme", "buzz");
  });
  await installMockBridge(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("open-settings").click();
  await page.getByTestId("profile-popover-settings").click();
  await page.getByTestId("settings-group-appearance-group").click();
  await expect(page.getByTestId("settings-appearance")).toBeVisible({
    timeout: 10_000,
  });
  await waitForAnimations(page);
}

function appearanceSnapshot(page: Page) {
  return page.evaluate(() => {
    const key = Object.keys(localStorage).find(
      (candidate) =>
        candidate.startsWith("colony.appearance.v1:") &&
        !candidate.endsWith(":last-business"),
    );
    return key ? JSON.parse(localStorage.getItem(key) ?? "null") : null;
  });
}

test("named theme and message density save as one workspace preference", async ({
  page,
}) => {
  await openAppearance(page);

  const appearance = page.getByTestId("settings-appearance");
  await expect(
    appearance.getByRole("heading", { exact: true, name: "Appearance" }),
  ).toBeVisible();
  await expect(appearance.getByText("One home for appearance")).toBeVisible();
  await expect(appearance.getByTestId("appearance-density")).toHaveValue(
    "comfortable",
  );
  await expect(
    appearance.getByTestId("appearance-density").locator("option"),
  ).toHaveText(["Choose message density", "Compact", "Comfortable"]);
  await expect(appearance.getByTestId("appearance-message-size")).toHaveCount(
    0,
  );
  await expect(appearance.getByTestId("appearance-links-rich")).toHaveCount(0);
  await expect(appearance.getByTestId("appearance-threads-focus")).toHaveCount(
    0,
  );

  await appearance.getByRole("button", { name: "Browse named themes" }).click();
  await expect(page.getByTestId("settings-theme-catalog")).toBeVisible();
  await page.getByTestId("theme-catalog-github-light").click();
  await expect(page.getByTestId("settings-theme-preview")).toBeVisible();
  await page.getByTestId("appearance-preview-density").selectOption("compact");
  await expect(page.getByTestId("appearance-preview-density")).toHaveValue(
    "compact",
  );

  await page.getByTestId("theme-use").click();
  await expect(page.getByTestId("settings-theme-applied")).toBeVisible();
  await expect
    .poll(() => appearanceSnapshot(page))
    .toMatchObject({ theme: "github-light", density: "compact" });
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("buzz-theme")))
    .toBe("github-light");
});

test("theme preview shows the signed-in profile and cancel leaves preferences unchanged", async ({
  page,
}) => {
  await openAppearance(page);
  const profileName = await page.locator(".w20-nav-person strong").innerText();

  await page.getByRole("button", { name: "Browse named themes" }).click();
  await page.getByTestId("theme-catalog-buzz-dark").click();
  const preview = page.getByTestId("theme-workspace-preview");
  await expect(preview).toContainText("Preview content only");
  await expect(preview.getByTestId("theme-preview-person")).toHaveText(
    profileName,
  );
  await expect(page.getByTestId("theme-use")).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("buzz-theme")))
    .toBe("buzz");

  await page.getByRole("button", { name: "Cancel preview" }).click();
  await expect(page.getByTestId("settings-theme-catalog")).toBeVisible();
  await expect.poll(() => appearanceSnapshot(page)).toBeNull();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("buzz-theme")))
    .toBe("buzz");
});

test("failed workspace appearance save keeps the selected density", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("colony.appearance.v1:")) {
        throw new DOMException("Storage is unavailable", "QuotaExceededError");
      }
      originalSetItem.call(this, key, value);
    };
  });
  await installMockBridge(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("open-settings").click();
  await page.getByTestId("profile-popover-settings").click();
  await page.getByTestId("settings-group-appearance-group").click();

  const density = page.getByTestId("appearance-density");
  await expect(density).toBeVisible();
  await density.selectOption("compact");
  await page.getByRole("button", { name: "Save appearance" }).click();

  await expect(page.getByRole("alert")).toContainText("Your inputs are kept");
  await expect(density).toHaveValue("compact");
  await expect(
    page.getByRole("button", { name: "Save appearance" }),
  ).toBeVisible();
});

test("appearance choices remain usable at a narrow desktop width", async ({
  page,
}) => {
  await page.setViewportSize({ width: 840, height: 900 });
  await openAppearance(page);

  const density = page.getByTestId("appearance-density");
  await expect(density).toBeVisible();
  await density.selectOption("compact");
  await expect(density).toHaveValue("compact");
  await page.getByRole("button", { name: "Save appearance" }).click();
  await expect(page.getByTestId("settings-theme-applied")).toBeVisible();
});
