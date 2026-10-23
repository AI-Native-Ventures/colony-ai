import { mkdirSync, writeFileSync } from "node:fs";
import { expect, type Locator, type Page, test } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import {
  COLONY3_AGENT_PUBKEYS,
  installColony3Agents,
  seedColony3AgentsWorking,
  type Colony3AgentsOptions,
} from "../helpers/colony3-agents-fixture";
import { COLONY3_NOW } from "../helpers/colony3Fixture";

/**
 * Colony 3.0 Agents proof. Captures the Agents directory and the single agent
 * page (header and overview, model and runtime, instructions) at the boards'
 * size with the Lerato Social fixture, so `scripts/colony3-compare.mjs` and
 * `scripts/colony3-proof-report.mjs` can lay each capture next to the design.
 * Not a regression gate: it writes PNGs and checks that each state can be
 * reached.
 *
 * COLONY3_PROOF_DIR chooses where the captures land.
 */
const OUT = process.env.COLONY3_PROOF_DIR ?? "test-results/colony3-agents-proof";

type Rect = [x: number, y: number, width: number, height: number];
type Capture = {
  name: string;
  /** Reference board the capture is judged against. */
  board: string;
  /** Part of the board the capture covers; the whole board when omitted. */
  refRect?: Rect;
  title: string;
};
const captures: Capture[] = [];

test.describe.configure({ mode: "serial", timeout: 120_000 });

test.afterAll(() => {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/captures.json`, JSON.stringify(captures, null, 2));
});

/** The profile board's sample times: Aya last started at 13:20, task from 13:02. */
const PROFILE_NOW = "2026-10-23T13:30:00+02:00";

async function openAgents(
  page: Page,
  route: string,
  options: Colony3AgentsOptions & {
    width?: number;
    now?: string;
    ayaWorking?: boolean;
  } = {},
) {
  mkdirSync(OUT, { recursive: true });
  await page.setViewportSize({ width: options.width ?? 1440, height: 960 });
  await page.clock.setFixedTime(new Date(options.now ?? COLONY3_NOW));
  await installColony3Agents(page, options);
  await page.goto(route);
  await expect(page.getByTestId("app-sidebar")).toBeVisible();
  await seedColony3AgentsWorking(
    page,
    options.ayaWorking ? { aya: { startedAgoMs: 28 * 60_000 } } : {},
  );
  await page.waitForTimeout(1500);
  await waitForAnimations(page);
}

async function shot(
  page: Page,
  capture: Capture,
  target?: Locator | { x: number; y: number; width: number; height: number },
) {
  await waitForAnimations(page);
  const path = `${OUT}/${capture.name}.png`;
  if (target && "screenshot" in target) {
    const box = await target.boundingBox();
    if (!box) throw new Error(`No box to capture for ${capture.name}`);
    await page.screenshot({
      animations: "disabled",
      clip: {
        x: Math.round(box.x),
        y: Math.round(box.y),
        width: Math.round(box.width),
        height: Math.round(box.height),
      },
      path,
    });
  } else {
    await page.screenshot({ animations: "disabled", clip: target, path });
  }
  captures.push(capture);
}

test("Agents board", async ({ page }) => {
  // The board's footer reads "Rows 10".
  await openAgents(page, "/#/agents?rows=10");
  await expect(page.getByTestId("agent-directory")).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(7);
  await shot(page, {
    name: "Agents",
    board: "Agents",
    title: "Agents: the flat directory",
  });
});

test("Agent profile board", async ({ page }) => {
  await openAgents(page, `/#/agents?agent=${COLONY3_AGENT_PUBKEYS.aya}`, {
    ayaLastStartedAt: "2026-10-23T13:20:00+02:00",
    ayaNeedsRestart: true,
    ayaWorking: true,
    now: PROFILE_NOW,
  });
  await expect(page.getByTestId("agent-profile")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Aya", level: 1 })).toBeVisible();
  await shot(page, {
    name: "AgentProfile",
    board: "AgentProfile",
    title: "Agent profile: header and overview (the rail is cut)",
  });
});

/**
 * The unified page has no section rail, so its cards are wider than the
 * boards'. At 1192 px the page's content column is 832 px, the boards' own
 * column, and each card is captured by itself against the same card cropped
 * out of the board rendered tall (`ref/<Board>-tall.png`, see
 * `render-tall.cjs` in the proof folder). Crops are [x, y, w, h].
 */
const PART_WIDTH = 1192;
const PROFILE_PARTS: Array<[string, string, Rect]> = [
  ["about", "about", [568, 312, 832, 123]],
  ["config", "config", [568, 451, 832, 221]],
  ["where", "where", [568, 688, 408, 162]],
  ["who", "who", [992, 688, 408, 162]],
  ["current-work", "current-work", [568, 866, 832, 120]],
  ["last-error", "last-error", [568, 1002, 408, 151]],
];

test("Agent profile cards", async ({ page }) => {
  await openAgents(page, `/#/agents?agent=${COLONY3_AGENT_PUBKEYS.aya}`, {
    ayaLastStartedAt: "2026-10-23T13:20:00+02:00",
    ayaWorking: true,
    now: PROFILE_NOW,
    width: PART_WIDTH,
  });
  await expect(page.getByTestId("agent-profile")).toBeVisible();
  for (const [id, label, refRect] of PROFILE_PARTS) {
    const card = page.locator(`[aria-labelledby="${id}"]`);
    await card.scrollIntoViewIfNeeded();
    await expect(card).toBeVisible();
    await shot(
      page,
      {
        name: `AgentProfile-${label}`,
        board: "AgentProfile-tall",
        refRect,
        title: `Agent profile card: ${label}`,
      },
      card,
    );
  }
});

test("Agent model and runtime cards", async ({ page }) => {
  await openAgents(page, `/#/agents?agent=${COLONY3_AGENT_PUBKEYS.aya}`, {
    width: PART_WIDTH,
  });
  const heading = page.locator("#runtime");
  await heading.scrollIntoViewIfNeeded();
  await expect(page.getByTestId("agent-model-selection")).toBeVisible();
  await shot(
    page,
    {
      name: "AgentRuntime-heading",
      board: "AgentRuntime-tall",
      refRect: [568, 312, 832, 30],
      title: "Model and runtime: heading",
    },
    heading,
  );
  const parts: Array<[string, string, Rect]> = [
    ["agent-model-selection", "model-selection", [568, 358, 832, 262]],
    ["agent-harness-account", "harness-account", [568, 636, 832, 277]],
    ["agent-reported-values", "reported-values", [568, 929, 832, 153]],
  ];
  for (const [testId, label, refRect] of parts) {
    const card = page.getByTestId(testId);
    await card.scrollIntoViewIfNeeded();
    await shot(
      page,
      {
        name: `AgentRuntime-${label}`,
        board: "AgentRuntime-tall",
        refRect,
        title: `Model and runtime card: ${label}`,
      },
      card,
    );
  }
});

test("Agent instructions editor", async ({ page }) => {
  await openAgents(page, `/#/agents?agent=${COLONY3_AGENT_PUBKEYS.aya}`, {
    width: PART_WIDTH,
  });
  const editor = page.getByTestId("agent-system-instructions");
  await editor.scrollIntoViewIfNeeded();
  // The board shows an edit in progress; a trailing space is invisible.
  await editor.fill(`${await editor.inputValue()} `);
  const form = page.getByTestId("agent-instructions");
  await form.scrollIntoViewIfNeeded();
  await expect(page.getByText("Unsaved changes · applies on the next start")).toBeVisible();
  await shot(
    page,
    {
      name: "AgentInstructions-form",
      board: "AgentInstructions-tall",
      refRect: [568, 224, 832, 761],
      title: "Agent instructions: the editor",
    },
    form,
  );
});
