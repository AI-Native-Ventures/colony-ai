import { expect, test } from "@playwright/test";
import { hexToBytes } from "@noble/hashes/utils.js";
import { finalizeEvent } from "nostr-tools/pure";

import {
  KIND_ASK_ACTION,
  KIND_STREAM_MESSAGE,
} from "../../src/shared/constants/kinds";
import { installBridge, TEST_IDENTITIES } from "../helpers/bridge";
import { assertRelaySeeded } from "../helpers/seed";

const LIVE_ENABLED = process.env.BUZZ_E2E_COMPANY_ASKS_LIVE === "1";
const RELAY_HTTP = process.env.BUZZ_E2E_RELAY_URL ?? "http://localhost:3000";
const RELAY_WS = RELAY_HTTP.replace(/^http/, "ws");
const SECOND_RELAY_WS = process.env.BUZZ_E2E_COMPANY_ASKS_SECOND_RELAY_URL;
const RELAY_SELF_PUBKEY = process.env.BUZZ_E2E_COMPANY_ASKS_RELAY_SELF_PUBKEY;
const GENERAL_CHANNEL_ID = "9f28288a-d724-587a-9709-92dc7f967110";

async function publishEvent(
  relayHttpUrl: string,
  privateKeyHex: string,
  template: {
    kind: number;
    created_at: number;
    content: string;
    tags: string[][];
  },
) {
  const event = finalizeEvent(template, hexToBytes(privateKeyHex));
  const response = await fetch(`${relayHttpUrl}/events`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Pubkey": event.pubkey,
    },
    body: JSON.stringify(event),
  });
  if (!response.ok) {
    throw new Error(
      `Relay rejected kind ${event.kind} with HTTP ${response.status}: ${await response.text()}`,
    );
  }
  return event;
}

test.describe("company asks live relay journey", () => {
  test.skip(
    !LIVE_ENABLED,
    "set BUZZ_E2E_COMPANY_ASKS_LIVE=1 for the isolated live relay gate",
  );

  test.beforeAll(async () => {
    test.setTimeout(90_000);
    await assertRelaySeeded();
  });

  test("creates in a thread, resolves from Today, survives reload and community switching", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    if (!SECOND_RELAY_WS) {
      throw new Error("BUZZ_E2E_COMPANY_ASKS_SECOND_RELAY_URL is required.");
    }
    if (!RELAY_SELF_PUBKEY) {
      throw new Error("BUZZ_E2E_COMPANY_ASKS_RELAY_SELF_PUBKEY is required.");
    }

    const nonce = crypto.randomUUID();
    const askId = crypto.randomUUID();
    const title = `Live relay ask ${nonce}`;
    const threadText = `Live relay thread ${nonce}`;
    const now = Math.floor(Date.now() / 1_000);
    const root = await publishEvent(
      RELAY_HTTP,
      TEST_IDENTITIES.alice.privateKey,
      {
        kind: KIND_STREAM_MESSAGE,
        created_at: now,
        content: threadText,
        tags: [["h", GENERAL_CHANNEL_ID]],
      },
    );
    await publishEvent(RELAY_HTTP, TEST_IDENTITIES.alice.privateKey, {
      kind: KIND_ASK_ACTION,
      created_at: now,
      content: JSON.stringify({
        schemaVersion: 1,
        askId,
        action: "create",
        ask: {
          schemaVersion: 1,
          askId,
          type: "approval",
          category: "general",
          title,
          body: "Confirm the release checklist is complete.",
          threadRootEventId: root.id,
          addresseePubkey: TEST_IDENTITIES.tyler.pubkey,
          decideBy: new Date((now + 3_600) * 1_000).toISOString(),
        },
      }),
      tags: [
        ["h", GENERAL_CHANNEL_ID],
        ["d", `channel:${GENERAL_CHANNEL_ID}:ask:${askId}`],
        ["e", root.id, "", "root"],
        ["e", root.id, "", "reply"],
      ],
    });

    const communityAId = `asks-a-${nonce}`;
    const communityBId = `asks-b-${nonce}`;
    await page.addInitScript(
      ({ communities, activeCommunityId }) => {
        window.localStorage.setItem(
          "buzz-communities",
          JSON.stringify(communities),
        );
        window.localStorage.setItem(
          "buzz-active-community-id",
          activeCommunityId,
        );
      },
      {
        activeCommunityId: communityAId,
        communities: [
          {
            id: communityAId,
            name: "Ask test A",
            relayUrl: RELAY_WS,
            pubkey: TEST_IDENTITIES.tyler.pubkey,
            addedAt: new Date().toISOString(),
          },
          {
            id: communityBId,
            name: "Ask test B",
            relayUrl: SECOND_RELAY_WS,
            pubkey: TEST_IDENTITIES.tyler.pubkey,
            addedAt: new Date().toISOString(),
          },
        ],
      },
    );
    await installBridge(page, {
      mode: "relay",
      user: "tyler",
      relayHttpUrl: RELAY_HTTP,
      relayWsUrl: RELAY_WS,
      mock: { relaySelf: RELAY_SELF_PUBKEY },
      skipCommunitySeed: true,
    });

    const threadUrl = `/#/channels/${GENERAL_CHANNEL_ID}?thread=${root.id}`;
    await page.goto(threadUrl);
    await expect(page.getByText(threadText)).toBeVisible();
    await expect(page.getByTestId("ask-card")).toBeVisible();
    await expect(page.getByTestId("ask-card")).toContainText(title);

    await page.goto("/#/today");
    const todayRow = page.getByTestId(`today-ask-${askId}`);
    await expect(todayRow).toBeVisible();
    await todayRow.click();
    await expect(page.getByTestId("ask-detail-screen")).toBeVisible();
    await expect(page.getByTestId("ask-thread-root")).toContainText(threadText);
    await expect(page.getByTestId("ask-card")).toBeVisible();
    await page.getByLabel("Reason or requested changes").fill("Approved.");
    await page.getByRole("button", { name: "Record response" }).click();
    await expect(page.getByTestId("ask-resolved")).toContainText(
      "Approved by You",
    );
    await expect(todayRow).toHaveCount(0);

    await page.getByRole("link", { name: "Back to discussion" }).click();
    await expect(page.getByText(threadText)).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`[?&]messageId=${root.id}`));
    await expect(page.getByTestId("message-thread-head")).toContainText(
      threadText,
    );
    await expect(page.getByTestId("ask-resolved")).toContainText(
      "Approved by You",
    );

    await page.goto("/#/today");
    await page.reload();
    await expect(page.getByRole("region", { name: "Needs me" })).toBeVisible();
    await expect(page.getByTestId(`today-ask-${askId}`)).toHaveCount(0);

    await page.goto(threadUrl);
    await expect(page.getByText(threadText)).toBeVisible();
    await expect(page.getByTestId("message-thread-head")).toContainText(
      threadText,
    );
    await expect(page.getByTestId("ask-resolved")).toContainText(
      "Approved by You",
    );

    await page.getByTestId(`community-rail-button-${communityBId}`).click();
    await expect
      .poll(() =>
        page.evaluate(() =>
          window.localStorage.getItem("buzz-active-community-id"),
        ),
      )
      .toBe(communityBId);
    await expect(page.getByTestId("channel-general")).toBeVisible();
    await page.getByTestId(`community-rail-button-${communityAId}`).click();
    await expect
      .poll(() =>
        page.evaluate(() =>
          window.localStorage.getItem("buzz-active-community-id"),
        ),
      )
      .toBe(communityAId);
    await expect(page.getByTestId("channel-general")).toBeVisible();

    await page.goto(threadUrl);
    await expect(page.getByTestId("ask-resolved")).toContainText(
      "Approved by You",
    );
  });
});
