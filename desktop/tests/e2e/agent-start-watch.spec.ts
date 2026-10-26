import { expect, test, type Page } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

/**
 * GATE-302 (26 Oct, published 3.0.2): a mention to a stopped agent was lost.
 * The first harness went silent, the person saw nothing for 19 minutes, and
 * the next mention spawned a harness whose replay floor was the NEW message, so
 * the first one was skipped for good.
 *
 * These specs pin what the person sees and what the host is asked to do:
 * the conversation says the agent is starting, starts it again on its own once,
 * then says plainly that it has not picked the message up and offers Try again;
 * and every start reaches back to the oldest mention nobody answered.
 */

const AGENT_PUBKEY = "ab".repeat(32);
const SECOND = 1000;

test.use({ viewport: { width: 1280, height: 720 } });

type StartCall = {
  expectedRelayUrl?: string | null;
  forceRestart?: boolean | null;
  replayFloorUnix?: number | null;
};

async function readCommands(page: Page) {
  return page.evaluate(
    () =>
      (window as Window & { __BUZZ_E2E_COMMANDS__?: string[] })
        .__BUZZ_E2E_COMMANDS__ ?? [],
  );
}

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

/** The page clock in unix seconds: the clock the app stamps replay floors with. */
async function pageNowSeconds(page: Page) {
  return page.evaluate(() => Math.floor(Date.now() / 1000));
}

async function openGeneral(page: Page) {
  await page.clock.install();
  await page.goto("/");
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");
}

async function mentionScout(page: Page, text: string) {
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
  await page.getByTestId("send-message").click();
}

async function emitScoutTyping(page: Page) {
  await page.evaluate((pubkey) => {
    (
      window as Window & {
        __BUZZ_E2E_EMIT_MOCK_TYPING__?: (input: {
          channelName: string;
          pubkey?: string;
        }) => unknown;
      }
    ).__BUZZ_E2E_EMIT_MOCK_TYPING__?.({ channelName: "general", pubkey });
  }, AGENT_PUBKEY);
}

function indicator(page: Page) {
  return page.getByTestId("channel-agent-working-indicator");
}

function threadIndicator(page: Page) {
  return page.getByTestId("thread-agent-working-indicator");
}

async function openThread(page: Page) {
  await page.evaluate(() => {
    (
      window as Window & {
        __BUZZ_E2E_EMIT_MOCK_MESSAGE__?: (input: {
          channelName: string;
          content: string;
          parentEventId?: string;
        }) => unknown;
      }
    ).__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
      channelName: "general",
      content: "Reply to open the thread",
      parentEventId: "mock-general-welcome",
    });
  });
  await page.getByTestId("message-thread-summary").first().click();
  await expect(page.getByTestId("message-thread-panel")).toBeVisible();
}

test.describe("a mention to an agent that has to be started", () => {
  test("says the agent is starting, restarts it once, then offers Try again", async ({
    page,
  }) => {
    await installMockBridge(page, {
      managedAgents: [
        {
          pubkey: AGENT_PUBKEY,
          name: "Scout",
          status: "stopped",
          channelNames: ["general"],
        },
      ],
    });
    await openGeneral(page);

    await mentionScout(page, "are you there?");

    // From the send until the agent picks it up, the conversation says so.
    await expect(indicator(page)).toBeVisible();
    await expect(indicator(page)).toHaveAttribute("data-state", "starting");
    await expect(
      indicator(page).getByTestId("agent-working-indicator-label"),
    ).toContainText(/Scout is starting…/);
    await expect(page.getByTestId("agent-working-announcer")).toHaveText(
      "Scout is starting…",
    );

    await expect.poll(async () => (await readStartCalls(page)).length).toBe(1);
    const [first] = await readStartCalls(page);
    expect(first.replayFloorUnix).toBeGreaterThan(0);
    expect(first.forceRestart ?? false).toBe(false);

    // 20 s of silence: the agent is started again once, on its own, and the
    // new harness still reaches back to the first mention.
    await page.clock.fastForward(21 * SECOND);
    await expect.poll(async () => (await readStartCalls(page)).length).toBe(2);
    const [, restart] = await readStartCalls(page);
    expect(restart.replayFloorUnix).toBe(first.replayFloorUnix);
    expect(restart.forceRestart ?? false).toBe(false);
    await expect(indicator(page)).toHaveAttribute("data-state", "starting");

    // A minute of silence: never silence. A short plain note with a retry.
    await page.clock.fastForward(45 * SECOND);
    await expect(indicator(page)).toHaveAttribute("data-state", "stalled");
    await expect(
      indicator(page).getByTestId("agent-working-indicator-label"),
    ).toHaveText("Scout hasn't picked this up yet.");
    expect((await readStartCalls(page)).length).toBe(2);

    // The retry is a real button: reachable and operable from the keyboard.
    const retry = indicator(page).getByRole("button", {
      name: "Try starting Scout again",
    });
    await expect(retry).toBeVisible();
    await expect(retry).toHaveText("Try again");
    await retry.focus();
    await page.keyboard.press("Enter");

    await expect.poll(async () => (await readStartCalls(page)).length).toBe(3);
    const [, , retried] = await readStartCalls(page);
    expect(retried.forceRestart).toBe(true);
    expect(retried.replayFloorUnix).toBe(first.replayFloorUnix);
    await expect(indicator(page)).toHaveAttribute("data-state", "starting");

    // The agent picks the message up: the notice becomes the working notice
    // and nothing is started again.
    await emitScoutTyping(page);
    await expect(indicator(page)).toHaveAttribute("data-state", "working");
    await page.clock.fastForward(90 * SECOND);
    expect((await readStartCalls(page)).length).toBe(3);
  });

  test("a harness that died before reading the first mention is replaced by one that replays it", async ({
    page,
  }) => {
    await installMockBridge(page, {
      managedAgents: [
        {
          pubkey: AGENT_PUBKEY,
          name: "Scout",
          status: "stopped",
          channelNames: ["general"],
        },
      ],
    });
    await openGeneral(page);

    const firstSentAt = await pageNowSeconds(page);
    await mentionScout(page, "are you there?");
    await expect.poll(async () => (await readStartCalls(page)).length).toBe(1);
    const [first] = await readStartCalls(page);

    // The harness ends with no word (GATE-302). The next list says stopped.
    await page.evaluate(
      (pubkey) =>
        (
          window as Window & {
            __BUZZ_E2E_END_MANAGED_AGENT__?: (pubkey: string) => Promise<void>;
          }
        ).__BUZZ_E2E_END_MANAGED_AGENT__?.(pubkey),
      AGENT_PUBKEY,
    );
    const listsBefore = (await readCommands(page)).filter(
      (command) => command === "list_managed_agents",
    ).length;
    await page.clock.fastForward(6 * SECOND);
    await expect
      .poll(
        async () =>
          (await readCommands(page)).filter(
            (command) => command === "list_managed_agents",
          ).length,
      )
      .toBeGreaterThan(listsBefore);

    // The person mentions Scout again, a few seconds later.
    const secondSentAt = await pageNowSeconds(page);
    await mentionScout(page, "hello?");
    await expect.poll(async () => (await readStartCalls(page)).length).toBe(2);
    const [, second] = await readStartCalls(page);

    // The second message is well after the first, so a floor taken from the
    // second message (the old behavior) would have skipped the first mention.
    expect(secondSentAt - firstSentAt).toBeGreaterThanOrEqual(5);
    expect(first.replayFloorUnix).toBeLessThanOrEqual(firstSentAt + 2);
    expect(second.replayFloorUnix).toBe(first.replayFloorUnix);
    expect(second.replayFloorUnix).toBeLessThan(secondSentAt - 3);
  });

  test("a start that fails outright says so at once, and Try again replaces the harness", async ({
    page,
  }) => {
    await installMockBridge(page, {
      managedAgents: [
        {
          pubkey: AGENT_PUBKEY,
          name: "Scout",
          status: "stopped",
          channelNames: ["general"],
        },
      ],
      startManagedAgentErrors: ["spawn failed"],
    });
    await openGeneral(page);

    await mentionScout(page, "are you there?");

    await expect(indicator(page)).toHaveAttribute("data-state", "stalled");
    await expect(
      indicator(page).getByTestId("agent-working-indicator-label"),
    ).toHaveText("Scout hasn't picked this up yet.");

    await indicator(page)
      .getByRole("button", { name: "Try starting Scout again" })
      .click();
    await expect.poll(async () => (await readStartCalls(page)).length).toBe(2);
    const [first, retried] = await readStartCalls(page);
    expect(retried.forceRestart).toBe(true);
    expect(retried.replayFloorUnix).toBe(first.replayFloorUnix);
    await expect(indicator(page)).toHaveAttribute("data-state", "starting");
  });

  test("a mention sent inside a thread is waited on in that thread, not in the channel", async ({
    page,
  }) => {
    await installMockBridge(page, {
      managedAgents: [
        {
          pubkey: AGENT_PUBKEY,
          name: "Scout",
          status: "stopped",
          channelNames: ["general"],
        },
      ],
    });
    await openGeneral(page);
    await openThread(page);

    const panel = page.getByTestId("message-thread-panel");
    const input = panel.getByTestId("message-input");
    await input.fill("Hey @scout");
    await expect(
      panel.getByTestId("mention-autocomplete").getByText("Scout"),
    ).toBeVisible();
    await input.press("Enter");
    await page.keyboard.type(" are you there?");
    await panel.getByTestId("send-message").click();

    await expect(threadIndicator(page)).toHaveAttribute(
      "data-state",
      "starting",
    );
    await expect(
      threadIndicator(page).getByTestId("agent-working-indicator-label"),
    ).toContainText(/Scout is starting…/);
    // The main conversation says nothing: the person is waiting in the thread.
    await expect(indicator(page)).toHaveCount(0);

    await page.clock.fastForward(66 * SECOND);
    await expect(threadIndicator(page)).toHaveAttribute(
      "data-state",
      "stalled",
    );
    await expect(indicator(page)).toHaveCount(0);
  });

  test("an agent that was already running gets no starting notice", async ({
    page,
  }) => {
    await installMockBridge(page, {
      managedAgents: [
        {
          pubkey: AGENT_PUBKEY,
          name: "Scout",
          status: "running",
          channelNames: ["general"],
        },
      ],
    });
    await openGeneral(page);

    await mentionScout(page, "are you there?");

    await expect(page.getByTestId("message-row").last()).toContainText(
      "are you there?",
    );
    expect(await readStartCalls(page)).toHaveLength(0);
    await expect(indicator(page)).toHaveCount(0);
  });
});
