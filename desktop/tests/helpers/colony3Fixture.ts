import type { Page } from "@playwright/test";

import {
  REFERENCE_AGENTS,
  REFERENCE_CHANNEL_IDS,
} from "../../src/testing/e2eReferenceWorkspace";

/** The instant the Colony 3.0 boards are captured at (the design's Friday 23 October). */
export const COLONY3_NOW = "2026-10-23T09:55:00+02:00";

/**
 * Brings the live parts of the Colony 3.0 Lerato Social fixture up after the
 * app has loaded: The Olive House has Mina (2:13) and Theo (0:40) working, and
 * Cedar Café has three unread messages. Requires `colony3Sidebar: true` in the
 * mock bridge options, and `page.clock.setFixedTime(COLONY3_NOW)` before
 * navigating so the elapsed timers read exactly as in the design.
 */
export async function seedColony3Activity(page: Page) {
  await page.waitForFunction(
    () => typeof window.__BUZZ_E2E_SEED_ACTIVE_TURNS__ === "function",
  );
  await page.evaluate(
    ({ minaPubkey, theoPubkey, oliveId, warmChannelId }) => {
      const seed = window.__BUZZ_E2E_SEED_ACTIVE_TURNS__;
      if (!seed) return;
      // A fresh sample first, in another channel (the watermark is per
      // channel), so back-dated starts are not read as clock skew.
      for (const agentPubkey of [minaPubkey, theoPubkey]) {
        seed({
          agentPubkey,
          channelId: warmChannelId,
          turnId: `warm-${agentPubkey.slice(0, 4)}`,
          kind: "turn_completed",
        });
      }
      seed({
        agentPubkey: minaPubkey,
        channelId: oliveId,
        turnId: "colony3-mina",
        startedAgoMs: 133_000,
      });
      seed({
        agentPubkey: theoPubkey,
        channelId: oliveId,
        turnId: "colony3-theo",
        startedAgoMs: 40_000,
      });
    },
    {
      minaPubkey: REFERENCE_AGENTS.mina.pubkey,
      theoPubkey: REFERENCE_AGENTS.theo.pubkey,
      oliveId: REFERENCE_CHANNEL_IDS.oliveHouse,
      warmChannelId: REFERENCE_CHANNEL_IDS.marketing,
    },
  );
  await page.waitForFunction(
    () =>
      window.__BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?.({
        channelName: "Cedar Café",
      }) ?? false,
  );
  const base = Math.floor(new Date(COLONY3_NOW).getTime() / 1000);
  const messages = [
    "The lunch menu photos are in the shared folder.",
    "Captions are drafted and waiting for you.",
    "Do you want the carousel to lead with the terrace?",
  ];
  for (const [index, content] of messages.entries()) {
    await page.evaluate(
      ({ pubkey, content: text, createdAt }) =>
        window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
          channelName: "Cedar Café",
          content: text,
          createdAt,
          pubkey,
        }),
      {
        pubkey: REFERENCE_AGENTS.mina.pubkey,
        content,
        createdAt: base - (messages.length - index) * 240,
      },
    );
  }
}

/**
 * Three communities for the rail: Lerato Social (open) and the two others the
 * Sidebar Collapsed board shows. Call after `installMockBridge`: it replaces the single community the
 * bridge seeds and keeps Lerato Social as the active one.
 */
export async function seedColony3Communities(page: Page) {
  await page.addInitScript(() => {
    const communities = [
      {
        id: "e2e-default-community",
        name: "Lerato Social",
        relayUrl: "ws://localhost:3000",
        addedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "colony3-rosebank",
        name: "Rosebank Studio",
        relayUrl: "ws://localhost:3001",
        addedAt: "2026-01-02T00:00:00.000Z",
      },
      {
        id: "colony3-tidepool",
        name: "Tidepool",
        relayUrl: "ws://localhost:3002",
        addedAt: "2026-01-03T00:00:00.000Z",
      },
    ];
    window.localStorage.setItem(
      "buzz-communities",
      JSON.stringify(communities),
    );
    window.localStorage.setItem("buzz-active-community-id", communities[0].id);
  });
}

type RelayConnectionState =
  | "connected"
  | "connecting"
  | "disconnected"
  | "idle"
  | "reconnecting"
  | "stalled";

/** Drives the mock relay into a degraded connection state (the notice cards). */
export async function setColony3RelayState(
  page: Page,
  state: RelayConnectionState,
) {
  await page.waitForFunction(
    () =>
      typeof (
        window as Window & {
          __BUZZ_E2E_SET_RELAY_CONNECTION_STATE__?: unknown;
        }
      ).__BUZZ_E2E_SET_RELAY_CONNECTION_STATE__ === "function" &&
      (
        window as Window & {
          __BUZZ_E2E_GET_RELAY_CONNECTION_STATE__?: () => string;
        }
      ).__BUZZ_E2E_GET_RELAY_CONNECTION_STATE__?.() === "connected",
  );
  await page.evaluate((next) => {
    (
      window as Window & {
        __BUZZ_E2E_SET_RELAY_CONNECTION_STATE__?: (s: string) => void;
      }
    ).__BUZZ_E2E_SET_RELAY_CONNECTION_STATE__?.(next);
  }, state);
}
