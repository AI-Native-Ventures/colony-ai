import { hexToBytes } from "@noble/hashes/utils.js";
import { expect, test } from "@playwright/test";
import { finalizeEvent, getPublicKey } from "nostr-tools/pure";

import { installMockBridge, TEST_IDENTITIES } from "../helpers/bridge";
import { seedActiveIdentity } from "../helpers/onboarding";

const ACTIVE_GOAL_ID = "a1b2c3d4-e5f6-4789-8abc-1234567890ab";
const ARCHIVED_GOAL_ID = "b1c2d3e4-f5a6-4789-8abc-1234567890ab";
const CHILD_GOAL_ID = "c1d2e3f4-a5b6-4789-8abc-1234567890ab";
const UNAVAILABLE_GOAL_ID = "d1e2f3a4-b5c6-4789-8abc-1234567890ab";
const RELAY_PRIVATE_KEY = TEST_IDENTITIES.charlie.privateKey;
const RELAY_SELF = getPublicKey(hexToBytes(RELAY_PRIVATE_KEY));
const GOAL_OWNER = TEST_IDENTITIES.bob.pubkey;
const GENERAL_CHANNEL_ID = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";

function goalHeadEvent({
  goalId,
  status = "active",
  title,
  parentGoalId,
  ownerPubkey = GOAL_OWNER,
}: {
  goalId: string;
  status?: "active" | "archived";
  title: string;
  parentGoalId?: string;
  ownerPubkey?: string;
}) {
  const goal = {
    schemaVersion: 1,
    goalId,
    ...(parentGoalId ? { parentGoalId } : {}),
    title,
    ownerPubkey,
    doneCondition: `${title} has clear evidence.`,
    linkedChannelIds: [GENERAL_CHANNEL_ID],
    target: { value: "5", unit: "qualified requests" },
  };
  return finalizeEvent(
    {
      kind: 30642,
      created_at: Math.floor(Date.now() / 1_000),
      tags: [["d", `company:goal:${goalId}`]],
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
  goalEvents = GOAL_EVENTS,
) {
  await seedActiveIdentity(page, TEST_IDENTITIES.tyler);
  await installMockBridge(page, {
    goalEvents,
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

test("an empty relay goal list shows the designed empty state", async ({
  page,
}) => {
  await installGoalsMock(page, "owner", []);
  await page.goto("/#/goals");

  await expect(page.getByTestId("goals-screen")).toContainText(
    "No goals here yet",
  );
  await expect(
    page.getByRole("button", { name: "Create your first goal" }),
  ).toBeVisible();
});

test("an invalid relay-signed goal head shows the unavailable state", async ({
  page,
}) => {
  const invalidHead = {
    ...goalHeadEvent({
      goalId: ACTIVE_GOAL_ID,
      title: "Malformed goal head",
    }),
    content: "{}",
  };
  await installGoalsMock(page, "owner", [invalidHead]);
  await page.goto("/#/goals");

  await expect(
    page.getByRole("heading", { name: "Goals unavailable" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
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

test("goal references distinguish deleted and unavailable records", async ({
  page,
}) => {
  const child = goalHeadEvent({
    goalId: CHILD_GOAL_ID,
    title: "Prepare the client launch brief",
    parentGoalId: ACTIVE_GOAL_ID,
  });
  await installGoalsMock(page, "owner", [...GOAL_EVENTS, child]);
  await joinGeneralChannel(page);
  await waitForMockLiveSubscription(page, "general");
  await page.evaluate((goalId) => {
    window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
      channelName: "general",
      content: `This sub-goal is active: buzz://goal/${goalId}`,
    });
  }, CHILD_GOAL_ID);

  const childCard = page.getByTestId(`goal-reference-card-${CHILD_GOAL_ID}`);
  await expect(childCard).toBeVisible();
  await childCard.click();
  await expect(page.getByTestId("goal-detail")).toContainText(
    "Prepare the client launch brief",
  );
  await page.getByRole("button", { name: "Delete goal" }).click();
  await page
    .getByTestId("goal-delete-screen")
    .getByRole("button", { name: "Delete goal" })
    .click();
  await page.goto(`/#/channels/${GENERAL_CHANNEL_ID}`);
  await expect(page.getByText(/Deleted goal · C1D2E3F4/)).toBeVisible();
  await waitForMockLiveSubscription(page, "general");
  await page.evaluate((goalId) => {
    window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
      channelName: "general",
      content: `This reference is unavailable: buzz://goal/${goalId}`,
    });
  }, UNAVAILABLE_GOAL_ID);
  await expect(page.getByText(/Goal unavailable · D1E2F3A4/)).toBeVisible();
});

test("progress status is explicit, archive restores, and delete respects sub-goals", async ({
  page,
}) => {
  // A different owner from the parent proves sub-goal owners resolve their
  // own profiles instead of falling back to an npub.
  const child = goalHeadEvent({
    goalId: CHILD_GOAL_ID,
    title: "Prepare the client launch brief",
    parentGoalId: ACTIVE_GOAL_ID,
    ownerPubkey: TEST_IDENTITIES.alice.pubkey,
  });
  await installGoalsMock(page, "owner", [...GOAL_EVENTS, child]);
  await page.goto(`/#/goals/${ACTIVE_GOAL_ID}`);
  const childRow = page
    .getByTestId("goal-detail")
    .getByTestId(`goal-row-${CHILD_GOAL_ID}`);
  await expect(childRow).toContainText("alice");
  await expect(childRow).not.toContainText("npub1");

  await page.getByRole("button", { name: "Update progress" }).click();
  const progressScreen = page.getByTestId("goal-progress-screen");
  await expect(progressScreen).toBeVisible();
  await page.getByLabel("Current value").fill("5");
  await progressScreen.getByLabel("Status").selectOption("off_pace");
  await page
    .getByLabel("Evidence or update")
    .fill("The final plan is awaiting client sign-off.");
  await page.evaluate(() => {
    window.__BUZZ_E2E_REJECT_GOAL_ACTIONS__ = ["progress"];
  });
  await page.getByRole("button", { name: "Record update" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "mock goal action rejected",
  );
  await expect(page.getByLabel("Current value")).toHaveValue("5");
  await expect(progressScreen.getByLabel("Status")).toHaveValue("off_pace");
  await expect(page.getByLabel("Evidence or update")).toHaveValue(
    "The final plan is awaiting client sign-off.",
  );
  await page.getByRole("button", { name: "Record update" }).click();
  await expect(page.getByTestId("goal-detail")).toContainText("off pace");
  await expect(page.getByTestId("goal-detail")).toContainText(
    "The final plan is awaiting client sign-off.",
  );

  await page.getByRole("button", { name: "Archive goal" }).click();
  await expect(page.getByTestId("goal-archive-screen")).toContainText(
    "1 sub-goals",
  );
  await page.getByRole("button", { name: "Archive goal" }).click();
  await expect(page.getByTestId("goal-detail")).toContainText(
    "This goal is archived.",
  );
  await page.getByRole("button", { name: "Restore goal" }).click();
  await expect(page.getByTestId("goal-detail")).toContainText("active");

  await page.getByRole("button", { name: "Delete goal" }).click();
  await expect(page.getByTestId("goal-delete-screen")).toContainText(
    "Resolve these links first.",
  );
  await expect(page.getByTestId("goal-delete-screen")).toContainText(
    "Prepare the client launch brief",
  );
  await expect(
    page.getByTestId("goal-delete-screen").getByRole("button", {
      name: "Delete goal",
    }),
  ).toHaveCount(0);
  await page
    .getByTestId("goal-delete-screen")
    .getByRole("button", { name: "Edit relationships" })
    .click();
  await expect(page).toHaveURL(new RegExp(`#/goals/${CHILD_GOAL_ID}/edit$`));
  await expect(page.getByLabel("Goal title")).toHaveValue(
    "Prepare the client launch brief",
  );
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByTestId("goal-detail")).toBeVisible();

  await page.getByRole("button", { name: "Delete goal" }).click();
  await page
    .getByTestId("goal-delete-screen")
    .getByRole("button", {
      name: "Delete goal",
    })
    .click();
  await expect(page).toHaveURL(/#\/goals$/);

  await page.goto(`/#/goals/${ACTIVE_GOAL_ID}`);
  await page.getByRole("button", { name: "Delete goal" }).click();
  await expect(page.getByTestId("goal-delete-screen")).not.toContainText(
    "Resolve these links first.",
  );
  await page
    .getByTestId("goal-delete-screen")
    .getByRole("button", {
      name: "Delete goal",
    })
    .click();
  await expect(page).toHaveURL(/#\/goals$/);
  await expect(page.getByTestId(`goal-row-${ACTIVE_GOAL_ID}`)).toHaveCount(0);
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
  await expect(
    page.getByText("Find a goal or sub-goal", { exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId(`insert-goal-${ARCHIVED_GOAL_ID}`)).toHaveCount(
    0,
  );
  await page.getByTestId("goal-reference-search").fill("qualified");
  const insertGoal = page.getByTestId(`insert-goal-${ACTIVE_GOAL_ID}`);
  await page.keyboard.press("Tab");
  await expect(insertGoal).toBeFocused();
  await page.keyboard.press("Enter");
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
