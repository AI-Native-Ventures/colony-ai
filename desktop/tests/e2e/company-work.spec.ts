import { bytesToHex } from "@noble/hashes/utils.js";
import { expect, test } from "@playwright/test";
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
} from "nostr-tools/pure";

import { installMockBridge, TEST_IDENTITIES } from "../helpers/bridge";
import { seedActiveIdentity } from "../helpers/onboarding";

const GENERAL_CHANNEL_ID = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
const GOAL_ID = "e1a2b3c4-d5e6-4789-8abc-1234567890ab";

function goalHeadEvent(relaySecret: Uint8Array, ownerPubkey: string) {
  return finalizeEvent(
    {
      kind: 30642,
      created_at: Math.floor(Date.now() / 1_000),
      tags: [["d", `company:goal:${GOAL_ID}`]],
      content: JSON.stringify({
        schemaVersion: 1,
        goalId: GOAL_ID,
        status: "active",
        title: "Complete the launch brief",
        goal: {
          schemaVersion: 1,
          goalId: GOAL_ID,
          title: "Complete the launch brief",
          ownerPubkey,
          doneCondition: "The launch brief is reviewed and approved.",
          linkedChannelIds: [GENERAL_CHANNEL_ID],
        },
        sourceActionEventId: "a".repeat(64),
      }),
    },
    relaySecret,
  );
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

async function installCompanyWorkMock(
  page: import("@playwright/test").Page,
  companyWorkActionErrors: string[] = [],
) {
  const relaySecret = generateSecretKey();
  const relaySelf = getPublicKey(relaySecret);
  await seedActiveIdentity(page, TEST_IDENTITIES.tyler);
  await installMockBridge(page, {
    companyWorkEvents: [],
    companyWorkActionErrors,
    companyWorkRelayPrivateKey: bytesToHex(relaySecret),
    goalEvents: [goalHeadEvent(relaySecret, TEST_IDENTITIES.tyler.pubkey)],
    goalRelayPrivateKey: bytesToHex(relaySecret),
    relayRequiresMembership: true,
    relayRole: "owner",
    relaySelf,
  });
}

async function activateByKeyboard(
  page: import("@playwright/test").Page,
  control: import("@playwright/test").Locator,
) {
  await control.focus();
  await page.keyboard.press("Enter");
}

test("company work keeps its chat source, review history, and goal link", async ({
  page,
}) => {
  await installCompanyWorkMock(page);
  await page.goto(`/#/channels/${GENERAL_CHANNEL_ID}`);
  const joinButton = page.getByRole("button", {
    name: "Join to participate",
  });
  await expect(joinButton).toBeVisible();
  await joinButton.click();
  await expect(page.getByTestId("reference-goal-button")).toBeVisible();
  await waitForMockLiveSubscription(page, "general");

  const sourceEventId = await page.evaluate((goalId) => {
    const event = window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
      channelName: "general",
      content: `The launch brief is tracked here: buzz://goal/${goalId}`,
    });
    if (!event) throw new Error("The mock message seam is unavailable.");
    return event.id;
  }, GOAL_ID);
  await expect(
    page.getByTestId(`goal-reference-card-${GOAL_ID}`),
  ).toBeVisible();
  await page
    .getByTestId(`create-company-work-from-message-${sourceEventId}`)
    .click();

  const form = page.getByTestId("company-work-form");
  await expect(form).toBeVisible();
  await expect(page.getByText("Company / Create work item")).toBeVisible();
  await expect(page.getByTestId("company-work-goal")).toHaveValue(GOAL_ID);
  await expect(page.getByTestId("company-work-conversation")).toHaveValue(
    GENERAL_CHANNEL_ID,
  );
  await page.getByTestId("company-work-title").fill("Review launch brief");
  await page
    .getByTestId("company-work-done-condition")
    .fill("A reviewer approves the launch brief.");
  await page
    .getByTestId("company-work-owner")
    .selectOption(TEST_IDENTITIES.tyler.pubkey);
  await page
    .getByTestId("company-work-requester")
    .selectOption(TEST_IDENTITIES.tyler.pubkey);
  await page
    .getByTestId("company-work-evidence")
    .fill("The first brief is ready for review.");
  const createButton = page.getByRole("button", {
    name: "Create commitment",
  });
  await expect(createButton).toBeEnabled();
  await createButton.focus();
  await page.keyboard.press("Enter");

  const detail = page.getByTestId("company-work-detail");
  await expect(detail).toBeVisible();
  await expect(detail).toContainText("Review launch brief");
  await expect(page.getByText("Company / Review launch brief")).toBeVisible();
  await expect(page.getByTestId("company-work-goal-card")).toContainText(
    "Complete the launch brief",
  );
  await expect(detail.getByRole("button", { name: /# general/ })).toContainText(
    "The launch brief is tracked here",
  );
  const workItemId = page.url().match(/#\/work\/detail\/([0-9a-f-]{36})$/)?.[1];
  if (!workItemId) throw new Error("The saved work item route has no id.");

  const storedSource = await page.evaluate((id) => {
    const events = JSON.parse(
      window.localStorage.getItem("buzz-e2e-company-work-events-v1") ?? "[]",
    ) as Array<{ kind: number; content: string }>;
    const headEvent = events.find(
      (event) =>
        event.kind === 30634 &&
        (JSON.parse(event.content) as { workItemId?: string }).workItemId ===
          id,
    );
    if (!headEvent)
      throw new Error("The relay did not persist a company head.");
    return JSON.parse(headEvent.content) as {
      sourceEventId?: string;
      threadRootEventId?: string;
    };
  }, workItemId);
  expect(storedSource.sourceEventId).toBe(sourceEventId);
  expect(storedSource.threadRootEventId).toBe(sourceEventId);

  await activateByKeyboard(
    page,
    page.getByRole("button", { name: "Edit work item" }),
  );
  await page
    .getByTestId("company-work-title")
    .fill("Review final launch brief");
  await page
    .getByTestId("company-work-done-condition")
    .fill("A reviewer approves the final launch brief.");
  const saveButton = page.getByRole("button", { name: "Save work item" });
  await saveButton.focus();
  await page.keyboard.press("Enter");
  await expect(detail).toContainText("Review final launch brief");

  await activateByKeyboard(
    page,
    page.getByRole("button", { name: "Update status" }),
  );
  await expect(page.getByText("Done condition", { exact: true })).toBeVisible();
  await page.getByTestId("company-work-status").focus();
  await page.getByTestId("company-work-status").press("End");
  await page
    .getByTestId("company-work-status-reason")
    .fill("The owner submitted the final document.");
  await activateByKeyboard(
    page,
    page.getByRole("button", { name: "Save status" }),
  );
  await expect(
    detail.getByText("done unverified", { exact: true }),
  ).toBeVisible();

  await activateByKeyboard(
    page,
    page.getByRole("button", { name: "Review and verify" }),
  );
  await expect(page.getByText("Done condition", { exact: true })).toBeVisible();
  await page.getByTestId("company-work-verdict").focus();
  await page.getByTestId("company-work-verdict").press("End");
  await page
    .getByTestId("company-work-review-note")
    .fill("Add the approved budget table before closing this work.");
  await activateByKeyboard(
    page,
    page.getByRole("button", { name: "Record verdict" }),
  );
  await expect(detail.getByText("Revision requested")).toBeVisible();
  await expect(detail.getByText("active", { exact: true })).toBeVisible();

  await activateByKeyboard(
    page,
    page.getByRole("button", { name: "Update status" }),
  );
  await page.getByTestId("company-work-status").focus();
  await page.getByTestId("company-work-status").press("End");
  await page
    .getByTestId("company-work-status-reason")
    .fill("The budget table was added.");
  await activateByKeyboard(
    page,
    page.getByRole("button", { name: "Save status" }),
  );
  await activateByKeyboard(
    page,
    page.getByRole("button", { name: "Review and verify" }),
  );
  await page.getByTestId("company-work-verdict").focus();
  await page.getByTestId("company-work-verdict").press("Home");
  await page
    .getByTestId("company-work-review-note")
    .fill("The final brief meets the done condition.");
  const recordVerdict = page.getByRole("button", { name: "Record verdict" });
  await recordVerdict.focus();
  await page.keyboard.press("Enter");
  await expect(detail.getByText("Verification passed")).toBeVisible();
  await page.reload();
  await page.goto(`/#/channels/${GENERAL_CHANNEL_ID}`);
  const rejoinButton = page.getByRole("button", {
    name: "Join to participate",
  });
  await expect(rejoinButton).toBeVisible();
  await rejoinButton.click();
  await expect(page.getByTestId("reference-goal-button")).toBeVisible();
  await page.goto(`/#/work/detail/${workItemId}`);
  await expect(page.getByTestId("company-work-verification")).toContainText(
    "The final brief meets the done condition.",
  );

  await activateByKeyboard(
    page,
    page.getByRole("button", { name: "Archive work item" }),
  );
  await activateByKeyboard(
    page,
    page.getByRole("button", { name: "Archive item" }),
  );
  await expect(detail).toContainText("This work item is archived.");
  await activateByKeyboard(
    page,
    page.getByRole("button", { name: "Restore work item" }),
  );
  await expect(detail.getByText("active", { exact: true })).toBeVisible();

  await page.goto(`/#/goals/${GOAL_ID}`);
  const goalDetail = page.getByTestId("goal-detail");
  await expect(
    goalDetail.getByRole("heading", { name: "Linked work 1" }),
  ).toBeVisible();
  await expect(
    goalDetail.getByTestId(`company-work-row-${workItemId}`),
  ).toContainText("Review final launch brief");
  await goalDetail.getByRole("button", { name: "Link work" }).click();
  await expect(page.getByTestId("company-work-form")).toBeVisible();
  await expect(page.getByTestId("company-work-goal")).toHaveValue(GOAL_ID);
});

test("company work keeps entered fields after a rejected create", async ({
  page,
}) => {
  const failureMessage = "The relay rejected this work item. Try again.";
  await installCompanyWorkMock(page, [failureMessage]);
  await page.goto(`/#/channels/${GENERAL_CHANNEL_ID}`);
  await page.getByRole("button", { name: "Join to participate" }).click();
  await expect(page.getByTestId("reference-goal-button")).toBeVisible();
  await page.goto("/#/work/new");

  const form = page.getByTestId("company-work-form");
  await page
    .getByTestId("company-work-conversation")
    .selectOption(GENERAL_CHANNEL_ID);
  await page.getByTestId("company-work-title").fill("Retain this launch brief");
  await page
    .getByTestId("company-work-done-condition")
    .fill("A reviewer approves this launch brief.");
  await page
    .getByTestId("company-work-owner")
    .selectOption(TEST_IDENTITIES.tyler.pubkey);
  await page
    .getByTestId("company-work-requester")
    .selectOption(TEST_IDENTITIES.tyler.pubkey);
  await page
    .getByTestId("company-work-evidence")
    .fill("Keep these notes after a failed save.");

  const createButton = page.getByRole("button", {
    name: "Create commitment",
  });
  await createButton.click();
  await expect(form.getByRole("alert")).toContainText(failureMessage);
  await expect(page.getByTestId("company-work-conversation")).toHaveValue(
    GENERAL_CHANNEL_ID,
  );
  await expect(page.getByTestId("company-work-title")).toHaveValue(
    "Retain this launch brief",
  );
  await expect(page.getByTestId("company-work-done-condition")).toHaveValue(
    "A reviewer approves this launch brief.",
  );
  await expect(page.getByTestId("company-work-owner")).toHaveValue(
    TEST_IDENTITIES.tyler.pubkey,
  );
  await expect(page.getByTestId("company-work-requester")).toHaveValue(
    TEST_IDENTITIES.tyler.pubkey,
  );
  await expect(page.getByTestId("company-work-evidence")).toHaveValue(
    "Keep these notes after a failed save.",
  );

  await createButton.click();
  await expect(page.getByTestId("company-work-detail")).toContainText(
    "Retain this launch brief",
  );
});

test("company work creation is reachable in form order from the keyboard", async ({
  page,
}) => {
  await installCompanyWorkMock(page);
  await page.goto(`/#/channels/${GENERAL_CHANNEL_ID}`);
  await page.getByRole("button", { name: "Join to participate" }).click();
  await page.goto("/#/work/new");

  await page
    .getByTestId("company-work-conversation")
    .selectOption(GENERAL_CHANNEL_ID);
  await page.getByTestId("company-work-title").fill("Keyboard launch brief");
  await page
    .getByTestId("company-work-done-condition")
    .fill("A reviewer approves the launch brief.");
  await page
    .getByTestId("company-work-owner")
    .selectOption(TEST_IDENTITIES.tyler.pubkey);
  await page
    .getByTestId("company-work-requester")
    .selectOption(TEST_IDENTITIES.tyler.pubkey);
  await expect(
    page.getByRole("button", { name: "Create commitment" }),
  ).toBeEnabled();

  const focusOrder = [
    page.getByTestId("company-work-done-condition"),
    page.getByTestId("company-work-owner"),
    page.getByTestId("company-work-requester"),
    page.getByTestId("company-work-goal"),
    page.getByTestId("company-work-conversation"),
    page.getByTestId("company-work-evidence"),
    page.getByRole("button", { name: "Create commitment" }),
    page.getByRole("button", { name: "Cancel" }),
  ];
  await page.getByTestId("company-work-title").focus();
  for (const control of focusOrder) {
    await page.keyboard.press("Tab");
    await expect(control).toBeFocused();
  }

  await page.getByRole("button", { name: "Create commitment" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("company-work-detail")).toContainText(
    "Keyboard launch brief",
  );
});
