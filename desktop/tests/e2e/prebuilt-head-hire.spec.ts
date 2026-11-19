import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { TEST_IDENTITIES } from "../helpers/bridge";
import { test } from "./cofounder-map-test";
import {
  AYA_PUBKEY,
  fixture,
  functionHead,
  selectMapPart,
} from "./cofounder-map-fixtures";
import { prepareMapShell } from "./mapShellTestSupport";

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
const LONG_GOOSE_MODEL = "goose-claude-4-6-opus";

type PrebuiltHireTheme = "light" | "dark";
type PrebuiltHireViewport = { width: number; height: number };
type CommandLogEntry = { command: string; payload: unknown };

async function readCommandLog(page: Page): Promise<CommandLogEntry[]> {
  return page.evaluate(() => {
    return (
      (
        window as Window & {
          __BUZZ_E2E_COMMAND_LOG__?: CommandLogEntry[];
        }
      ).__BUZZ_E2E_COMMAND_LOG__ ?? []
    );
  });
}

function commandPayload<T>(
  entries: readonly CommandLogEntry[],
  command: string,
): T | null {
  const entry = [...entries]
    .reverse()
    .find((candidate) => candidate.command === command);
  return (entry?.payload as T | undefined) ?? null;
}

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
  await prepareMapShell(page, {
    cofounderEnabled: true,
    featureEnabled: true,
    height: viewport.height,
    identity: TEST_IDENTITIES.tyler,
    mock,
    theme,
    width: viewport.width,
  });
  await expect(page.getByTestId("cofounder-company-map")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.classList.contains("dark")),
    )
    .toBe(theme === "dark");
}

async function choosePrebuiltRuntimeAndModel(page: Page) {
  await page.getByTestId("prebuilt-hire-harness").click();
  await page.getByTestId("prebuilt-hire-harness-option-goose").click();
  const model = page.getByTestId("prebuilt-hire-model");
  await expect(model).toBeEnabled();
  await model.click();
  await page
    .locator("[data-testid^='prebuilt-hire-model-option-']")
    .first()
    .click();
  const effort = page.getByTestId("prebuilt-hire-effort");
  if (await effort.isEnabled()) {
    await effort.click();
    await page
      .locator("[data-testid^='prebuilt-hire-effort-option-']")
      .first()
      .click();
  }
  await expect(page.getByTestId("prebuilt-hire-finish")).toBeEnabled();
}

async function hireFinanceFromDesktopMap(page: Page) {
  await selectMapPart(page, "finance", "Finance");
  const card = page.getByTestId("cofounder-map-part-card");
  await page.getByTestId("cofounder-hire-head-finance").click();
  const dialog = page.getByTestId("prebuilt-head-hire-dialog");
  await expect(dialog).toBeVisible();
  await choosePrebuiltRuntimeAndModel(page);
  await page.getByTestId("prebuilt-hire-finish").click();
  await expect(dialog).toBeHidden();
  await expect(card).toContainText("Just hired");
  return card;
}

async function preparePrebuiltHireSidebar(
  page: Page,
  viewport: PrebuiltHireViewport,
) {
  await preparePrebuiltHireCapture(page, "light", viewport);
  await page.goto("/#/company/map");
  await expect(page.getByTestId("cofounder-company-map")).toBeVisible();
  if (viewport.width < 768) {
    await expect(page.getByTestId("cofounder-map-phone")).toBeVisible();
    return;
  }
  await expect(page.getByTestId("cofounder-map-stage")).toBeVisible();
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
        await expect(dialog).toContainText("Hire for Finance");
        await expect(dialog).toContainText("Head of Finance");
        await expect(dialog).toContainText(
          "Scout hands Finance over the moment you hire.",
        );
        await expect(dialog).toContainText("Pre-built agent.");
        await expect(dialog).not.toContainText(
          "Ask the owner for one invoice they are happy with, to copy its layout and terms.",
        );
        await expect(page.getByTestId("prebuilt-hire-channel")).toHaveCount(0);
        await expect(page.getByTestId("prebuilt-hire-finish")).toBeDisabled();
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
        await expect(page.getByTestId("cofounder-map-part-card")).toContainText(
          "Hi Lerato. I run Finance from here. To start, send me one invoice you are happy with. I will copy its layout and terms.",
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
        await expect(
          dialog.getByTestId("prebuilt-hire-choice-helper"),
        ).toHaveText("Same as your last hire. Change any of them.");
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

        await dialog.getByRole("button", { name: "Cancel" }).click();
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

test.describe("prebuilt head hiring journeys", () => {
  test("a long model label stays in its field and leaves optional effort neutral", async ({
    page,
  }) => {
    await preparePrebuiltHireCapture(page, "light", {
      width: 1440,
      height: 900,
    });
    await selectMapPart(page, "finance", "Finance");
    await page.getByTestId("cofounder-hire-head-finance").click();
    await choosePrebuiltRuntimeAndModel(page);

    const harness = page.getByTestId("prebuilt-hire-harness");
    const model = page.getByTestId("prebuilt-hire-model");
    const effort = page.getByTestId("prebuilt-hire-effort");
    const selectedModelLabel = model.locator(":scope > span > span");

    await expect(model).toHaveAttribute("data-value", LONG_GOOSE_MODEL);
    await expect(selectedModelLabel).toHaveText(LONG_GOOSE_MODEL);
    await expect(selectedModelLabel).toHaveAttribute("title", LONG_GOOSE_MODEL);
    expect(
      await selectedModelLabel.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          clientWidth: element.clientWidth,
          overflow: style.overflow,
          scrollWidth: element.scrollWidth,
          textOverflow: style.textOverflow,
          whiteSpace: style.whiteSpace,
        };
      }),
    ).toMatchObject({
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
    });
    expect(
      await selectedModelLabel.evaluate(
        (element) => element.scrollWidth > element.clientWidth,
      ),
    ).toBe(true);

    await expect(effort).toBeDisabled();
    await expect(effort).toContainText("Set by this harness");
    await expect(effort).toHaveClass(/border-input/);
    await expect(effort).not.toHaveClass(/border-primary/);

    const [harnessBox, modelBox, effortBox] = await Promise.all([
      harness.boundingBox(),
      model.boundingBox(),
      effort.boundingBox(),
    ]);
    if (!harnessBox || !modelBox || !effortBox) {
      throw new Error("The prebuilt hire choice fields must be visible.");
    }
    expect(harnessBox.x + harnessBox.width).toBeLessThanOrEqual(modelBox.x);
    expect(modelBox.x + modelBox.width).toBeLessThanOrEqual(effortBox.x);
  });

  test("the map home hire delivers the visible greeting and keeps the agent reachable", async ({
    page,
  }) => {
    await preparePrebuiltHireCapture(page, "light", {
      width: 1440,
      height: 900,
    });
    await expect(page.getByTestId("cofounder-company-map")).toBeVisible();
    await selectMapPart(page, "finance", "Finance");
    const card = page.getByTestId("cofounder-map-part-card");
    await expect(card.locator(".company-map-card-actions > *")).toHaveText([
      "Hire Head of Finance",
      "Open Finance",
      "Close",
    ]);
    await page.getByTestId("cofounder-hire-head-finance").click();
    const dialog = page.getByTestId("prebuilt-head-hire-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).not.toContainText(
      "Ask the owner for one invoice they are happy with, to copy its layout and terms.",
    );
    await choosePrebuiltRuntimeAndModel(page);
    await page.getByTestId("prebuilt-hire-finish").click();
    await expect(dialog).toBeHidden();
    await expect(card).toContainText("Just hired");
    await expect(card).toContainText(
      "Hi Lerato. I run Finance from here. To start, send me one invoice you are happy with. I will copy its layout and terms.",
    );
    await expect(card).not.toContainText(
      "Ask the owner for one invoice they are happy with, to copy its layout and terms.",
    );
    await expect(card.getByAltText("Head of Finance avatar")).toHaveAttribute(
      "src",
      /data:image/,
    );

    await expect
      .poll(async () =>
        (await readCommandLog(page)).some(
          (entry) => entry.command === "start_managed_agent",
        ),
      )
      .toBe(true);
    const commandsAfterHire = await readCommandLog(page);
    const startPayload = commandPayload<{ pubkey?: string }>(
      commandsAfterHire,
      "start_managed_agent",
    );
    expect(startPayload?.pubkey).toMatch(/^[0-9a-f]{64}$/);

    await card.getByRole("link", { name: "Open direct chat" }).click();
    await expect(page.getByTestId("message-input")).toBeVisible();
    const ownerMessage = "Please confirm you have this invoice request.";
    await page.getByTestId("message-input").fill(ownerMessage);
    await page.getByTestId("send-message").click();
    await expect(page.getByTestId("message-timeline")).toContainText(
      ownerMessage,
    );
    const ownerSend = await page.evaluate((content) => {
      const frames =
        (
          window as Window & {
            __BUZZ_E2E_RELAY_FRAMES__?: Array<{ frame: unknown[] }>;
          }
        ).__BUZZ_E2E_RELAY_FRAMES__ ?? [];
      return frames
        .map(({ frame }) =>
          frame[0] === "EVENT"
            ? (frame[1] as {
                content?: string;
                tags?: string[][];
              })
            : null,
        )
        .findLast((event) => event?.content === content);
    }, ownerMessage);
    expect(ownerSend).toMatchObject({ content: ownerMessage });
    expect(
      ownerSend?.tags?.some(
        (tag) => tag[0] === "p" && tag[1] === startPayload?.pubkey,
      ),
    ).toBe(true);

    const agentReply = "I have it. I will copy the layout and terms first.";
    await page.evaluate(
      async ({ agentPubkey, channelId, content }) => {
        await window.__BUZZ_E2E_INVOKE_MOCK_COMMAND__?.(
          "send_managed_agent_channel_message",
          {
            agentPubkey,
            channelId,
            content,
            marker: "prebuilt-finance-owner-reply",
            markerScope: "agent",
          },
        );
      },
      {
        agentPubkey: startPayload?.pubkey ?? "",
        channelId: ownerSend?.tags?.find((tag) => tag[0] === "h")?.[1] ?? "",
        content: agentReply,
      },
    );
    await expect(page.getByTestId("message-timeline")).toContainText(
      agentReply,
    );
    const directChatAvatar = page
      .getByAltText(/Head of Finance.*avatar/u)
      .first();
    await expect(directChatAvatar).toHaveAttribute("src", /data:image/);
    expect(
      decodeURIComponent((await directChatAvatar.getAttribute("src")) ?? ""),
    ).toContain("#D9A83F");
  });

  test("the sidebar map keeps the same Finance hire journey", async ({
    page,
  }) => {
    await preparePrebuiltHireSidebar(page, { width: 1440, height: 900 });
    const card = await hireFinanceFromDesktopMap(page);
    await expect(card).toContainText("Just hired");
  });

  test("the phone map keeps Hire first and completes the Finance journey", async ({
    page,
  }) => {
    await preparePrebuiltHireSidebar(page, { width: 390, height: 844 });
    await expect(page.getByTestId("cofounder-map-phone")).toBeVisible();
    await page.getByTestId("cofounder-map-phone-finance").click();
    const card = page
      .getByTestId("cofounder-map-phone")
      .locator(".company-map-card--part");
    await expect(card).toBeVisible();
    await expect(card.locator(".company-map-card-actions > *")).toHaveText([
      "Hire Head of Finance",
      "Open Finance",
      "Close",
    ]);
    await page.getByTestId("cofounder-hire-head-phone-finance").click();
    await choosePrebuiltRuntimeAndModel(page);
    await page.getByTestId("prebuilt-hire-finish").click();
    await expect(card).toContainText("Just hired");
  });
});
