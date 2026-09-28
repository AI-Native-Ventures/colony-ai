import { expect, test } from "@playwright/test";

import { installRelayBridge, TEST_IDENTITIES } from "../helpers/bridge";

const enabled = process.env.BUZZ_E2E_GOALS_LIVE === "1";
const GENERAL_CHANNEL_ID = "9f28288a-d724-587a-9709-92dc7f967110";
const COMMUNITY_A_ID = "goals-live-a";
const COMMUNITY_B_ID = "goals-live-b";

function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`${name} is required for the live goals gate`);
  return value;
}

function websocketUrl(httpUrl: string): string {
  return httpUrl.replace(/^http/, "ws");
}

async function relaySelfPubkey(relayHttpUrl: string): Promise<string> {
  const response = await fetch(new URL("/", relayHttpUrl), {
    headers: { Accept: "application/nostr+json" },
  });
  if (!response.ok) throw new Error("The live relay NIP-11 request failed.");
  const relayInfo: unknown = await response.json();
  if (
    relayInfo === null ||
    typeof relayInfo !== "object" ||
    typeof (relayInfo as { self?: unknown }).self !== "string"
  ) {
    throw new Error("The live relay does not advertise its signing identity.");
  }
  return (relayInfo as { self: string }).self;
}

async function seedCommunities(
  page: import("@playwright/test").Page,
  relayA: string,
  relayB: string,
) {
  await page.addInitScript(
    ({ relayA, relayB, pubkey }) => {
      window.localStorage.setItem(
        "buzz-communities",
        JSON.stringify([
          {
            id: "goals-live-a",
            name: "Goals Alpha",
            relayUrl: relayA,
            pubkey,
            addedAt: "2026-01-01T00:00:00.000Z",
          },
          {
            id: "goals-live-b",
            name: "Goals Bravo",
            relayUrl: relayB,
            pubkey,
            addedAt: "2026-01-02T00:00:00.000Z",
          },
        ]),
      );
      window.localStorage.setItem("buzz-active-community-id", "goals-live-a");
    },
    {
      relayA: websocketUrl(relayA),
      relayB: websocketUrl(relayB),
      pubkey: TEST_IDENTITIES.tyler.pubkey,
    },
  );
}

async function createGoal(
  page: import("@playwright/test").Page,
  title: string,
  parentGoalId?: string,
  target?: { value: string; unit: string },
): Promise<string> {
  if (parentGoalId) {
    await page.goto(`/#/goals/${parentGoalId}`);
    await page.getByRole("button", { name: "Add sub-goal" }).click();
  } else {
    await page.goto("/#/goals/new");
  }
  await expect(page.getByTestId("goal-form-screen")).toBeVisible();
  await page.getByLabel("Goal title").fill(title);
  await page
    .getByLabel("Done condition")
    .fill(`${title} is complete and reviewed by the team.`);
  await page.getByLabel("Owner").selectOption(TEST_IDENTITIES.tyler.pubkey);
  if (target) {
    await page.locator("details summary").click();
    await page.getByLabel("Target", { exact: true }).fill(target.value);
    await page.getByLabel("Unit", { exact: true }).fill(target.unit);
  }
  await page.getByRole("button", { name: "Create goal" }).click();
  await expect(page.getByTestId("goal-detail")).toContainText(title);
  const goalId = page.url().match(/#\/goals\/([0-9a-f-]{36})$/)?.[1];
  if (!goalId) throw new Error("The saved goal route did not include its id.");
  return goalId;
}

test.describe("company goals live relay journey", () => {
  test.skip(!enabled, "set BUZZ_E2E_GOALS_LIVE=1 to run the live goal gate");

  test("persists goal actions and references across reload and community switch", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const relayA = required(
      "BUZZ_E2E_GOALS_RELAY_A",
      process.env.BUZZ_E2E_GOALS_RELAY_A,
    );
    const relayB = required(
      "BUZZ_E2E_GOALS_RELAY_B",
      process.env.BUZZ_E2E_GOALS_RELAY_B,
    );
    const relaySelf = await relaySelfPubkey(relayA);
    await installRelayBridge(page, "tyler", {
      relayHttpUrl: relayA,
      relaySelf,
      relayRequiresMembership: true,
      skipCommunitySeed: true,
    });
    await seedCommunities(page, relayA, relayB);
    await page.goto("/#/goals");
    await expect(page.getByTestId("goals-screen")).toBeVisible();
    await expect(
      page.getByTestId(`community-rail-button-${COMMUNITY_A_ID}`),
    ).toHaveAttribute("aria-current", "true");

    const persistenceTitle = `Persistent goal ${Date.now()}`;
    const persistenceGoalId = await createGoal(page, persistenceTitle);
    const rootTitle = `Client launch outcome ${Date.now()}`;
    const rootGoalId = await createGoal(page, rootTitle, undefined, {
      value: "5",
      unit: "approved plans",
    });
    const childTitle = `Client launch brief ${Date.now()}`;
    const childGoalId = await createGoal(page, childTitle, rootGoalId);
    const secondChildTitle = `Client review checklist ${Date.now()}`;
    const secondChildGoalId = await createGoal(
      page,
      secondChildTitle,
      rootGoalId,
    );

    const editedTitle = `${rootTitle} reviewed`;
    await page.goto(`/#/goals/${rootGoalId}`);
    await page.getByRole("button", { name: "Edit goal" }).click();
    await page.getByLabel("Goal title").fill(editedTitle);
    await page.getByRole("button", { name: "Save goal" }).click();
    await expect(page.getByTestId("goal-detail")).toContainText(editedTitle);
    await page.reload();
    await expect(page.getByTestId("goal-detail")).toContainText(editedTitle);

    await page.goto(`/#/channels/${GENERAL_CHANNEL_ID}`);
    await expect(page.getByTestId("reference-goal-button")).toBeVisible();
    await page.getByTestId("reference-goal-button").click();
    await expect(page.getByTestId("goal-reference-picker")).toBeVisible();
    await page.getByTestId("goal-reference-search").fill(childTitle);
    await page.getByTestId(`insert-goal-${childGoalId}`).click();
    await page
      .getByTestId("message-input")
      .pressSequentially("This sub-goal is the next launch milestone.");
    await page.getByTestId("send-message").click();
    const childCard = page.getByTestId(`goal-reference-card-${childGoalId}`);
    await expect(childCard).toBeVisible();
    await childCard.click();
    await expect(page.getByTestId("goal-detail")).toContainText(childTitle);

    await page.goto(`/#/goals/${rootGoalId}`);
    await page
      .getByRole("button", { name: "Reference in a conversation" })
      .click();
    await expect(page.getByTestId("goal-share-screen")).toBeVisible();
    await page.getByLabel("Conversation").selectOption(GENERAL_CHANNEL_ID);
    await page.getByRole("button", { name: "Post reference" }).click();
    await expect(
      page.getByTestId(`goal-reference-card-${rootGoalId}`),
    ).toBeVisible();

    await page.goto(`/#/goals/${rootGoalId}`);
    await page.getByRole("button", { name: "Update progress" }).click();
    const progressScreen = page.getByTestId("goal-progress-screen");
    await expect(progressScreen).toBeVisible();
    await page.getByLabel("Current value").fill("5");
    await progressScreen.getByLabel("Status").selectOption("off_pace");
    await page
      .getByLabel("Evidence or update")
      .fill("Four approvals are recorded; the fifth is pending review.");
    await page.getByRole("button", { name: "Record update" }).click();
    await expect(page.getByTestId("goal-detail")).toContainText("off pace");
    await expect(page.getByTestId("goal-detail")).toContainText(
      "Four approvals are recorded; the fifth is pending review.",
    );

    await page.getByRole("button", { name: "Archive goal" }).click();
    await page.getByRole("button", { name: "Archive goal" }).click();
    await expect(page.getByTestId("goal-detail")).toContainText(
      "This goal is archived.",
    );
    await page.getByRole("button", { name: "Restore goal" }).click();
    await expect(page.getByTestId("goal-detail")).toContainText("active");

    await page.getByRole("button", { name: "Delete goal" }).click();
    const deleteScreen = page.getByTestId("goal-delete-screen");
    await expect(deleteScreen).toContainText("2 sub-goals");
    await expect(deleteScreen).toContainText(childTitle);
    await expect(deleteScreen).toContainText(secondChildTitle);
    await expect(
      deleteScreen.getByRole("button", { name: "Delete goal" }),
    ).toHaveCount(0);
    await deleteScreen
      .getByRole("button", { name: "Edit relationships" })
      .click();
    await expect(page).toHaveURL(new RegExp(`#/goals/${childGoalId}/edit$`));
    await page.getByRole("button", { name: "Cancel" }).click();

    for (const dependentGoalId of [childGoalId, secondChildGoalId]) {
      await page.goto(`/#/goals/${dependentGoalId}`);
      await page.getByRole("button", { name: "Delete goal" }).click();
      await expect(
        page
          .getByTestId("goal-delete-screen")
          .getByRole("button", { name: "Delete goal" }),
      ).toBeVisible();
      await page
        .getByTestId("goal-delete-screen")
        .getByRole("button", { name: "Delete goal" })
        .click();
      await expect(page).toHaveURL(/#\/goals$/);
    }

    await page.goto(`/#/goals/${rootGoalId}`);
    await page.getByRole("button", { name: "Delete goal" }).click();
    await expect(
      page
        .getByTestId("goal-delete-screen")
        .getByRole("button", { name: "Delete goal" }),
    ).toBeVisible();
    await page
      .getByTestId("goal-delete-screen")
      .getByRole("button", { name: "Delete goal" })
      .click();
    await expect(page).toHaveURL(/#\/goals$/);
    await expect(page.getByTestId(`goal-row-${rootGoalId}`)).toHaveCount(0);

    await page.reload();
    await expect(
      page.getByTestId(`goal-row-${persistenceGoalId}`),
    ).toContainText(persistenceTitle);
    await page.getByTestId(`community-rail-button-${COMMUNITY_B_ID}`).click();
    await expect(
      page.getByTestId(`community-rail-button-${COMMUNITY_B_ID}`),
    ).toHaveAttribute("aria-current", "true");
    await page.goto("/#/goals");
    await expect(page.getByTestId("goals-screen")).toBeVisible();
    await expect(page.getByText("No goals here yet")).toBeVisible();
    await page.getByTestId(`community-rail-button-${COMMUNITY_A_ID}`).click();
    await expect(
      page.getByTestId(`community-rail-button-${COMMUNITY_A_ID}`),
    ).toHaveAttribute("aria-current", "true");
    await page.goto("/#/goals");
    await expect(
      page.getByTestId(`goal-row-${persistenceGoalId}`),
    ).toContainText(persistenceTitle);
  });
});
