import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";
import { installDiscoveryImageMocks } from "../helpers/discoveryImages";
import { waitForAnimations } from "../helpers/animations";

const PROOF_DIR =
  process.env.COLONY3_DISCOVERY_V4_PROOF_DIR ??
  "test-results/colony3-discovery-v4-proof";

async function seedTheme(page: Page, dark: boolean) {
  const relayUrl = "ws://localhost:3000";
  const theme = dark ? "buzz-dark" : "buzz";
  await page.emulateMedia({ colorScheme: dark ? "dark" : "light" });
  await page.addInitScript(
    ({ themeName, activeRelayUrl }) => {
      window.localStorage.setItem("buzz-theme", themeName);
      window.localStorage.setItem("buzz-follow-system", "false");
      window.localStorage.setItem("buzz-accent-color", "#5B45BE");
      window.localStorage.setItem(
        "buzz-community-theme.v1:" +
          "deadbeef".repeat(8) +
          ":" +
          encodeURIComponent(activeRelayUrl),
        JSON.stringify({
          version: 1,
          theme: themeName,
          accent: "#5B45BE",
          followSystem: false,
        }),
      );
    },
    { themeName: theme, activeRelayUrl: relayUrl },
  );
}

async function openDiscovery(
  page: Page,
  width: number,
  height: number,
  dark = false,
) {
  await page.setViewportSize({ width, height });
  await seedTheme(page, dark);
  await installDiscoveryImageMocks(page);
  await installMockBridge(page, {
    referenceWorkspace: true,
    colony3Sidebar: true,
    windowFullscreen: true,
  });
  await page.goto("/#/discovery", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("w10-discovery-page")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.classList.contains("dark")),
    )
    .toBe(dark);
  await expectNoHorizontalOverflow(page);
}

async function expectNoHorizontalOverflow(page: Page) {
  const discovery = page.getByTestId("w10-discovery-page");
  await expect
    .poll(() =>
      discovery.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    )
    .toBe(true);
}

async function capture(page: Page, name: string) {
  mkdirSync(PROOF_DIR, { recursive: true });
  await waitForAnimations(page);
  await page.screenshot({
    animations: "disabled",
    fullPage: true,
    path: path.join(PROOF_DIR, name),
  });
}

async function captureIndustry(page: Page, keyboard = false) {
  const industryButton = page.getByRole("button", {
    name: /Travel & Tourism/,
  });
  if (keyboard) {
    await industryButton.focus();
    await page.keyboard.press("Enter");
  } else {
    await industryButton.click();
  }
  const heading = page.getByRole("heading", { name: "Travel & Tourism" });
  await expect(heading).toBeVisible();
  const discovery = page.getByTestId("w10-discovery-page");
  await discovery.evaluate((element) => {
    element.scrollTop = 0;
  });

  const cover = page.locator(".d4-industry-cover img");
  await expect
    .poll(() =>
      cover.evaluate((image) => (image as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(0);

  const firstTypeImage = page.locator(".d4-type-image img").first();
  await firstTypeImage.scrollIntoViewIfNeeded();
  await expect
    .poll(() =>
      firstTypeImage.evaluate(
        (image) => (image as HTMLImageElement).naturalWidth,
      ),
    )
    .toBeGreaterThan(0);
  await discovery.evaluate((element) => {
    element.scrollTop = 0;
  });
  await expectNoHorizontalOverflow(page);
}

test("Discovery v4 covers the industry to business type to campaign flow", async ({
  page,
}) => {
  await openDiscovery(page, 1440, 900);
  const discovery = page.getByTestId("w10-discovery-page");
  await expect(discovery.locator(".d4-industry-card")).toHaveCount(51);
  await expect(
    discovery.locator(".d4-industry-card-image img").first(),
  ).toHaveAttribute("loading", "lazy");

  await captureIndustry(page, true);
  const categoryCover = discovery.locator(".d4-industry-cover img");
  await expect(categoryCover).toHaveAttribute(
    "src",
    "https://colony.global/discovery/covers/v1/travel-tourism-1200.webp",
  );
  const accommodation = discovery.getByRole("button", {
    name: /^Accommodation \d+$/,
  });
  await accommodation.focus();
  await page.keyboard.press("Enter");

  const search = discovery.getByRole("textbox", {
    name: "Search business types in Travel & Tourism",
  });
  await search.fill("guest house");
  const guesthouses = discovery.getByTestId(
    "discovery-type-card-guesthouses-and-inns",
  );
  await expect(guesthouses).toBeVisible();
  await expect(guesthouses.locator(".d4-type-image img")).toHaveAttribute(
    "src",
    "https://colony.global/discovery/covers/v1/guesthouses-and-inns-640.webp",
  );

  await guesthouses
    .getByRole("button", {
      name: "Add Guesthouses and inns from selection",
    })
    .click();
  await expect(discovery.getByText("1 business type selected")).toBeVisible();
  await discovery.getByRole("button", { name: "View selection" }).click();
  const selection = page.getByRole("dialog");
  await expect(
    selection.getByRole("heading", { name: "1 business type" }),
  ).toBeVisible();
  await selection.getByRole("button", { name: "Keep exploring" }).click();

  await guesthouses
    .getByRole("button", { name: "Details for Guesthouses and inns" })
    .click();
  const details = page.getByRole("dialog");
  await expect(
    details.getByRole("heading", { name: "Guesthouses and inns" }),
  ).toBeVisible();
  await expect
    .poll(() =>
      details.evaluate((dialog) => dialog.contains(document.activeElement)),
    )
    .toBe(true);
  const lastDialogControl = details
    .locator(
      'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )
    .last();
  await lastDialogControl.focus();
  await page.keyboard.press("Tab");
  await expect
    .poll(() =>
      details.evaluate((dialog) => dialog.contains(document.activeElement)),
    )
    .toBe(true);
  await page.keyboard.press("Escape");
  await expect(details).toBeHidden();

  await guesthouses
    .getByRole("button", { name: "Details for Guesthouses and inns" })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Find prospects" })
    .click();
  await expect(
    page.getByRole("dialog").getByRole("heading", {
      name: "Find the right fit.",
    }),
  ).toBeVisible();
});

test("Discovery v4 desktop light screenshot", async ({ page }) => {
  await openDiscovery(page, 1440, 900);
  await capture(page, "discovery-1440x900-light.png");
  await captureIndustry(page);
  await capture(page, "discovery-category-1440x900-light.png");
});

test("Discovery v4 phone light screenshot", async ({ page }) => {
  await openDiscovery(page, 390, 844);
  await capture(page, "discovery-390x844-light.png");
  await captureIndustry(page);
  await capture(page, "discovery-category-390x844-light.png");
});

test("Discovery v4 desktop dark screenshot", async ({ page }) => {
  await openDiscovery(page, 1440, 900, true);
  await capture(page, "discovery-1440x900-dark.png");
  await captureIndustry(page);
  await capture(page, "discovery-category-1440x900-dark.png");
});

test("Discovery v4 phone dark screenshot", async ({ page }) => {
  await openDiscovery(page, 390, 844, true);
  await capture(page, "discovery-390x844-dark.png");
  await captureIndustry(page);
  await capture(page, "discovery-category-390x844-dark.png");
});
