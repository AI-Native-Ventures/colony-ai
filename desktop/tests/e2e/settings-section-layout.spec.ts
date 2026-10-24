import { expect, test } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";
import { openSettings, selectSettingsSection } from "../helpers/settings";

test("settings use seven pages, find-a-setting search, remembered sections, and return navigation", async ({
  page,
}) => {
  await installMockBridge(page);
  await page.goto("/");
  await openSettings(page);
  await expect(page.getByTestId("settings-history-back")).toBeEnabled();
  await expect(page.getByTestId("settings-history-forward")).toBeDisabled();

  for (const group of [
    "account",
    "appearance-group",
    "preferences",
    "business",
    "agents-group",
    "blocks-templates",
    "app-devices",
  ]) {
    await expect(page.getByTestId(`settings-group-${group}`)).toBeVisible();
  }
  await expect(page.locator('[data-testid^="settings-group-"]')).toHaveCount(7);
  await expect(page.getByRole("tablist")).toHaveCount(1);

  await page.getByTestId("settings-search").fill("Harnesses");
  const result = page.getByRole("option", { name: "Harnesses, Agents" });
  await expect(result).toBeVisible();
  await result.click();
  await expect(page.getByTestId("settings-harnesses")).toBeVisible();
  await expect(page.getByTestId("settings-group-agents-group")).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  // Pages the owner cut have no way in, not even through search.
  await page.getByTestId("settings-search").fill("Channel templates");
  await expect(page.getByRole("option")).toHaveCount(0);
  await page.getByTestId("settings-search").fill("");

  await page.getByTestId("settings-group-appearance-group").click();
  await expect(page.getByTestId("settings-appearance")).toBeVisible();
  await page.getByTestId("settings-group-agents-group").click();
  await expect(page.getByTestId("settings-harnesses")).toBeVisible();

  await page.getByTestId("settings-group-business").click();
  await expect(page.getByTestId("settings-inner-work")).toHaveCount(0);
  await expect(page.getByTestId("settings-inner-connections")).toHaveCount(0);
  await page.getByTestId("settings-group-agents-group").click();
  await expect(page.getByTestId("settings-inner-ai-connections")).toHaveCount(
    0,
  );

  await page.getByTestId("settings-back-to-app").click();
  await expect(page.getByTestId("settings-view")).toHaveCount(0);
  await expect(page.getByTestId("app-sidebar")).toBeVisible();
});

test("prominent settings selection uses the saved accent", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.addInitScript(() => {
    localStorage.setItem("buzz-accent-color", "#3b82f6");
    localStorage.setItem("buzz-prominent-active-tab", "true");
  });
  await installMockBridge(page);
  await page.goto("/");
  await openSettings(page, "profile");

  const selectedGroup = page.getByTestId("settings-group-account");
  await expect(selectedGroup).toHaveAttribute("data-active", "true");
  const accent = await page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.background = "hsl(var(--colony-accent))";
    document.body.append(probe);
    const color = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return color;
  });
  await expect
    .poll(() =>
      selectedGroup.evaluate(
        (element) => getComputedStyle(element).backgroundColor,
      ),
    )
    .toBe(accent);
});

test("routes without a data-backed design fall back to Account profile", async ({
  page,
}) => {
  await installMockBridge(page);
  for (const section of [
    "compute-hosts",
    "blocks",
    "business-defaults",
    "business-connections",
    "ai-connections",
    "provider-connections",
    "voice",
    "channel-templates",
    "compute",
    "moderation",
    "audit",
    "settings/admin",
    "local-archive",
    "storage",
    "settings/themes",
    "settings/theme-preview",
    "settings/theme-applied",
    "archived-records",
    "administration",
  ]) {
    await page.goto(`/#/settings?section=${section}`);

    await expect(page.getByTestId("settings-view")).toBeVisible();
    await expect(page.getByTestId("settings-panel-profile")).toBeVisible();
    await expect(page.getByTestId(`settings-panel-${section}`)).toHaveCount(0);
    await expect(page.getByTestId("settings-history-back")).toBeDisabled();
    await expect(page.getByTestId("settings-history-forward")).toBeDisabled();
  }
});

test("account profile follows the design grid and type scale at desktop widths", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await installMockBridge(page, {
    relayRequiresMembership: true,
    relayRole: "owner",
    userStatus: "Available",
  });
  await page.goto("/");
  await openSettings(page, "profile");

  const profileTitle = page
    .getByTestId("settings-profile")
    .getByRole("heading", { name: "Profile", exact: true });
  await expect(profileTitle).toBeVisible();
  const profileCard = page.getByTestId("settings-account-profile-card");
  await expect(profileCard.getByLabel("Name")).toHaveValue(/\S/);
  await expect(profileCard.getByLabel("Email")).toHaveValue(/.+@.+/);
  await expect(page.getByTestId("account-profile-status")).toContainText(
    "Available",
  );
  await expect(profileCard.getByLabel("Timezone")).toHaveValue(/\S/);
  const businessCard = page.getByTestId("settings-account-business-card");
  await expect(businessCard.getByText("This business")).toBeVisible();
  await expect(businessCard.getByText("Your role · Owner")).toBeVisible();
  await expect(
    businessCard.getByRole("button", { name: "Business settings" }),
  ).toBeVisible();
  await expect(
    businessCard.getByRole("button", { name: "Members & roles" }),
  ).toBeVisible();

  const box = async (selector: string) =>
    page
      .locator(selector)
      .first()
      .evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          fontSize: Number.parseFloat(getComputedStyle(element).fontSize),
        };
      });
  const near = (actual: number, expected: number, label: string) =>
    expect(
      Math.abs(actual - expected),
      `${label}: expected ${expected}, received ${actual}`,
    ).toBeLessThanOrEqual(1);

  // Values from the Colony 3.0 SettingsAccount board at 1440 wide.
  const title = await box(".cs-page-title h1");
  near(title.x, 420, "title x");
  near(title.fontSize, 38, "title size");
  const card = await box('[data-testid="settings-account-profile-card"]');
  near(card.x, 420, "profile card x");
  near(card.width, 881, "profile card width");
  const nameInput = await box('[data-testid="profile-display-name"]');
  near(nameInput.x, 446, "name input x");
  near(nameInput.height, 46, "name input height");
  const business = await box('[data-testid="settings-account-business-card"]');
  near(business.x, 420, "business card x");
  near(business.width, 881, "business card width");
});

test("device privacy preferences apply at once with closed defaults", async ({
  page,
}) => {
  await installMockBridge(page);
  await page.goto("/");
  await openSettings(page, "privacy");

  const messageText = page.getByTestId("privacy-message-text");
  const typingActivity = page.getByTestId("privacy-typing-activity");
  await expect(messageText).not.toBeChecked();
  await expect(typingActivity).not.toBeChecked();

  await messageText.click();
  await typingActivity.click();
  await expect(messageText).toBeChecked();
  await expect(typingActivity).toBeChecked();
  const saved = await page.evaluate(() =>
    Object.entries(localStorage)
      .filter(([key]) => key.startsWith("colony.device-privacy.v1:"))
      .map(([key, value]) => [key, JSON.parse(value)]),
  );
  expect(saved).toHaveLength(1);
  expect(saved[0][0]).toMatch(/^colony\.device-privacy\.v1:[a-f0-9]+$/u);
  expect(saved[0][1]).toEqual({
    showMessageText: true,
    shareTypingActivity: true,
  });
});

test("device privacy save failure keeps the controls editable and says so", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("colony.device-privacy.v1:")) {
        throw new DOMException("Storage is unavailable", "QuotaExceededError");
      }
      originalSetItem.call(this, key, value);
    };
  });
  await installMockBridge(page);
  await page.goto("/");
  await openSettings(page, "privacy");

  const messageText = page.getByTestId("privacy-message-text");
  await messageText.click();

  await expect(page.getByRole("alert")).toContainText(
    "Could not save your privacy preferences",
  );
  await expect(messageText).not.toBeChecked();
  await expect(messageText).toBeEnabled();
});

test("Accessibility saves as it changes and restores motion and keyboard hints", async ({
  page,
}) => {
  await installMockBridge(page);
  await page.goto("/#/settings?section=accessibility");
  const panel = page.getByTestId("settings-accessibility");
  await expect(
    panel.getByRole("heading", { name: "Accessibility", exact: true }),
  ).toBeVisible();
  await expect(panel.getByTestId("settings-shortcuts")).toHaveCount(0);
  await expect(
    panel.getByRole("button", { name: "Save", exact: true }),
  ).toHaveCount(0);
  await panel.getByTestId("accessibility-motion-reduce").click();
  await panel.getByTestId("accessibility-keyboard-hints").click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-reduced-motion",
    "true",
  );
  await expect(page.locator("html")).toHaveAttribute(
    "data-keyboard-hints",
    "false",
  );
  await page.reload();
  await expect(
    panel.getByTestId("accessibility-motion-reduce"),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    panel.getByTestId("accessibility-keyboard-hints"),
  ).not.toBeChecked();
  await expect(page.locator("html")).toHaveAttribute(
    "data-reduced-motion",
    "true",
  );
  await page.getByTestId("settings-back-to-app").click();
  await page.getByTestId("section-actions-channels").click();
  const hint = page
    .getByRole("menuitem", { name: /^Browse channels/ })
    .locator("[data-keyboard-hint]");
  await expect(hint).toHaveCount(1);
  await expect(hint).toBeHidden();
});

test("Accessibility save failure preserves the durable and live preference", async ({
  page,
}) => {
  await installMockBridge(page);
  await page.goto("/#/settings?section=accessibility");
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "colony.accessibility.v1")
        throw new DOMException("Storage unavailable", "QuotaExceededError");
      original.call(this, key, value);
    };
  });
  const panel = page.getByTestId("settings-accessibility");
  await panel.getByTestId("accessibility-motion-reduce").click();
  await expect(panel.getByRole("alert")).toContainText("Could not save");
  await expect(page.locator("html")).toHaveAttribute(
    "data-reduced-motion",
    "false",
  );
  await expect(panel.getByTestId("accessibility-motion-reduce")).toBeEnabled();
  expect(
    await page.evaluate(() => localStorage.getItem("colony.accessibility.v1")),
  ).toBeNull();
});

test("People and access gives members a denied state and a way back", async ({
  page,
}) => {
  await installMockBridge(page, {
    relayRole: "member",
    relayRequiresMembership: true,
  });
  await page.goto("/#/settings?section=people");
  const panel = page.getByTestId("settings-community-members");
  await expect(panel).toContainText("Only workspace owners and administrators");
  await panel.getByRole("button", { name: "Back to business" }).click();
  await expect(page.getByTestId("settings-business-profile")).toBeVisible();
});

test("People and access shows permission loading before the denied state", async ({
  page,
}) => {
  await installMockBridge(page, {
    relayRole: "member",
    relayRequiresMembership: true,
  });
  await page.goto("/");
  await expect(page.getByTestId("app-sidebar")).toBeVisible();
  await page.evaluate(() => {
    window.__BUZZ_E2E_QUERY_CLIENT__?.removeQueries({
      queryKey: ["myRelayMembershipLookup"],
    });
    const original = window.__TAURI_INTERNALS__.invoke;
    window.__TAURI_INTERNALS__.invoke = async (command, args, options) => {
      if (command === "relay_requires_membership")
        await new Promise((resolve) => setTimeout(resolve, 1500));
      return original(command, args, options);
    };
  });
  await openSettings(page, "people");
  const panel = page.getByTestId("settings-community-members");
  await expect(panel.getByRole("status")).toContainText("Checking permissions");
  await expect(panel).toContainText("Only workspace owners and administrators");
});
