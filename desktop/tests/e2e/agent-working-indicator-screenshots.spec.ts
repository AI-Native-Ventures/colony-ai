import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";

import { waitForAnimations } from "../helpers/animations";
import { openR17ConnectionSetup, r17Runtime } from "../helpers/onboarding";

const OUT = process.env.CHAT_FEEL_SHOTS_DIR ?? "test-results/chat-feel";
const SELF_PUBKEY = "deadbeef".repeat(8);

type MockMessageEvent = { id: string; created_at: number };

async function shot(page: Page, name: string) {
  await mkdir(OUT, { recursive: true });
  // Park the pointer in an empty corner so no hover card covers the screen.
  const size = page.viewportSize();
  await page.mouse.move((size?.width ?? 1440) - 3, 3);
  await page.waitForTimeout(300);
  await waitForAnimations(page);
  await page.screenshot({ path: `${OUT}/${name}.png` });
}

async function emit(
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
        channelName: "Welcome",
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
    agentPubkey: string;
    channelId: string;
    kind?: "turn_started" | "turn_completed";
    startedAgoMs?: number;
    turnId: string;
  },
) {
  await page.evaluate((seed) => {
    (
      window as Window & {
        __BUZZ_E2E_SEED_ACTIVE_TURNS__?: (input: typeof seed) => void;
      }
    ).__BUZZ_E2E_SEED_ACTIVE_TURNS__?.(seed);
  }, input);
}

async function scoutAndWelcome(page: Page) {
  const agents = (await page.evaluate(async () =>
    window.__BUZZ_E2E_INVOKE_MOCK_COMMAND__?.("list_managed_agents", null),
  )) as Array<{ pubkey: string; name: string }>;
  const scout = agents.find((agent) => agent.name === "Scout");
  // The sidebar is closed on a phone; the open conversation's URL has the id.
  const welcomeId =
    (await page
      .getByTestId("channel-Welcome")
      .getAttribute("data-channel-id", { timeout: 1_000 })
      .catch(() => null)) ??
    page.url().match(/[0-9a-f]{8}-[0-9a-f-]{27}/)?.[0] ??
    null;
  if (!scout || !welcomeId) {
    throw new Error("Scout and the Welcome channel must exist");
  }
  return { scoutPubkey: scout.pubkey, welcomeId };
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`Welcome with Scout working, thread, and a short reply at ${viewport.width}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await openR17ConnectionSetup(page, {
      runtimes: [r17Runtime("codex", "available", { status: "logged_in" })],
    });
    await page.getByTestId("onboarding-test-connection").click();
    await expect(page.getByTestId("onboarding-scene-connected")).toBeVisible();
    await page
      .getByRole("button", { name: "Open my Colony", exact: true })
      .click();
    if (viewport.width >= 768) {
      await expect(page.getByTestId("app-sidebar")).toBeVisible();
      await page.getByTestId("channel-Welcome").click();
    }
    await expect(page.getByTestId("message-timeline")).toContainText("Scout");

    const { scoutPubkey, welcomeId } = await scoutAndWelcome(page);
    // Scout's own greeting lands a moment after the channel opens. A turn that
    // starts before it would read as already answered, so let it arrive first.
    await expect(page.getByTestId("message-timeline")).toContainText(
      "Hello, I'm here.",
    );
    // The mock also posts a reply under the greeting; wait for that too.
    await expect(
      page.getByTestId("message-thread-summary").first(),
    ).toBeVisible();
    const now = Math.floor(Date.now() / 1000);

    // 1. Scout is working on a message in the channel.
    await emit(page, "What do you know about my business?", {
      createdAt: now - 20,
      pubkey: SELF_PUBKEY,
    });
    // A turn that starts in the same second as an earlier reply would read as
    // already answered; let the greeting's second pass.
    await page.waitForTimeout(1_500);
    await seedTurn(page, {
      agentPubkey: scoutPubkey,
      channelId: welcomeId,
      turnId: "t-main",
    });
    if (viewport.width >= 768) {
      await expect(page.getByTestId("channel-working-Welcome")).toBeVisible();
    }
    await page.waitForTimeout(6_000);
    await shot(page, `01-welcome-scout-working-${viewport.width}`);

    // 2. One short reply replaces the notice.
    await emit(page, "Hi, I'm Scout. What does your business sell?", {
      createdAt: now - 1,
      pubkey: scoutPubkey,
    });
    await seedTurn(page, {
      agentPubkey: scoutPubkey,
      channelId: welcomeId,
      kind: "turn_completed",
      turnId: "t-main",
    });
    await expect(page.getByTestId("channel-working-Welcome")).toHaveCount(0);
    await page.waitForTimeout(400);
    await shot(page, `03-short-reply-${viewport.width}`);

    // 3. Scout is working inside a thread.
    const root = await emit(page, "Can you draft our launch post?", {
      createdAt: now + 1,
      pubkey: SELF_PUBKEY,
    });
    await emit(page, "Sure, give me a minute.", {
      createdAt: now + 2,
      parentEventId: root.id,
      pubkey: scoutPubkey,
    });
    await page
      .locator(
        `[data-testid="message-thread-summary"][data-thread-head-id="${root.id}"]`,
      )
      .click();
    await expect(page.getByTestId("message-thread-panel")).toBeVisible();
    // A new turn in a channel must be newer than the last one seen there, so it
    // cannot be back-dated; the timer simply counts from now.
    await seedTurn(page, {
      agentPubkey: scoutPubkey,
      channelId: welcomeId,
      turnId: "t-thread",
    });
    // Typing right after the same agent's message is dropped for two seconds.
    await page.waitForTimeout(2_500);
    // Typing is dropped until the channel has a live typing subscription.
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              window as Window & {
                __BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?: (input: {
                  channelName: string;
                  kind: number;
                }) => boolean;
              }
            ).__BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?.({
              channelName: "Welcome",
              kind: 20002,
            }) ?? false,
        ),
      )
      .toBe(true);
    const emitThreadTyping = () =>
      page.evaluate(
        ({ pubkey, threadHeadId }) => {
          (
            window as Window & {
              __BUZZ_E2E_EMIT_MOCK_TYPING__?: (input: {
                channelName: string;
                createdAt: number;
                pubkey: string;
                threadHeadId: string;
              }) => unknown;
            }
          ).__BUZZ_E2E_EMIT_MOCK_TYPING__?.({
            channelName: "Welcome",
            createdAt: Math.floor(Date.now() / 1000) + 3,
            pubkey,
            threadHeadId,
          });
        },
        { pubkey: scoutPubkey, threadHeadId: root.id },
      );
    // The harness re-sends typing every few seconds, so does the spec.
    // CHAT_FEEL_BASELINE=1 runs this against a build without the notice.
    if (process.env.CHAT_FEEL_BASELINE === "1") {
      await emitThreadTyping();
    } else {
      await expect(async () => {
        await emitThreadTyping();
        await expect(
          page.getByTestId("thread-agent-working-indicator"),
        ).toBeVisible({ timeout: 1_500 });
      }).toPass({ timeout: 15_000 });
    }
    await page.waitForTimeout(6_000);
    await shot(page, `02-thread-scout-working-${viewport.width}`);
  });
}
