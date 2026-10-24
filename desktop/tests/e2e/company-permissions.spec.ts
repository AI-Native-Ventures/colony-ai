import { expect, test } from "@playwright/test";
import { bytesToHex } from "@noble/hashes/utils.js";
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
} from "nostr-tools/pure";
import { KIND_ASK_HEAD } from "../../src/shared/constants/kinds";
import { installMockBridge } from "../helpers/bridge";

const AGENT_PUBKEY =
  "1111111111111111111111111111111111111111111111111111111111111111";

test("owner resolves an off-channel tool consent ask from Needs me", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const relaySecret = generateSecretKey();
  const relaySelf = getPublicKey(relaySecret);
  const askId = "7245ba1a-e078-42ef-b896-00be34a94f11";
  const channelId = "e18cc18b-9685-48c6-941a-910fbaf8f13d";
  const threadRootEventId = "c".repeat(64);
  const actionPreview =
    "Send this email to x@y.com (subject: Launch date): The new launch date is Friday.";
  const now = new Date();
  const askHead = finalizeEvent(
    {
      kind: KIND_ASK_HEAD,
      created_at: Math.floor(now.getTime() / 1_000),
      tags: [
        ["d", `channel:${channelId}:ask:${askId}`],
        ["h", channelId],
        ["e", threadRootEventId],
        ["t", "tool_consent"],
      ],
      content: JSON.stringify({
        schemaVersion: 1,
        askId,
        status: "open",
        askerPubkey: AGENT_PUBKEY,
        createdAt: now.toISOString(),
        ask: {
          schemaVersion: 1,
          askId,
          type: "tool_consent",
          category: "tool",
          title: "Tool consent",
          threadRootEventId,
          addresseePubkey: null,
          decideBy: new Date(now.getTime() + 4 * 60_000).toISOString(),
          toolConsent: {
            action: "message_outsider",
            actionPreview,
          },
        },
        resolution: null,
        cancellation: null,
        sourceActionEventId: "a".repeat(64),
      }),
    },
    relaySecret,
  );
  await installMockBridge(page, {
    relaySelf,
    relayRequiresMembership: true,
    companyAskRelayPrivateKeyHex: bytesToHex(relaySecret),
    companyAskHeads: [askHead],
    managedAgents: [
      {
        pubkey: AGENT_PUBKEY,
        name: "Mina",
        about: "Social media manager",
        status: "running",
      },
    ],
  });
  await page.goto("/#/today");
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible({
    timeout: 20_000,
  });

  const row = page.getByTestId(`today-ask-${askId}`);
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.click();
  await expect(page).toHaveURL(/companyToolConsentInbox=true/);
  await expect(page.getByTestId("tool-consent-preview")).toHaveText(
    actionPreview,
  );
  await page.getByLabel("Reason").fill("Reviewed the recipient and message.");
  await page.getByRole("button", { name: "Record tool decision" }).click();
  await expect(page.getByTestId("ask-resolved")).toContainText(
    "Approved by You",
  );
});
