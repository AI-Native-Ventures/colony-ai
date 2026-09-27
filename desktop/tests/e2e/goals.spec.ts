import { hexToBytes } from "@noble/hashes/utils.js";
import { expect, test } from "@playwright/test";
import { finalizeEvent, getPublicKey } from "nostr-tools/pure";

import { installMockBridge, TEST_IDENTITIES } from "../helpers/bridge";
import { seedActiveIdentity } from "../helpers/onboarding";

const COMMUNITY_ID = "d8c1a2b3-c4d5-4e6f-8a90-1234567890ab";
const ACTIVE_GOAL_ID = "a1b2c3d4-e5f6-4789-8abc-1234567890ab";
const ARCHIVED_GOAL_ID = "b1c2d3e4-f5a6-4789-8abc-1234567890ab";
const RELAY_PRIVATE_KEY = TEST_IDENTITIES.charlie.privateKey;
const RELAY_SELF = getPublicKey(hexToBytes(RELAY_PRIVATE_KEY));
const GOAL_OWNER = TEST_IDENTITIES.bob.pubkey;
const GENERAL_CHANNEL_ID = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";

function goalHeadEvent({
  goalId,
  status = "active",
  title,
}: {
  goalId: string;
  status?: "active" | "archived";
  title: string;
}) {
  const goal = {
    schemaVersion: 1,
    goalId,
    title,
    ownerPubkey: GOAL_OWNER,
    doneCondition: `${title} has clear evidence.`,
    linkedChannelIds: [GENERAL_CHANNEL_ID],
    target: { value: "5", unit: "qualified requests" },
  };
  return finalizeEvent(
    {
      kind: 30642,
      created_at: Math.floor(Date.now() / 1_000),
      tags: [["d", `company:${COMMUNITY_ID}:goal:${goalId}`]],
      content: JSON.stringify({
        schemaVersion: 1,
        goalId,
        status,
        title,
        goal,
        sourceActionEventId: "f".repeat(64),
      }),
    },
    hexToBytes(RELAY_PRIVATE_KEY),
  );
}

const GOAL_EVENTS = [
  goalHeadEvent({
    goalId: ACTIVE_GOAL_ID,
    title: "Increase qualified enquiries",
  }),
  goalHeadEvent({
    goalId: ARCHIVED_GOAL_ID,
    status: "archived",
    title: "Refresh the studio portfolio",
  }),
];

async function installGoalsMock(
  page: import("@playwright/test").Page,
  relayRole: "owner" | "admin" | "member" = "owner",
) {
  await seedActiveIdentity(page, TEST_IDENTITIES.tyler);
  await installMockBridge(page, {
    goalEvents: GOAL_EVENTS,
    goalRelayPrivateKey: RELAY_PRIVATE_KEY,
    relaySelf: RELAY_SELF,
    relayRequiresMembership: true,
    relayRole,
  });
}

async function waitForMockLiveSubscription(
  page: import("@playwright/test").Page,
  channelName: string,
) {
  await expect
    .poll(() =>
      page.evaluate(
        (name) =>
          window.__BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?.({
            channelName: name,
            kind: 9,
          }) ?? false,
        channelName,
      ),
    )
    .toBe(true);
}

async function joinGeneralChannel(page: import("@playwright/test").Page) {
  await page.goto(`/#/channels/${GENERAL_CHANNEL_ID}`);
  const joinButton = page
    .getByTestId("chat-header")
    .getByRole("button", { name: "Join" });
  await expect(joinButton).toBeVisible();
  await joinButton.click();
  await expect(page.getByTestId("reference-goal-button")).toBeVisible();
}

test("goal list searches, filters and opens the signed head", async ({
  page,
}) => {
  await installGoalsMock(page);
  await page.goto("/#/goals");

  const activeRow = page.getByTestId(`goal-row-${ACTIVE_GOAL_ID}`);
  await expect(activeRow).toContainText("Increase qualified enquiries");
  await page.getByTestId("goals-search").fill("qualified");
  await expect(activeRow).toBeVisible();
  await expect(page.getByTestId(`goal-row-${ARCHIVED_GOAL_ID}`)).toHaveCount(0);

  await page.getByTestId("goals-search").fill("");
  await page.getByTestId("goals-filter-archived").focus();
  await expect(page.getByTestId("goals-filter-archived")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId(`goal-row-${ARCHIVED_GOAL_ID}`)).toContainText(
    "Refresh the studio portfolio",
  );
  await page.getByTestId("goals-filter-active").click();
  await page.getByTestId(`goal-row-${ACTIVE_GOAL_ID}`).click();
  await expect(page.getByTestId("goal-detail")).toContainText(
    "Increase qualified enquiries",
  );
  await expect(page.getByTestId("goal-detail")).toContainText(
    "A target reaching 100% does not automatically mark the goal achieved.",
  );
});

test("create and edit a root goal, then reload from the relay head", async ({
  page,
}) => {
  await installGoalsMock(page);
  await page.goto("/#/goals/new");
  await page.getByLabel("Goal title").fill("Prepare the studio launch plan");
  await page
    .getByLabel("Done condition")
    .fill("The team has approved the launch plan and its owner.");
  await page.getByRole("button", { name: "Create goal" }).click();

  await expect(page.getByTestId("goal-detail")).toContainText(
    "Prepare the studio launch plan",
  );
  await page.getByRole("button", { name: "Edit goal" }).click();
  await page.getByLabel("Goal title").fill("Approve the studio launch plan");
  await page.getByRole("button", { name: "Save goal" }).click();
  await expect(page.getByTestId("goal-detail")).toContainText(
    "Approve the studio launch plan",
  );

  await page.reload();
  await expect(page.getByTestId("goal-detail")).toContainText(
    "Approve the studio launch plan",
  );
});

test("chat picker inserts a goal chip and the message card opens that goal", async ({
  page,
}) => {
  await installGoalsMock(page);
  await joinGeneralChannel(page);
  await waitForMockLiveSubscription(page, "general");
  await page.evaluate((goalId) => {
    window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
      channelName: "general",
      content: `This is the goal to reference: buzz://goal/${goalId}`,
    });
  }, ACTIVE_GOAL_ID);

  const card = page.getByTestId(`goal-reference-card-${ACTIVE_GOAL_ID}`);
  await expect(card).toBeVisible();
  await card.click();
  await expect(page.getByTestId("goal-detail")).toContainText(
    "Increase qualified enquiries",
  );

  await page.goto(`/#/channels/${GENERAL_CHANNEL_ID}`);
  await page.getByTestId("reference-goal-button").click();
  await expect(page.getByTestId("goal-reference-picker")).toBeVisible();
  await page.getByTestId("goal-reference-search").fill("qualified");
  await page.getByTestId(`insert-goal-${ACTIVE_GOAL_ID}`).click();
  await expect(page).toHaveURL(new RegExp(`#/channels/${GENERAL_CHANNEL_ID}$`));
  await expect(page.locator("[data-composer-buzz-link]")).toBeVisible();
  await expect(page.locator("[data-composer-buzz-link]")).toHaveAttribute(
    "data-href",
    `buzz://goal/${ACTIVE_GOAL_ID}`,
  );
});

test("a goal can be shared to a conversation as a resolvable message card", async ({
  page,
}) => {
  await installGoalsMock(page);
  await joinGeneralChannel(page);
  await page.goto(`/#/goals/${ACTIVE_GOAL_ID}`);
  await page
    .getByRole("button", { name: "Reference in a conversation" })
    .click();
  await expect(page.getByTestId("goal-share-screen")).toBeVisible();
  await page
    .getByRole("textbox", { name: "Message" })
    .fill("Use this goal to guide the next draft.");
  await page.getByRole("button", { name: "Post reference" }).click();

  await expect(page).toHaveURL(new RegExp(`#/channels/${GENERAL_CHANNEL_ID}$`));
  const card = page.getByTestId(`goal-reference-card-${ACTIVE_GOAL_ID}`);
  await expect(card).toBeVisible();
  await expect(card).toContainText("Increase qualified enquiries");
  await card.click();
  await expect(page.getByTestId("goal-detail")).toContainText(
    "Increase qualified enquiries",
  );
});

test("a viewer without edit authority gets a reason and no write controls", async ({
  page,
}) => {
  await installGoalsMock(page, "member");
  await page.goto(`/#/goals/${ACTIVE_GOAL_ID}`);

  await expect(page.getByTestId("goal-detail")).toContainText(
    "Only the community owner, an admin, or this goal’s owner can create a sub-goal.",
  );
  await expect(page.getByRole("button", { name: "Add sub-goal" })).toHaveCount(
    0,
  );
  await expect(page.getByRole("button", { name: "Edit goal" })).toHaveCount(0);
});
