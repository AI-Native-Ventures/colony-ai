import { expect, test } from "@playwright/test";
import { bytesToHex } from "@noble/hashes/utils.js";
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
} from "nostr-tools/pure";

import { KIND_ASK_HEAD } from "../../src/shared/constants/kinds";
import { installMockBridge, TEST_IDENTITIES } from "../helpers/bridge";
import { waitForAnimations } from "../helpers/animations";
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

test("a partner can decide a pending ask and open its source discussion", async ({
  page,
}) => {
  const relaySecret = generateSecretKey();
  const askId = "7245ba1a-e078-42ef-b896-00be34a94f11";
  const channelId = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
  const now = new Date();
  const askHead = finalizeEvent(
    {
      kind: KIND_ASK_HEAD,
      created_at: Math.floor(now.getTime() / 1_000),
      tags: [
        ["d", `channel:${channelId}:ask:${askId}`],
        ["h", channelId],
        ["e", "d".repeat(64)],
        ["t", "tool_consent"],
      ],
      content: JSON.stringify({
        schemaVersion: 1,
        askId,
        status: "open",
        askerPubkey: TEST_IDENTITIES.alice.pubkey,
        createdAt: now.toISOString(),
        ask: {
          schemaVersion: 1,
          askId,
          type: "tool_consent",
          category: "tool",
          title: "Approve the launch email",
          body: "Send the approved launch message to a customer.",
          threadRootEventId: "d".repeat(64),
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
    relayRole: "partner",
    companyAskRelayPrivateKeyHex: bytesToHex(relaySecret),
    companyAskHeads: [askHead],
    searchProfiles: [
      {
        pubkey: TEST_IDENTITIES.alice.pubkey,
        displayName: "Maya",
        isAgent: true,
      },
    ],
    relayAgents: [
      {
        pubkey: TEST_IDENTITIES.alice.pubkey,
        ownerPubkey: TEST_IDENTITIES.tyler.pubkey,
        name: "Maya",
        agentType: "agent",
      },
    ],
  });
  await page.goto("/#/today");

  const card = page.getByTestId(`today-ask-${askId}`);
  await expect(card).toBeVisible();
  await expect(card).toContainText("Waiting for you");
  await expect(card).toContainText("Send the approved launch message");
  await expect(card.locator('[data-ant-portrait="Maya"]')).toBeVisible();
  if (process.env.COLONY_CANARY_CARD_SHOT) {
    await waitForAnimations(page);
    await page.screenshot({ path: process.env.COLONY_CANARY_CARD_SHOT });
  }
  await card.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/companyToolConsentInbox=true/);
  await expect(
    page.getByTestId("ask-card").locator('[data-ant-portrait="Maya"]'),
  ).toBeVisible();
  if (process.env.COLONY_CANARY_CARD_DETAIL_SHOT) {
    await waitForAnimations(page);
    await page.screenshot({ path: process.env.COLONY_CANARY_CARD_DETAIL_SHOT });
  }
  await expect(page.getByTestId("tool-consent-preview")).toContainText(
    "Send the launch email to the customer.",
  );
  await page.getByRole("link", { name: "Open conversation" }).click();
  await expect(page.getByTestId("message-thread-panel")).toContainText(
    "React to me with a custom emoji",
  );
  await page.goBack();
  await expect(page.getByTestId("ask-card")).toBeVisible();
  await page.getByLabel("Reason").fill("The launch email is ready.");
  await page.getByRole("button", { name: "Record tool decision" }).click();
  await expect(page.getByTestId("ask-resolved")).toContainText(
    "Approved by You",
  );
  await page.setViewportSize({ width: 700, height: 700 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(700);
  if (process.env.COLONY_CANARY_CARD_NARROW_SHOT) {
    await waitForAnimations(page);
    await page.screenshot({ path: process.env.COLONY_CANARY_CARD_NARROW_SHOT });
  }
  const close = page.getByRole("link", { name: "Close card" });
  await close.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#\/today$/);
  await expect(page.getByTestId(`today-ask-${askId}`)).toHaveCount(0);
});

test("a signed question keeps its answer tied to the source conversation", async ({
  page,
}) => {
  const viewerPubkey = "deadbeef".repeat(8);
  const relaySecret = generateSecretKey();
  const askId = "7245ba1a-e078-42ef-b896-00be34a94f12";
  const channelId = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
  const now = new Date();
  const askHead = finalizeEvent(
    {
      kind: KIND_ASK_HEAD,
      created_at: Math.floor(now.getTime() / 1_000),
      tags: [
        ["d", `channel:${channelId}:ask:${askId}`],
        ["h", channelId],
        ["e", "d".repeat(64)],
        ["t", "question"],
      ],
      content: JSON.stringify({
        schemaVersion: 1,
        askId,
        status: "open",
        askerPubkey: TEST_IDENTITIES.alice.pubkey,
        createdAt: now.toISOString(),
        ask: {
          schemaVersion: 1,
          askId,
          type: "question",
          category: "general",
          title: "Which sizes does the linen dress come in?",
          body: "We need the available sizes before writing product copy.",
          threadRootEventId: "d".repeat(64),
          addresseePubkey: viewerPubkey,
          decideBy: new Date(now.getTime() + 60_000).toISOString(),
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
    searchProfiles: [
      {
        pubkey: TEST_IDENTITIES.alice.pubkey,
        displayName: "Naledi",
        isAgent: true,
      },
    ],
    relayAgents: [
      {
        pubkey: TEST_IDENTITIES.alice.pubkey,
        ownerPubkey: viewerPubkey,
        name: "Naledi",
        agentType: "agent",
      },
    ],
  });
  await page.goto("/#/today?view=needs-you");
  const card = page.getByTestId(`today-ask-${askId}`);
  await expect(card).toContainText("question");
  await expect(card).toContainText("We need the available sizes");
  await expect(card.locator('[data-ant-portrait="Naledi"]')).toBeVisible();
  await card.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByTestId("ask-card")).toBeVisible();
  await expect(page.getByTestId("ask-thread-title")).toHaveText(
    "Which sizes does the linen dress come in?",
  );
  if (process.env.COLONY_CANARY_QUESTION_SHOT) {
    await waitForAnimations(page);
    await page.screenshot({ path: process.env.COLONY_CANARY_QUESTION_SHOT });
  }
  await page.getByRole("link", { name: "Open conversation" }).click();
  await expect(page.getByTestId("message-thread-panel")).toContainText(
    "React to me with a custom emoji",
  );
  await page.goBack();
  await page.getByLabel("Answer", { exact: true }).fill("XS, S, M, L and XL.");
  await page.getByRole("button", { name: "Send answer" }).click();
  await expect(page.getByTestId("ask-resolved")).toContainText(
    "Answered by You",
  );
  await page.setViewportSize({ width: 700, height: 700 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(700);
  if (process.env.COLONY_CANARY_QUESTION_NARROW_SHOT) {
    await waitForAnimations(page);
    await page.screenshot({
      path: process.env.COLONY_CANARY_QUESTION_NARROW_SHOT,
    });
  }
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/#\/today$/);
  await expect(page.getByTestId(`today-ask-${askId}`)).toHaveCount(0);
});
