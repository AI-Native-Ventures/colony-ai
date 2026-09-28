import { expect, test } from "@playwright/test";
import { bytesToHex } from "@noble/hashes/utils.js";
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
} from "nostr-tools/pure";
import { KIND_ASK_HEAD } from "../../src/shared/constants/kinds";
import { openAgentsDirectoryView } from "../helpers/agentWorkspace";
import { installMockBridge } from "../helpers/bridge";

const AGENT_PUBKEY =
  "1111111111111111111111111111111111111111111111111111111111111111";
const PERMISSION_CHANNEL = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
const MARKETING_CHANNEL = "8c576119-f567-4f72-80f8-6124a430b6aa";

function futureDate(days: number) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1_000)
    .toISOString()
    .slice(0, 10);
}

test("owner grants, edits and revokes a standing tool permission", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const relaySecret = generateSecretKey();
  const relaySelf = getPublicKey(relaySecret);
  await installMockBridge(page, {
    relaySelf,
    relayRequiresMembership: true,
    companyAskRelayPrivateKeyHex: bytesToHex(relaySecret),
    managedAgents: [
      {
        pubkey: AGENT_PUBKEY,
        name: "Mina",
        about: "Social media manager",
        status: "stopped",
      },
    ],
    visualChannels: [
      { id: PERMISSION_CHANNEL, name: "permission-sandbox" },
      { id: MARKETING_CHANNEL, name: "permission-marketing" },
    ],
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await openAgentsDirectoryView(page);
  await page.getByRole("button", { name: "Open Mina profile" }).click();
  await page
    .getByRole("navigation", { name: "Agent profile sections" })
    .getByRole("button", { name: "Tools & access", exact: true })
    .click();

  await page.getByRole("link", { name: "Grant permission" }).click();
  const permissionForm = page.getByTestId("permission-form");
  await expect(permissionForm).toBeVisible();
  await page.getByLabel("Allowed action").fill("Message outsiders");
  await page.getByLabel("Exact scope and limits").fill("#permission-sandbox");
  await page.getByLabel("Expires").fill(futureDate(3));
  await page
    .getByLabel(
      "As Lerato, I approve only this action and scope until the expiry date.",
    )
    .check();
  await page.getByRole("button", { name: "Confirm permission" }).click();

  await expect(page.getByTestId("permission-detail")).toContainText(
    "Message outsiders",
  );
  await expect(page.getByTestId("permission-detail")).toContainText(
    "#permission-sandbox",
  );
  await expect(page.getByTestId("permission-detail")).toContainText("Active");

  await page.getByRole("link", { name: "Edit scope" }).click();
  await expect(page.getByTestId("permission-form")).toBeVisible();
  await expect(page.getByLabel("Allowed action")).toHaveValue(
    "Message outsiders",
  );
  await page.getByLabel("Exact scope and limits").fill("#permission-marketing");
  await page.getByLabel("Expires").fill(futureDate(10));
  await page
    .getByLabel(
      "As Lerato, I approve only this action and scope until the expiry date.",
    )
    .check();
  await page.getByRole("button", { name: "Confirm permission" }).click();
  await expect(page.getByTestId("permission-detail")).toContainText(
    "#permission-marketing",
  );

  await page.getByRole("link", { name: "Revoke permission" }).click();
  await expect(
    page.getByRole("heading", { name: "Revoke standing permission?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Revoke permission" }).click();
  await expect(page.getByTestId("permission-detail")).toContainText("Revoked");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const testWindow = window as Window & {
          __BUZZ_E2E_ACCEPTED_TOOL_PERMISSION_ACTIONS__?: Array<{
            action: string;
          }>;
        };
        return testWindow.__BUZZ_E2E_ACCEPTED_TOOL_PERMISSION_ACTIONS__?.map(
          (entry) => entry.action,
        );
      }),
    )
    .toEqual(["grant", "update", "revoke"]);
});

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
  await page.getByRole("button", { name: "Record response" }).click();
  await expect(page.getByTestId("ask-resolved")).toContainText(
    "Approved by You",
  );
});
