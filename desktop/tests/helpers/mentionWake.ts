import { expect, type Page } from "@playwright/test";

/**
 * Shared steps for the specs that follow a mention to a local agent through
 * the mock bridge: open the channel, pick Scout, send, move the page clock on
 * and read what the host was asked to start.
 */

export const AGENT_PUBKEY = "ab".repeat(32);
export const SECOND = 1000;

export type StartCall = {
  expectedRelayUrl?: string | null;
  forceRestart?: boolean | null;
  replayFloorUnix?: number | null;
};

export async function readStartCalls(page: Page): Promise<StartCall[]> {
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

export async function pageNowSeconds(page: Page) {
  return page.evaluate(() => Math.floor(Date.now() / 1000));
}

export async function callBridge(
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
export async function endHarness(page: Page) {
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

export async function openGeneral(page: Page) {
  await page.clock.install();
  await page.goto("/");
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");
}

export async function pickScout(page: Page, text: string) {
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

export async function mentionScout(page: Page, text: string) {
  await pickScout(page, text);
  await page.getByTestId("send-message").click();
}

/**
 * Moves the page clock on, running every timer due on the way, including the
 * ones that earlier timers schedule: the mock host answers each call on a
 * timer too, so a chain of reads and waits needs the clock to keep moving.
 */
export async function advance(page: Page, totalMs: number, stepMs = 250) {
  for (let spent = 0; spent < totalMs; spent += stepMs) {
    await page.clock.runFor(Math.min(stepMs, totalMs - spent));
  }
}

export function indicator(page: Page) {
  return page.getByTestId("channel-agent-working-indicator");
}

export function scout(status: "stopped" | "running") {
  return {
    pubkey: AGENT_PUBKEY,
    name: "Scout",
    status,
    channelNames: ["general"],
  };
}

type LoggedCommand = { command: string; payload: unknown };

/** Every command of these names the host was asked, in the order asked. */
export async function readCommands(
  page: Page,
  names: readonly string[],
): Promise<LoggedCommand[]> {
  return page.evaluate(
    (wanted) =>
      (
        (
          window as Window & {
            __BUZZ_E2E_COMMAND_LOG__?: Array<{
              command: string;
              payload: unknown;
            }>;
          }
        ).__BUZZ_E2E_COMMAND_LOG__ ?? []
      ).filter((entry) => wanted.includes(entry.command)),
    [...names],
  );
}

/** The id of the newest message in the conversation on screen. */
export async function lastMessageId(page: Page): Promise<string> {
  const id = await page
    .getByTestId("message-row")
    .last()
    .getAttribute("data-message-id");
  if (!id) throw new Error("the newest message row has no id");
  return id;
}

/**
 * The agent's harness queued a mention: it reacts with this emoji the moment
 * it does, and leaves it behind when it is stopped before it answers.
 */
export async function reactAsAgent(
  page: Page,
  mentionId: string,
  emoji = "👀",
  channelName = "general",
) {
  await page.evaluate(
    ({ pubkey, id, content, channel }) => {
      (
        window as Window & {
          __BUZZ_E2E_EMIT_MOCK_MESSAGE__?: (input: {
            channelName: string;
            content: string;
            pubkey: string;
            kind: number;
            extraTags: string[][];
          }) => unknown;
        }
      ).__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
        channelName: channel,
        content,
        pubkey,
        kind: 7,
        extraTags: [["e", id]],
      });
    },
    {
      pubkey: AGENT_PUBKEY,
      id: mentionId,
      content: emoji,
      channel: channelName,
    },
  );
}
