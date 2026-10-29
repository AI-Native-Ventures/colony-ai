import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";
import { installDiscoveryImageMocks } from "../helpers/discoveryImages";
import { waitForAnimations } from "../helpers/animations";

const PROOF_DIR =
  process.env.COLONY3_DISCOVERY_TAGS_PROOF_DIR ??
  "test-results/colony3-discovery-tags-proof";

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

async function searchFor(page: Page, query: string) {
  await page
    .getByRole("textbox", { name: /^Search (industries and )?business types/ })
    .fill(query);
}

for (const [width, height] of [
  [390, 844],
  [1440, 900],
] as const) {
  for (const dark of [false, true]) {
    const mode = dark ? "dark" : "light";
    test(`Discovery tag search "sofa" shows the matched tag at ${String(width)} ${mode}`, async ({
      page,
    }) => {
      await openDiscovery(page, width, height, dark);
      await searchFor(page, "sofa");
      const card = page.getByTestId(
        "discovery-type-card-furniture-manufacturers",
      );
      await expect(card).toBeVisible();
      await expect(card).toContainText("Furniture manufacturers");
      const hint = page.getByTestId(
        "discovery-type-match-furniture-manufacturers",
      );
      await expect(hint).toBeVisible();
      await expect(hint).toHaveText(/^Matches: .*sofa/);
      // A name match carries no hint.
      await expect(
        page.getByTestId("discovery-type-match-sofa-couch-retailers"),
      ).toHaveCount(0);
      await expect(
        page.locator(".d4-global-type-grid .d4-type-card").first(),
      ).toHaveAttribute(
        "data-testid",
        "discovery-type-card-sofa-couch-retailers",
      );
      await expectNoHorizontalOverflow(page);
      await hint.scrollIntoViewIfNeeded();
      await capture(page, `sofa-${String(width)}-${mode}.png`);
    });
  }
}

test("Discovery tag search finds a South African term and keeps the name match first", async ({
  page,
}) => {
  await openDiscovery(page, 1440, 900);
  await searchFor(page, "spaza");
  await expect(
    page.getByTestId("discovery-type-card-convenience-stores"),
  ).toBeVisible();
  await searchFor(page, "guest house");
  await expect(
    page.locator(".d4-global-type-grid .d4-type-card").first(),
  ).toHaveAttribute("data-testid", "discovery-type-card-guesthouses-and-inns");
});

test("Discovery search inside an industry shows the hint too", async ({
  page,
}) => {
  await openDiscovery(page, 1440, 900);
  await page
    .getByRole("button", { name: /^Manufacturing/ })
    .first()
    .click();
  await searchFor(page, "sofa");
  await expect(
    page.getByTestId("discovery-type-match-furniture-manufacturers"),
  ).toBeVisible();
});
