import { expect, type Page } from "@playwright/test";

import { TEST_IDENTITIES } from "./bridge";

const SELF_PUBKEY = "deadbeef".repeat(8);
const ROOT_COUNT = 6;

type MockMessageEvent = { id: string; created_at: number };
export type Roots = Array<{ id: string; text: string }>;

async function waitForMockLiveSubscription(page: Page, channelName: string) {
  await expect
    .poll(() =>
      page.evaluate(
        (name) =>
          (
            window as Window & {
              __BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?: (input: {
                channelName: string;
              }) => boolean;
            }
          ).__BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?.({ channelName: name }) ??
          false,
        channelName,
      ),
    )
    .toBe(true);
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

/** Six messages from different people, each with a reply, so six threads show. */
export async function openChannelWithThreads(page: Page): Promise<Roots> {
  await page.goto("/");
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");
  await waitForMockLiveSubscription(page, "general");
  const start = Math.floor(Date.now() / 1000) - 600;
  const authors = [
    SELF_PUBKEY,
    TEST_IDENTITIES.alice.pubkey,
    TEST_IDENTITIES.bob.pubkey,
  ];
  const roots: Roots = [];
  for (let index = 0; index < ROOT_COUNT; index += 1) {
    const text = `Launch topic number ${index + 1}`;
    const root = await emit(page, text, {
      createdAt: start + index * 20,
      pubkey: authors[index % authors.length],
    });
    // A reply that lands before its root has rendered has nothing to attach
    // to on a slow runner, so the root shows first.
    await expect(
      page.locator(".c3c-row", { hasText: text }).first(),
    ).toBeVisible({ timeout: 15_000 });
    await emit(page, `A reply on topic ${index + 1}`, {
      createdAt: start + index * 20 + 5,
      parentEventId: root.id,
      pubkey: TEST_IDENTITIES.charlie.pubkey,
    });
    roots.push({ id: root.id, text });
  }
  for (const root of roots) {
    await expect(summaryOf(page, root.id)).toBeVisible({ timeout: 15_000 });
  }
  return roots;
}

export function summaryOf(page: Page, rootId: string) {
  return page.locator(
    `[data-testid="message-thread-summary"][data-thread-head-id="${rootId}"]`,
  );
}
