import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge, TEST_IDENTITIES } from "../helpers/bridge";
import { test } from "./cofounder-map-test";
import {
  AYA_PUBKEY,
  fixture,
  functionHead,
  seedCofounderTheme,
  selectMapPart,
} from "./cofounder-map-fixtures";

const PREBUILT_HIRE_CAPTURE_ENABLED =
  process.env.COLONY_PREBUILT_HIRE_CAPTURE === "1";
const PREBUILT_HIRE_SCREENSHOT_DIR =
  process.env.COLONY_PREBUILT_HIRE_SCREENSHOT_DIR ??
  "test-results/prebuilt-hire";
const PREBUILT_HIRE_BOARD_DIR =
  "/Users/mac/.claude/coord-work/colony-prebuilt/renders";
const PREBUILT_HIRE_CHANNEL = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "general",
};

type PrebuiltHireTheme = "light" | "dark";
type PrebuiltHireViewport = { width: number; height: number };

function prebuiltHireScreenshotPath(
  screenshotDir: string,
  name: string,
  theme: PrebuiltHireTheme,
  viewport: PrebuiltHireViewport,
) {
  return join(
    screenshotDir,
    `${name}-${theme}-${viewport.width}x${viewport.height}.png`,
  );
}

async function capturePrebuiltHireBoard(
  page: Page,
  screenshotDir: string,
  name: string,
  theme: PrebuiltHireTheme,
  viewport: PrebuiltHireViewport,
) {
  const path = prebuiltHireScreenshotPath(screenshotDir, name, theme, viewport);
  await waitForAnimations(page);
  await page.screenshot({
    animations: "disabled",
    fullPage: false,
    path,
  });
  return path;
}

async function capturePrebuiltHireComparison(
  page: Page,
  board:
    | "PbSales"
    | "PbFinance"
    | "PbHireFirst"
    | "PbHireNext"
    | "PbFirstMove"
    | "PbSpotStates",
  appScreenshot: string,
  screenshotDir: string,
) {
  const boardPath = join(PREBUILT_HIRE_BOARD_DIR, `${board}.png`);
  const boardHeight = board === "PbHireNext" ? 1000 : 900;
  const boardImage = readFileSync(boardPath).toString("base64");
  const appImage = readFileSync(appScreenshot).toString("base64");

  await page.setViewportSize({ width: 2880, height: boardHeight });
  await page.setContent(`
    <!doctype html>
    <html lang="en">
      <head>
        <style>
          * { box-sizing: border-box; }
          html, body { margin: 0; width: 2880px; height: ${boardHeight}px; overflow: hidden; }
          main { display: flex; width: 2880px; height: ${boardHeight}px; background: #fff; }
          img { display: block; width: 1440px; height: ${boardHeight}px; object-fit: cover; }
        </style>
      </head>
      <body>
        <main>
          <img alt="Approved ${board} board" src="data:image/png;base64,${boardImage}" />
          <img alt="Implemented ${board} state" src="data:image/png;base64,${appImage}" />
        </main>
      </body>
    </html>
  `);
  await expect(page.getByRole("img")).toHaveCount(2);
  await waitForAnimations(page);
  await page.screenshot({
    animations: "disabled",
    fullPage: false,
    path: join(screenshotDir, `${board}-compare.png`),
  });
}

function fixtureWithPrebuiltFinanceHead() {
  const base = fixture({
    includeScout: true,
    identity: TEST_IDENTITIES.tyler,
    functionHeads: [
      functionHead("sales", "filled", AYA_PUBKEY),
      functionHead("finance", "filled", AYA_PUBKEY),
      functionHead("operations", "covered_by_scout"),
    ],
  });
  return {
    ...base,
    searchProfiles: base.searchProfiles.map((profile) =>
      profile.pubkey === AYA_PUBKEY
        ? { ...profile, displayName: "Head of Finance" }
        : profile,
    ),
    relayAgents: base.relayAgents.map((agent) =>
      agent.pubkey === AYA_PUBKEY
        ? { ...agent, name: "Head of Finance" }
        : agent,
    ),
    managedAgents: base.managedAgents.map((agent) =>
      agent.pubkey === AYA_PUBKEY
        ? { ...agent, name: "Head of Finance" }
        : agent,
    ),
  };
}

async function preparePrebuiltHireCapture(
  page: Page,
  theme: PrebuiltHireTheme,
  viewport: PrebuiltHireViewport,
  mock = {
    ...fixture({ includeScout: true, identity: TEST_IDENTITIES.tyler }),
    visualChannels: [PREBUILT_HIRE_CHANNEL],
  },
) {
  await page.addInitScript(() => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith("company-map-prebuilt-")) {
        localStorage.removeItem(key);
      }
    }
  });
  await seedCofounderTheme(page, theme);
  await installMockBridge(page, mock, { identity: TEST_IDENTITIES.tyler });
  await page.emulateMedia({ colorScheme: theme });
  await page.setViewportSize(viewport);
  await page.goto("/#/company/map");
  await expect(page.getByTestId("cofounder-map-stage")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.classList.contains("dark")),
    )
    .toBe(theme === "dark");
}

async function choosePrebuiltRuntimeAndModel(page: Page) {
  await page.getByTestId("prebuilt-hire-harness").selectOption("goose");
  const model = page.getByTestId("prebuilt-hire-model");
  await expect(model.locator("option").nth(1)).toBeAttached();
  await model.selectOption({ index: 1 });
  const effort = page.getByTestId("prebuilt-hire-effort");
  if (await effort.isEnabled()) {
    await expect(effort.locator("option").nth(1)).toBeAttached();
    await effort.selectOption({ index: 1 });
  }
  await expect(page.getByTestId("prebuilt-hire-finish")).toBeEnabled();
}

test.describe("prebuilt head visual proof", () => {
  for (const theme of ["light", "dark"] as const) {
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 1728, height: 1117 },
    ] as const) {
      test(`captures prebuilt head board states in ${theme} at ${viewport.width}x${viewport.height}`, async ({
        page,
      }) => {
        test.skip(
          !PREBUILT_HIRE_CAPTURE_ENABLED,
          "The prebuilt proof capture only runs when explicitly requested.",
        );
        test.setTimeout(120_000);
        mkdirSync(PREBUILT_HIRE_SCREENSHOT_DIR, { recursive: true });
        await preparePrebuiltHireCapture(page, theme, viewport);

        await selectMapPart(page, "sales", "Sales");
        const salesScreenshot = await capturePrebuiltHireBoard(
          page,
          PREBUILT_HIRE_SCREENSHOT_DIR,
          "PbSales",
          theme,
          viewport,
        );

        await selectMapPart(page, "finance", "Finance");
        const financeScreenshot = await capturePrebuiltHireBoard(
          page,
          PREBUILT_HIRE_SCREENSHOT_DIR,
          "PbFinance",
          theme,
          viewport,
        );

        await page.getByTestId("cofounder-hire-head-finance").click();
        const dialog = page.getByTestId("prebuilt-head-hire-dialog");
        await expect(dialog).toBeVisible();
        const firstHireScreenshot = await capturePrebuiltHireBoard(
          page,
          PREBUILT_HIRE_SCREENSHOT_DIR,
          "PbHireFirst",
          theme,
          viewport,
        );

        await choosePrebuiltRuntimeAndModel(page);
        await page.getByTestId("prebuilt-hire-finish").click();
        await expect(dialog).toBeHidden();
        await expect(page.getByTestId("cofounder-map-part-card")).toContainText(
          "Just hired",
        );
        const firstMoveScreenshot = await capturePrebuiltHireBoard(
          page,
          PREBUILT_HIRE_SCREENSHOT_DIR,
          "PbFirstMove",
          theme,
          viewport,
        );

        await selectMapPart(page, "brand", "Brand");
        await page.getByTestId("cofounder-hire-head-brand").click();
        await expect(dialog).toBeVisible();
        await capturePrebuiltHireBoard(
          page,
          PREBUILT_HIRE_SCREENSHOT_DIR,
          "PbHireNext",
          theme,
          viewport,
        );

        let nextHireComparisonSource: string | null = null;
        if (
          theme === "light" &&
          viewport.width === 1440 &&
          viewport.height === 900
        ) {
          const comparisonSourceDir = join(
            PREBUILT_HIRE_SCREENSHOT_DIR,
            ".compare-sources",
          );
          mkdirSync(comparisonSourceDir, { recursive: true });
          nextHireComparisonSource = join(
            comparisonSourceDir,
            "PbHireNext-light-1440x1000.png",
          );
          await page.setViewportSize({ width: 1440, height: 1000 });
          await waitForAnimations(page);
          await page.screenshot({
            animations: "disabled",
            fullPage: false,
            path: nextHireComparisonSource,
          });
          await page.setViewportSize(viewport);
        }

        await dialog.getByRole("button", { name: "Not yet" }).click();
        await expect(dialog).toBeHidden();
        await selectMapPart(page, "operations", "Operations");
        await expect(page.getByTestId("cofounder-map-part-card")).toContainText(
          "Scout runs Operations for now.",
        );
        const scoutScreenshot = await capturePrebuiltHireBoard(
          page,
          PREBUILT_HIRE_SCREENSHOT_DIR,
          "PbSpotStates-scout",
          theme,
          viewport,
        );

        if (
          theme === "light" &&
          viewport.width === 1440 &&
          viewport.height === 900 &&
          nextHireComparisonSource
        ) {
          await capturePrebuiltHireComparison(
            page,
            "PbSales",
            salesScreenshot,
            PREBUILT_HIRE_SCREENSHOT_DIR,
          );
          await capturePrebuiltHireComparison(
            page,
            "PbFinance",
            financeScreenshot,
            PREBUILT_HIRE_SCREENSHOT_DIR,
          );
          await capturePrebuiltHireComparison(
            page,
            "PbHireFirst",
            firstHireScreenshot,
            PREBUILT_HIRE_SCREENSHOT_DIR,
          );
          await capturePrebuiltHireComparison(
            page,
            "PbHireNext",
            nextHireComparisonSource,
            PREBUILT_HIRE_SCREENSHOT_DIR,
          );
          await capturePrebuiltHireComparison(
            page,
            "PbFirstMove",
            firstMoveScreenshot,
            PREBUILT_HIRE_SCREENSHOT_DIR,
          );
          await capturePrebuiltHireComparison(
            page,
            "PbSpotStates",
            scoutScreenshot,
            PREBUILT_HIRE_SCREENSHOT_DIR,
          );
        }
      });

      test(`captures the prebuilt hired-head state in ${theme} at ${viewport.width}x${viewport.height}`, async ({
        page,
      }) => {
        test.skip(
          !PREBUILT_HIRE_CAPTURE_ENABLED,
          "The prebuilt proof capture only runs when explicitly requested.",
        );
        test.setTimeout(120_000);
        mkdirSync(PREBUILT_HIRE_SCREENSHOT_DIR, { recursive: true });
        await preparePrebuiltHireCapture(page, theme, viewport, {
          ...fixtureWithPrebuiltFinanceHead(),
          visualChannels: [PREBUILT_HIRE_CHANNEL],
        });

        await selectMapPart(page, "finance", "Finance");
        const card = page.getByTestId("cofounder-map-part-card");
        await expect(card).toContainText("Head of Finance");
        await expect(card).toContainText("Works here");
        await expect(card).not.toContainText("Just hired");
        const hiredHeadScreenshot = await capturePrebuiltHireBoard(
          page,
          PREBUILT_HIRE_SCREENSHOT_DIR,
          "PbSpotStates-head",
          theme,
          viewport,
        );

        if (
          theme === "light" &&
          viewport.width === 1440 &&
          viewport.height === 900
        ) {
          await capturePrebuiltHireComparison(
            page,
            "PbSpotStates",
            hiredHeadScreenshot,
            PREBUILT_HIRE_SCREENSHOT_DIR,
          );
        }
      });
    }
  }
});
