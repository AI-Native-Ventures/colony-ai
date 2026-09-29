import { expect, test } from "@playwright/test";

import { installRelayBridge, TEST_IDENTITIES } from "../helpers/bridge";

const enabled = process.env.BUZZ_E2E_COMPANY_WORK_LIVE === "1";
const GENERAL_CHANNEL_ID = "9f28288a-d724-587a-9709-92dc7f967110";
const COMMUNITY_A_ID = "company-work-live-a";
const COMMUNITY_B_ID = "company-work-live-b";

function required(name: string, value: string | undefined): string {
  if (!value)
    throw new Error(`${name} is required for the live company work gate`);
  return value;
}

function localRelayUrl(name: string, value: string | undefined): string {
  const result = required(name, value);
  const hostname = new URL(result).hostname.toLowerCase();
  if (
    !["localhost", "127.0.0.1", "::1", "host.docker.internal"].includes(
      hostname,
    )
  ) {
    throw new Error(`${name} must point to a local disposable relay.`);
  }
  return result;
}

function websocketUrl(httpUrl: string): string {
  return httpUrl.replace(/^http/, "ws");
}

async function relaySelfPubkey(relayHttpUrl: string): Promise<string> {
  const response = await fetch(new URL("/", relayHttpUrl), {
    headers: { Accept: "application/nostr+json" },
  });
  if (!response.ok) throw new Error("The local relay NIP-11 request failed.");
  const relayInfo: unknown = await response.json();
  if (
    relayInfo === null ||
    typeof relayInfo !== "object" ||
    typeof (relayInfo as { self?: unknown }).self !== "string"
  ) {
    throw new Error("The local relay does not advertise its signing identity.");
  }
  return (relayInfo as { self: string }).self;
}

async function seedCommunities(
  page: import("@playwright/test").Page,
  relayA: string,
  relayB: string,
) {
  await page.addInitScript(
    ({ relayA, relayB, pubkey, communityAId, communityBId }) => {
      window.localStorage.setItem(
        "buzz-communities",
        JSON.stringify([
          {
            id: communityAId,
            name: "Work Alpha",
            relayUrl: relayA,
            pubkey,
            addedAt: "2026-01-01T00:00:00.000Z",
          },
          {
            id: communityBId,
            name: "Work Bravo",
            relayUrl: relayB,
            pubkey,
            addedAt: "2026-01-02T00:00:00.000Z",
          },
        ]),
      );
      window.localStorage.setItem("buzz-active-community-id", communityAId);
    },
    {
      relayA: websocketUrl(relayA),
      relayB: websocketUrl(relayB),
      pubkey: TEST_IDENTITIES.tyler.pubkey,
      communityAId: COMMUNITY_A_ID,
      communityBId: COMMUNITY_B_ID,
    },
  );
}

test.describe("company work local relay journey", () => {
  test.skip(
    !enabled,
    "set BUZZ_E2E_COMPANY_WORK_LIVE=1 with two local relay host endpoints to run this gate",
  );

  test("creates, verifies, reloads, and isolates work across communities", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const relayA = localRelayUrl(
      "BUZZ_E2E_COMPANY_WORK_RELAY_A",
      process.env.BUZZ_E2E_COMPANY_WORK_RELAY_A,
    );
    const relayB = localRelayUrl(
      "BUZZ_E2E_COMPANY_WORK_RELAY_B",
      process.env.BUZZ_E2E_COMPANY_WORK_RELAY_B,
    );
    const relaySelf = await relaySelfPubkey(relayA);
    await installRelayBridge(page, "tyler", {
      relayHttpUrl: relayA,
      relaySelf,
      relayRequiresMembership: true,
      skipCommunitySeed: true,
    });
    await seedCommunities(page, relayA, relayB);
    await page.goto(`/#/channels/${GENERAL_CHANNEL_ID}`);

    const joinButton = page.getByRole("button", {
      name: "Join to participate",
    });
    if (await joinButton.isVisible().catch(() => false)) {
      await joinButton.click();
    }
    const destinationMessageText = `Move destination ${Date.now()}`;
    await page.getByTestId("message-input").fill(destinationMessageText);
    await page.getByTestId("send-message").click();
    const destinationMessage = page
      .locator("[data-message-id]")
      .filter({ hasText: destinationMessageText });
    await expect(destinationMessage).toHaveCount(1);
    await expect(destinationMessage).toHaveAttribute(
      "data-message-id",
      /^[0-9a-f]{64}$/,
    );
    const destinationRootId =
      await destinationMessage.getAttribute("data-message-id");
    if (!destinationRootId) {
      throw new Error("The local relay omitted the destination message id.");
    }
    await page.goto("/#/work/new");
    await expect(page.getByTestId("company-work-form")).toBeVisible();
    await page
      .getByTestId("company-work-conversation")
      .selectOption(GENERAL_CHANNEL_ID);
    await page
      .getByTestId("company-work-title")
      .fill(`Relay work ${Date.now()}`);
    await page
      .getByTestId("company-work-done-condition")
      .fill("The requester accepts the evidence.");
    await page
      .getByTestId("company-work-owner")
      .selectOption(TEST_IDENTITIES.tyler.pubkey);
    await page
      .getByTestId("company-work-requester")
      .selectOption(TEST_IDENTITIES.tyler.pubkey);
    await page
      .getByTestId("company-work-evidence")
      .fill("The work is ready for a local relay review.");
    await page.getByRole("button", { name: "Create commitment" }).click();
    await expect(page.getByTestId("company-work-detail")).toBeVisible();
    const workItemId = page
      .url()
      .match(/#\/work\/detail\/([0-9a-f-]{36})$/)?.[1];
    if (!workItemId)
      throw new Error("The real relay omitted the work item id.");

    await page.getByRole("button", { name: "Update status" }).click();
    await page
      .getByTestId("company-work-status")
      .selectOption("done_unverified");
    await page
      .getByTestId("company-work-status-reason")
      .fill("The owner submitted the work.");
    await page.getByRole("button", { name: "Save status" }).click();
    await page.getByRole("button", { name: "Review and verify" }).click();
    await page
      .getByTestId("company-work-review-note")
      .fill("The evidence satisfies the done condition.");
    await page.getByRole("button", { name: "Record verdict" }).click();
    await expect(page.getByTestId("company-work-verification")).toContainText(
      "Verification passed",
    );

    await page.getByRole("button", { name: "Move to another thread" }).click();
    await expect(page.getByTestId("company-work-move")).toBeVisible();
    const destinationRoot = page.getByTestId(
      `company-work-move-root-${destinationRootId}`,
    );
    await expect(destinationRoot).toBeEnabled();
    await destinationRoot.click();
    await page.getByRole("button", { name: "Review move" }).click();
    await expect(page.getByTestId("company-work-move")).toContainText(
      "Both threads are in #general. No membership or permissions will change.",
    );
    await page.getByRole("button", { name: "Move work item" }).click();
    await expect(page.getByTestId("company-work-detail")).toBeVisible();
    await page.getByRole("button", { name: "Full timeline" }).click();
    await expect(page.getByTestId("company-work-full-timeline")).toContainText(
      "moved this work item to a new thread.",
    );

    await page.reload();
    await expect(page.getByTestId("company-work-full-timeline")).toContainText(
      "moved this work item to a new thread.",
    );
    await page.goto(
      `/#/channels/${GENERAL_CHANNEL_ID}?messageId=${destinationRootId}&threadRootId=${destinationRootId}`,
    );
    await expect(
      page.getByTestId(`company-work-current-card-${workItemId}`),
    ).toBeVisible();
    await page.goto(`/#/work/detail/${workItemId}`);
    await expect(page.getByTestId("company-work-verification")).toContainText(
      "The evidence satisfies the done condition.",
    );
    await page.getByTestId(`community-rail-button-${COMMUNITY_B_ID}`).click();
    await expect(
      page.getByTestId(`community-rail-button-${COMMUNITY_B_ID}`),
    ).toHaveAttribute("aria-current", "true");
    await page.goto("/#/company-work");
    await expect(page.getByTestId("company-work-list")).toBeVisible();
    await expect(page.getByTestId("company-work-rows")).toHaveCount(0);
    await page.getByTestId(`community-rail-button-${COMMUNITY_A_ID}`).click();
    await expect(
      page.getByTestId(`community-rail-button-${COMMUNITY_A_ID}`),
    ).toHaveAttribute("aria-current", "true");
    await page.goto("/#/company-work");
    const row = page.getByTestId(`company-work-row-${workItemId}`);
    await expect(row).toBeVisible();
    await row.click();
    await expect(page.getByTestId("company-work-verification")).toContainText(
      "The evidence satisfies the done condition.",
    );
    await page.getByRole("button", { name: "Archive work item" }).click();
    await page.getByRole("button", { name: "Archive item" }).click();
    await expect(page.getByTestId("company-work-detail")).toContainText(
      "This work item is archived.",
    );
  });
});
