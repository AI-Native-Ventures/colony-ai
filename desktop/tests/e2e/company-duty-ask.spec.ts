import { expect, test } from "@playwright/test";
import { bytesToHex } from "@noble/hashes/utils.js";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";

import { KIND_ASK_ACTION } from "../../src/shared/constants/kinds";
import type { RelayEvent } from "../../src/shared/api/types";
import { installMockBridge, TEST_IDENTITIES } from "../helpers/bridge";

const DUTY_ASK_ID = "7245ba1a-e078-42ef-b896-00be34a94f11";
const DUTY_ID = "7916ba1a-e078-42ef-b896-00be34a94f12";

async function seedDutyAsk(
  page: Parameters<typeof installMockBridge>[0],
  askResponseErrors: string[] = [],
) {
  const relaySecret = generateSecretKey();
  const relaySelf = getPublicKey(relaySecret);
  await installMockBridge(page, {
    relaySelf,
    companyAskRelayPrivateKeyHex: bytesToHex(relaySecret),
    relayRequiresMembership: true,
    relayRole: "owner",
    relayAgents: [
      {
        pubkey: TEST_IDENTITIES.alice.pubkey,
        ownerPubkey: TEST_IDENTITIES.tyler.pubkey,
        name: "Mina",
        agentType: "agent",
        channelNames: ["general"],
      },
    ],
    searchProfiles: [
      {
        pubkey: TEST_IDENTITIES.alice.pubkey,
        displayName: "Mina",
        isAgent: true,
        ownerPubkey: TEST_IDENTITIES.tyler.pubkey,
      },
    ],
    askResponseErrors,
  });
  await page.goto("/#/today");
  await page.waitForFunction(() => {
    const testWindow = window as Window & {
      __BUZZ_E2E_EMIT_MOCK_MESSAGE__?: unknown;
      __BUZZ_E2E_PUBLISH_MOCK_ASK_HEAD__?: unknown;
    };
    return (
      typeof testWindow.__BUZZ_E2E_EMIT_MOCK_MESSAGE__ === "function" &&
      typeof testWindow.__BUZZ_E2E_PUBLISH_MOCK_ASK_HEAD__ === "function"
    );
  });

  return page.evaluate(
    async ({ askId, dutyId, askerPubkey, actionKind }) => {
      type TestWindow = Window & {
        __BUZZ_E2E_EMIT_MOCK_MESSAGE__?: (input: {
          channelName: string;
          content: string;
          parentEventId?: string | null;
          pubkey?: string;
          kind?: number;
          extraTags?: string[][];
          id?: string;
        }) => RelayEvent;
        __BUZZ_E2E_PUBLISH_MOCK_ASK_HEAD__?: (input: {
          channelId: string;
          askId: string;
          threadRootEventId: string;
          content: string;
        }) => RelayEvent;
      };
      const testWindow = window as TestWindow;
      const emit = testWindow.__BUZZ_E2E_EMIT_MOCK_MESSAGE__;
      const publishHead = testWindow.__BUZZ_E2E_PUBLISH_MOCK_ASK_HEAD__;
      if (!emit || !publishHead) {
        throw new Error("The mock relay duty ask test seam is unavailable.");
      }
      const rootId = Array.from(crypto.getRandomValues(new Uint8Array(32)))
        .map((value) => value.toString(16).padStart(2, "0"))
        .join("");
      const root = emit({
        channelName: "general",
        content: "Duty proposal",
        id: rootId,
        pubkey: askerPubkey,
      });
      const channelId = root.tags.find((tag) => tag[0] === "h")?.[1];
      if (!channelId) throw new Error("The seeded duty thread has no channel.");
      const createdAt = new Date().toISOString();
      const dutyProposal = {
        schemaVersion: 1,
        dutyId,
        employeePubkey: askerPubkey,
        title: "Review saved hospitality research",
        scheduleText: "Every Monday at 09:00",
        scheduleCron: "0 9 * * 1",
        timeZone: "Etc/UTC",
        channelId,
        instructions: "Review the saved hospitality list and report changes.",
      };
      const ask = {
        schemaVersion: 1,
        askId,
        type: "approval",
        category: "duty",
        title: "Give Aya a weekly research duty",
        body: "Every Monday, review the saved hospitality list and report changes in #sales. Duty owner: Aya.",
        threadRootEventId: root.id,
        decideBy: null,
        subject: { kind: "duty", id: dutyId },
        dutyProposal,
      };
      const content = JSON.stringify({
        schemaVersion: 1,
        askId,
        status: "open",
        askerPubkey,
        createdAt,
        ask,
        resolution: null,
        cancellation: null,
        sourceActionEventId: "b".repeat(64),
      });
      publishHead({ channelId, askId, threadRootEventId: root.id, content });
      emit({
        channelName: "general",
        content: JSON.stringify({
          schemaVersion: 1,
          askId,
          action: "create",
          ask,
        }),
        kind: actionKind,
        parentEventId: root.id,
        pubkey: askerPubkey,
        extraTags: [["d", `channel:${channelId}:ask:${askId}`]],
      });
      return { askId, channelId };
    },
    {
      askId: DUTY_ASK_ID,
      dutyId: DUTY_ID,
      askerPubkey: TEST_IDENTITIES.alice.pubkey,
      actionKind: KIND_ASK_ACTION,
    },
  );
}

test("owner approves a duty ask and can retry a failed relay decision", async ({
  page,
}) => {
  const { channelId, askId } = await seedDutyAsk(page, [
    "Temporary relay write failure",
  ]);
  await page.goto(`/#/asks/${channelId}/${askId}`);

  const card = page.getByTestId("ask-card");
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute("data-ask-variant", "duty");
  await expect(
    card.getByRole("heading", { name: "Decision requested" }),
  ).toBeVisible();
  await expect(card).toContainText("Mina");
  await expect(card).toContainText(
    "Every Monday, review the saved hospitality list and report changes in #sales. Duty owner: Aya.",
  );
  await expect(
    card.getByRole("button", { name: "Approve duty" }),
  ).toBeVisible();
  await expect(card.getByRole("button", { name: "Decline" })).toBeVisible();

  await card.getByRole("button", { name: "Approve duty" }).click();
  await expect(card.getByTestId("ask-status")).toHaveText("failed");
  await expect(
    card.getByText("Decision could not be saved", { exact: true }),
  ).toBeVisible();
  await expect(card).toContainText(
    "No action has been released. Your review is kept; retry once connected.",
  );

  await card.getByRole("button", { name: "Approve duty" }).click();
  await expect(card.getByTestId("ask-status")).toHaveText("resolved");
  await expect(
    card.getByText("Decision recorded", { exact: true }),
  ).toBeVisible();
  await expect(card).toContainText(
    "The requester has the outcome in the original thread.",
  );
  await expect(
    card.getByRole("link", { name: "Open conversation" }),
  ).toBeVisible();
});
