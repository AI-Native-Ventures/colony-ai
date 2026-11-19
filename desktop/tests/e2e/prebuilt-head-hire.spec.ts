import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { hexToBytes } from "@noble/hashes/utils.js";
import { finalizeEvent } from "nostr-tools/pure";
import { expect, type Page } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { TEST_IDENTITIES } from "../helpers/bridge";
import {
  KIND_HIRE_ACTION,
  KIND_HIRE_HEAD,
} from "../../src/shared/constants/kinds";
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
const RECOVERY_HIRE_ID = "11111111-2222-4333-8444-555555555555";
const RECOVERY_EMPLOYEE_PUBKEY = "c".repeat(64);

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

function approvedFinanceHireHead(relayPrivateKeyHex: string) {
  const proposal = {
    hireId: RECOVERY_HIRE_ID,
    rolePack: {
      personaId: "builtin:prebuilt-head-finance",
      title: "Head of Finance",
      job: "Head of Finance",
      skills: ["Keeps the money records clear."],
      tools: [],
      workerMenu: ["goose"],
    },
    displayName: "Head of Finance",
    title: "Head of Finance",
    introductionChannelId: PREBUILT_HIRE_CHANNEL.id,
    runtimeId: "goose",
    modelId: LONG_GOOSE_MODEL,
  };
  return finalizeEvent(
    {
      kind: KIND_HIRE_HEAD,
      created_at: 1_790_000_000,
      tags: [
        ["d", `company:hire:${RECOVERY_HIRE_ID}`],
        ["p", RECOVERY_EMPLOYEE_PUBKEY],
      ],
      content: JSON.stringify({
        schemaVersion: 1,
        proposal,
        status: "approved",
        proposedByPubkey: "a".repeat(64),
        founderPubkey: TEST_IDENTITIES.tyler.pubkey,
        employeePubkey: RECOVERY_EMPLOYEE_PUBKEY,
        sourceActionEventId: "b".repeat(64),
      }),
    },
    hexToBytes(relayPrivateKeyHex),
  );
}

function interruptedFinanceHireMock() {
  const base = fixture({
    identity: TEST_IDENTITIES.tyler,
    includeAya: false,
    includeScout: true,
  });
  return {
    ...base,
    companyHireHeads: [
      approvedFinanceHireHead(base.companyHireRelayPrivateKeyHex),
    ],
    companyAccessRecords: [
      {
        dTag: `company:slot-hire:${RECOVERY_HIRE_ID}`,
        content: {
          schemaVersion: 1,
          hireId: RECOVERY_HIRE_ID,
          function: "finance",
          setByPubkey: TEST_IDENTITIES.tyler.pubkey,
          updatedAt: 1_790_000_000,
        },
      },
    ],
    managedAgents: [
      ...base.managedAgents,
      {
        pubkey: RECOVERY_EMPLOYEE_PUBKEY,
        name: "Head of Finance",
        runtime: "goose",
        model: LONG_GOOSE_MODEL,
        status: "running" as const,
      },
    ],
    visualChannels: [PREBUILT_HIRE_CHANNEL],
  };
}

async function seedRecoveryDirectConversation(page: Page): Promise<string> {
  return page.evaluate(async (agentPubkey) => {
    const directChannel = (await window.__BUZZ_E2E_INVOKE_MOCK_COMMAND__?.(
      "open_dm",
      { pubkeys: [agentPubkey] },
    )) as { id?: string } | null | undefined;
    if (!directChannel?.id) {
      throw new Error(
        "Recovery fixture could not open its existing direct chat.",
      );
    }

    await window.__BUZZ_E2E_INVOKE_MOCK_COMMAND__?.("send_channel_message", {
      channelId: directChannel.id,
      content: "I need help with an invoice.",
      mentionPubkeys: [],
    });
    await window.__BUZZ_E2E_INVOKE_MOCK_COMMAND__?.(
      "send_managed_agent_channel_message",
      {
        agentPubkey,
        channelId: directChannel.id,
        content: "I can help with that.",
        marker: "prebuilt-recovery-existing-reply",
        markerScope: "agent",
      },
    );
    return directChannel.id;
  }, RECOVERY_EMPLOYEE_PUBKEY);
}

function parsedCompleteHireAction(entry: CommandLogEntry) {
  if (entry.command !== "sign_event") return null;
  const payload = entry.payload as { content?: unknown; kind?: unknown } | null;
  if (
    payload?.kind !== KIND_HIRE_ACTION ||
    typeof payload.content !== "string"
  ) {
    return null;
  }
  try {
    const action = JSON.parse(payload.content) as {
      action?: unknown;
      employeePubkey?: unknown;
      hireId?: unknown;
      introductionEventId?: unknown;
    };
    return action.action === "complete" && typeof action.hireId === "string"
      ? action
      : null;
  } catch {
    return null;
  }
}

async function assertPrebuiltHireSequence(page: Page, expectedHireId?: string) {
  await expect
    .poll(async () => {
      const commands = await readCommandLog(page);
      return commands.some((entry) => parsedCompleteHireAction(entry) !== null);
    })
    .toBe(true);
  const commands = await readCommandLog(page);
  const completionIndex = commands.findIndex(
    (entry) => parsedCompleteHireAction(entry) !== null,
  );
  const completionEntry = commands[completionIndex];
  const completion = completionEntry
    ? parsedCompleteHireAction(completionEntry)
    : null;
  expect(completion).not.toBeNull();
  const hireId = completion?.hireId;
  expect(hireId).toBe(expectedHireId ?? hireId);
  expect(typeof completion?.employeePubkey).toBe("string");
  expect(typeof completion?.introductionEventId).toBe("string");

  const introductionMarker = `company-prebuilt-hire:${hireId}:introduction`;
  const firstMessageMarker = `company-prebuilt-hire:${hireId}:first-message`;
  await expect
    .poll(async () => {
      const currentCommands = await readCommandLog(page);
      return currentCommands.filter(
        (entry) =>
          entry.command === "send_managed_agent_channel_message" &&
          (entry.payload as { marker?: string } | null)?.marker ===
            introductionMarker,
      ).length;
    })
    .toBe(1);
  await expect
    .poll(async () => {
      const currentCommands = await readCommandLog(page);
      return currentCommands.filter(
        (entry) =>
          entry.command === "send_managed_agent_channel_message" &&
          (entry.payload as { marker?: string } | null)?.marker ===
            firstMessageMarker,
      ).length;
    })
    .toBe(1);
  const completedCommands = await readCommandLog(page);
  const introductionIndex = completedCommands.findIndex(
    (entry) =>
      entry.command === "send_managed_agent_channel_message" &&
      (entry.payload as { marker?: string } | null)?.marker ===
        introductionMarker,
  );
  const firstMessageIndex = completedCommands.findIndex(
    (entry) =>
      entry.command === "send_managed_agent_channel_message" &&
      (entry.payload as { marker?: string } | null)?.marker ===
        firstMessageMarker,
  );
  const introductionPayload = completedCommands[introductionIndex]?.payload as
    | {
        agentPubkey?: string;
        channelId?: string;
        marker?: string;
        markerScope?: string;
      }
    | undefined;
  const firstMessagePayload = completedCommands[firstMessageIndex]?.payload as
    | {
        agentPubkey?: string;
        channelId?: string;
        marker?: string;
        markerScope?: string;
      }
    | undefined;
  expect(introductionIndex).toBeGreaterThanOrEqual(0);
  expect(firstMessageIndex).toBeGreaterThanOrEqual(0);
  expect(introductionIndex).toBeLessThan(completionIndex);
  expect(completionIndex).toBeLessThan(firstMessageIndex);
  expect(introductionPayload).toMatchObject({
    agentPubkey: completion?.employeePubkey,
    channelId: PREBUILT_HIRE_CHANNEL.id,
    marker: introductionMarker,
    markerScope: "agent",
  });
  expect(firstMessagePayload).toMatchObject({
    agentPubkey: completion?.employeePubkey,
    marker: firstMessageMarker,
    markerScope: "agent",
  });
  expect(firstMessagePayload?.channelId).not.toBe(PREBUILT_HIRE_CHANNEL.id);

  for (const [payload, marker] of [
    [introductionPayload, introductionMarker],
    [firstMessagePayload, firstMessageMarker],
  ] as const) {
    expect(
      await page.evaluate(
        async ({ agentPubkey, channelId, messageMarker }) =>
          Boolean(
            await window.__BUZZ_E2E_INVOKE_MOCK_COMMAND__?.(
              "has_managed_agent_channel_message_marker",
              {
                agentPubkey,
                channelId,
                marker: messageMarker,
                markerScope: "agent",
              },
            ),
          ),
        {
          agentPubkey: payload?.agentPubkey ?? "",
          channelId: payload?.channelId ?? "",
          messageMarker: marker,
        },
      ),
    ).toBe(true);
  }

  return {
    directChannelId: firstMessagePayload?.channelId,
    employeePubkey: completion?.employeePubkey,
    hireId,
  };
}

async function assertOneRecoveryGreeting(page: Page, directChannelId: string) {
  const sequence = await assertPrebuiltHireSequence(page, RECOVERY_HIRE_ID);
  expect(sequence.directChannelId).toBe(directChannelId);
  expect(sequence.employeePubkey).toBe(RECOVERY_EMPLOYEE_PUBKEY);
}

function startCommandsForEmployee(
  commands: readonly CommandLogEntry[],
  employeePubkey: string,
) {
  return commands.filter(
    (entry) =>
      entry.command === "start_managed_agent" &&
      (entry.payload as { pubkey?: string } | null)?.pubkey === employeePubkey,
  );
}

async function assertPreservedRecoveryConversation(page: Page) {
  await page
    .getByTestId("cofounder-map-part-card")
    .getByRole("link", { name: "Open direct chat" })
    .click();
  await expect(page.getByTestId("message-timeline")).toContainText(
    "I need help with an invoice.",
  );
  await expect(page.getByTestId("message-timeline")).toContainText(
    "I can help with that.",
  );
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
  test("a missing model stops the hire before an agent is created", async ({
    page,
  }) => {
    await preparePrebuiltHireCapture(page, "light", {
      width: 1440,
      height: 900,
    });
    await selectMapPart(page, "finance", "Finance");
    await page.getByTestId("cofounder-hire-head-finance").click();
    const dialog = page.getByTestId("prebuilt-head-hire-dialog");
    await expect(dialog).toBeVisible();
    await page.getByTestId("prebuilt-hire-harness").click();
    await page.getByTestId("prebuilt-hire-harness-option-goose").click();

    await expect(page.getByTestId("prebuilt-hire-finish")).toBeDisabled();
    await expect(
      dialog.getByText(
        "Choose a model before hiring. Colony will not create an agent without one.",
      ),
    ).toBeVisible();
    expect(
      (await readCommandLog(page)).filter(
        (entry) => entry.command === "create_managed_agent",
      ),
    ).toHaveLength(0);
  });

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
    // The mock rejects completion unless this marker belongs to the home-channel
    // introduction. A regression that supplies the direct-chat greeting here
    // leaves the dialog open and fails this journey.
    await assertPrebuiltHireSequence(page);
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
    const createPayload = commandPayload<{
      input?: { model?: string; modelOverride?: string };
    }>(commandsAfterHire, "create_managed_agent");
    expect(createPayload?.input).toMatchObject({
      model: LONG_GOOSE_MODEL,
      modelOverride: LONG_GOOSE_MODEL,
    });
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

  test("a saved employee-attached hire resumes without creating another agent", async ({
    page,
  }) => {
    await preparePrebuiltHireCapture(
      page,
      "light",
      { width: 1440, height: 900 },
      interruptedFinanceHireMock(),
    );
    const directChannelId = await seedRecoveryDirectConversation(page);
    await page.evaluate(
      ({ hireId, employeePubkey }) => {
        window.localStorage.setItem(
          "company-map-prebuilt-progress:v1:e2e-default-community:finance",
          JSON.stringify({
            hireId,
            functionId: "finance",
            agentId: "prebuilt-head-finance",
            introductionChannelId: "22222222-2222-4222-8222-222222222222",
            choice: {
              runtimeId: "goose",
              providerId: "",
              modelId: "goose-claude-4-6-opus",
            },
            employeePubkey,
          }),
        );
      },
      {
        employeePubkey: RECOVERY_EMPLOYEE_PUBKEY,
        hireId: RECOVERY_HIRE_ID,
      },
    );

    await selectMapPart(page, "finance", "Finance");
    await page.getByTestId("cofounder-hire-head-finance").click();
    const dialog = page.getByTestId("prebuilt-head-hire-dialog");
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId("prebuilt-hire-finish")).toBeEnabled();
    const commandsBeforeHire = await readCommandLog(page);
    const createdBeforeHire = commandsBeforeHire.filter(
      (entry) => entry.command === "create_managed_agent",
    ).length;

    await page.getByTestId("prebuilt-hire-finish").click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId("cofounder-map-part-card")).toContainText(
      "Just hired",
    );
    const createdAfterHire = (await readCommandLog(page)).filter(
      (entry) => entry.command === "create_managed_agent",
    ).length;
    expect(createdAfterHire).toBe(createdBeforeHire);
    await assertOneRecoveryGreeting(page, directChannelId);
    expect(
      startCommandsForEmployee(
        await readCommandLog(page),
        RECOVERY_EMPLOYEE_PUBKEY,
      ),
    ).toHaveLength(0);
    await assertPreservedRecoveryConversation(page);
  });

  test("a relay slot record restores an attached hire after local progress is lost", async ({
    page,
  }) => {
    await preparePrebuiltHireCapture(
      page,
      "light",
      { width: 1440, height: 900 },
      interruptedFinanceHireMock(),
    );
    const directChannelId = await seedRecoveryDirectConversation(page);
    await selectMapPart(page, "finance", "Finance");
    await page.getByTestId("cofounder-hire-head-finance").click();
    const dialog = page.getByTestId("prebuilt-head-hire-dialog");
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId("prebuilt-hire-finish")).toBeEnabled();
    await page.getByTestId("prebuilt-hire-finish").click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId("cofounder-map-part-card")).toContainText(
      "Just hired",
    );
    await assertOneRecoveryGreeting(page, directChannelId);
    expect(
      startCommandsForEmployee(
        await readCommandLog(page),
        RECOVERY_EMPLOYEE_PUBKEY,
      ),
    ).toHaveLength(0);
    await assertPreservedRecoveryConversation(page);
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
