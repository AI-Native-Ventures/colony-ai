import { expect, test } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";
import { openSettings, selectSettingsSection } from "../helpers/settings";

test("settings use nine groups, inner search, remembered sections, and return navigation", async ({
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
    "administration",
    "app-devices",
    "storage-group",
  ]) {
    await expect(page.getByTestId(`settings-group-${group}`)).toBeVisible();
  }
  await expect(page.locator('[data-testid^="settings-group-"]')).toHaveCount(9);
  await expect(page.getByRole("tablist")).toHaveCount(1);

  await page.getByTestId("settings-search").fill("Channel templates");
  const result = page.getByRole("option", {
    name: "Channel templates, Blocks & templates",
  });
  await expect(result).toBeVisible();
  await result.click();
  await expect(page.getByTestId("settings-channel-templates")).toBeVisible();
  await expect(
    page.getByTestId("settings-group-blocks-templates"),
  ).toHaveAttribute("aria-pressed", "true");

  await selectSettingsSection(page, "harnesses");
  await expect(page.getByTestId("settings-harnesses")).toBeVisible();
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
  await page.getByTestId("settings-group-blocks-templates").click();
  await expect(page.getByTestId("settings-inner-blocks")).toHaveCount(0);
  await page.getByTestId("settings-group-app-devices").click();
  await expect(page.getByTestId("settings-inner-compute")).toHaveCount(0);

  await page.getByTestId("settings-back-to-app").click();
  await expect(page.getByTestId("settings-view")).toHaveCount(0);
  await expect(page.getByTestId("app-sidebar")).toBeVisible();
});

test("prominent settings selection uses the saved accent tint", async ({
  page,
}) => {
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
  await expect
    .poll(() =>
      selectedGroup.evaluate(
        (element) => getComputedStyle(element).backgroundColor,
      ),
    )
    .toBe("rgb(38, 85, 160)");
});

test("routes without a data-backed design fall back to Account profile", async ({
  page,
}) => {
  await installMockBridge(page);
  for (const section of [
    "compute",
    "compute-hosts",
    "blocks",
    "business-defaults",
    "business-connections",
    "ai-connections",
    "provider-connections",
  ]) {
    await page.goto(`/#/settings?section=${section}`);

    await expect(page.getByTestId("settings-view")).toBeVisible();
    await expect(page.getByTestId("settings-panel-profile")).toBeVisible();
    await expect(page.getByTestId(`settings-panel-${section}`)).toHaveCount(0);
    await expect(page.getByTestId("settings-history-back")).toBeDisabled();
    await expect(page.getByTestId("settings-history-forward")).toBeDisabled();
  }
});

test("archive follows the r19 title and empty state", async ({ page }) => {
  await installMockBridge(page, { archivedIdentities: [] });
  await page.goto("/");
  await openSettings(page, "archived-records");

  const archive = page.getByTestId("settings-archived-records");
  await expect(
    archive.getByRole("heading", { name: "Archive", exact: true }),
  ).toBeVisible();
  await expect(
    archive.getByRole("heading", { name: "Archived records", exact: true }),
  ).toBeVisible();
  await expect(archive).toContainText("No archived records.");
  await expect(archive).not.toContainText(
    "Identities archived from community discovery.",
  );
  await archive.getByTestId("settings-archive-back-to-today").click();
  await expect(page.getByTestId("settings-view")).toHaveCount(0);
});

test("account profile follows the r19 grid and type scale at desktop widths", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("buzz-sidebar-width", "238");
  });
  await installMockBridge(page, {
    relayRequiresMembership: true,
    relayRole: "owner",
    userStatus: "Available",
  });
  await page.goto("/");
  await openSettings(page, "profile");

  const profileTitle = page
    .getByTestId("settings-profile")
    .getByRole("heading", { name: "Your account", exact: true });
  await expect(profileTitle).toBeVisible();
  const profileCard = page.getByTestId("settings-account-profile-card");
  await expect(
    profileCard.getByRole("heading", { name: "Your profile", exact: true }),
  ).toBeVisible();
  await expect(profileCard.getByLabel("Name")).toHaveValue(/\S/);
  await expect(profileCard.getByLabel("Email address")).toHaveValue(/.+@.+/);
  await expect(profileCard.getByLabel("Status")).toHaveValue("Available");
  await expect(profileCard.getByLabel("Timezone")).toHaveValue(/\S/);
  const businessCard = page.getByTestId("settings-account-business-card");
  await expect(
    businessCard.getByRole("heading", { name: "This business", exact: true }),
  ).toBeVisible();
  await expect(businessCard.getByText("Owner", { exact: true })).toBeVisible();
  await expect(
    businessCard.getByRole("button", { name: "Business settings" }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator(".w20-account-card-title")
        .evaluateAll((elements) =>
          elements.map((element) => getComputedStyle(element).fontSize),
        ),
    )
    .toEqual(["16px", "16px"]);
  const titleFontSize = await profileTitle.evaluate(
    (element) => getComputedStyle(element).fontSize,
  );
  const breadcrumbLineHeights = await page
    .locator(".w20-topbar-title > span")
    .evaluateAll((elements) =>
      elements.map((element) => getComputedStyle(element).lineHeight),
    );
  const profileAvatarSize = await page
    .getByTestId("settings-profile-avatar")
    .evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    });

  expect(titleFontSize).toBe("27.2px");
  expect(breadcrumbLineHeights).toEqual(["18px", "18px"]);
  expect(profileAvatarSize).toEqual({ width: 23, height: 23 });

  for (const expected of [
    {
      viewport: { width: 1440, height: 900 },
      fieldLayer: { x: 1, y: 1, width: 1438, height: 898 },
      title: { x: 314, y: 172, width: 161.3125, height: 33.1875 },
      profileCard: { x: 314, y: 267.1875, width: 631.96875 },
      businessCard: { x: 973.96875, y: 267.1875, width: 383.03125 },
      nameField: { x: 339, y: 331.1875, width: 581.96875, height: 72.71875 },
      nameInput: { x: 339, y: 363.90625, width: 581.96875, height: 40 },
    },
    {
      viewport: { width: 1728, height: 1117 },
      fieldLayer: { x: 1, y: 1, width: 1726, height: 1115 },
      title: { x: 322, y: 176, width: 161.3125, height: 33.1875 },
      profileCard: { x: 322, y: 275.1875, width: 801.328125 },
      businessCard: { x: 1151.328125, y: 275.1875, width: 485.65625 },
      nameField: { x: 347, y: 339.1875, width: 751.328125, height: 72.71875 },
      nameInput: { x: 347, y: 371.90625, width: 751.328125, height: 40 },
    },
  ]) {
    await page.setViewportSize(expected.viewport);
    const geometry = await page.evaluate(() => {
      const bounds = (selector: string) => {
        const rect = document.querySelector(selector)?.getBoundingClientRect();
        if (!rect) throw new Error(`Missing settings geometry for ${selector}`);
        return {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        };
      };
      const firstProfileField = document.querySelector(
        '[data-testid="settings-profile"] .w20-account-field',
      );
      const firstProfileFieldRect = firstProfileField?.getBoundingClientRect();
      if (!firstProfileFieldRect) {
        throw new Error("Missing first account profile field");
      }
      return {
        fieldLayer: bounds(".buzz-theme-gradient-underlay"),
        fieldFrame: (() => {
          const layer = document.querySelector(".buzz-theme-gradient-layer");
          if (!layer) throw new Error("Missing settings field frame");
          const style = getComputedStyle(layer);
          const border = getComputedStyle(layer, "::after");
          return {
            rootBackground: getComputedStyle(document.documentElement)
              .backgroundColor,
            borderRadius: style.borderRadius,
            overflow: style.overflow,
            frameRadius: border.borderTopLeftRadius,
            borderWidth: border.borderTopWidth,
            borderColor: border.borderTopColor,
          };
        })(),
        title: bounds('[data-testid="settings-profile"] h1'),
        profileCard: bounds('[data-testid="settings-account-profile-card"]'),
        businessCard: bounds('[data-testid="settings-account-business-card"]'),
        nameField: {
          x: firstProfileFieldRect.x,
          y: firstProfileFieldRect.y,
          width: firstProfileFieldRect.width,
          height: firstProfileFieldRect.height,
        },
        nameInput: bounds('[data-testid="profile-display-name"]'),
      };
    });
    const expectCoordinate = (actual: number, expectedValue: number) => {
      expect(
        Math.abs(actual - expectedValue),
        `Expected ${expectedValue}px, received ${actual}px`,
      ).toBeLessThan(1);
    };
    expectCoordinate(geometry.fieldLayer.x, expected.fieldLayer.x);
    expectCoordinate(geometry.fieldLayer.y, expected.fieldLayer.y);
    expectCoordinate(geometry.fieldLayer.width, expected.fieldLayer.width);
    expectCoordinate(geometry.fieldLayer.height, expected.fieldLayer.height);
    expect(geometry.fieldFrame).toEqual({
      rootBackground: "rgba(0, 0, 0, 0)",
      borderRadius: "12px",
      overflow: "hidden",
      frameRadius: "12px",
      borderWidth: "1px",
      borderColor: "rgb(220, 212, 226)",
    });
    expectCoordinate(geometry.title.x, expected.title.x);
    expectCoordinate(geometry.title.y, expected.title.y);
    expectCoordinate(geometry.title.width, expected.title.width);
    expectCoordinate(geometry.title.height, expected.title.height);
    expectCoordinate(geometry.profileCard.x, expected.profileCard.x);
    expectCoordinate(geometry.profileCard.y, expected.profileCard.y);
    expectCoordinate(geometry.profileCard.width, expected.profileCard.width);
    expectCoordinate(geometry.businessCard.x, expected.businessCard.x);
    expectCoordinate(geometry.businessCard.y, expected.businessCard.y);
    expectCoordinate(geometry.businessCard.width, expected.businessCard.width);
    expectCoordinate(geometry.nameField.x, expected.nameField.x);
    expectCoordinate(geometry.nameField.y, expected.nameField.y);
    expectCoordinate(geometry.nameField.width, expected.nameField.width);
    expectCoordinate(geometry.nameField.height, expected.nameField.height);
    expectCoordinate(geometry.nameInput.x, expected.nameInput.x);
    expectCoordinate(geometry.nameInput.y, expected.nameInput.y);
    expectCoordinate(geometry.nameInput.width, expected.nameInput.width);
    expectCoordinate(geometry.nameInput.height, expected.nameInput.height);
  }
});

test("appearance controls save a complete scoped snapshot and retain density", async ({
  page,
}) => {
  await installMockBridge(page);
  await page.goto("/");
  await openSettings(page, "appearance");

  await expect(page.getByTestId("appearance-density")).toBeVisible();
  const innerTabIndicatorColor = () =>
    page
      .getByTestId("settings-inner-appearance")
      .evaluate(
        (element) => getComputedStyle(element, "::after").backgroundColor,
      );
  const sharedChrome = () =>
    page.evaluate(() => {
      const read = (selector: string) => {
        const element = document.querySelector(selector);
        if (!element) throw new Error(`Missing settings chrome: ${selector}`);
        return getComputedStyle(element);
      };
      const avatar = read('[data-testid="settings-profile-avatar"]');
      return {
        sectionLabelTracking: read(".w20-nav-heading").letterSpacing,
        searchTextColor: read(".w20-nav-search input").color,
        breadcrumbColor: read(".w20-topbar-title > span").color,
        avatar: {
          backgroundColor: avatar.backgroundColor,
          color: avatar.color,
          fontSize: avatar.fontSize,
          fontWeight: avatar.fontWeight,
          borderRadius: avatar.borderRadius,
        },
      };
    });
  expect(await sharedChrome()).toEqual({
    sectionLabelTracking: "-0.22px",
    searchTextColor: "rgb(40, 37, 50)",
    breadcrumbColor: "rgb(121, 116, 127)",
    avatar: {
      backgroundColor: "rgb(236, 229, 237)",
      color: "rgb(121, 103, 130)",
      fontSize: "9.44px",
      fontWeight: "600",
      borderRadius: "7px",
    },
  });
  await expect.poll(innerTabIndicatorColor).toBe("rgb(38, 85, 160)");

  await page.getByTestId("appearance-mode-dark").click();
  await expect(page.getByTestId("appearance-mode-dark")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.classList.contains("dark")),
    )
    .toBe(true);
  await expect.poll(innerTabIndicatorColor).toBe("rgb(157, 193, 251)");
  await expect.poll(sharedChrome).toEqual({
    sectionLabelTracking: "-0.22px",
    searchTextColor: "rgb(236, 230, 239)",
    breadcrumbColor: "rgb(163, 154, 169)",
    avatar: {
      backgroundColor: "rgb(69, 58, 74)",
      color: "rgb(209, 191, 216)",
      fontSize: "9.44px",
      fontWeight: "600",
      borderRadius: "7px",
    },
  });
  const fieldBorderColor = await page
    .locator(".buzz-theme-gradient-layer")
    .evaluate((element) => getComputedStyle(element, "::after").borderTopColor);
  expect(fieldBorderColor).toBe("rgb(73, 57, 81)");
  const rootBackground = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement).backgroundColor;
    const layer = document.querySelector(".buzz-theme-gradient-layer");
    if (!layer) throw new Error("Missing settings field frame");
    return {
      root,
      border: getComputedStyle(layer, "::after").borderTopColor,
    };
  });
  expect(rootBackground).toEqual({
    root: "rgba(0, 0, 0, 0)",
    border: "rgb(73, 57, 81)",
  });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          Object.keys(localStorage).filter(
            (key) =>
              key.startsWith("colony.appearance.v1:") &&
              !key.endsWith(":last-business"),
          ).length,
      ),
    )
    .toBe(1);
  const businessSnapshot = await page.evaluate(() => {
    const key = Object.keys(localStorage).find(
      (candidate) =>
        candidate.startsWith("colony.appearance.v1:") &&
        !candidate.endsWith(":last-business") &&
        !candidate.endsWith(":global-conversations"),
    );
    return key ? JSON.parse(localStorage.getItem(key) ?? "null") : null;
  });
  expect(businessSnapshot).toMatchObject({
    followSystem: false,
    glassBackground: false,
    prominentActiveTab: false,
  });
});
