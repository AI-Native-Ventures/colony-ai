import { bytesToHex } from "@noble/hashes/utils.js";
import type { Page } from "@playwright/test";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";

import { REFERENCE_AGENTS } from "../../src/testing/e2eReferenceWorkspace";
import { installMockBridge } from "./bridge";
import { COLONY3_NOW } from "./colony3Fixture";

/** The employee the funding ask is about ("Olive Studio" on the board). */
export const OLIVE_STUDIO_PUBKEY = "0".repeat(60) + "0a1e";
export const DECISION_ASK_ID = "c3d00000-0000-4000-8000-000000000001";
export const FUNDING_ASK_ID = "c3d00000-0000-4000-8000-000000000002";
export const WORK_ITEM_ID = "b1b17000-0000-4000-8000-000000000001";

type SeedWindow = Window & {
  __BUZZ_E2E_INVOKE_MOCK_COMMAND__?: (
    command: string,
    payload?: unknown,
  ) => Promise<unknown>;
  __BUZZ_E2E_EMIT_MOCK_MESSAGE__?: (input: {
    channelName: string;
    content: string;
    kind?: number;
    createdAt?: number;
    parentEventId?: string | null;
    pubkey?: string;
    extraTags?: string[][];
    id?: string;
  }) => { id: string; tags: string[][] };
  __BUZZ_E2E_PUBLISH_MOCK_ASK_HEAD__?: (head: {
    channelId: string;
    askId: string;
    threadRootEventId: string;
    content: string;
  }) => unknown;
};

/**
 * Opens the Lerato Social fixture with a relay identity able to sign ask heads,
 * at the design's fixed instant, ready for `seedDecisionAsks`.
 */
export async function openDecisionWorkspace(page: Page) {
  const relaySecret = generateSecretKey();
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.clock.setFixedTime(new Date(COLONY3_NOW));
  await installMockBridge(page, {
    referenceWorkspace: true,
    colony3Sidebar: true,
    windowFullscreen: true,
    relayRequiresMembership: true,
    relaySelf: getPublicKey(relaySecret),
    companyAskRelayPrivateKeyHex: bytesToHex(relaySecret),
    searchProfiles: [
      { pubkey: OLIVE_STUDIO_PUBKEY, displayName: "Olive Studio" },
    ],
  });
  await page.goto("/#/today");
  await page.waitForFunction(() => {
    const testWindow = window as SeedWindow;
    return (
      typeof testWindow.__BUZZ_E2E_EMIT_MOCK_MESSAGE__ === "function" &&
      typeof testWindow.__BUZZ_E2E_INVOKE_MOCK_COMMAND__ === "function" &&
      typeof testWindow.__BUZZ_E2E_PUBLISH_MOCK_ASK_HEAD__ === "function"
    );
  });
}

export type SeededDecisionAsk = {
  askId: string;
  channelId: string;
  rootId: string;
};

type AskSeed = {
  askId: string;
  channelName: string;
  askerPubkey: string;
  rootContent: string;
  rootAt: string;
  createdAt: string;
  ask: Record<string, unknown>;
};

/** Seeds the ask of the Decision board and the ask of the Funding decision board. */
export async function seedDecisionAsks(
  page: Page,
): Promise<{ decision: SeededDecisionAsk; funding: SeededDecisionAsk }> {
  const seeds: AskSeed[] = [
    {
      askId: DECISION_ASK_ID,
      channelName: "The Olive House",
      askerPubkey: REFERENCE_AGENTS.mina.pubkey,
      rootContent:
        "# October content calendar\nOctober carousel concepts are ready for The Olive House. Once they’re approved I’ll schedule the first three posts.",
      rootAt: "2026-10-23T13:52:00+02:00",
      createdAt: "2026-10-23T13:52:00+02:00",
      ask: {
        schemaVersion: 1,
        askId: DECISION_ASK_ID,
        type: "approval",
        category: "general",
        title: "Approve the October campaign",
        body: "Three carousels with captions, following the spring brief. The concepts are in the thread above.",
        decideBy: "2026-10-23T14:00:00+02:00",
        subject: { kind: "workItem", id: WORK_ITEM_ID },
      },
    },
    {
      askId: FUNDING_ASK_ID,
      channelName: "Operations",
      askerPubkey: REFERENCE_AGENTS.scout.pubkey,
      rootContent: "# October budgets\nAllowance changes for October.",
      rootAt: "2026-10-22T17:00:00+02:00",
      createdAt: "2026-10-22T17:00:00+02:00",
      ask: {
        schemaVersion: 1,
        askId: FUNDING_ASK_ID,
        type: "approval",
        category: "money",
        title: "Increase Olive Studio’s October allowance by USD 120",
        body: "Olive Studio has two extra campaigns in October. The current allowance runs out before the month ends, so drafts and revisions would stop.",
        decideBy: "2026-10-22T17:00:00+02:00",
        subject: { kind: "companyMember", id: OLIVE_STUDIO_PUBKEY },
        spendAllowanceProposal: {
          schemaVersion: 1,
          employeePubkey: OLIVE_STUDIO_PUBKEY,
          allowance: { amountCents: "12000", period: "month" },
          temporaryAllowance: {
            allowance: { amountCents: "12000", period: "month" },
            expiresAt: "2026-10-31T23:59:59+02:00",
          },
          fundingOrder: [],
        },
      },
    },
  ];
  const seeded = await page.evaluate(async (inputs) => {
    const testWindow = window as SeedWindow;
    const invoke = testWindow.__BUZZ_E2E_INVOKE_MOCK_COMMAND__;
    const emit = testWindow.__BUZZ_E2E_EMIT_MOCK_MESSAGE__;
    const publishHead = testWindow.__BUZZ_E2E_PUBLISH_MOCK_ASK_HEAD__;
    if (!invoke || !emit || !publishHead) {
      throw new Error("The mock relay ask test seam is unavailable.");
    }
    const identity = (await invoke("get_identity", {})) as { pubkey: string };
    const out: Array<{ askId: string; channelId: string; rootId: string }> = [];
    for (const input of inputs) {
      const root = emit({
        channelName: input.channelName,
        content: input.rootContent,
        createdAt: Math.floor(Date.parse(input.rootAt) / 1_000),
        pubkey: input.askerPubkey,
      });
      const channelId = root.tags.find((tag) => tag[0] === "h")?.[1];
      if (!channelId) throw new Error("The seeded thread has no channel tag.");
      const ask = {
        ...input.ask,
        threadRootEventId: root.id,
        addresseePubkey: identity.pubkey,
      };
      publishHead({
        channelId,
        askId: input.askId,
        threadRootEventId: root.id,
        content: JSON.stringify({
          schemaVersion: 1,
          askId: input.askId,
          status: "open",
          askerPubkey: input.askerPubkey,
          createdAt: input.createdAt,
          ask,
          resolution: null,
          cancellation: null,
          sourceActionEventId: "b".repeat(64),
        }),
      });
      emit({
        channelName: input.channelName,
        content: JSON.stringify({
          schemaVersion: 1,
          askId: input.askId,
          action: "create",
          ask,
        }),
        createdAt: Math.floor(Date.parse(input.rootAt) / 1_000) + 1,
        kind: 47032,
        parentEventId: root.id,
        pubkey: input.askerPubkey,
        extraTags: [["d", `channel:${channelId}:ask:${input.askId}`]],
      });
      out.push({ askId: input.askId, channelId, rootId: root.id });
    }
    return out;
  }, seeds);
  return { decision: seeded[0], funding: seeded[1] };
}
