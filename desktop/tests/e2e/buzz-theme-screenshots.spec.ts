import { expect, test, type Page } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";
import { openSettings } from "../helpers/settings";

const SHOTS = "test-results/buzz-theme";
const THEME_STORAGE_KEY = "buzz-theme";
const GLASS_BACKGROUND_STORAGE_KEY = "buzz-glass-background";
const PROMINENT_ACTIVE_TAB_STORAGE_KEY = "buzz-prominent-active-tab";
const FONT_SIZE_STORAGE_KEY = "buzz.appearance.fontSize";
const MOCK_PUBKEY = "deadbeef".repeat(8);
const GENERAL_CHANNEL_ID = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
const MOCK_RELAY_URL = (
  process.env.BUZZ_E2E_RELAY_URL ?? "http://localhost:3000"
).replace(/^http/u, "ws");
const COMMUNITY_THEME_STORAGE_KEY = `buzz-community-theme.v1:${MOCK_PUBKEY}:${encodeURIComponent(MOCK_RELAY_URL)}`;

/**
 * Seed the active theme into localStorage BEFORE the mock bridge installs so
 * ThemeProvider reads it on first mount (init scripts run in registration
 * order; React reads state on mount, which the bridge triggers).
 */
async function seedTheme(page: Page, theme: string, followSystem = false) {
  await page.addInitScript(
    ({ communityKey, key, value, followSystem }) => {
      window.localStorage.setItem(key, value);
      window.localStorage.setItem(
        communityKey,
        JSON.stringify({
          version: 1,
          theme: value,
          accent: "#3b82f6",
          followSystem,
        }),
      );
    },
    {
      communityKey: COMMUNITY_THEME_STORAGE_KEY,
      key: THEME_STORAGE_KEY,
      value: theme,
      followSystem,
    },
  );
}

function luminance(color: string) {
  const [r, g, b] = (color.match(/[\d.]+/g) ?? ["0", "0", "0"])
    .slice(0, 3)
    .map((channel) => {
      const value = Number(channel) / 255;
      return value <= 0.03928
        ? value / 12.92
        : ((value + 0.055) / 1.055) ** 2.4;
    });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two `rgb()` colours. */
function contrastRatio(foreground: string, background: string) {
  const [high, low] = [luminance(foreground), luminance(background)].sort(
    (a, b) => b - a,
  );
  return (high + 0.05) / (low + 0.05);
}

/** The Colony 3.0 shell: the person's field in the sidebar, a flat main area. */
async function expectColonyShell(page: Page, mode: "light" | "dark") {
  await expect(page.locator("html")).toHaveAttribute(
    "data-buzz-theme",
    mode === "light" ? "buzz" : "buzz-dark",
  );
  const field = page.locator(
    '[data-testid="app-sidebar"] [data-colony-field="sidebar"]',
  );
  await expect(field).toBeVisible();
  const blobs = await field.evaluate((element) =>
    ["top", "middle", "bottom"].map(
      (name) =>
        getComputedStyle(
          element.querySelector(`.colony-field-blob-${name}`) as Element,
        ).backgroundColor,
    ),
  );
  expect(blobs).toEqual([
    "rgb(245, 164, 213)",
    "rgb(198, 179, 244)",
    "rgb(148, 180, 250)",
  ]);
  const content = page.locator("[data-buzz-content-surface]").first();
  await expect(content).toHaveCSS("box-shadow", "none");
  await expect(content).toHaveCSS("border-radius", "0px");
  await expect(content).toHaveCSS(
    "background-color",
    mode === "light" ? "rgb(255, 253, 250)" : "rgb(33, 30, 38)",
  );
  // Section titles stay aligned with the rows' icons.
  for (const list of ["stream-list", "dm-list"] as const) {
    const title = await page
      .getByTestId(`${list}-section-label`)
      .locator("[data-sidebar-section-title]")
      .boundingBox();
    const row = await page
      .getByTestId(list)
      .locator('[data-sidebar="menu-button"]')
      .first()
      .boundingBox();
    expect(title).not.toBeNull();
    expect(row).not.toBeNull();
    expect(Math.abs((title?.x ?? 0) - (row?.x ?? 0))).toBeLessThanOrEqual(12);
  }
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

/**
 * The wall the sidebar field sits on: pale in the light theme, deep in the dark
 * one. Returns it so a test can see a theme change move it.
 */
async function expectBuzzGradientPaint(
  page: Page,
  mode: "light" | "dark",
): Promise<string> {
  const root = page.locator("html");
  await expect(root).toHaveAttribute(
    "data-buzz-theme",
    mode === "light" ? "buzz" : "buzz-dark",
  );
  await expect(root).toHaveClass(
    mode === "dark" ? /(^|\s)dark($|\s)/ : /(^|\s)light($|\s)/,
  );
  const wall = await page.evaluate(() =>
    getComputedStyle(document.documentElement)
      .getPropertyValue("--colony-field-wall")
      .trim(),
  );
  expect(wall).toBe(mode === "light" ? "#f8f4f8" : "#2a2432");
  return wall;
}

async function expectBuzzSettingsPalette(page: Page, mode: "light" | "dark") {
  const sidebar = page.getByTestId("settings-sidebar");
  const sectionLabel = sidebar
    .locator(".w20-nav-heading")
    .filter({ hasText: "Personal" });
  const activeItem = sidebar.locator('.w20-nav-item[data-active="true"]');

  // Section labels are the quiet tone; the open item reads stronger.
  const activeColor = await activeItem.evaluate(
    (element) => getComputedStyle(element).color,
  );
  await expect(sectionLabel).not.toHaveCSS("color", activeColor);
  await expect(page.locator("html")).toHaveClass(
    mode === "dark" ? /(^|\s)dark($|\s)/ : /(^|\s)light($|\s)/,
  );
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
          fieldTop: styles.getPropertyValue("--colony-field-top").trim(),
          fieldBottom: styles.getPropertyValue("--colony-field-bottom").trim(),
        };
      }, THEME_STORAGE_KEY),
    )
    .toEqual({
      storedTheme,
      isDark,
      buzzTheme: themeName,
      // The default field colours: rose on top, periwinkle at the bottom.
      fieldTop: "#f5a4d5",
      fieldBottom: "#94b4fa",
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

for (const theme of ["buzz", "buzz-dark", "github-light", "github-dark"]) {
  test(`sidebar brand and owner caption use theme foreground: ${theme}`, async ({
    page,
  }) => {
    await seedTheme(page, theme);
    await installMockBridge(page);
    await openChannel(page);
    await page.goto("/#/team");
    await expect(page.getByTestId("app-sidebar")).toBeVisible();
    // The brand mark is a solid tile: its letter must read against it.
    const mark = await page
      .locator(".colony-sidebar-brand-mark")
      .evaluate((element) => {
        const style = getComputedStyle(element);
        return { background: style.backgroundColor, text: style.color };
      });
    expect(contrastRatio(mark.text, mark.background)).toBeGreaterThanOrEqual(
      4.5,
    );
    await openSettings(page, "profile");
    await expect(page.locator(".w20-nav-person small")).toHaveCSS(
      "color",
      await resolveSidebarColor(page, "color", "hsl(var(--foreground))"),
    );
  });
}

test("buzz light sidebar field", async ({ page }) => {
  await seedTheme(page, "buzz");
  await installMockBridge(page);
  await openChannel(page);
  await expectColonyShell(page, "light");
  await waitForAnimations(page);
  await page
    .getByTestId("app-sidebar")
    .screenshot({ path: `${SHOTS}/01-buzz-light-sidebar.png` });
});

test("buzz dark sidebar field", async ({ page }) => {
  await seedTheme(page, "buzz-dark");
  await installMockBridge(page);
  await openChannel(page);
  await expectColonyShell(page, "dark");
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
  expect(sectionIconBox.x + sectionIconBox.width).toBeLessThanOrEqual(
    sectionTitleBox.x,
  );
  expect(channelIconBox.x + channelIconBox.width).toBeLessThanOrEqual(
    channelTitleBox.x,
  );
});

async function openAppearance(page: Page) {
  // Settings renders at the AppShell level; open it via the profile card
  // button, then select the Appearance section.
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("open-settings").click();
  await page.getByTestId("profile-popover-settings").click();
  await page.getByTestId("settings-group-appearance-group").click();
  const panel = page.getByTestId("settings-appearance");
  await expect(panel).toBeVisible({ timeout: 10_000 });
  await waitForAnimations(page);
  return panel;
}

test("appearance keeps the named catalog and supported workspace density choices", async ({
  page,
}) => {
  await seedTheme(page, "buzz");
  await installMockBridge(page);
  await openAppearance(page);

  const appearance = page.getByTestId("settings-appearance");
  await expect(
    appearance.getByRole("heading", { exact: true, name: "Appearance" }),
  ).toBeVisible();
  await expect(
    appearance.getByRole("heading", { name: "Make yourself at home." }),
  ).toBeVisible();
  await expect(appearance.getByTestId("appearance-open-themes")).toBeVisible();
  await expect(appearance.getByTestId("appearance-density")).toHaveCount(0);
  await expect(appearance.getByTestId("appearance-glass")).toBeVisible();
  await expect(appearance.getByTestId("appearance-message-size")).toBeVisible();
  await expect(appearance.getByTestId("appearance-links-rich")).toBeVisible();
  await expect(
    appearance.getByTestId("appearance-threads-focus"),
  ).toBeVisible();
});

test("conversation size and accessibility text size keep their own scopes", async ({
  page,
}) => {
  await seedTheme(page, "buzz");
  await installMockBridge(page);
  await openAppearance(page);
  await page.getByTestId("appearance-message-size").selectOption("larger");

  await expect
    .poll(() =>
      page.evaluate(() =>
        document.documentElement.style.getPropertyValue(
          "--conversation-message-font-size",
        ),
      ),
    )
    .toBe("calc(var(--text-sm) + 1rem / 16)");

  await page.getByTestId("settings-inner-accessibility").click();
  const accessibility = page.getByTestId("settings-accessibility");
  await expect(accessibility).toBeVisible();
  await expect(
    accessibility.getByLabel("Text size", { exact: true }),
  ).toBeVisible();
  await accessibility
    .getByLabel("Text size", { exact: true })
    .selectOption("larger");
  await accessibility
    .getByRole("button", { name: "Save", exact: true })
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
});

test("workspace appearance opens the retained named theme catalog", async ({
  page,
}) => {
  await seedTheme(page, "buzz");
  await installMockBridge(page);
  const panel = await openAppearance(page);
  await panel.getByTestId("appearance-open-themes").click();
  const catalog = page.getByTestId("settings-theme-catalog");
  await expect(catalog.getByTestId("theme-catalog-buzz")).toBeVisible();
  await expect(catalog.getByTestId("theme-catalog-buzz-dark")).toBeVisible();
  await catalog.screenshot({ path: `${SHOTS}/03-theme-catalog.png` });
});

test("named theme catalog retains light and dark variants", async ({
  page,
}) => {
  await seedTheme(page, "buzz-dark");
  await installMockBridge(page);
  await openAppearance(page);
  await page.getByTestId("appearance-open-themes").click();
  const catalog = page.getByTestId("settings-theme-catalog");
  await expect(catalog.getByTestId("theme-catalog-github-light")).toBeVisible();
  await expect(catalog.getByTestId("theme-catalog-github-dark")).toBeVisible();
  await page.getByTestId("settings-view").screenshot({
    path: `${SHOTS}/04-theme-catalog-dark.png`,
  });
});

test("named theme preview retains the selected workspace density", async ({
  page,
}) => {
  await seedTheme(page, "buzz-dark");
  await installMockBridge(page);
  await openAppearance(page);
  await page.getByTestId("appearance-open-themes").click();
  await page.getByTestId("theme-catalog-buzz-dark").click();
  await expect(page.getByTestId("appearance-preview-density")).toHaveCount(0);
  await waitForAnimations(page);
  await page.getByTestId("settings-view").screenshot({
    path: `${SHOTS}/05-theme-preview.png`,
  });
});

test("settings nav keeps its row geometry with Colony selection (light)", async ({
  page,
}) => {
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
  await page.evaluate(() => document.fonts.ready);
  const selectedRowBox = await profileRow.boundingBox();
  const selectedLabelBox = await profileLabel.boundingBox();
  // Manrope's bold glyphs can be wider. The row and label origin must stay
  // fixed when selection changes, without constraining intrinsic glyph width.
  await page.getByTestId("settings-group-appearance-group").click();
  await expect(profileRow).toHaveCSS("font-weight", "400");
  const unselectedLabelBox = await profileLabel.boundingBox();
  const unselectedRowBox = await profileRow.boundingBox();
  expect(selectedLabelBox).not.toBeNull();
  expect(unselectedLabelBox).not.toBeNull();
  if (
    !selectedLabelBox ||
    !unselectedLabelBox ||
    !selectedRowBox ||
    !unselectedRowBox
  ) {
    throw new Error("Settings nav label geometry is missing");
  }
  expect(Math.abs(selectedLabelBox.x - unselectedLabelBox.x)).toBe(0);
  expect(Math.abs(selectedLabelBox.y - unselectedLabelBox.y)).toBe(0);
  expect(unselectedRowBox).toEqual(selectedRowBox);
  expect(selectedLabelBox.x + selectedLabelBox.width).toBeLessThanOrEqual(
    selectedRowBox.x + selectedRowBox.width,
  );
  expect(unselectedLabelBox.x + unselectedLabelBox.width).toBeLessThanOrEqual(
    unselectedRowBox.x + unselectedRowBox.width,
  );
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
    "rgba(0, 0, 0, 0)",
  );
  await expect(page.getByTestId("settings-view")).toHaveCSS(
    "background-color",
    "rgb(33, 30, 38)",
  );
  await waitForAnimations(page);
  await sidebar.screenshot({ path: `${SHOTS}/07-settings-nav-dark.png` });
  await page.getByTestId("settings-view").screenshot({
    path: `${SHOTS}/09-settings-content-dark.png`,
  });
});

test("workspace appearance keeps navigation controls within the frozen design", async ({
  page,
}) => {
  await seedTheme(page, "buzz");
  await installMockBridge(page);
  const appearance = await openAppearance(page);
  const root = page.locator("html");
  await expect(appearance.getByTestId("appearance-prominent")).toBeVisible();
  await expect(appearance.getByTestId("appearance-accent-teal")).toBeVisible();
  await expect(appearance.getByTestId("appearance-glass")).toBeVisible();
  await expect(root).not.toHaveAttribute("data-prominent-active-tab", "");

  await page.getByTestId("settings-close").click();
  await page.getByTestId("channel-general").click();
  const activeRow = page.getByTestId("channel-general");
  const subtleSurface = "rgba(255, 255, 255, 0.84)";
  await expect(activeRow).toHaveCSS("background-color", subtleSurface);
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
  const activeSurface = await resolveSidebarColor(
    page,
    "background-color",
    "hsl(var(--colony-accent))",
  );

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
    activeSurface: "rgba(255, 255, 255, 0.84)",
    hoverSurface: "rgba(255, 255, 255, 0.62)",
    mode: "light" as const,
    theme: "buzz",
  },
  {
    activeSurface: "rgba(255, 255, 255, 0.15)",
    hoverSurface: "rgba(255, 255, 255, 0.09)",
    mode: "dark" as const,
    theme: "buzz-dark",
  },
]) {
  test(`non-prominent ${theme} selection matches the C1 shell`, async ({
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
    const subtleForeground = await resolveSidebarColor(
      page,
      "color",
      "var(--colony-sidebar-foreground)",
    );
    await expect(activeRow).toHaveCSS("background-color", activeSurface);
    // The open row lifts off the field with the designed soft shadow.
    await expect(activeRow).not.toHaveCSS("box-shadow", "none");
    await expect(activeRow).toHaveCSS("font-weight", "800");
    await activeRow.hover();
    await expect(activeRow).toHaveCSS("background-color", activeSurface);
    const inactiveRow = page.getByTestId("channel-random");
    await inactiveRow.hover();
    await expect(inactiveRow).toHaveCSS("background-color", hoverSurface);
    await expect(activeRow).toHaveCSS("color", subtleForeground);
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
    await expect(page.getByTestId("app-sidebar")).toHaveAttribute(
      "data-colony-full-app-shell",
      "true",
    );
    await expect(root).toHaveClass(
      new RegExp(`(^|\\s)${mode === "dark" ? "dark" : "light"}($|\\s)`),
    );
    await expect(root).not.toHaveAttribute("data-prominent-active-tab", "");
    await expect(root).not.toHaveAttribute("data-buzz-sidebar", "");

    const expectedBackground =
      mode === "light"
        ? "rgba(255, 255, 255, 0.84)"
        : "rgba(255, 255, 255, 0.15)";
    const expectedForeground = await resolveSidebarColor(
      page,
      "color",
      "hsl(var(--colony-sidebar-foreground))",
    );
    await expect(activeRow).toHaveCSS("background-color", expectedBackground);
    await expect(activeRow).toHaveCSS("color", expectedForeground);
    await expect(activeRow).toHaveCSS("font-weight", "800");
  });
}

test("settings content uses the same inset surface as the main app", async ({
  page,
}) => {
  await seedTheme(page, "buzz");
  await installMockBridge(page);
  await page.setViewportSize({ height: 900, width: 1440 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const searchBox = await page.getByTestId("open-search").boundingBox();
  await page.getByTestId("open-settings").click();
  await page.getByTestId("profile-popover-settings").click();

  const settingsView = page.getByTestId("settings-view");
  const contentSurface = page.getByTestId("settings-content-surface");
  await expect(settingsView).toHaveCSS("margin", "8px");
  await expect(settingsView).toHaveCSS("border-radius", "11px");
  const settingsTopChrome = page.getByTestId("settings-top-chrome");
  const settingsBackToApp = page.getByTestId("settings-back-to-app");
  const backToAppBox = await page
    .getByTestId("settings-back-to-app")
    .boundingBox();
  await expect(contentSurface).toBeVisible({ timeout: 10_000 });
  const settingsTopTitle = settingsTopChrome.locator(".w20-topbar-title");
  await expect(settingsTopTitle).toHaveAttribute(
    "data-tauri-drag-region",
    /^(?:|true)$/,
  );
  await expect(settingsTopTitle).toHaveCSS("cursor", "default");
  await expect(settingsTopTitle).toHaveCSS("user-select", "none");
  await expect(settingsBackToApp).not.toHaveAttribute("data-tauri-drag-region");
  await expect(settingsBackToApp).toHaveCSS("cursor", "pointer");
  // The r19 account surface uses a 59px top inset for the profile content.
  await expect(page.getByTestId("settings-content-scroll")).toHaveCSS(
    "padding-top",
    "59.03px",
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

  // The sidebar starts at the shared 8px frame inset. Settings keeps its
  // own top chrome, so this measures the two independent control rows.
  const isMac = await page.evaluate(() =>
    /mac|iphone|ipad|ipod/i.test(navigator.platform),
  );
  // The Colony 3.0 sidebar puts the search 78px down on a Mac (below the
  // window buttons) and 50px down elsewhere.
  expect(searchBox.y - backToAppBox.y).toBe(isMac ? 78 : 50);

  // Header and content share one card. The frame carries the 8px margin;
  // the content starts directly below its 52px header.
  expect(surfaceBox.y - viewBox.y).toBe(52);
  expect(surfaceBox.x - viewBox.x).toBe(0);
  expect(viewBox.x + viewBox.width - (surfaceBox.x + surfaceBox.width)).toBe(0);
  expect(viewBox.y + viewBox.height - (surfaceBox.y + surfaceBox.height)).toBe(
    0,
  );

  const topChromeBox = await settingsTopTitle.boundingBox();
  const settingsHeadingBox = await page
    .getByRole("heading", { level: 1, name: "Profile" })
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

test("named theme catalog retains the saved theme choices", async ({
  page,
}) => {
  await seedTheme(page, "buzz");
  await installMockBridge(page);
  await openAppearance(page);
  await page.getByTestId("appearance-open-themes").click();
  const catalog = page.getByTestId("settings-theme-catalog");
  await expect(catalog.getByTestId("theme-catalog-buzz")).toBeVisible();
  await expect(catalog.getByTestId("theme-catalog-buzz-dark")).toBeVisible();
  await expect(catalog.getByTestId("theme-catalog-github-light")).toBeVisible();
  await expect(catalog.getByTestId("theme-catalog-github-dark")).toBeVisible();
  await page.getByTestId("settings-view").screenshot({
    path: `${SHOTS}/10-named-themes.png`,
  });
});

test("saved glass preference keeps settings content solid", async ({
  page,
}) => {
  await seedTheme(page, "buzz");
  await page.addInitScript(() => {
    window.localStorage.setItem("buzz-glass-background", "true");
    (window as typeof window & { isTauri?: boolean }).isTauri = true;
    Object.defineProperty(navigator, "platform", {
      configurable: true,
      get: () => "MacIntel",
    });
  });
  await installMockBridge(page);
  const appearance = await openAppearance(page);
  const root = page.locator("html");
  await expect(appearance.getByTestId("appearance-glass")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        (key) => window.localStorage.getItem(key),
        GLASS_BACKGROUND_STORAGE_KEY,
      ),
    )
    .toBe("true");
  await expect(root).toHaveAttribute("data-glass-background", "");
  await expect(page.getByTestId("settings-view")).toHaveCSS(
    "background-color",
    "rgb(255, 254, 253)",
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
  await waitForAnimations(page);
  await page.getByTestId("settings-appearance").screenshot({
    path: `${SHOTS}/11-appearance-glass.png`,
  });
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
  const panel = await openAppearance(page);

  await expect(panel.getByTestId("appearance-glass")).toBeVisible();
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
    window.localStorage.setItem("buzz-glass-background", "true");
    (window as typeof window & { isTauri?: boolean }).isTauri = true;
    Object.defineProperty(navigator, "platform", {
      configurable: true,
      get: () => "MacIntel",
    });
  });
  await installMockBridge(page);
  await openAppearance(page);

  const root = page.locator("html");
  await expect(root).not.toHaveAttribute("data-buzz-sidebar", "");
  await expect(root).toHaveAttribute("data-glass-background", "");

  const tint = await page
    .getByTestId("app-sidebar-layer")
    .evaluate((element) => {
      const rootStyles = getComputedStyle(document.documentElement);
      const sidebar = rootStyles
        .getPropertyValue("--sidebar-background")
        .trim();
      // --sidebar now aliases --sidebar-background through the canvas token,
      // so the tint is compared with the value the theme actually applied.
      const appliedSidebar = JSON.parse(
        localStorage.getItem("buzz-theme-cache") ?? "{}",
      ).vars?.["--sidebar-background"];
      const probe = document.createElement("div");
      probe.style.backgroundColor = `hsl(${sidebar} / 65%)`;
      document.body.appendChild(probe);
      const expected = getComputedStyle(probe).backgroundColor;
      probe.remove();

      return {
        actual: getComputedStyle(element).backgroundColor,
        expected,
        sidebar,
        appliedSidebar,
      };
    });

  expect(tint.appliedSidebar).toBeTruthy();
  expect(tint.sidebar).toBe(tint.appliedSidebar);
  expect(tint.actual).toBe(tint.expected);
  // An opaque chrome fill would hide native vibrancy even with the right tint.
  for (const selector of [".buzz-huddle-app-surface", ".buzz-huddle-shell"]) {
    await expect(page.locator(selector)).toHaveCSS("background-image", "none");
    await expect(page.locator(selector)).toHaveCSS(
      "background-color",
      "rgba(0, 0, 0, 0)",
    );
  }
});

test("a named theme remains applied after returning to workspace appearance", async ({
  page,
}) => {
  await seedTheme(page, "github-light");
  await installMockBridge(page);
  await openAppearance(page);

  await page.getByTestId("appearance-open-themes").click();
  await page.getByTestId("theme-catalog-buzz-dark").click();
  await expect(page.getByTestId("settings-theme-preview")).toBeVisible();
  const themePreview = page.getByTestId("theme-workspace-preview");
  await expect(themePreview).toContainText(
    "The September designs are ready for feedback.",
  );
  await page.getByTestId("theme-use").click();
  await expect(page.getByTestId("settings-theme-applied")).toBeVisible();
  await expectAppliedBuzzTheme(page, "buzz-dark");
  await page.getByRole("button", { name: "Done", exact: true }).click();

  const updatedAppearance = page.getByTestId("settings-appearance");
  await expect(updatedAppearance).toBeVisible();
  await expect(
    updatedAppearance.getByTestId("appearance-open-themes"),
  ).toBeVisible();
  await expect
    .poll(() => businessSnapshot(page))
    .toMatchObject({ theme: "buzz-dark" });
  await waitForAnimations(page);
  await updatedAppearance.screenshot({
    path: `${SHOTS}/12-appearance-theme.png`,
  });
});

test("named Buzz themes apply live without a reload", async ({ page }) => {
  await seedTheme(page, "buzz");
  await installMockBridge(page);
  await openAppearance(page);
  await expectAppliedBuzzTheme(page, "buzz");
  const lightGradient = await expectBuzzGradientPaint(page, "light");

  await page.getByTestId("appearance-open-themes").click();
  await page.getByTestId("theme-catalog-buzz-dark").click();
  await page.getByTestId("theme-use").click();
  await expectAppliedBuzzTheme(page, "buzz-dark");
  const darkGradient = await expectBuzzGradientPaint(page, "dark");
  expect(darkGradient).not.toBe(lightGradient);

  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByTestId("appearance-open-themes").click();
  await page.getByTestId("theme-catalog-buzz").click();
  await page.getByTestId("theme-use").click();
  await expectAppliedBuzzTheme(page, "buzz");
  await expectBuzzGradientPaint(page, "light");
});

test("Buzz follows native system theme changes without a reload", async ({
  page,
}) => {
  await seedTheme(page, "buzz", true);
  await page.addInitScript(() => {
    (window as typeof window & { isTauri?: boolean }).isTauri = true;
  });
  await installMockBridge(page);
  await openAppearance(page);

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
  await expect(page.getByTestId("theme-catalog-buzz-dark")).toBeVisible();
  await page.getByTestId("theme-catalog-buzz-dark").click();
  await expect(page.getByTestId("settings-theme-preview")).toBeVisible();
  const themePreview = page.getByTestId("theme-workspace-preview");
  await expect(themePreview).toContainText(
    "The September designs are ready for feedback.",
  );

  await page.getByTestId("theme-use").click();
  await expect(page.getByTestId("settings-theme-applied")).toBeVisible();
  await expect(page.getByRole("status")).toContainText(
    "Your personal appearance is updated.",
  );
  await expectAppliedBuzzTheme(page, "buzz-dark");
  await expect
    .poll(() => businessSnapshot(page))
    .toMatchObject({
      theme: "buzz-dark",
      followSystem: false,
      density: "comfortable",
    });

  await waitForAnimations(page);
  await page.getByTestId("settings-view").screenshot({
    path: `${SHOTS}/03-theme-applied.png`,
  });
});

test("workspace appearance saves conversation size in its global preference", async ({
  page,
}) => {
  await seedTheme(page, "buzz");
  await installMockBridge(page);
  const panel = await openAppearance(page);
  await expect(panel.getByTestId("appearance-message-size")).toBeVisible();
  await panel.getByTestId("appearance-message-size").selectOption("larger");

  await expect
    .poll(() =>
      page.evaluate(() =>
        Object.entries(localStorage)
          .filter(([key]) => key.endsWith(":global-conversations"))
          .map(([, value]) => JSON.parse(value).messageSize),
      ),
    )
    .toEqual(["larger"]);
  await waitForAnimations(page);
  await page.getByTestId("settings-view").screenshot({
    path: `${SHOTS}/04-appearance-saved.png`,
  });
});

test("named appearance keeps density and theme in the same scoped snapshot", async ({
  page,
}) => {
  await seedTheme(page, "buzz");
  await installMockBridge(page);
  const panel = await openAppearance(page);
  await expect(panel.getByTestId("appearance-prominent")).toBeVisible();
  await expect(panel.getByTestId("appearance-accent-teal")).toBeVisible();
  await expect(panel.getByTestId("appearance-density")).toHaveCount(0);
  await panel.getByTestId("appearance-open-themes").click();
  await page.getByTestId("theme-catalog-github-dark").click();

  await page.getByTestId("theme-use").click();
  await expect
    .poll(() => businessSnapshot(page))
    .toMatchObject({ theme: "github-dark", density: "comfortable" });
});
