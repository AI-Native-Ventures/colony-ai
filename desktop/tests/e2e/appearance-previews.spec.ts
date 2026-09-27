import { expect, test, type Page } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";

const THEME_STORAGE_KEY = "buzz-theme";
const LINK_PREVIEW_STYLE_STORAGE_KEY = "buzz.appearance.linkPreviewStyle";
const THREAD_VIEW_MODE_STORAGE_KEY = "buzz.channels.threadViewMode";

async function openAppearance(
  page: Page,
  {
    linkStyle = "compact",
    theme = "buzz",
    threadMode = "split",
  }: {
    linkStyle?: "compact" | "rich";
    theme?: "buzz" | "buzz-dark";
    threadMode?: "focus" | "split";
  } = {},
) {
  await page.addInitScript(
    ({ linkKey, linkStyle, theme, themeKey, threadKey, threadMode }) => {
      window.localStorage.setItem(themeKey, theme);
      window.localStorage.setItem(linkKey, linkStyle);
      window.localStorage.setItem(threadKey, threadMode);
    },
    {
      linkKey: LINK_PREVIEW_STYLE_STORAGE_KEY,
      linkStyle,
      theme,
      themeKey: THEME_STORAGE_KEY,
      threadKey: THREAD_VIEW_MODE_STORAGE_KEY,
      threadMode,
    },
  );
  await installMockBridge(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("open-settings").click();
  await page.getByTestId("profile-popover-settings").click();
  await page.getByTestId("settings-group-appearance-group").click();
  await expect(
    page.getByTestId("settings-group-appearance-group").locator("svg"),
  ).toHaveClass(/lucide-sun/);
  await expect(page.locator(".w20-topbar-title > svg")).toHaveClass(
    /lucide-sun/,
  );
  await expect(page.locator(".w20-nav-person > div strong")).toHaveCSS(
    "color",
    theme === "buzz-dark" ? "rgb(236, 230, 239)" : "rgb(40, 37, 50)",
  );
  await expect(page.getByTestId("settings-appearance")).toBeVisible({
    timeout: 10_000,
  });
  await waitForAnimations(page);
}

test("conversation controls update the preview and save one global snapshot", async ({
  page,
}) => {
  await openAppearance(page);

  const preview = page.getByTestId("appearance-live-preview");
  await expect(preview.locator(".ap-demo-link")).toHaveClass(/compact/);
  await expect(preview.locator(".ap-live-chat")).not.toHaveClass(/focused/);

  await page.getByTestId("appearance-links-rich").click();
  await expect(preview.locator(".ap-demo-link")).toHaveClass(/rich/);
  await page.getByTestId("appearance-threads-focus").click();
  await expect(preview.locator(".ap-live-chat")).toHaveClass(/focused/);

  await expect
    .poll(() =>
      page.evaluate(() => {
        const key = Object.keys(localStorage).find((candidate) =>
          candidate.endsWith(":global-conversations"),
        );
        return key ? JSON.parse(localStorage.getItem(key) ?? "null") : null;
      }),
    )
    .toMatchObject({ linkPreview: "rich", threadLayout: "focus" });
  await expect
    .poll(() =>
      page.evaluate(
        (key) => window.localStorage.getItem(key),
        LINK_PREVIEW_STYLE_STORAGE_KEY,
      ),
    )
    .toBe("rich");
  await expect
    .poll(() =>
      page.evaluate(
        (key) => window.localStorage.getItem(key),
        THREAD_VIEW_MODE_STORAGE_KEY,
      ),
    )
    .toBe("focus");
});

test("appearance preview keeps the custom thumbnail and compose affordance", async ({
  page,
}) => {
  await openAppearance(page);

  await expect(
    page.getByTestId("appearance-theme-custom").locator(".ap-mini"),
  ).toHaveCSS("background-image", /linear-gradient/);
  await expect(page.locator(".ap-live-compose")).toContainText("＋");
});

test("custom palette validates, survives Default, and stays applied after closing settings", async ({
  page,
}) => {
  await openAppearance(page);

  await page.getByTestId("appearance-theme-custom").click();
  const firstHex = page.getByTestId("appearance-color-hex-1");
  await firstHex.fill("#12AB34");
  await expect(firstHex).toHaveValue("#12AB34");
  await expect(page.locator("html")).toHaveClass(/w20-custom-appearance/);

  const secondHex = page.getByTestId("appearance-color-hex-2");
  await secondHex.fill("#12x");
  await expect(page.getByRole("alert")).toContainText(
    "Use a six-digit hex colour",
  );
  await secondHex.blur();
  await expect(secondHex).toHaveValue("#5A9CF6");

  await page.getByTestId("appearance-theme-default").click();
  await expect(page.getByTestId("appearance-color-hex-1")).toHaveCount(0);
  await page.getByTestId("appearance-theme-custom").click();
  await expect(page.getByTestId("appearance-color-hex-1")).toHaveValue(
    "#12AB34",
  );

  await page.getByTestId("settings-close").click();
  await expect(page.getByTestId("settings-view")).toHaveCount(0);
  await expect(page.locator("html")).toHaveClass(/w20-custom-appearance/);
});

test("appearance controls remain usable at the narrow desktop width", async ({
  page,
}) => {
  await page.setViewportSize({ width: 840, height: 900 });
  await openAppearance(page, {
    linkStyle: "rich",
    theme: "buzz-dark",
    threadMode: "focus",
  });

  const grid = page.locator(".ap-appearance-grid");
  await expect(page.getByTestId("appearance-density")).toBeVisible();
  await expect(page.getByTestId("appearance-live-preview")).toBeHidden();
  const gridColumns = await grid.evaluate(
    (element) => getComputedStyle(element).gridTemplateColumns,
  );
  expect(gridColumns.trim().split(/\s+/)).toHaveLength(1);

  await page.getByTestId("appearance-density").selectOption("spacious");
  await expect(page.getByTestId("appearance-density")).toHaveValue("spacious");
});
