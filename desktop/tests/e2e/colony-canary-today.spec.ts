import { expect, test } from "@playwright/test";
import { bytesToHex } from "@noble/hashes/utils.js";
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
} from "nostr-tools/pure";

import { KIND_ASK_HEAD } from "../../src/shared/constants/kinds";
import { installMockBridge } from "../helpers/bridge";
import { setup } from "../helpers/companyTeamFixture";

test("Today presents real team members as ants and opens the Needs you view", async ({
  page,
}) => {
  await setup(page);
  await page.goto("/#/today");

  const today = page.getByTestId("colony-canary-today");
  await expect(today.getByRole("heading", { name: /^Good / })).toBeVisible();
  await expect(
    today.getByRole("region", { name: "Scout's latest brief" }),
  ).toContainText("Scout's brief will appear here when it arrives.");
  const mina = today.getByRole("button", {
    name: /Mina.*Social Media Manager/,
  });
  await expect(mina).toBeVisible();
  await expect(mina.locator('[data-ant-portrait="Mina"]')).toHaveCSS(
    "background-image",
    /colony-ant-portraits\.png/,
  );

  await page
    .getByTestId("app-sidebar")
    .getByRole("button", { name: /Needs you/ })
    .click();
  await expect(page).toHaveURL(/#\/today\?view=needs-you$/);
  await expect(
    today.getByRole("heading", { name: "Needs you." }),
  ).toBeVisible();
  await expect(today.getByRole("button", { name: /See all/ })).toHaveCount(0);
});

test("the live Team route keeps employee portraits as ants", async ({
  page,
}) => {
  const { minaPk } = await setup(page);
  await page.goto("/#/team");

  const avatar = page.getByTestId(`team-avatar-${minaPk}`);
  await expect(avatar).toBeVisible();
  await expect(avatar).toHaveAttribute("data-ant-portrait", "Mina");
  await expect(avatar).toHaveCSS(
    "background-image",
    /colony-ant-portraits\.png/,
  );
});

test("a real pending decision opens its source discussion", async ({
  page,
}) => {
  const relaySecret = generateSecretKey();
  const askId = "7245ba1a-e078-42ef-b896-00be34a94f11";
  const channelId = "e18cc18b-9685-48c6-941a-910fbaf8f13d";
  const now = new Date();
  const askHead = finalizeEvent(
    {
      kind: KIND_ASK_HEAD,
      created_at: Math.floor(now.getTime() / 1_000),
      tags: [
        ["d", `channel:${channelId}:ask:${askId}`],
        ["h", channelId],
        ["e", "c".repeat(64)],
        ["t", "tool_consent"],
      ],
      content: JSON.stringify({
        schemaVersion: 1,
        askId,
        status: "open",
        askerPubkey: "1".repeat(64),
        createdAt: now.toISOString(),
        ask: {
          schemaVersion: 1,
          askId,
          type: "tool_consent",
          category: "tool",
          title: "Approve the launch email",
          threadRootEventId: "c".repeat(64),
          addresseePubkey: null,
          decideBy: new Date(now.getTime() + 4 * 60_000).toISOString(),
          toolConsent: {
            action: "message_outsider",
            actionPreview: "Send the launch email to the customer.",
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
    relaySelf: getPublicKey(relaySecret),
    relayRequiresMembership: true,
    companyAskRelayPrivateKeyHex: bytesToHex(relaySecret),
    companyAskHeads: [askHead],
  });
  await page.goto("/#/today");

  const card = page.getByTestId(`today-ask-${askId}`);
  await expect(card).toBeVisible();
  await card.click();
  await expect(page).toHaveURL(/companyToolConsentInbox=true/);
  await expect(page.getByTestId("tool-consent-preview")).toContainText(
    "Send the launch email to the customer.",
  );
});
