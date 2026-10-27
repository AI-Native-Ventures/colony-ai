import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";

import { REFERENCE_CHANNEL_IDS } from "../../src/testing/e2eReferenceWorkspace";
import { installMockBridge } from "../helpers/bridge";
import { colony3Extras } from "../helpers/colony3Conversations";
import {
  COLONY3_ACTIVITY_ITEMS,
  colony3ActivityMockOptions,
} from "../helpers/colony3ActivityFixture";
import { COLONY3_NOW, seedColony3Activity } from "../helpers/colony3Fixture";
import { colony3TodayMockOptions } from "../helpers/colony3HomeFixture";
import { colony3WorkAreaBridgeOptions } from "../helpers/colony3WorkAreaFixture";
import { waitForAnimations } from "../helpers/animations";
import { installBrowserHostFake } from "./helpers/browserHostFake";
import { installBrowserBrokerFake } from "./helpers/browserBrokerFake";
import { actionsBoardMessages } from "../helpers/colony3TimelineFixture";

const OIL_CHANNEL = REFERENCE_CHANNEL_IDS.oliveHouse;

async function seedTheme(
  page: Page,
  mode: "explicit-dark" | "explicit-light" | "system-dark",
) {
  const followsSystem = mode === "system-dark";
  await page.emulateMedia({
    colorScheme: followsSystem ? "dark" : "light",
  });
  const theme = mode === "explicit-dark" ? "buzz-dark" : "buzz";
  const relayUrl = "ws://localhost:3000";
  await page.addInitScript(
    ({ themeName, followSystem, activeRelayUrl }) => {
      window.localStorage.setItem("buzz-theme", themeName);
      window.localStorage.setItem(
        "buzz-follow-system",
        followSystem ? "true" : "false",
      );
      window.localStorage.setItem("buzz-accent-color", "#5B45BE");
      window.localStorage.setItem(
        `buzz-community-theme.v1:${"deadbeef".repeat(8)}:${encodeURIComponent(activeRelayUrl)}`,
        JSON.stringify({
          version: 1,
          theme: themeName,
          accent: "#5B45BE",
          followSystem,
        }),
      );
    },
    { themeName: theme, followSystem: followsSystem, activeRelayUrl: relayUrl },
  );
}

const FOLLOWUP_PROOF_DIR =
  process.env.COLONY3_DARK_MODE_3_PROOF_DIR ??
  process.env.COLONY3_DARK_MODE_2_PROOF_DIR;

async function captureFollowupScreen(
  page: Page,
  name: string,
  clip?: { x: number; y: number; width: number; height: number },
) {
  if (!FOLLOWUP_PROOF_DIR) return;
  mkdirSync(FOLLOWUP_PROOF_DIR, { recursive: true });
  await waitForAnimations(page);
  await page.screenshot({
    animations: "disabled",
    ...(clip ? { clip } : { fullPage: true }),
    path: join(FOLLOWUP_PROOF_DIR, name),
  });
}

async function darkBackground(locator: Locator) {
  const color = await locator.evaluate((element) => {
    const background = getComputedStyle(element).backgroundColor;
    if (background !== "rgba(0, 0, 0, 0)") return background;
    return getComputedStyle(element, "::before").backgroundColor;
  });
  const perceptual = color.match(
    /^(?:oklab|oklch)\(([\d.]+)(?:\s+[^/]+)?(?:\/\s*([\d.]+))?\)$/u,
  );
  if (perceptual) {
    const lightness = Number(perceptual[1]);
    const alpha = perceptual[2] === undefined ? 1 : Number(perceptual[2]);
    expect(alpha, color).toBeGreaterThan(0);
    expect(lightness, color).toBeLessThan(0.6);
    return color;
  }
  const srgb = color.startsWith("color(srgb ");
  const match = color.match(
    srgb ? /color\(srgb ([^)]+)\)/u : /rgba?\(([^)]+)\)/u,
  );
  if (!match) throw new Error(`Expected a computed RGB surface, got ${color}`);
  const [red, green, blue, alpha] = match[1]
    .split(/[\s,/]+/u)
    .filter(Boolean)
    .slice(0, 4)
    .map((part) => Number(part) * (srgb ? 255 : 1));
  expect(alpha === undefined || alpha > 0, color).toBe(true);
  expect((red * 299 + green * 587 + blue * 114) / 1000, color).toBeLessThan(
    150,
  );
  return color;
}

function cssColorChannels(color: string) {
  const match = color.match(/^rgba?\(([^)]+)\)$/u);
  if (!match) throw new Error(`Expected an RGB color, got ${color}`);
  return match[1]
    .split(/[\s,/]+/u)
    .filter(Boolean)
    .slice(0, 3)
    .map(Number);
}

function luminance(color: string) {
  const [red, green, blue] = cssColorChannels(color).map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(foreground: string, background: string) {
  const first = luminance(foreground);
  const second = luminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

function cssAlpha(color: string) {
  const match = color.match(/^rgba?\(([^)]+)\)$/u);
  if (!match) throw new Error(`Expected an RGB color, got ${color}`);
  const channels = match[1].split(/[\s,/]+/u).filter(Boolean);
  return channels[3] === undefined ? 1 : Number(channels[3]);
}

test.describe.configure({ timeout: 120_000 });

test("C3 dark-mode follow-up screens", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.clock.setFixedTime(new Date(COLONY3_NOW));
  await seedTheme(page, "explicit-light");
  await installMockBridge(page, {
    referenceWorkspace: true,
    colony3Sidebar: true,
    relayRequiresMembership: true,
    relayRole: "owner",
  });
  await page.goto("/#/today");
  await expect(page.getByTestId("today-screen")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.classList.contains("dark")),
    )
    .toBe(false);
  await captureFollowupScreen(page, "light-today-main.png", {
    x: 280,
    y: 0,
    width: 1160,
    height: 960,
  });

  await page.goto("/#/leads");
  await expect(page.getByTestId("w10-leads-page")).toBeVisible();
  const lightPrimary = page.getByRole("button", { name: "Find prospects" });
  await expect(lightPrimary).toBeVisible();
  const lightPrimaryColors = await lightPrimary.evaluate((element) => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, color: style.color };
  });
  expect(lightPrimaryColors).toEqual({
    background: "rgb(37, 34, 44)",
    color: "rgb(255, 253, 250)",
  });
  await captureFollowupScreen(page, "light-leads.png");

  await page.goto("/#/settings?section=appearance");
  await expect(page.getByTestId("settings-appearance")).toBeVisible();
  const lightDawn = page.getByTestId("appearance-field-preset-dawn");
  const lightPeach = page.getByTestId("appearance-field-preset-peach");
  await expect(lightDawn).toHaveAttribute("aria-pressed", "true");
  const lightPresetColors = await Promise.all(
    [lightDawn, lightPeach].map((preset) =>
      preset.evaluate((element) => getComputedStyle(element).backgroundColor),
    ),
  );
  expect(lightPresetColors).toEqual([
    "rgb(247, 244, 253)",
    "rgb(255, 255, 255)",
  ]);
  const lightInkSwatch = await page
    .getByTestId("appearance-accent-ink")
    .evaluate((element) => getComputedStyle(element).borderTopWidth);
  expect(lightInkSwatch).toBe("0px");
  await captureFollowupScreen(page, "light-appearance.png");
  await page.getByTestId("appearance-mode-dark").click();
  await page.getByTestId("appearance-apply").click();
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.classList.contains("dark")),
    )
    .toBe(true);

  await page.goto("/#/leads");
  await expect(page.getByTestId("w10-leads-page")).toBeVisible();
  const primary = page.getByRole("button", { name: "Find prospects" });
  const primaryColors = await primary.evaluate((element) => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, color: style.color };
  });
  expect(primaryColors).toEqual({
    background: "rgb(184, 162, 255)",
    color: "rgb(26, 25, 32)",
  });
  expect(
    contrastRatio(primaryColors.color, primaryColors.background),
  ).toBeGreaterThanOrEqual(4.5);

  const runnerAvatar = page.locator(".c3l-runner-avatar").first();
  await expect(runnerAvatar).toBeVisible();
  const runnerStyle = await runnerAvatar.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      background: style.backgroundColor,
      boxShadow: style.boxShadow,
    };
  });
  const runnerBounds = await runnerAvatar.boundingBox();
  expect(runnerBounds?.width).toBeGreaterThanOrEqual(20);
  expect(runnerBounds?.height).toBeGreaterThanOrEqual(20);
  expect(runnerStyle.background).toBe("rgb(59, 52, 68)");
  expect(runnerStyle.boxShadow).not.toBe("none");
  await captureFollowupScreen(page, "dark-leads.png");

  await page.goto("/#/settings?section=appearance");
  await expect(page.getByTestId("settings-appearance")).toBeVisible();
  for (const presetId of ["dawn", "peach", "sea"]) {
    const preset = page.getByTestId(`appearance-field-preset-${presetId}`);
    const initialColors = await preset.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        background: style.backgroundColor,
        color: style.color,
        border: style.borderColor,
        pressed: element.getAttribute("aria-pressed"),
      };
    });
    expect(initialColors.pressed).toBe(presetId === "dawn" ? "true" : "false");
    expect(luminance(initialColors.background)).toBeLessThan(0.25);
    expect(
      contrastRatio(initialColors.color, initialColors.background),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrastRatio(initialColors.border, initialColors.background),
    ).toBeGreaterThanOrEqual(3);
  }

  await captureFollowupScreen(page, "dark-appearance.png");

  for (const presetId of ["dawn", "peach", "sea"]) {
    const preset = page.getByTestId(`appearance-field-preset-${presetId}`);
    await preset.click();
    await expect(preset).toHaveAttribute("aria-pressed", "true");
    const selectedColors = await preset.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        background: style.backgroundColor,
        color: style.color,
        border: style.borderColor,
      };
    });
    expect(luminance(selectedColors.background)).toBeLessThan(0.25);
    expect(
      contrastRatio(selectedColors.color, selectedColors.background),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrastRatio(selectedColors.border, selectedColors.background),
    ).toBeGreaterThanOrEqual(3);
  }

  const darkInkSwatch = await page
    .getByTestId("appearance-accent-ink")
    .evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        background: style.backgroundColor,
        border: style.borderColor,
        borderStyle: style.borderStyle,
        borderWidth: style.borderTopWidth,
      };
    });
  expect(darkInkSwatch.borderStyle).toBe("solid");
  expect(darkInkSwatch.borderWidth).toBe("1px");
  expect(
    contrastRatio(darkInkSwatch.border, darkInkSwatch.background),
  ).toBeGreaterThanOrEqual(3);

  for (const selector of [".ap-field-lines > u", ".cs-preview-lines > u"]) {
    const previewRowBackground = await page
      .locator(selector)
      .evaluate((element) => getComputedStyle(element).backgroundColor);
    expect(cssAlpha(previewRowBackground), selector).toBeLessThan(0.5);
  }
  const fieldPreviewAvatarRing = await page
    .locator(".ap-field-lines > b")
    .evaluate((element) => getComputedStyle(element).boxShadow);
  expect(fieldPreviewAvatarRing).not.toBe("none");
});

test("Colony 3.0 Today cards and states use dark surfaces", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.clock.setFixedTime(new Date(COLONY3_NOW));
  await seedTheme(page, "explicit-dark");
  await installMockBridge(page, {
    referenceWorkspace: true,
    colony3Sidebar: true,
    relayRequiresMembership: true,
    relayRole: "owner",
    ...colony3TodayMockOptions(),
  });
  await page.goto("/#/today");
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.classList.contains("dark")),
    )
    .toBe(true);

  const row = page.locator(".ct-row").first();
  await expect(row).toBeVisible();
  const cardSurface = await darkBackground(row);
  const chipSurface = await darkBackground(row.locator(".ct-chip").first());
  const overdueSurface = await darkBackground(
    page.getByTestId("today-screen").getByRole("status"),
  );

  expect({ cardSurface, chipSurface, overdueSurface }).toBeTruthy();
});

test("Colony 3.0 Activity list and selected rows use dark surfaces", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.clock.setFixedTime(new Date(COLONY3_NOW));
  await seedTheme(page, "explicit-dark");
  await installMockBridge(page, {
    referenceWorkspace: true,
    colony3Sidebar: true,
    relayRequiresMembership: true,
    relayRole: "owner",
    ...colony3ActivityMockOptions(),
  });
  await page.goto("/#/");
  const list = page.locator(".ca-list");
  await expect(list).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.classList.contains("dark")),
    )
    .toBe(true);
  const filterSurface = await darkBackground(
    list.getByTestId("inbox-filter-trigger"),
  );

  await page
    .getByTestId(`home-inbox-item-${COLONY3_ACTIVITY_ITEMS.zinhle}`)
    .click();
  const selectedRow = page.locator('.ca-row[data-selected="true"]').first();
  await expect(selectedRow).toBeVisible();
  const selectedSurface = await darkBackground(selectedRow);

  expect({ filterSurface, selectedSurface }).toBeTruthy();
});

test("Colony 3.0 dark thread, composer and browser chrome use the shared palette", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.clock.setFixedTime(new Date(COLONY3_NOW));
  await page.addInitScript(() => {
    window.localStorage.setItem("buzz.channels.threadViewMode", "split");
  });
  await seedTheme(page, "explicit-dark");
  await installBrowserHostFake(page, {
    contentSize: { width: 1440, height: 960 },
  });
  await installBrowserBrokerFake(page, true, { defaultAccess: true });

  const { colony3Extras: _workAreaExtras, ...workAreaBridge } =
    colony3WorkAreaBridgeOptions();
  await installMockBridge(page, {
    ...workAreaBridge,
    colony3Extras: colony3Extras({
      clearMessagesIn: [OIL_CHANNEL],
      readChannelIds: [OIL_CHANNEL],
      patchChannels: [
        {
          id: OIL_CHANNEL,
          description: "Client channel · spring content campaign",
        },
      ],
      messages: actionsBoardMessages(),
    }),
  });
  await page.goto("/#/today");
  await seedColony3Activity(page);
  await expect(page.getByTestId("app-sidebar")).toBeVisible();
  await page.getByTestId("channel-The Olive House").click();
  await expect(page.getByTestId("chat-title")).toHaveText("The Olive House");
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.classList.contains("dark")),
    )
    .toBe(true);

  await page.getByTestId("message-thread-summary").first().click();
  const thread = page.getByTestId("message-thread-panel");
  await expect(thread).toBeVisible();
  const threadRoot = page.locator('.c3c-row[data-active-thread-root="true"]');
  await expect(threadRoot).toContainText(
    "Three carousel concepts from the spring brief.",
  );
  const threadRootSurface = await darkBackground(threadRoot);

  const reply = thread
    .getByTestId("message-row")
    .filter({ hasText: "Farm visit first, agreed." })
    .first();
  await reply.hover();
  const actionBar = reply
    .getByTestId(/^message-action-bar-/)
    .locator(".c3c-action-bar");
  await expect(actionBar).toBeVisible();
  const actionSurface = await darkBackground(actionBar);

  const composer = thread.locator(".c3c-card").first();
  const composerSurface = await darkBackground(composer);
  const sendButton = composer.getByTestId("send-message");
  await expect(sendButton).toBeVisible();
  const sendStyle = await sendButton.evaluate((element) => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, color: style.color };
  });
  expect(sendStyle.background).toBe("rgb(184, 162, 255)");
  expect(sendStyle.color).toBe("rgb(26, 25, 32)");
  const referenceButton = composer.getByTestId("reference-lead-button");
  await expect(referenceButton).toBeVisible();
  const referenceColor = await referenceButton.evaluate(
    (element) => getComputedStyle(element).color,
  );
  expect(referenceColor).toBe("rgb(184, 162, 255)");

  await waitForAnimations(page);
  await page.screenshot({
    animations: "disabled",
    path: testInfo.outputPath("dark-thread-composer.png"),
  });

  await page.getByTestId("channel-work-area-trigger").click();
  await expect(page.getByTestId("work-area-panel")).toBeVisible();
  await page.getByTestId("work-area-open-browser").click();
  const address = page.getByTestId("browser-address");
  await expect(address).toBeVisible();
  await address.fill("fixture.test/a");
  await address.press("Enter");
  await expect(address).toHaveValue("https://fixture.test/a");
  await expect(page.getByTestId("browser-status")).toContainText(
    "Separate browser profile",
  );
  await expect(page.getByTestId("browser-agent-controls")).toContainText(
    "AI employees can use this tab",
  );
  const browser = page.getByTestId("work-area-browser");
  const browserSurface = await darkBackground(browser);
  const addressSurface = await darkBackground(address);
  const tabStripSurface = await darkBackground(
    page.locator(".colony-work-area-head").first(),
  );
  await waitForAnimations(page);
  await page.screenshot({
    animations: "disabled",
    path: testInfo.outputPath("dark-browser-chrome.png"),
  });

  expect({
    threadRootSurface,
    actionSurface,
    composerSurface,
    browserSurface,
    addressSurface,
    tabStripSurface,
  }).toBeTruthy();
});

test("System mode follows the dark desktop appearance", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await seedTheme(page, "system-dark");
  await installMockBridge(page, {
    referenceWorkspace: true,
    colony3Sidebar: true,
  });
  await page.goto("/#/today");
  await expect(page.getByTestId("app-sidebar")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.classList.contains("dark")),
    )
    .toBe(true);
  expect(
    await page.evaluate(() => getComputedStyle(document.body).backgroundColor),
  ).toBe("rgb(26, 25, 32)");
  await waitForAnimations(page);
  await page.screenshot({
    animations: "disabled",
    path: testInfo.outputPath("system-dark-today.png"),
  });
});

test("built-in accents keep text contrast in Dark", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await seedTheme(page, "explicit-dark");
  await installMockBridge(page, {
    referenceWorkspace: true,
    colony3Sidebar: true,
  });
  await page.goto("/#/settings?section=appearance");
  await expect(page.getByTestId("settings-appearance")).toBeVisible();

  for (const accentName of ["violet", "rose", "teal", "blue", "amber", "ink"]) {
    const option = page.getByTestId(`appearance-accent-${accentName}`);
    if ((await option.getAttribute("aria-pressed")) !== "true") {
      await option.click();
      await page.getByTestId("appearance-apply").click();
    }
    const ratios = await page.evaluate(() => {
      const styles = getComputedStyle(document.documentElement);
      const toRgb = (value: string) => {
        const hex = value.match(/^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/iu);
        if (hex)
          return hex.slice(1).map((channel) => Number.parseInt(channel, 16));
        const hsl = value.match(/^(-?[\d.]+)\s+([\d.]+)%\s+([\d.]+)%$/u);
        if (!hsl) throw new Error(`Unexpected theme color: ${value}`);
        const hue = ((Number(hsl[1]) % 360) + 360) % 360;
        const saturation = Number(hsl[2]) / 100;
        const lightness = Number(hsl[3]) / 100;
        const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
        const secondary = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
        const offset = lightness - chroma / 2;
        const channels =
          hue < 60
            ? [chroma, secondary, 0]
            : hue < 120
              ? [secondary, chroma, 0]
              : hue < 180
                ? [0, chroma, secondary]
                : hue < 240
                  ? [0, secondary, chroma]
                  : hue < 300
                    ? [secondary, 0, chroma]
                    : [chroma, 0, secondary];
        return channels.map((channel) => Math.round((channel + offset) * 255));
      };
      const luminance = (rgb: number[]) => {
        const channels = rgb.map((channel) => {
          const value = channel / 255;
          return value <= 0.04045
            ? value / 12.92
            : ((value + 0.055) / 1.055) ** 2.4;
        });
        return (
          0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
        );
      };
      const ratio = (foreground: string, background: string) => {
        const first = luminance(toRgb(foreground));
        const second = luminance(toRgb(background));
        return (
          (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
        );
      };
      const accent = styles.getPropertyValue("--colony-accent").trim();
      const ink = styles.getPropertyValue("--colony-accent-ink").trim();
      const soft = styles.getPropertyValue("--colony-accent-soft").trim();
      const overlay = styles.getPropertyValue("--colony-overlay").trim();
      return {
        accentOnOverlay: ratio(accent, overlay),
        inkOnAccentSoft: ratio(ink, soft),
      };
    });

    expect(
      ratios.accentOnOverlay,
      `${accentName} accent on dark overlay`,
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      ratios.inkOnAccentSoft,
      `${accentName} ink on accent surface`,
    ).toBeGreaterThanOrEqual(4.5);
  }
});

test("Ink accent keeps the Appearance preview and a real button readable in Dark", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await seedTheme(page, "explicit-dark");
  await installMockBridge(page, {
    referenceWorkspace: true,
    colony3Sidebar: true,
  });
  await page.goto("/#/settings?section=appearance");
  await expect(page.getByTestId("settings-appearance")).toBeVisible();

  const inkAccent = page.getByTestId("appearance-accent-ink");
  if ((await inkAccent.getAttribute("aria-pressed")) !== "true") {
    await inkAccent.click();
    await page.getByTestId("appearance-apply").click();
  }

  const approve = page.getByText("Approve", { exact: true });
  await expect(approve).toBeVisible();
  const previewColors = await approve.evaluate((element) => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, color: style.color };
  });
  expect(
    contrastRatio(previewColors.color, previewColors.background),
    "Ink preview Approve label on its fill",
  ).toBeGreaterThanOrEqual(4.5);
  await captureFollowupScreen(page, "dark-ink-appearance.png");

  await page.goto("/#/leads");
  await expect(page.getByTestId("w10-leads-page")).toBeVisible();
  const findProspects = page.getByRole("button", { name: "Find prospects" });
  await expect(findProspects).toBeVisible();
  const buttonColors = await findProspects.evaluate((element) => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, color: style.color };
  });
  expect(
    contrastRatio(buttonColors.color, buttonColors.background),
    "Dark Ink accent label on the Find prospects button",
  ).toBeGreaterThanOrEqual(4.5);
  await captureFollowupScreen(page, "dark-ink-leads.png");
});
