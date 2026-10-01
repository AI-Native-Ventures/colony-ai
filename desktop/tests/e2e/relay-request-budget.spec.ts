import { expect, test } from "@playwright/test";
import { bytesToHex } from "@noble/hashes/utils.js";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";

import { installMockBridge, TEST_IDENTITIES } from "../helpers/bridge";

const ASK_ID = "request-budget-ask-0";
const WINDOW_MS = 5_000;

type RelayFrameSample = {
  at: number;
  frame: unknown[];
};

type RelayFrameWindow = Window & {
  __BUZZ_E2E_RELAY_FRAMES__?: RelayFrameSample[];
  __BUZZ_E2E_RELAY_BUDGET_STABILITY__?: {
    count: number;
    since: number;
  };
};

function countOperations(frames: RelayFrameSample[]) {
  const counts = { req: 0, count: 0, event: 0 };
  for (const { frame } of frames) {
    if (frame[0] === "REQ") counts.req += 1;
    if (frame[0] === "COUNT") counts.count += 1;
    if (frame[0] === "EVENT") counts.event += 1;
  }
  return { ...counts, total: counts.req + counts.count + counts.event };
}

function isRequestBudgetAskHead(frame: unknown[]) {
  const filter = frame[2];
  if (!filter || typeof filter !== "object") return false;
  const record = filter as Record<string, unknown>;
  const coordinates = record["#d"];
  return (
    Array.isArray(record.kinds) &&
    record.kinds.includes(30643) &&
    Array.isArray(coordinates) &&
    coordinates.some(
      (coordinate) =>
        typeof coordinate === "string" &&
        coordinate.startsWith("channel:") &&
        coordinate.includes("request-budget-ask-"),
    )
  );
}

async function captureWindow(
  page: import("@playwright/test").Page,
  label: string,
  startedAt: number,
) {
  const endsAt = startedAt + WINDOW_MS;
  const now = await page.evaluate(() => Date.now());
  if (now < endsAt) await page.waitForTimeout(endsAt - now);
  const samples = await page.evaluate(
    ({ start, end }) => {
      const frameWindow = window as RelayFrameWindow;
      return (frameWindow.__BUZZ_E2E_RELAY_FRAMES__ ?? []).filter(
        (sample) => sample.at >= start && sample.at < end,
      );
    },
    { start: startedAt, end: endsAt },
  );
  const askHeadRequests = samples.filter(
    ({ frame }) => frame[0] === "REQ" && isRequestBudgetAskHead(frame),
  ).length;
  return { label, ...countOperations(samples), askHeadRequests };
}

async function waitForMockLiveSubscription(
  page: import("@playwright/test").Page,
  channelName: string,
  kind: number,
) {
  await expect
    .poll(() =>
      page.evaluate(
        ({ name, eventKind }) => {
          const testWindow = window as Window & {
            __BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?: (input: {
              channelName: string;
              kind: number;
            }) => boolean;
          };
          return (
            testWindow.__BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?.({
              channelName: name,
              kind: eventKind,
            }) ?? false
          );
        },
        { name: channelName, eventKind: kind },
      ),
    )
    .toBe(true);
}

test("primary route journey records bounded relay request windows", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const relaySecret = generateSecretKey();
  await installMockBridge(
    page,
    {
      relaySelf: getPublicKey(relaySecret),
      companyAskRelayPrivateKeyHex: bytesToHex(relaySecret),
    },
    { forceRelayPacing: true },
  );

  const journeyStartedAt = Date.now();
  await page.goto("/");
  await expect(page.getByTestId("app-sidebar")).toBeVisible();

  const windows = [];
  windows.push(await captureWindow(page, "startup", journeyStartedAt));

  let startedAt = await page.evaluate(() => Date.now());
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await expect(page).toHaveURL(/#\/today$/);
  windows.push(await captureWindow(page, "today", startedAt));

  startedAt = await page.evaluate(() => Date.now());
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");
  await waitForMockLiveSubscription(page, "general", 47032);
  const askChannelId = await page.evaluate(
    async ({ askerPubkey }) => {
      const testWindow = window as Window & {
        __BUZZ_E2E_INVOKE_MOCK_COMMAND__?: (
          command: string,
          payload?: unknown,
        ) => Promise<unknown>;
        __BUZZ_E2E_EMIT_MOCK_MESSAGE__?: (input: {
          channelName: string;
          content: string;
          kind?: number;
          parentEventId?: string | null;
          pubkey?: string;
          extraTags?: string[][];
        }) => { id: string; tags: string[][] };
        __BUZZ_E2E_PUBLISH_MOCK_ASK_HEAD__?: (input: {
          channelId: string;
          askId: string;
          threadRootEventId: string;
          content: string;
        }) => unknown;
      };
      const invoke = testWindow.__BUZZ_E2E_INVOKE_MOCK_COMMAND__;
      const emit = testWindow.__BUZZ_E2E_EMIT_MOCK_MESSAGE__;
      const publishHead = testWindow.__BUZZ_E2E_PUBLISH_MOCK_ASK_HEAD__;
      if (!invoke || !emit || !publishHead) {
        throw new Error("The mock relay Ask seams are unavailable.");
      }
      const identity = (await invoke("get_identity", {})) as { pubkey: string };
      const now = Math.floor(Date.now() / 1_000);
      let seededChannelId: string | null = null;
      for (let index = 0; index < 20; index += 1) {
        const askId = `request-budget-ask-${index}`;
        const root = emit({
          channelName: "general",
          content: `Discussion ${index}`,
          kind: 9,
          pubkey: askerPubkey,
        });
        const channelId = root.tags.find((tag) => tag[0] === "h")?.[1];
        if (!channelId)
          throw new Error("The seeded discussion has no channel.");
        if (seededChannelId && seededChannelId !== channelId) {
          throw new Error("The seeded Ask messages changed channels.");
        }
        seededChannelId = channelId;
        const ask = {
          schemaVersion: 1,
          askId,
          type: "question",
          category: "general",
          title: `Budget question ${index}`,
          body: "Please review this request.",
          threadRootEventId: root.id,
          addresseePubkey: identity.pubkey,
          decideBy: new Date((now + 3_600) * 1_000).toISOString(),
        };
        publishHead({
          channelId,
          askId,
          threadRootEventId: root.id,
          content: JSON.stringify({
            schemaVersion: 1,
            askId,
            status: "open",
            askerPubkey,
            createdAt: new Date(now * 1_000).toISOString(),
            ask,
            resolution: null,
            cancellation: null,
            sourceActionEventId: "b".repeat(64),
          }),
        });
        emit({
          channelName: "general",
          kind: 47032,
          content: JSON.stringify({
            schemaVersion: 1,
            askId,
            action: "create",
            ask,
          }),
          pubkey: askerPubkey,
          extraTags: [["d", `channel:${channelId}:ask:${askId}`]],
        });
      }
      if (!seededChannelId) throw new Error("No Ask messages were seeded.");
      return seededChannelId;
    },
    { askerPubkey: TEST_IDENTITIES.alice.pubkey },
  );
  windows.push(await captureWindow(page, "channel", startedAt));

  startedAt = await page.evaluate(() => Date.now());
  await page.getByTestId("sidebar-company-team").click();
  await expect(page).toHaveURL(/#\/team$/);
  windows.push(await captureWindow(page, "team", startedAt));

  startedAt = await page.evaluate(() => Date.now());
  await page.getByTestId("sidebar-company-work").click();
  await expect(page).toHaveURL(/#\/work$/);
  windows.push(await captureWindow(page, "work", startedAt));

  startedAt = await page.evaluate(() => Date.now());
  await page.goto(`/#/asks/${askChannelId}/${ASK_ID}`);
  await expect(page.getByTestId("ask-detail-breadcrumb")).toBeVisible();
  await expect(page.getByTestId("ask-thread-root")).toBeVisible();
  windows.push(await captureWindow(page, "asks", startedAt));

  startedAt = await page.evaluate(() => Date.now());
  await page.getByTestId("sidebar-settings").click();
  await expect(page).toHaveURL(/#\/settings/);
  windows.push(await captureWindow(page, "settings", startedAt));

  await page.waitForFunction(
    () => {
      const frameWindow = window as RelayFrameWindow;
      const count = frameWindow.__BUZZ_E2E_RELAY_FRAMES__?.length ?? 0;
      const now = Date.now();
      const stability = frameWindow.__BUZZ_E2E_RELAY_BUDGET_STABILITY__;
      if (!stability || stability.count !== count) {
        frameWindow.__BUZZ_E2E_RELAY_BUDGET_STABILITY__ = {
          count,
          since: now,
        };
        return false;
      }
      return now - stability.since >= 750;
    },
    undefined,
    { timeout: 45_000, polling: 50 },
  );

  const journeySamples = await page.evaluate(
    (start) =>
      ((window as RelayFrameWindow).__BUZZ_E2E_RELAY_FRAMES__ ?? []).filter(
        (sample) => sample.at >= start,
      ),
    journeyStartedAt,
  );
  const journey = countOperations(journeySamples);
  const maxWindowOperations = Math.max(...windows.map(({ total }) => total));

  console.log(
    `[relay-request-budget] ${JSON.stringify({ windows, journey, maxWindowOperations })}`,
  );
  expect(maxWindowOperations).toBeLessThanOrEqual(48);
  const channelWindow = windows.find(({ label }) => label === "channel");
  expect(channelWindow?.askHeadRequests).toBeGreaterThan(0);
  expect(channelWindow?.askHeadRequests).toBeLessThanOrEqual(20);
  expect(journey.total).toBeLessThanOrEqual(128);
});
