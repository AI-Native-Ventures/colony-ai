import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";

import { KIND_TYPING_INDICATOR } from "../../src/shared/constants/kinds";
import { waitForAnimations } from "../helpers/animations";
import { installMockBridge, TEST_IDENTITIES } from "../helpers/bridge";

// The composer activity row used to read "Scout: Ran tool · <cli> channels
// list 2>&1 | head -50": the raw agent command, with the old product name.
// People see plain wording by default; the raw command is opt-in.

const AGENT = TEST_IDENTITIES.alice.pubkey;
const AGENTS_CHANNEL_ID = "94a444a4-c0a3-5966-ab05-530c6ddc2301";
const LIST_COMMAND = "buzz --format compact channels list 2>&1 | head -50";
const SEND_COMMAND =
  'echo "On it" | buzz messages send --channel dc25bbfd-1b2c-4d3e-8f90-123456789abc --content -';

// Agents are taught the `colony` command now. It must read exactly like the
// legacy `buzz` one: same plain labels, raw text only behind Show details.
const COLONY_LIST_COMMAND =
  "colony --format compact channels list 2>&1 | head -50";
const COLONY_SEND_COMMAND =
  'echo "On it" | colony messages send --channel dc25bbfd-1b2c-4d3e-8f90-123456789abc --content -';

const proof = process.env.ACTIVITY_PROOF_DIR;

test.use({ viewport: { width: 1728, height: 1117 } });

async function capture(page: Page, name: string) {
  if (!proof) return;
  await mkdir(proof, { recursive: true });
  await waitForAnimations(page);
  await page.screenshot({ path: `${proof}/${name}.png` });
}

function toolCallEvent(seq: number, toolCallId: string, command: string) {
  return {
    seq,
    timestamp: new Date().toISOString(),
    kind: "acp_read",
    agentIndex: 0,
    channelId: AGENTS_CHANNEL_ID,
    sessionId: "session-plain",
    turnId: "turn-plain",
    payload: {
      method: "session/update",
      params: {
        sessionId: "session-plain",
        update: {
          sessionUpdate: "tool_call",
          toolCallId,
          // Worst case: the harness uses the raw command as the title too.
          title: command,
          kind: "execute",
          status: "in_progress",
          rawInput: { command },
        },
      },
    },
  };
}

async function workingAgentRow(page: Page) {
  await page.goto("/");
  await page.getByTestId("channel-agents").click();
  await expect(page.getByTestId("chat-title")).toHaveText("agents");
  await expect
    .poll(() =>
      page.evaluate(
        ({ kind }) =>
          window.__BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?.({
            channelName: "agents",
            kind,
          }) ?? false,
        { kind: KIND_TYPING_INDICATOR },
      ),
    )
    .toBe(true);
  await page.evaluate((pubkey) => {
    window.__BUZZ_E2E_EMIT_MOCK_TYPING__?.({ channelName: "agents", pubkey });
  }, AGENT);
  const row = page.getByTestId("channel-composer-activity-row");
  await expect(page.getByTestId("bot-activity-composer-trigger")).toBeVisible();
  return row;
}

async function seedToolCalls(page: Page, commands: string[]) {
  await page.evaluate(
    ({ pubkey, events }) => {
      window.__BUZZ_E2E_SEED_OBSERVER_EVENTS__?.({
        agentPubkey: pubkey,
        events,
      });
    },
    {
      pubkey: AGENT,
      events: commands.map((command, index) =>
        toolCallEvent(index + 1, `call-${index + 1}`, command),
      ),
    },
  );
}

// Everything a person can see or hover in the row: rendered text, title and
// accessible names.
async function visibleTextAndNames(scope: Locator) {
  return scope.evaluate((root) => {
    const nodes = [root, ...Array.from(root.querySelectorAll("*"))];
    const names = nodes.flatMap((node) =>
      ["title", "aria-label", "aria-description", "alt"].flatMap((attr) => {
        const value = node.getAttribute(attr);
        return value ? [value] : [];
      }),
    );
    return [
      (root as HTMLElement).innerText,
      root.textContent ?? "",
      ...names,
    ].join("\n");
  });
}

test.describe("agent activity shows plain labels", () => {
  test.beforeEach(async ({ page }) => {
    await installMockBridge(page);
  });

  test("composer row shows a plain label and never the raw command", async ({
    page,
  }) => {
    const row = await workingAgentRow(page);
    await seedToolCalls(page, [LIST_COMMAND, SEND_COMMAND]);

    // The headline rotates through the recent activity.
    await expect(row).toContainText("Checking channels");
    await expect(row).toContainText("Sending a message", { timeout: 15_000 });
    await expect(row).not.toContainText("Ran tool");

    const text = await visibleTextAndNames(row);
    expect(text).not.toMatch(/buzz/i);
    expect(text).not.toContain("|");
    expect(text).not.toContain("--format");
    expect(text).not.toContain("dc25bbfd");
    await capture(page, "composer-default");
  });

  test("the colony command gets the same plain labels and stays hidden", async ({
    page,
  }) => {
    const row = await workingAgentRow(page);
    await seedToolCalls(page, [COLONY_LIST_COMMAND, COLONY_SEND_COMMAND]);

    await expect(row).toContainText("Checking channels");
    await expect(row).toContainText("Sending a message", { timeout: 15_000 });
    await expect(row).not.toContainText("Running a command");
    await expect(row).not.toContainText("Ran tool");

    const text = await visibleTextAndNames(row);
    expect(text).not.toMatch(/buzz/i);
    expect(text).not.toContain("colony --format");
    expect(text).not.toContain("colony messages");
    expect(text).not.toContain("|");
    expect(text).not.toContain("--format");
    expect(text).not.toContain("dc25bbfd");

    // The raw command is still one explicit click away.
    await page.getByTestId("bot-activity-details-trigger").click();
    const details = page.getByTestId("bot-activity-details");
    await expect(details).toContainText(COLONY_LIST_COMMAND);
    await expect(details).toContainText(COLONY_SEND_COMMAND);
  });

  test("Show details reveals the raw command and collapses again", async ({
    page,
  }) => {
    const row = await workingAgentRow(page);
    await seedToolCalls(page, [LIST_COMMAND, SEND_COMMAND]);
    await expect(row).toContainText("Checking channels");

    const toggle = page.getByTestId("bot-activity-details-trigger");
    const details = page.getByTestId("bot-activity-details");
    await expect(toggle).toHaveText("Show details");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(details).toHaveCount(0);
    // The toggle's own name is its text: no raw command in title or aria-label.
    expect(await toggle.getAttribute("title")).toBeNull();
    expect(await toggle.getAttribute("aria-label")).toBeNull();

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(details).toBeVisible();
    await expect(details).toContainText(LIST_COMMAND);
    await expect(details).toContainText(SEND_COMMAND);
    await capture(page, "composer-details-open");

    await toggle.click();
    await expect(details).toHaveCount(0);
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(await visibleTextAndNames(row)).not.toMatch(/buzz/i);

    // Not persisted: a reload starts collapsed again.
    await page.reload();
    await expect(page.getByTestId("bot-activity-details")).toHaveCount(0);
  });

  test("Show details works from the keyboard alone", async ({ page }) => {
    const row = await workingAgentRow(page);
    await seedToolCalls(page, [LIST_COMMAND]);
    await expect(row).toContainText("Checking channels");

    const toggle = page.getByTestId("bot-activity-details-trigger");
    const details = page.getByTestId("bot-activity-details");

    // Reachable by Tab from the activity trigger.
    await page.getByTestId("bot-activity-composer-trigger").focus();
    await page.keyboard.press("Tab");
    await expect(toggle).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(details).toContainText(LIST_COMMAND);

    await page.keyboard.press("Escape");
    await expect(details).toHaveCount(0);
    await expect(toggle).toBeFocused();

    await page.keyboard.press("Space");
    await expect(details).toContainText(LIST_COMMAND);
    await page.keyboard.press("Escape");
    await expect(details).toHaveCount(0);
  });

  test("transcript rows use the same plain wording by default", async ({
    page,
  }) => {
    await workingAgentRow(page);
    await seedToolCalls(page, [LIST_COMMAND, SEND_COMMAND]);
    await page.getByTestId("bot-activity-composer-trigger").click();
    await page
      .getByTestId(`bot-activity-composer-item-${AGENT}`)
      .click({ force: true });
    const panel = page.getByTestId("agent-session-thread-panel");
    await expect(panel).toBeVisible();

    const rows = panel.locator(
      '[data-testid="transcript-tool-item"], [data-testid="transcript-same-kind-summary"]',
    );
    await expect(rows.first()).toBeVisible();
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);
    for (let index = 0; index < count; index += 1) {
      const text = await visibleTextAndNames(rows.nth(index));
      // Closed details are not rendered, so innerText is what people see.
      const rendered = text.split("\n")[0] ?? "";
      expect(rendered).not.toMatch(/buzz/i);
      expect(rendered).not.toContain("|");
    }
    await capture(page, "transcript-default");
  });
});
