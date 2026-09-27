import { expect, test, type Page } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";

const SHOTS = "test-results/buzz-theme";
const THEME_STORAGE_KEY = "buzz-theme";
const GLASS_BACKGROUND_STORAGE_KEY = "buzz-glass-background";
const GLASS_OPACITY_STORAGE_KEY = "buzz-glass-opacity";
const PROMINENT_ACTIVE_TAB_STORAGE_KEY = "buzz-prominent-active-tab";
const FONT_SIZE_STORAGE_KEY = "buzz.appearance.fontSize";
const MOCK_PUBKEY = "deadbeef".repeat(8);
const GENERAL_CHANNEL_ID = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";

/**
 * Seed the active theme into localStorage BEFORE the mock bridge installs so
 * ThemeProvider reads it on first mount (init scripts run in registration
 * order; React reads state on mount, which the bridge triggers).
 */
async function seedTheme(page: Page, theme: string) {
  await page.addInitScript(
    ({ key, value }) => {
      window.localStorage.setItem(key, value);
    },
    { key: THEME_STORAGE_KEY, value: theme },
  );
}

async function seedIconChannelSection(page: Page) {
  await page.addInitScript(
    ({ channelId, pubkey }) => {
      window.localStorage.setItem(
        `buzz-channel-sections.v1:${pubkey}`,
        JSON.stringify({
          version: 1,
          sections: [
            {
              id: "alignment-section",
              name: "Team channels",
              icon: "📌",
              order: 0,
            },
          ],
          assignments: { [channelId]: "alignment-section" },
        }),
      );
    },
    { channelId: GENERAL_CHANNEL_ID, pubkey: MOCK_PUBKEY },
  );
}

async function openChannel(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");
  await expect(page.getByTestId("app-sidebar")).toBeVisible();
}

async function resolveSidebarColor(
  page: Page,
  property: "background-color" | "color",
  value: string,
) {
  return page
    .locator('[data-testid="app-sidebar"], [data-testid="settings-sidebar"]')
    .first()
    .evaluate(
      (sidebar, { property, value }) => {
        const probe = document.createElement("span");
        probe.style.setProperty(property, value);
        sidebar.append(probe);
        const color = getComputedStyle(probe).getPropertyValue(property);
        probe.remove();
        return color;
      },
      { property, value },
    );
}

async function expectBuzzSidebarPalette(page: Page, mode: "light" | "dark") {
  const mutedColor = await resolveSidebarColor(
    page,
    "color",
    "hsl(var(--colony-sidebar-foreground) / 0.72)",
  );
  const secondaryTextColor = await resolveSidebarColor(
    page,
    "color",
    "var(--buzz-muted-foreground)",
  );
  const searchSurface = await resolveSidebarColor(
    page,
    "background-color",
    "var(--buzz-search-surface)",
  );
  const rowHoverSurface = "rgba(255, 255, 255, 0.33)";
  const directMessageHoverSurface = await resolveSidebarColor(
    page,
    "background-color",
    "var(--buzz-hover-surface)",
  );
  const activeSurface =
    mode === "light" ? "rgb(36, 87, 168)" : "rgb(55, 107, 181)";
  const search = page.getByTestId("open-search");
  const pinnedHeader = page.getByTestId("sidebar-pinned-header");
  const sidebarScroller = page.locator(".buzz-sidebar-scrollbar");
  const scrollContent = page.getByTestId("sidebar-scroll-content");
  const primaryMenu = page.getByTestId("sidebar-primary-menu");
  const sectionLabel = page
    .locator('[data-sidebar="group-label"]')
    .filter({ hasText: "Channels" })
    .first();

  await expect(sectionLabel).toHaveCSS("color", mutedColor);
  await expect(search).toHaveCSS("background-color", searchSurface);
  await expect(search.locator("svg").first()).toHaveClass(
    /text-sidebar-foreground\/45/,
  );
  await expect(search.locator("span").first()).toHaveClass(
    /text-sidebar-foreground\/55/,
  );
  await expect(pinnedHeader).toHaveCSS("padding-top", "12px");
  await expect(pinnedHeader).toHaveCSS("padding-bottom", "16px");
  await expect(pinnedHeader).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(pinnedHeader).toHaveCSS("margin-left", "3px");
  await expect(pinnedHeader).toHaveCSS("margin-right", "3px");
  await expect(pinnedHeader).toHaveCSS("padding-left", "8px");
  await expect(pinnedHeader).toHaveCSS("padding-right", "8px");
  await expect(sidebarScroller).toHaveCSS("padding-left", "0px");
  await expect(sidebarScroller).toHaveCSS("padding-right", "0px");
  await expect(scrollContent).toHaveCSS("padding-left", "3px");
  await expect(scrollContent).toHaveCSS("padding-right", "3px");
  const pinnedSpacerColor = await pinnedHeader.evaluate(
    (element) => getComputedStyle(element, "::before").backgroundColor,
  );
  expect(pinnedSpacerColor).toBe("rgba(0, 0, 0, 0)");
  await expect(sidebarScroller.getByTestId("open-agents-view")).toBeVisible();
  const searchBox = await search.boundingBox();
  const pinnedHeaderBox = await pinnedHeader.boundingBox();
  const primaryMenuBox = await primaryMenu.boundingBox();
  const primaryRowBox = await page
    .getByTestId("open-agents-view")
    .boundingBox();
  const activeRowBox = await page.getByTestId("channel-general").boundingBox();
  const hoverRowBox = await page.getByTestId("channel-random").boundingBox();
  const scrollContentBox = await scrollContent.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return { left: box.left, right: box.right };
  });
  expect(searchBox).not.toBeNull();
  expect(pinnedHeaderBox).not.toBeNull();
  expect(primaryMenuBox).not.toBeNull();
  expect(primaryRowBox).not.toBeNull();
  expect(activeRowBox).not.toBeNull();
  expect(hoverRowBox).not.toBeNull();
  if (
    !searchBox ||
    !pinnedHeaderBox ||
    !primaryMenuBox ||
    !primaryRowBox ||
    !activeRowBox ||
    !hoverRowBox
  ) {
    throw new Error("Sidebar search or primary navigation geometry is missing");
  }
  expect(
    Math.abs(primaryMenuBox.y - (searchBox.y + searchBox.height) - 8),
  ).toBeLessThanOrEqual(1);
  expect(
    pinnedHeaderBox.y +
      pinnedHeaderBox.height -
      (searchBox.y + searchBox.height),
  ).toBe(16);
  for (const rowBox of [primaryRowBox, activeRowBox, hoverRowBox]) {
    expect(Math.abs(rowBox.x - searchBox.x)).toBeLessThanOrEqual(0.5);
    // Linux CI reserves a classic scrollbar gutter while macOS uses an
    // overlay scrollbar. Compare each row to its usable scroll area so the
    // alignment check remains platform-independent.
    const rowLeftSpacing = rowBox.x - scrollContentBox.left;
    const rowRightSpacing = scrollContentBox.right - (rowBox.x + rowBox.width);
    expect(Math.abs(rowLeftSpacing - rowRightSpacing)).toBeLessThanOrEqual(0.5);
  }
  await expect(page.locator("[data-buzz-sidebar-secondary]").first()).toHaveCSS(
    "color",
    secondaryTextColor,
  );
  await expect(page.locator('[data-sidebar="trigger"]')).toHaveClass(
    /text-sidebar-foreground\/70/,
  );
  await expect(page.getByTestId("channel-general")).not.toHaveCSS(
    "color",
    mutedColor,
  );
  await expect(page.getByTestId("channel-general")).toHaveCSS(
    "font-weight",
    "400",
  );
  await expect(
    page.getByTestId("channel-general").locator("[data-sidebar-row-label]"),
  ).toHaveCSS("opacity", "1");
  await page.mouse.move(600, 100);
  await expect(page.getByTestId("channel-general")).toHaveCSS(
    "background-color",
    activeSurface,
  );
  const hoverChannel = page.getByTestId("channel-random");
  await hoverChannel.hover();
  await expect(hoverChannel).toHaveCSS("background-color", rowHoverSurface);

  const firstDmItem = page
    .getByTestId("dm-list")
    .locator('[data-sidebar="menu-item"]')
    .first();
  const firstDmButton = firstDmItem.locator('[data-sidebar="menu-button"]');
  const firstDmLabel = firstDmButton.locator("[data-sidebar-row-label]");
  const closeDmButton = firstDmItem.getByRole("button", {
    name: "Close direct message",
  });
  const hoverChannelLabel = hoverChannel.locator("[data-sidebar-row-label]");
  const hoverChannelIcon = hoverChannel.locator("svg").first();
  const agentsButton = page.getByTestId("open-agents-view");
  const agentsLabel = agentsButton.locator('[data-sidebar="menu-label"]');
  const agentsIcon = agentsButton.locator("svg").first();
  const sidebarForeground = await page
    .getByTestId("app-sidebar")
    .evaluate((element) => getComputedStyle(element).color);
  const channelForeground = await hoverChannel.evaluate(
    (element) => getComputedStyle(element).color,
  );
  const directMessageForeground = await firstDmButton.evaluate(
    (element) => getComputedStyle(element).color,
  );
  expect(channelForeground).toBe(directMessageForeground);
  await expect(agentsButton).toHaveCSS("color", sidebarForeground);
  await expect(hoverChannelLabel).toHaveCSS("opacity", "0.8");
  await expect(hoverChannelIcon).toHaveCSS("opacity", "0.8");
  await expect(firstDmButton).toHaveCSS("opacity", "1");
  await expect(firstDmLabel).toHaveCSS("opacity", "0.8");
  await expect(agentsLabel).toHaveCSS("opacity", "0.8");
  await expect(agentsIcon).toHaveCSS("opacity", "0.8");
  await firstDmItem.hover();
  await expect(closeDmButton).toBeVisible();
  await closeDmButton.hover();
  await expect(firstDmButton).toHaveCSS(
    "background-color",
    directMessageHoverSurface,
  );

  const scrollbarThumbColor = await sidebarScroller.evaluate(
    (element) =>
      getComputedStyle(element, "::-webkit-scrollbar-thumb").backgroundColor,
  );
  expect(scrollbarThumbColor).toBe(searchSurface);
}

async function expectIconlessSectionTitleAligned(
  page: Page,
  listTestId: "stream-list" | "dm-list",
) {
  const titleBox = await page
    .getByTestId(`${listTestId}-section-label`)
    .locator("[data-sidebar-section-title]")
    .boundingBox();
  const firstRowIconX = await page
    .getByTestId(listTestId)
    .locator('[data-sidebar="menu-button"]')
    .first()
    .evaluate((element) => {
      const box = element.getBoundingClientRect();
      const paddingLeft = Number.parseFloat(
        getComputedStyle(element).paddingLeft,
      );
      return box.x + paddingLeft;
    });

  expect(titleBox).not.toBeNull();
  if (!titleBox) {
    throw new Error(`Sidebar section ${listTestId} is missing label geometry`);
  }
  expect(Math.abs(titleBox.x - firstRowIconX)).toBeLessThanOrEqual(0.5);
}

async function expectBuzzContentShadow(page: Page, mode: "light" | "dark") {
  const effects = await page.evaluate(() => {
    const shell = document.querySelector(".buzz-huddle-shell");
    const content = document.querySelector("[data-buzz-content-surface]");
    const shadowViewport = document.querySelector(
      "[data-buzz-shadow-viewport]",
    );
    return {
      appStroke: shell ? getComputedStyle(shell, "::before").boxShadow : "",
      contentShadow: content ? getComputedStyle(content).boxShadow : "",
      shadowViewportOverflow: shadowViewport
        ? getComputedStyle(shadowViewport).overflow
        : "",
    };
  });

  expect(effects.appStroke).toBe("none");
  if (mode === "light") {
    expect(effects.contentShadow).toContain("5px 35px");
    expect(effects.contentShadow).toContain("rgba(118, 96, 137, 0.043)");
    expect(effects.shadowViewportOverflow).toBe("visible");
  } else {
    expect(effects.contentShadow).not.toContain("4px");
    expect(effects.contentShadow).not.toContain("rgba(255, 255, 255, 0.07)");
    expect(effects.shadowViewportOverflow).toBe("hidden");
  }
}

async function expectBuzzGradientPaint(
  page: Page,
  mode: "light" | "dark",
): Promise<string> {
  if ((await page.getByTestId("settings-view").count()) > 0) {
    const underlay = page.locator(".buzz-theme-gradient-underlay").first();
    const backgroundImage = await underlay.evaluate(
      (element) => getComputedStyle(element).backgroundImage,
    );
    expect(backgroundImage).toContain(`colony-field-${mode}.svg`);
    return backgroundImage;
  }

  await expect
    .poll(() =>
      page
        .locator('[data-buzz-gradient="light"]')
        .evaluate((element) => getComputedStyle(element).opacity),
    )
    .toBe(mode === "light" ? "1" : "0");
  await expect
    .poll(() =>
      page
        .locator('[data-buzz-gradient="dark"]')
        .evaluate((element) => getComputedStyle(element).opacity),
    )
    .toBe(mode === "dark" ? "1" : "0");

  const paint = await page.evaluate(() => {
    const root = document.documentElement;
    const appSurface = document.querySelector(".buzz-huddle-app-surface");
    const lightLayer = document.querySelector('[data-buzz-gradient="light"]');
    const darkLayer = document.querySelector('[data-buzz-gradient="dark"]');
    const sidebarRoot = document.querySelector(
      '[data-testid="app-sidebar"], [data-testid="settings-sidebar"]',
    );
    const sidebarSurface =
      sidebarRoot?.querySelector('[data-sidebar="sidebar"]') ?? sidebarRoot;
    const appStyles = appSurface ? getComputedStyle(appSurface) : null;
    const lightStyles = lightLayer ? getComputedStyle(lightLayer) : null;
    const darkStyles = darkLayer ? getComputedStyle(darkLayer) : null;
    return {
      isDark: root.classList.contains("dark"),
      theme: root.getAttribute("data-buzz-theme"),
      surfaceImage: appStyles?.backgroundImage ?? "",
      lightImage: lightStyles?.backgroundImage ?? "",
      lightOpacity: lightStyles?.opacity ?? "",
      darkImage: darkStyles?.backgroundImage ?? "",
      darkOpacity: darkStyles?.opacity ?? "",
      sidebarImage: sidebarSurface
        ? getComputedStyle(sidebarSurface).backgroundImage
        : "",
    };
  });

  expect(paint.theme).toBe(mode === "light" ? "buzz" : "buzz-dark");
  expect(paint.isDark).toBe(mode === "dark");
  expect(paint.surfaceImage).toBe("none");
  expect(paint.lightImage).not.toBe("");
  expect(paint.lightImage).not.toBe("none");
  expect(paint.darkImage).not.toBe("");
  expect(paint.darkImage).not.toBe("none");
  expect(paint.lightImage).not.toBe(paint.darkImage);
  expect(paint.lightOpacity).toBe(mode === "light" ? "1" : "0");
  expect(paint.darkOpacity).toBe(mode === "dark" ? "1" : "0");
  expect(paint.sidebarImage).toBe("none");
  return mode === "light" ? paint.lightImage : paint.darkImage;
}

async function expectBuzzSettingsPalette(page: Page, mode: "light" | "dark") {
  const mutedColor = await resolveSidebarColor(
    page,
    "color",
    "var(--buzz-muted-foreground)",
  );
  const sidebar = page.getByTestId("settings-sidebar");
  const sectionLabel = sidebar
    .locator(".w20-nav-heading")
    .filter({ hasText: "Personal" });

  await expect(sectionLabel).toHaveCSS("color", mutedColor);
  await expect(
    sidebar.locator('.w20-nav-item[data-active="true"]'),
  ).not.toHaveCSS("color", mutedColor);

  await expectBuzzGradientPaint(page, mode);

  const version = page.getByTestId("settings-version");
  if ((await version.count()) > 0) {
    await expect(version).toHaveCSS("color", mutedColor);
  }
}

async function expectAppliedBuzzTheme(
  page: Page,
  themeName: "buzz" | "buzz-dark",
  storedTheme: "buzz" | "buzz-dark" = themeName,
) {
  const isDark = themeName === "buzz-dark";
  await expect
    .poll(() =>
      page.evaluate((storageKey) => {
        const root = document.documentElement;
        const styles = getComputedStyle(root);
        return {
          storedTheme: window.localStorage.getItem(storageKey),
          isDark: root.classList.contains("dark"),
          buzzTheme: root.getAttribute("data-buzz-theme"),
          gradientTop: styles.getPropertyValue("--buzz-gradient-top").trim(),
          gradientBottom: styles
            .getPropertyValue("--buzz-gradient-bottom")
            .trim(),
        };
      }, THEME_STORAGE_KEY),
    )
    .toEqual({
      storedTheme,
      isDark,
      buzzTheme: themeName,
      gradientTop: isDark ? "#38273f" : "#fae7ed",
      gradientBottom: isDark ? "#223570" : "#94b4fa",
    });
}

async function emitNativeThemeChange(page: Page, theme: "light" | "dark") {
  await page.evaluate(async (nextTheme) => {
    const tauriWindow = window as typeof window & {
      __TAURI_INTERNALS__?: {
        invoke?: (
          command: string,
          payload?: Record<string, unknown>,
        ) => Promise<unknown>;
      };
    };
    const invoke = tauriWindow.__TAURI_INTERNALS__?.invoke;
    if (!invoke) throw new Error("Mock Tauri invoke bridge is unavailable.");
    await invoke("plugin:event|emit", {
      event: "tauri://theme-changed",
      payload: nextTheme,
    });
  }, theme);
}

test("buzz light sidebar gradient", async ({ page }) => {
  await seedTheme(page, "buzz");
  await installMockBridge(page);
  await openChannel(page);
  await expectBuzzGradientPaint(page, "light");
  await expectBuzzSidebarPalette(page, "light");
  await expectBuzzContentShadow(page, "light");
  await expectIconlessSectionTitleAligned(page, "stream-list");
  await expectIconlessSectionTitleAligned(page, "dm-list");
  await waitForAnimations(page);
  await page
    .getByTestId("app-sidebar")
    .screenshot({ path: `${SHOTS}/01-buzz-light-sidebar.png` });
});

test("buzz dark sidebar gradient", async ({ page }) => {
  await seedTheme(page, "buzz-dark");
  await installMockBridge(page);
  await openChannel(page);
  await expectBuzzGradientPaint(page, "dark");
  await expectBuzzSidebarPalette(page, "dark");
  await expectBuzzContentShadow(page, "dark");
  await expectIconlessSectionTitleAligned(page, "stream-list");
  await expectIconlessSectionTitleAligned(page, "dm-list");
  await expect(page.locator("[data-buzz-content-surface]")).toHaveCSS(
    "background-color",
    "rgb(33, 30, 38)",
  );
  await waitForAnimations(page);
  await page
    .getByTestId("app-sidebar")
    .screenshot({ path: `${SHOTS}/02-buzz-dark-sidebar.png` });
});

test("custom section icon and name align with channel columns", async ({
  page,
}) => {
  await seedTheme(page, "buzz");
  await seedIconChannelSection(page);
  await installMockBridge(page);
  await openChannel(page);

  const sectionIconBox = await page
    .getByTestId("section-icon-alignment-section")
    .boundingBox();
  const sectionTitleBox = await page
    .getByTestId("section-title-alignment-section")
    .boundingBox();
  const channelButton = page.getByTestId("channel-general");
  const channelIconBox = await channelButton
    .locator("svg")
    .first()
    .boundingBox();
  const channelTitleBox = await channelButton
    .locator("[data-sidebar-row-label]")
    .boundingBox();

  expect(sectionIconBox).not.toBeNull();
  expect(sectionTitleBox).not.toBeNull();
  expect(channelIconBox).not.toBeNull();
  expect(channelTitleBox).not.toBeNull();
  if (
    !sectionIconBox ||
    !sectionTitleBox ||
    !channelIconBox ||
    !channelTitleBox
  ) {
    throw new Error("Custom section alignment geometry is missing");
  }
  expect(Math.abs(sectionIconBox.x - channelIconBox.x)).toBeLessThanOrEqual(
    0.5,
  );
  expect(Math.abs(sectionTitleBox.x - channelTitleBox.x)).toBeLessThanOrEqual(
    0.5,
  );
});

async function openAppearance(
  page: Page,
  mode: "system" | "light" | "dark" = "light",
) {
  // Settings renders at the AppShell level; open it via the profile card
  // button, then select the Appearance section.
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("open-settings").click();
  await page.getByTestId("profile-popover-settings").click();
  await page.getByTestId("settings-group-appearance-group").click();
  const panel = page.getByTestId("settings-appearance");
  await expect(panel).toBeVisible({ timeout: 10_000 });
  await page.getByTestId(`appearance-mode-${mode}`).click();
  await waitForAnimations(page);
  return panel;
}

test("appearance shows the frozen controls in their designed sections", async ({
  page,
}) => {
  await seedTheme(page, "buzz");
  await installMockBridge(page);
  await openAppearance(page, "light");

  const appearance = page.getByTestId("settings-appearance");
  await expect(
    appearance.getByRole("heading", { name: "Make yourself at home." }),
  ).toBeVisible();
  await expect(appearance.getByText("Only you", { exact: true })).toBeVisible();
  await expect(appearance.getByTestId("appearance-open-themes")).toBeVisible();
  await expect(appearance.getByTestId("appearance-mode-system")).toBeVisible();
  await expect(
    appearance.getByTestId("appearance-theme-default"),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(appearance.getByTestId("appearance-accent-blue")).toBeVisible();
  await expect(appearance.getByTestId("appearance-glass")).toBeVisible();
  await expect(appearance.getByTestId("appearance-prominent")).toBeVisible();
  await expect(appearance.getByTestId("appearance-message-size")).toBeVisible();
  await expect(appearance.getByTestId("appearance-density")).toBeVisible();
  await expect(appearance.getByTestId("appearance-links-rich")).toBeVisible();
  await expect(
    appearance.getByTestId("appearance-threads-focus"),
  ).toBeVisible();

  const sectionOrder = await appearance
    .locator(".ap-section h2")
    .evaluateAll((headings) =>
      headings.map((heading) => heading.firstChild?.textContent?.trim()),
    );
  expect(sectionOrder).toEqual(["Appearance", "Window", "Conversations"]);
});

test("text size, message size, and density save to their own scopes", async ({
  page,
}) => {
  await seedTheme(page, "buzz");
  await installMockBridge(page);
  await openAppearance(page, "light");

  const readConversations = () =>
    page.evaluate(() => {
      const key = Object.keys(localStorage).find((candidate) =>
        candidate.endsWith(":global-conversations"),
      );
      return key ? JSON.parse(localStorage.getItem(key) ?? "null") : null;
    });
  await page.getByTestId("appearance-message-size").selectOption("larger");
  await page.getByTestId("appearance-density").selectOption("spacious");
  await expect
    .poll(readConversations)
    .toMatchObject({ messageSize: "larger", density: "spacious" });

  await page.getByTestId("settings-inner-accessibility").click();
  const accessibility = page.getByTestId("settings-accessibility");
  await expect(accessibility).toBeVisible();
  await expect(
    accessibility.getByRole("group", { name: "Text size" }),
  ).toBeVisible();
  await accessibility
    .getByRole("button", { name: "Larger", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-font-size",
    "larger",
  );
  await expect
    .poll(() =>
      page.evaluate((key) => localStorage.getItem(key), FONT_SIZE_STORAGE_KEY),
    )
    .toBe("larger");
  await expect
    .poll(readConversations)
    .toMatchObject({ messageSize: "larger", density: "spacious" });
});

test("appearance picker: system tab (Buzz follows OS)", async ({ page }) => {
  await seedTheme(page, "buzz");
  await installMockBridge(page);
  const panel = await openAppearance(page, "system");
  await panel.screenshot({ path: `${SHOTS}/03-picker-system.png` });
});

test("appearance picker: light tab (Buzz)", async ({ page }) => {
  await seedTheme(page, "buzz");
  await installMockBridge(page);
  const panel = await openAppearance(page, "light");
  await panel.screenshot({ path: `${SHOTS}/04-picker-light.png` });
});

test("appearance picker: dark tab (Buzz Dark)", async ({ page }) => {
  await seedTheme(page, "buzz-dark");
  await installMockBridge(page);
  const panel = await openAppearance(page, "dark");
  await panel.screenshot({ path: `${SHOTS}/05-picker-dark.png` });
});

test("settings nav uses Buzz active pill + hover (light)", async ({ page }) => {
  await seedTheme(page, "buzz");
  await installMockBridge(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("open-settings").click();
  await page.getByTestId("profile-popover-settings").click();
  const sidebar = page.getByTestId("settings-sidebar");
  await expect(sidebar).toBeVisible({ timeout: 10_000 });
  const profileRow = page.getByTestId("settings-group-account");
  const profileLabel = profileRow.locator(".truncate");
  await expect(profileRow).toHaveAttribute("data-active", "true");
  await expect(profileRow).toHaveCSS("font-weight", "700");
  const selectedLabelBox = await profileLabel.boundingBox();
  // Appearance is the active section here; its nav row uses the Buzz
  // selected surface (data-active=true), matching the Left Nav treatment.
  await page.getByTestId("settings-group-appearance-group").click();
  await expect(profileRow).toHaveCSS("font-weight", "400");
  const unselectedLabelBox = await profileLabel.boundingBox();
  expect(selectedLabelBox).not.toBeNull();
  expect(unselectedLabelBox).not.toBeNull();
  if (!selectedLabelBox || !unselectedLabelBox) {
    throw new Error("Settings nav label geometry is missing");
  }
  expect(Math.abs(selectedLabelBox.width - unselectedLabelBox.width)).toBe(0);
  await expectBuzzSettingsPalette(page, "light");
  const activeRow = page.getByTestId("settings-group-appearance-group");
  await expect(activeRow).toHaveAttribute("data-active", "true");
  await waitForAnimations(page);
  await sidebar.screenshot({ path: `${SHOTS}/06-settings-nav-light.png` });
});

test("settings nav uses Buzz active pill + hover (dark)", async ({ page }) => {
  await seedTheme(page, "buzz-dark");
  await installMockBridge(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("open-settings").click();
  await page.getByTestId("profile-popover-settings").click();
  const sidebar = page.getByTestId("settings-sidebar");
  await expect(sidebar).toBeVisible({ timeout: 10_000 });
  await page.getByTestId("settings-group-appearance-group").click();
  await expectBuzzSettingsPalette(page, "dark");
  await expect(page.getByTestId("settings-content-surface")).toHaveCSS(
    "background-color",
    "rgb(33, 30, 38)",
  );
  await waitForAnimations(page);
  await sidebar.screenshot({ path: `${SHOTS}/07-settings-nav-dark.png` });
  await page.getByTestId("settings-view").screenshot({
    path: `${SHOTS}/09-settings-content-dark.png`,
  });
});

test("prominent active tab is opt-in and switches selection surfaces", async ({
  page,
}) => {
  await seedTheme(page, "buzz");
  await installMockBridge(page);
  await openAppearance(page, "light");

  const root = page.locator("html");
  const activeRow = page.getByTestId("settings-group-appearance-group");
  const toggle = page.getByTestId("appearance-prominent");
  const subtleSurface = await resolveSidebarColor(
    page,
    "background-color",
    "var(--sidebar-row-subtle-active-surface)",
  );
  const prominentSurface = await resolveSidebarColor(
    page,
    "background-color",
    "var(--sidebar-row-active-surface)",
  );
  await expect(toggle).not.toBeChecked();
  await expect(root).not.toHaveAttribute("data-prominent-active-tab", "");
  await expect(activeRow).toHaveCSS("background-color", subtleSurface);
  const subtleTextStyle = await activeRow.evaluate((element) => {
    const styles = getComputedStyle(element);
    return { color: styles.color, fontWeight: styles.fontWeight };
  });
  await expect
    .poll(() =>
      page.evaluate(
        (key) => window.localStorage.getItem(key),
        PROMINENT_ACTIVE_TAB_STORAGE_KEY,
      ),
    )
    .toBe("false");

  await toggle.click();
  await expect(toggle).toBeChecked();
  await expect(root).toHaveAttribute("data-prominent-active-tab", "");
  await expect(activeRow).toHaveCSS("background-color", prominentSurface);
  await expect
    .poll(() =>
      page.evaluate(
        (key) => window.localStorage.getItem(key),
        PROMINENT_ACTIVE_TAB_STORAGE_KEY,
      ),
    )
    .toBe("true");
  const prominentTextStyle = await activeRow.evaluate((element) => {
    const styles = getComputedStyle(element);
    return { color: styles.color, fontWeight: styles.fontWeight };
  });
  expect(prominentTextStyle).toEqual(subtleTextStyle);

  await toggle.click();
  await expect(root).not.toHaveAttribute("data-prominent-active-tab", "");
  await expect(activeRow).toHaveCSS("background-color", subtleSurface);
  await expect
    .poll(() =>
      page.evaluate(
        (key) => window.localStorage.getItem(key),
        PROMINENT_ACTIVE_TAB_STORAGE_KEY,
      ),
    )
    .toBe("false");
});

test("prominent channel and direct-message rows share one flat active state", async ({
  page,
}) => {
  await seedTheme(page, "buzz");
  await page.addInitScript(
    ({ key }) => window.localStorage.setItem(key, "true"),
    { key: PROMINENT_ACTIVE_TAB_STORAGE_KEY },
  );
  await installMockBridge(page);
  await openChannel(page);

  const channelRow = page.getByTestId("channel-general");
  const directMessageRow = page.getByTestId("channel-alice-tyler");
  const activeSurface = "rgb(36, 87, 168)";

  await expect(channelRow).toHaveCSS("background-color", activeSurface);
  await expect(channelRow).toHaveCSS("box-shadow", "none");
  await channelRow.hover();
  await expect(channelRow).toHaveCSS("background-color", activeSurface);

  await directMessageRow.click();
  await expect(page.getByTestId("chat-title")).toHaveText("alice-tyler");
  await expect(directMessageRow).toHaveCSS("background-color", activeSurface);
  await expect(directMessageRow).toHaveCSS("box-shadow", "none");
  await directMessageRow.hover();
  await expect(directMessageRow).toHaveCSS("background-color", activeSurface);
});

for (const { activeSurface, hoverSurface, mode, theme } of [
  {
    activeSurface: "rgb(36, 87, 168)",
    hoverSurface: "rgba(255, 255, 255, 0.33)",
    mode: "light" as const,
    theme: "buzz",
  },
  {
    activeSurface: "rgb(55, 107, 181)",
    hoverSurface: "rgba(255, 255, 255, 0.33)",
    mode: "dark" as const,
    theme: "buzz-dark",
  },
]) {
  test(`non-prominent ${theme} selection matches production`, async ({
    page,
  }) => {
    await seedTheme(page, theme);
    await page.addInitScript(
      ({ key }) => window.localStorage.setItem(key, "false"),
      { key: PROMINENT_ACTIVE_TAB_STORAGE_KEY },
    );
    await installMockBridge(page);
    await openChannel(page);

    const root = page.locator("html");
    const activeRow = page.getByTestId("channel-general");
    await expect(root).toHaveClass(
      new RegExp(`(^|\\s)${mode === "dark" ? "dark" : "light"}($|\\s)`),
    );
    await expect(root).not.toHaveAttribute("data-prominent-active-tab", "");
    await expect(activeRow).toHaveCSS("background-color", activeSurface);
    await expect(activeRow).toHaveCSS("box-shadow", "none");
    await expect(activeRow).toHaveCSS("font-weight", "400");
    await activeRow.hover();
    await expect(activeRow).toHaveCSS("background-color", activeSurface);
    const inactiveRow = page.getByTestId("channel-random");
    await inactiveRow.hover();
    await expect(inactiveRow).toHaveCSS("background-color", hoverSurface);
    await expect(activeRow).toHaveCSS("color", "rgb(255, 255, 255)");
  });
}

for (const { mode, theme } of [
  { mode: "light" as const, theme: "github-light" },
  { mode: "dark" as const, theme: "github-dark" },
]) {
  test(`${theme} ignores the Buzz prominent preference`, async ({ page }) => {
    await seedTheme(page, theme);
    await page.addInitScript(
      ({ key }) => window.localStorage.setItem(key, "true"),
      { key: PROMINENT_ACTIVE_TAB_STORAGE_KEY },
    );
    await installMockBridge(page);
    await openChannel(page);

    const root = page.locator("html");
    const activeRow = page.getByTestId("channel-general");
    await expect(root).toHaveClass(
      new RegExp(`(^|\\s)${mode === "dark" ? "dark" : "light"}($|\\s)`),
    );
    await expect(root).not.toHaveAttribute("data-prominent-active-tab", "");

    const productionStyle = await page.evaluate(() => {
      const sidebar = document.querySelector<HTMLElement>(
        '[data-testid="app-sidebar"]',
      );
      const row = document.querySelector<HTMLElement>(
        '[data-testid="channel-general"]',
      );
      if (!sidebar || !row) return null;
      const probe = document.createElement("span");
      probe.style.backgroundColor = "hsl(var(--sidebar-active))";
      probe.style.color = "hsl(var(--sidebar-active-foreground))";
      sidebar.append(probe);
      const probeStyles = getComputedStyle(probe);
      const rowStyles = getComputedStyle(row);
      const result = {
        expectedBackground: probeStyles.backgroundColor,
        expectedForeground: probeStyles.color,
        background: rowStyles.backgroundColor,
        color: rowStyles.color,
        fontWeight: rowStyles.fontWeight,
      };
      probe.remove();
      return result;
    });

    expect(productionStyle).not.toBeNull();
    expect(productionStyle?.background).toBe(
      productionStyle?.expectedBackground,
    );
    expect(productionStyle?.color).toBe(productionStyle?.expectedForeground);
    await expect(activeRow).toHaveCSS(
      "font-weight",
      productionStyle?.fontWeight ?? "",
    );
  });
}

test("settings content uses the same inset surface as the main app", async ({
  page,
}) => {
  await seedTheme(page, "buzz");
  await installMockBridge(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const searchBox = await page.getByTestId("open-search").boundingBox();
  await page.getByTestId("open-settings").click();
  await page.getByTestId("profile-popover-settings").click();

  const settingsView = page.getByTestId("settings-view");
  const contentSurface = page.getByTestId("settings-content-surface");
  const settingsTopChrome = page.getByTestId("settings-top-chrome");
  const settingsSidebarTopChrome = page.getByTestId(
    "settings-sidebar-top-chrome",
  );
  const backToAppBox = await page
    .getByTestId("settings-back-to-app")
    .boundingBox();
  await expect(contentSurface).toBeVisible({ timeout: 10_000 });
  const settingsTopTitle = settingsTopChrome.locator(".w20-topbar-title");
  for (const dragRegion of [settingsTopTitle, settingsSidebarTopChrome]) {
    await expect(dragRegion).toHaveAttribute(
      "data-tauri-drag-region",
      /^(?:|true)$/,
    );
    await expect(dragRegion).toHaveCSS("cursor", "default");
    await expect(dragRegion).toHaveCSS("user-select", "none");
  }
  await expect(page.getByTestId("settings-content-scroll")).toHaveCSS(
    "padding-top",
    "24px",
  );

  const viewBox = await settingsView.boundingBox();
  const surfaceBox = await contentSurface.boundingBox();
  expect(searchBox).not.toBeNull();
  expect(backToAppBox).not.toBeNull();
  expect(viewBox).not.toBeNull();
  expect(surfaceBox).not.toBeNull();
  if (!searchBox || !backToAppBox || !viewBox || !surfaceBox) {
    throw new Error("Settings layout is missing");
  }

  expect(searchBox.y - backToAppBox.y).toBe(44);

  // Match the normal app shell: a fixed 40px top chrome strip, then a 1px
  // top/left inset and 8px right/bottom inset around the rounded content card.
  expect(surfaceBox.y - viewBox.y).toBe(41);
  expect(surfaceBox.x - viewBox.x).toBe(1);
  expect(viewBox.x + viewBox.width - (surfaceBox.x + surfaceBox.width)).toBe(8);
  expect(viewBox.y + viewBox.height - (surfaceBox.y + surfaceBox.height)).toBe(
    8,
  );

  const topChromeBox = await settingsTopTitle.boundingBox();
  const settingsHeadingBox = await page
    .getByRole("heading", { level: 1, name: "Your profile" })
    .boundingBox();
  expect(topChromeBox).not.toBeNull();
  expect(settingsHeadingBox).not.toBeNull();
  if (!topChromeBox || !settingsHeadingBox) {
    throw new Error("Settings drag region or title is missing");
  }
  await page.mouse.move(
    topChromeBox.x + topChromeBox.width / 2,
    topChromeBox.y + topChromeBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    settingsHeadingBox.x + settingsHeadingBox.width / 2,
    settingsHeadingBox.y + settingsHeadingBox.height / 2,
    { steps: 5 },
  );
  await page.mouse.up();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("");

  await waitForAnimations(page);
  await settingsView.screenshot({
    path: `${SHOTS}/08-settings-content-inset.png`,
  });
});

test("appearance keeps accent controls visible with the Buzz theme", async ({
  page,
}) => {
  await seedTheme(page, "buzz");
  await installMockBridge(page);
  const panel = await openAppearance(page, "light");
  const accentIds = [
    "violet",
    "neutral",
    "blue",
    "cyan",
    "green",
    "orange",
    "red",
    "pink",
    "lilac",
    "purple",
    "indigo",
  ];
  for (const accent of accentIds) {
    await expect(
      panel.getByTestId(`appearance-accent-${accent}`),
    ).toBeVisible();
  }
  await expect(panel.getByTestId("appearance-accent-cyan")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await panel.screenshot({ path: `${SHOTS}/10-appearance-accent.png` });
});

test("glass controls keep settings content solid", async ({ page }) => {
  await seedTheme(page, "buzz");
  await page.addInitScript(() => {
    (window as typeof window & { isTauri?: boolean }).isTauri = true;
    Object.defineProperty(navigator, "platform", {
      configurable: true,
      get: () => "MacIntel",
    });
  });
  await installMockBridge(page);
  await openAppearance(page, "light");

  const toggle = page.getByTestId("appearance-glass");
  const opacitySlider = page.getByTestId("appearance-glass-opacity");
  const root = page.locator("html");
  await expect(toggle).toBeEnabled();
  await expect(toggle).not.toBeChecked();
  await expect
    .poll(() =>
      page.evaluate(
        (key) => window.localStorage.getItem(key),
        GLASS_BACKGROUND_STORAGE_KEY,
      ),
    )
    .toBe("false");
  await expect(opacitySlider).toHaveCount(0);
  await expect(root).not.toHaveAttribute("data-glass-background", "");

  await toggle.click();
  await expect(toggle).toBeChecked();
  await expect(opacitySlider).toBeVisible();
  await expect(opacitySlider).toHaveValue("65");
  await expect(root).toHaveAttribute("data-glass-background", "");
  await expect(page.getByTestId("settings-content-surface")).not.toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)",
  );
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window.__BUZZ_E2E_COMMAND_LOG__ ?? []).some(
          (entry) =>
            entry.command === "set_window_vibrancy" &&
            (entry.payload as { enabled?: boolean } | undefined)?.enabled ===
              true,
        ),
      ),
    )
    .toBe(true);

  await opacitySlider.press("Home");
  await expect(opacitySlider).toHaveValue("30");
  await expect
    .poll(() =>
      page.evaluate(
        (storageKey) => localStorage.getItem(storageKey),
        GLASS_OPACITY_STORAGE_KEY,
      ),
    )
    .toBe("30");
  await waitForAnimations(page);
  await page.getByTestId("settings-appearance").screenshot({
    path: `${SHOTS}/11-appearance-glass.png`,
  });

  await toggle.click();
  await expect(root).not.toHaveAttribute("data-glass-background", "");
  await expect(opacitySlider).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(
        (storageKey) => localStorage.getItem(storageKey),
        GLASS_BACKGROUND_STORAGE_KEY,
      ),
    )
    .toBe("false");
});

test("glass controls are disabled on Linux", async ({ page }) => {
  await seedTheme(page, "buzz");
  await page.addInitScript((storageKey) => {
    window.localStorage.setItem(storageKey, "true");
    (window as typeof window & { isTauri?: boolean }).isTauri = true;
    Object.defineProperty(navigator, "platform", {
      configurable: true,
      get: () => "Linux x86_64",
    });
    Object.defineProperty(navigator, "userAgent", {
      configurable: true,
      get: () => "Buzz Desktop Linux",
    });
  }, GLASS_BACKGROUND_STORAGE_KEY);
  await installMockBridge(page);
  const panel = await openAppearance(page, "light");

  const toggle = panel.getByTestId("appearance-glass");
  await expect(toggle).toBeVisible();
  await expect(toggle).toBeDisabled();
  await expect(toggle).not.toBeChecked();
  await expect(panel.getByTestId("appearance-glass-opacity")).toHaveCount(0);
  await expect(page.locator("html")).not.toHaveAttribute(
    "data-glass-background",
    "",
  );
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window.__BUZZ_E2E_COMMAND_LOG__ ?? []).some(
          (entry) => entry.command === "set_window_vibrancy",
        ),
      ),
    )
    .toBe(false);
  await expect
    .poll(() =>
      page.evaluate(
        (storageKey) => window.localStorage.getItem(storageKey),
        GLASS_BACKGROUND_STORAGE_KEY,
      ),
    )
    .toBe("true");
});

test("glass keeps a non-Buzz theme sidebar tint", async ({ page }) => {
  await seedTheme(page, "rose-pine-dawn");
  await page.addInitScript(() => {
    (window as typeof window & { isTauri?: boolean }).isTauri = true;
    Object.defineProperty(navigator, "platform", {
      configurable: true,
      get: () => "MacIntel",
    });
  });
  await installMockBridge(page);
  const panel = await openAppearance(page, "light");

  const root = page.locator("html");
  await expect(root).not.toHaveAttribute("data-buzz-sidebar", "");
  await panel.getByTestId("appearance-glass").click();
  await expect(root).toHaveAttribute("data-glass-background", "");

  const tint = await page
    .locator(".buzz-theme-gradient-layer")
    .evaluate((element) => {
      const rootStyles = getComputedStyle(document.documentElement);
      const sidebar = rootStyles
        .getPropertyValue("--sidebar-background")
        .trim();
      const staticFallback = rootStyles.getPropertyValue("--sidebar").trim();
      const probe = document.createElement("div");
      probe.style.backgroundColor = `hsl(${sidebar} / 65%)`;
      document.body.appendChild(probe);
      const expected = getComputedStyle(probe).backgroundColor;
      probe.remove();

      return {
        actual: getComputedStyle(element).backgroundColor,
        expected,
        sidebar,
        staticFallback,
      };
    });

  expect(tint.sidebar).not.toBe(tint.staticFallback);
  expect(tint.actual).toBe(tint.expected);
});

test("accent controls remain available after applying a named theme", async ({
  page,
}) => {
  await seedTheme(page, "github-light");
  await installMockBridge(page);
  const panel = await openAppearance(page, "light");
  await expect(panel.getByTestId("appearance-accent-neutral")).toBeVisible();

  await panel.getByTestId("appearance-open-themes").click();
  await page.getByTestId("theme-catalog-buzz-dark").click();
  await expect(page.getByTestId("settings-theme-preview")).toBeVisible();
  await page.getByTestId("theme-use").click();
  await expect(page.getByTestId("settings-theme-applied")).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();

  const updatedAppearance = page.getByTestId("settings-appearance");
  await expect(updatedAppearance).toBeVisible();
  for (const accent of ["neutral", "blue", "cyan", "violet"]) {
    await expect(
      updatedAppearance.getByTestId(`appearance-accent-${accent}`),
    ).toBeVisible();
  }
  await waitForAnimations(page);
  await updatedAppearance.screenshot({
    path: `${SHOTS}/12-appearance-theme-and-accents.png`,
  });
});

test("Buzz light and dark modes apply live without a reload", async ({
  page,
}) => {
  await seedTheme(page, "buzz");
  await installMockBridge(page);
  await openAppearance(page, "light");
  await expectAppliedBuzzTheme(page, "buzz");
  const lightGradient = await expectBuzzGradientPaint(page, "light");

  await page.getByTestId("appearance-mode-dark").click();
  await expectAppliedBuzzTheme(page, "buzz-dark");
  const darkGradient = await expectBuzzGradientPaint(page, "dark");
  expect(darkGradient).not.toBe(lightGradient);

  await page.getByTestId("appearance-mode-light").click();
  await expectAppliedBuzzTheme(page, "buzz");
  await expectBuzzGradientPaint(page, "light");

  // Exercise the overlap that previously let a slower, stale theme load win.
  await page.getByTestId("appearance-mode-dark").click();
  await page.getByTestId("appearance-mode-light").click();
  await expectAppliedBuzzTheme(page, "buzz");
});

test("Buzz follows native system theme changes without a reload", async ({
  page,
}) => {
  await seedTheme(page, "buzz");
  await page.addInitScript(() => {
    (window as typeof window & { isTauri?: boolean }).isTauri = true;
  });
  await installMockBridge(page);
  await openAppearance(page, "system");

  await emitNativeThemeChange(page, "dark");
  await expectAppliedBuzzTheme(page, "buzz-dark", "buzz");
  await expectBuzzGradientPaint(page, "dark");

  await emitNativeThemeChange(page, "light");
  await expectAppliedBuzzTheme(page, "buzz", "buzz");
  await expectBuzzGradientPaint(page, "light");
});

function businessSnapshot(page: Page) {
  return page.evaluate(() => {
    const key = Object.keys(localStorage).find(
      (candidate) =>
        candidate.startsWith("colony.appearance.v1:") &&
        !candidate.endsWith(":global-conversations") &&
        !candidate.endsWith(":last-business"),
    );
    return key ? JSON.parse(localStorage.getItem(key) ?? "null") : null;
  });
}

test("r17 settings have nine groups, section search, and return navigation", async ({
  page,
}) => {
  await seedTheme(page, "buzz");
  await installMockBridge(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("open-settings").click();
  await page.getByTestId("profile-popover-settings").click();

  await expect(page.locator('[data-testid^="settings-group-"]')).toHaveCount(9);
  await expect(page.getByRole("tablist")).toHaveCount(1);
  await page.getByTestId("settings-search").fill("Channel templates");
  const result = page.getByRole("option", {
    name: "Channel templates, Blocks & templates",
  });
  await expect(result).toBeVisible();
  await result.click();
  await expect(
    page.getByTestId("settings-panel-channel-templates"),
  ).toBeVisible();

  await page.getByTestId("settings-back-to-app").click();
  await expect(page.getByTestId("settings-view")).toHaveCount(0);
  await expect(page.getByTestId("app-sidebar")).toBeVisible();
});

test("theme catalog applies a named theme through a scoped save", async ({
  page,
}) => {
  await seedTheme(page, "buzz");
  await installMockBridge(page);
  await openAppearance(page);

  await page.getByTestId("appearance-open-themes").click();
  await expect(page.getByTestId("settings-theme-catalog")).toBeVisible();
  await expect(page.getByRole("button", { name: "All" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("button", { exact: true, name: "Dark" }).click();
  const themeSearch = page.getByRole("searchbox", { name: "Search themes" });
  await themeSearch.fill("no matching theme");
  await expect(
    page.getByRole("heading", { name: "No themes found" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(themeSearch).toHaveValue("");
  await expect(page.getByTestId("theme-catalog-buzz-dark")).toBeVisible();
  await page.getByTestId("theme-catalog-buzz-dark").click();
  await expect(page.getByTestId("settings-theme-preview")).toBeVisible();
  await page.getByTestId("theme-use").click();
  await expect(page.getByTestId("settings-theme-applied")).toBeVisible();
  await expectAppliedBuzzTheme(page, "buzz-dark");
  await expect
    .poll(() => businessSnapshot(page))
    .toMatchObject({ theme: "buzz-dark", followSystem: false });

  await waitForAnimations(page);
  await page.getByTestId("settings-view").screenshot({
    path: `${SHOTS}/03-theme-applied.png`,
  });
});

test("appearance controls save business and global preferences with a live preview", async ({
  page,
}) => {
  await seedTheme(page, "buzz");
  await installMockBridge(page);
  const panel = await openAppearance(page);
  const preview = page.getByTestId("appearance-live-preview");

  await expect(page.getByTestId("appearance-accent-violet")).toBeVisible();
  await expect(page.getByTestId("appearance-density")).toBeVisible();
  await page.getByTestId("appearance-mode-dark").click();
  await page.getByTestId("appearance-accent-cyan").click();
  await page.getByTestId("appearance-message-size").selectOption("larger");
  await expect(page.locator("html")).toHaveAttribute(
    "data-font-size",
    "default",
  );
  await expect
    .poll(() =>
      page.evaluate(() =>
        document.documentElement.style.getPropertyValue(
          "--conversation-message-font-size",
        ),
      ),
    )
    .toBe("calc(var(--buzz-type-rem) * 0.9375)");
  await page.getByTestId("appearance-density").selectOption("spacious");
  await page.getByTestId("appearance-links-rich").click();
  await page.getByTestId("appearance-threads-focus").click();

  await expect(preview.locator(".ap-demo-link")).toHaveClass(/rich/);
  await expect(preview.locator(".ap-live-chat")).toHaveClass(/focused/);
  await expect
    .poll(() => businessSnapshot(page))
    .toMatchObject({ theme: "buzz-dark", accent: "#06B6D4" });
  await expect
    .poll(() =>
      page.evaluate(() => {
        const key = Object.keys(localStorage).find((candidate) =>
          candidate.endsWith(":global-conversations"),
        );
        return key ? JSON.parse(localStorage.getItem(key) ?? "null") : null;
      }),
    )
    .toMatchObject({
      messageSize: "larger",
      density: "spacious",
      linkPreview: "rich",
      threadLayout: "focus",
    });

  await waitForAnimations(page);
  await panel.screenshot({ path: `${SHOTS}/04-appearance.png` });
});

test("prominent selection uses the chosen accent on the active settings group", async ({
  page,
}) => {
  await seedTheme(page, "buzz");
  await installMockBridge(page);
  await openAppearance(page);

  const activeGroup = page.getByTestId("settings-group-appearance-group");
  const toggle = page.getByTestId("appearance-prominent");
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect(page.locator("html")).not.toHaveAttribute(
    "data-prominent-active-tab",
    "",
  );
  await page.getByTestId("appearance-accent-cyan").click();
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect(page.locator("html")).toHaveAttribute(
    "data-prominent-active-tab",
    "",
  );
  const expectedAccent = await page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.color = "var(--w20-appearance-accent)";
    document.body.appendChild(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  });
  await expect(activeGroup).toHaveCSS("background-color", expectedAccent);
});
