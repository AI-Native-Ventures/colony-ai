import { expect, test, type Page } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge, TEST_IDENTITIES } from "../helpers/bridge";

const SELF_PUBKEY = "deadbeef".repeat(8);
const AGENT_PUBKEY = TEST_IDENTITIES.charlie.pubkey;
const CHANNEL_GENERAL = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
// A channel the agent is NOT being watched in, used to warm its clock offset so
// a back-dated turn reads as already running (see colony3Fixture).
const CHANNEL_ENGINEERING = "1c7e1c02-87bb-5e88-b2da-5a7a9432d0c9";
const TYPING_KIND = 20002;

type MockMessageEvent = { id: string; created_at: number; pubkey: string };
type SeedKind = "turn_started" | "turn_completed" | "turn_error";

async function waitForMockLiveSubscription(
  page: Page,
  channelName: string,
  kind?: number,
) {
  await expect
    .poll(() =>
      page.evaluate(
        ({ name, subscriptionKind }) =>
          (
            window as Window & {
              __BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?: (input: {
                channelName: string;
                kind?: number;
              }) => boolean;
            }
          ).__BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?.({
            channelName: name,
            kind: subscriptionKind,
          }) ?? false,
        { name: channelName, subscriptionKind: kind },
      ),
    )
    .toBe(true);
}

async function emitMockMessage(
  page: Page,
  content: string,
  options: { createdAt: number; parentEventId?: string; pubkey: string },
): Promise<MockMessageEvent> {
  const event = await page.evaluate(
    ({ body, createdAt, parentEventId, pubkey }) =>
      (
        window as Window & {
          __BUZZ_E2E_EMIT_MOCK_MESSAGE__?: (input: {
            channelName: string;
            content: string;
            createdAt: number;
            parentEventId?: string;
            pubkey: string;
          }) => MockMessageEvent;
        }
      ).__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
        channelName: "general",
        content: body,
        createdAt,
        parentEventId,
        pubkey,
      }),
    { body: content, ...options },
  );
  if (!event) {
    throw new Error("Mock message emitter is unavailable");
  }
  return event;
}

async function seedTurn(
  page: Page,
  input: {
    channelId?: string;
    kind?: SeedKind;
    startedAgoMs?: number;
    turnId: string;
  },
) {
  await page.evaluate(
    ({ agentPubkey, channelId, kind, startedAgoMs, turnId }) => {
      (
        window as Window & {
          __BUZZ_E2E_SEED_ACTIVE_TURNS__?: (seed: {
            agentPubkey: string;
            channelId: string;
            kind?: SeedKind;
            startedAgoMs?: number;
            turnId: string;
          }) => void;
        }
      ).__BUZZ_E2E_SEED_ACTIVE_TURNS__?.({
        agentPubkey,
        channelId,
        kind,
        startedAgoMs,
        turnId,
      });
    },
    {
      agentPubkey: AGENT_PUBKEY,
      channelId: input.channelId ?? CHANNEL_GENERAL,
      kind: input.kind,
      startedAgoMs: input.startedAgoMs,
      turnId: input.turnId,
    },
  );
}

async function warmClockOffset(page: Page) {
  await seedTurn(page, {
    channelId: CHANNEL_ENGINEERING,
    kind: "turn_completed",
    turnId: "warm",
  });
}

async function emitAgentTyping(page: Page, threadHeadId?: string) {
  await page.evaluate(
    ({ pubkey, threadHead }) => {
      (
        window as Window & {
          __BUZZ_E2E_EMIT_MOCK_TYPING__?: (input: {
            channelName: string;
            pubkey?: string;
            threadHeadId?: string;
          }) => unknown;
        }
      ).__BUZZ_E2E_EMIT_MOCK_TYPING__?.({
        channelName: "general",
        pubkey,
        threadHeadId: threadHead,
      });
    },
    { pubkey: AGENT_PUBKEY, threadHead: threadHeadId },
  );
}

async function openGeneral(page: Page) {
  await page.goto("/");
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");
  await waitForMockLiveSubscription(page, "general");
}

async function openThreadWithReply(page: Page) {
  const createdAt = Math.floor(Date.now() / 1000) - 30;
  const root = await emitMockMessage(page, "Can you plan our launch week?", {
    createdAt,
    pubkey: SELF_PUBKEY,
  });
  await emitMockMessage(page, "Sure, one moment.", {
    createdAt: createdAt + 1,
    parentEventId: root.id,
    pubkey: TEST_IDENTITIES.alice.pubkey,
  });
  const summary = page.locator(
    `[data-testid="message-thread-summary"][data-thread-head-id="${root.id}"]`,
  );
  await expect(summary).toBeVisible();
  await summary.click();
  await expect(page.getByTestId("message-thread-panel")).toBeVisible();
  await waitForMockLiveSubscription(page, "general", TYPING_KIND);
  return root;
}

test.describe("agent working indicator", () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test.beforeEach(async ({ page }) => {
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
  });

  test("channel: shows the agent working with a timer, then hides when the turn ends", async ({
    page,
  }) => {
    await openGeneral(page);
    const indicator = page.getByTestId("channel-agent-working-indicator");
    await expect(indicator).toHaveCount(0);

    await warmClockOffset(page);
    await seedTurn(page, { turnId: "t-1", startedAgoMs: 12_000 });

    await expect(indicator).toBeVisible();
    await expect(indicator).toHaveAttribute("data-state", "working");
    // The shimmer repeats the text in an aria-hidden overlay, so match by part.
    await expect(
      indicator.getByTestId("agent-working-indicator-label"),
    ).toContainText("Scout is working…");
    await expect(
      indicator.getByTestId(
        `agent-working-indicator-avatar-${AGENT_PUBKEY.toLowerCase()}`,
      ),
    ).toBeVisible();
    // Elapsed time counts from the turn start, not from when the row appeared.
    const timer = indicator.getByTestId("agent-working-indicator-timer");
    await expect(timer).toHaveText(/^0:(1[2-9]|2\d)$/);
    // The sidebar badge and the notice read the same signal.
    await expect(page.getByTestId("channel-working-general")).toBeVisible();

    // The notice lives in the composer rail and does not move the composer.
    await waitForAnimations(page);
    const composer = page.getByTestId("channel-composer-overlay");
    const rowBox = await indicator.boundingBox();
    const composerBox = await page
      .getByTestId("message-composer")
      .boundingBox();
    expect(rowBox).not.toBeNull();
    expect(composerBox).not.toBeNull();
    expect(rowBox?.y ?? 0).toBeGreaterThan(
      (composerBox?.y ?? 0) + (composerBox?.height ?? 0) - 4,
    );
    await expect(composer).toBeVisible();

    // Stop with no reply (turn_completed): the notice goes away.
    await seedTurn(page, { kind: "turn_completed", turnId: "t-1" });
    await expect(indicator).toHaveCount(0);
    await expect(page.getByTestId("channel-working-general")).toHaveCount(0);
  });

  test("channel: hides as soon as the agent's reply posts", async ({
    page,
  }) => {
    await openGeneral(page);
    await warmClockOffset(page);
    await seedTurn(page, { turnId: "t-reply", startedAgoMs: 3_000 });
    const indicator = page.getByTestId("channel-agent-working-indicator");
    await expect(indicator).toBeVisible();

    // The reply lands while the turn is still wrapping up: no turn_completed yet.
    await emitMockMessage(page, "Here is a short plan.", {
      createdAt: Math.floor(Date.now() / 1000),
      pubkey: AGENT_PUBKEY,
    });

    await expect(page.getByText("Here is a short plan.")).toBeVisible();
    await expect(indicator).toHaveCount(0);
    await expect(page.getByTestId("agent-working-announcer")).toHaveText("");
  });

  test("channel: shows a short plain error when the turn fails, then clears it", async ({
    page,
  }) => {
    await openGeneral(page);
    await warmClockOffset(page);
    await seedTurn(page, { turnId: "t-err", startedAgoMs: 4_000 });
    const indicator = page.getByTestId("channel-agent-working-indicator");
    await expect(indicator).toHaveAttribute("data-state", "working");

    await seedTurn(page, { kind: "turn_error", turnId: "t-err" });
    await expect(indicator).toHaveAttribute("data-state", "error");
    await expect(
      indicator.getByTestId("agent-working-indicator-label"),
    ).toHaveText("Scout hit a problem and stopped.");
    await expect(
      indicator.getByTestId("agent-working-indicator-timer"),
    ).toHaveCount(0);

    // A new turn replaces the error at once.
    await seedTurn(page, { turnId: "t-retry" });
    await expect(indicator).toHaveAttribute("data-state", "working");

    // An error that nobody retries fades on its own.
    await seedTurn(page, { kind: "turn_error", turnId: "t-retry" });
    await expect(indicator).toHaveAttribute("data-state", "error");
    await expect(indicator).toHaveCount(0, { timeout: 20_000 });
  });

  test("channel: announces politely once, not on every tick", async ({
    page,
  }) => {
    await openGeneral(page);
    await warmClockOffset(page);
    const announcer = page.getByTestId("agent-working-announcer");
    await expect(announcer).toHaveText("");
    await expect(announcer).toHaveAttribute("aria-live", "polite");
    await expect(announcer).toHaveAttribute("role", "status");

    await seedTurn(page, { turnId: "t-sr", startedAgoMs: 5_000 });
    await expect(announcer).toHaveText("Scout is working…");

    // Record every change to the live region while the timer ticks.
    const changes = await announcer.evaluate(
      (element) =>
        new Promise<string[]>((resolve) => {
          const seen: string[] = [];
          const observer = new MutationObserver(() => {
            seen.push(element.textContent ?? "");
          });
          observer.observe(element, {
            characterData: true,
            childList: true,
            subtree: true,
          });
          setTimeout(() => {
            observer.disconnect();
            resolve(seen);
          }, 2_500);
        }),
    );
    expect(changes).toEqual([]);

    // The visible row is hidden from assistive tech: the live region owns it.
    await expect(
      page.getByTestId("channel-agent-working-indicator"),
    ).toHaveAttribute("aria-hidden", "true");
  });

  test("thread: shows the agent working where the reply will land, then hides when it replies", async ({
    page,
  }) => {
    await openGeneral(page);
    const root = await openThreadWithReply(page);
    const threadIndicator = page.getByTestId("thread-agent-working-indicator");
    const channelIndicator = page.getByTestId(
      "channel-agent-working-indicator",
    );
    await expect(threadIndicator).toHaveCount(0);

    await warmClockOffset(page);
    await seedTurn(page, { turnId: "t-thread", startedAgoMs: 8_000 });
    await emitAgentTyping(page, root.id);

    await expect(threadIndicator).toBeVisible();
    await expect(
      threadIndicator.getByTestId("agent-working-indicator-label"),
    ).toContainText("Scout is working…");
    await expect(
      threadIndicator.getByTestId("agent-working-indicator-timer"),
    ).toHaveText(/^0:(0[8-9]|1\d)$/);
    // The reply lands in the thread, so the main column stays quiet.
    await expect(channelIndicator).toHaveCount(0);
    await expect(page.getByTestId("thread-agent-working-announcer")).toHaveText(
      "Scout is working…",
    );

    await emitMockMessage(page, "Day one: announce. Day two: demo.", {
      createdAt: Math.floor(Date.now() / 1000) + 2,
      parentEventId: root.id,
      pubkey: AGENT_PUBKEY,
    });

    // Gone as soon as the reply posts, before the turn is reported finished.
    await expect(threadIndicator).toHaveCount(0);
    await expect(page.getByTestId("thread-agent-working-announcer")).toHaveText(
      "",
    );
  });

  test("thread: shows the error where the agent was working", async ({
    page,
  }) => {
    await openGeneral(page);
    const root = await openThreadWithReply(page);
    const threadIndicator = page.getByTestId("thread-agent-working-indicator");
    const channelIndicator = page.getByTestId(
      "channel-agent-working-indicator",
    );

    await warmClockOffset(page);
    await seedTurn(page, { turnId: "t-thread-err", startedAgoMs: 2_000 });
    await emitAgentTyping(page, root.id);
    await expect(threadIndicator).toHaveAttribute("data-state", "working");

    await seedTurn(page, { kind: "turn_error", turnId: "t-thread-err" });
    await expect(threadIndicator).toHaveAttribute("data-state", "error");
    await expect(
      threadIndicator.getByTestId("agent-working-indicator-label"),
    ).toHaveText("Scout hit a problem and stopped.");
    await expect(channelIndicator).toHaveCount(0);
  });
});
