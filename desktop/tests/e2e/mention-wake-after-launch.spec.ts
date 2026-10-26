import { expect, test, type Page } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

/**
 * GATE-303 (26 Oct, published 3.0.3): a mention sent 3.6 s after launch to a
 * stopped Scout was lost for good. The app had not yet heard from the host
 * about its agents, so the send decided nobody needed waking, and nothing else
 * ever looked at the message again.
 *
 * These specs pin what the person sees and what the host is asked to do when
 * the mention is sent while the host cannot list its agents, and when a
 * running agent never touches a mention: the agent is started, reaching back
 * to the mention, the conversation says so, and a silent agent is never left
 * silent.
 */

const AGENT_PUBKEY = "ab".repeat(32);
const SECOND = 1000;

test.use({ viewport: { width: 1280, height: 720 } });

type StartCall = {
  expectedRelayUrl?: string | null;
  forceRestart?: boolean | null;
  replayFloorUnix?: number | null;
};

async function readStartCalls(page: Page): Promise<StartCall[]> {
  return page.evaluate(() =>
    (
      (
        window as Window & {
          __BUZZ_E2E_COMMAND_LOG__?: Array<{
            command: string;
            payload: unknown;
          }>;
        }
      ).__BUZZ_E2E_COMMAND_LOG__ ?? []
    )
      .filter((entry) => entry.command === "start_managed_agent")
      .map((entry) => entry.payload as StartCall),
  );
}

async function pageNowSeconds(page: Page) {
  return page.evaluate(() => Math.floor(Date.now() / 1000));
}

async function callBridge(
  page: Page,
  name:
    | "__BUZZ_E2E_BLOCK_MANAGED_AGENT_LIST__"
    | "__BUZZ_E2E_RELEASE_MANAGED_AGENT_LIST__",
) {
  await page.evaluate((fn) => {
    (window as unknown as Record<string, () => void>)[fn]?.();
  }, name);
}

/** The agent's harness ends with no word; the app's cache has not heard yet. */
async function endHarness(page: Page) {
  await page.evaluate(
    (pubkey) =>
      (
        window as Window & {
          __BUZZ_E2E_END_MANAGED_AGENT__?: (pubkey: string) => Promise<void>;
        }
      ).__BUZZ_E2E_END_MANAGED_AGENT__?.(pubkey),
    AGENT_PUBKEY,
  );
}

async function openGeneral(page: Page) {
  await page.clock.install();
  await page.goto("/");
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");
}

async function pickScout(page: Page, text: string) {
  const input = page.getByTestId("message-input");
  await input.fill("Hey @scout");
  await expect(
    page
      .getByTestId("message-composer")
      .getByTestId("mention-autocomplete")
      .getByText("Scout"),
  ).toBeVisible();
  await input.press("Enter");
  await page.keyboard.type(` ${text}`);
}

async function mentionScout(page: Page, text: string) {
  await pickScout(page, text);
  await page.getByTestId("send-message").click();
}

/**
 * Moves the page clock on, running every timer due on the way, including the
 * ones that earlier timers schedule: the mock host answers each call on a
 * timer too, so a chain of reads and waits needs the clock to keep moving.
 */
async function advance(page: Page, totalMs: number, stepMs = 250) {
  for (let spent = 0; spent < totalMs; spent += stepMs) {
    await page.clock.runFor(Math.min(stepMs, totalMs - spent));
  }
}

function indicator(page: Page) {
  return page.getByTestId("channel-agent-working-indicator");
}

function scout(status: "stopped" | "running") {
  return {
    pubkey: AGENT_PUBKEY,
    name: "Scout",
    status,
    channelNames: ["general"],
  };
}

test.describe("a mention to an agent the app believes is fine", () => {
  // GATE-303: the app's picture of its agents was stale or missing when the
  // person pressed send. Here the cache still says running (the harness died
  // with no word) and the host cannot answer for a moment.

  test("is woken as soon as the host answers, and the conversation says so", async ({
    page,
  }) => {
    await installMockBridge(page, { managedAgents: [scout("running")] });
    await openGeneral(page);
    await pickScout(page, "are you there?");

    await endHarness(page);
    await callBridge(page, "__BUZZ_E2E_BLOCK_MANAGED_AGENT_LIST__");
    const sentAt = await pageNowSeconds(page);
    await page.getByTestId("send-message").click();

    // The send is still waiting for the host to confirm; it comes back.
    await callBridge(page, "__BUZZ_E2E_RELEASE_MANAGED_AGENT_LIST__");
    await advance(page, 1500);
    await expect(page.getByTestId("message-row").last()).toContainText(
      "are you there?",
    );

    await expect
      .poll(async () => (await readStartCalls(page)).length)
      .toBeGreaterThan(0);
    const [first] = await readStartCalls(page);
    expect(first.replayFloorUnix).toBeGreaterThan(0);
    expect(first.replayFloorUnix).toBeLessThanOrEqual(sentAt + 2);
    await expect(indicator(page)).toHaveAttribute("data-state", "starting");
    await expect(
      indicator(page).getByTestId("agent-working-indicator-label"),
    ).toContainText(/Scout is starting…/);
  });

  test("is found on the relay and the agent is started again when the send's own wake failed", async ({
    page,
  }) => {
    // The send's wake is refused (the host fails the start once). Whatever the
    // send did or failed to do, the relay still holds the mention and the agent
    // never touched it.
    await installMockBridge(page, {
      managedAgents: [scout("stopped")],
      startManagedAgentErrors: ["spawn failed"],
    });
    await openGeneral(page);

    const sentAt = await pageNowSeconds(page);
    await mentionScout(page, "are you there?");
    await advance(page, 2 * SECOND);
    await expect(indicator(page)).toHaveAttribute("data-state", "stalled");
    expect(await readStartCalls(page)).toHaveLength(1);

    // Shortly after the send the relay is asked, and the agent is started
    // again on its own, reaching back to the mention.
    await advance(page, 8 * SECOND);
    await expect
      .poll(async () => (await readStartCalls(page)).length)
      .toBeGreaterThan(1);
    const second = (await readStartCalls(page))[1];
    expect(second.replayFloorUnix).toBeGreaterThan(sentAt - 5);
    expect(second.replayFloorUnix).toBeLessThanOrEqual(sentAt + 2);
    expect(second.forceRestart ?? false).toBe(false);
    await expect(indicator(page)).toHaveAttribute("data-state", "starting");
  });
});

test.describe("a running agent that never touches a mention", () => {
  test("is not left silent: quiet at first, then a plain note with Try again", async ({
    page,
  }) => {
    await installMockBridge(page, { managedAgents: [scout("running")] });
    await openGeneral(page);

    const sentAt = await pageNowSeconds(page);
    await mentionScout(page, "are you there?");

    // A running agent has time to answer before anything is said.
    await advance(page, 8 * SECOND);
    await expect(indicator(page)).toHaveCount(0);

    // A minute of silence: the relay shows nobody touched the mention.
    await advance(page, 75 * SECOND, SECOND);
    await expect(indicator(page)).toHaveAttribute("data-state", "stalled");
    await expect(
      indicator(page).getByTestId("agent-working-indicator-label"),
    ).toHaveText("Scout hasn't picked this up yet.");

    // Try again replaces the harness and reaches back to the mention.
    await indicator(page)
      .getByRole("button", { name: "Try starting Scout again" })
      .click();
    await expect
      .poll(async () => {
        const calls = await readStartCalls(page);
        return calls.some((call) => call.forceRestart === true);
      })
      .toBe(true);
    const forced = (await readStartCalls(page)).find(
      (call) => call.forceRestart === true,
    );
    expect(forced?.replayFloorUnix).toBeLessThanOrEqual(sentAt + 2);
    expect(forced?.replayFloorUnix).toBeGreaterThan(sentAt - 5);
  });
});
