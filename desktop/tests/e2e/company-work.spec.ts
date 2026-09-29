import { bytesToHex } from "@noble/hashes/utils.js";
import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
} from "nostr-tools/pure";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge, TEST_IDENTITIES } from "../helpers/bridge";
import { seedActiveIdentity } from "../helpers/onboarding";

const CAPTURE_COMPANY_WORK_MATRIX =
  process.env.CAPTURE_COMPANY_WORK_MATRIX === "1";
const GENERAL_CHANNEL_ID = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
const GOAL_ID = "e1a2b3c4-d5e6-4789-8abc-1234567890ab";
const LINK_FAILURE_WORK_ID = "7a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
const LINK_SUCCESS_WORK_ID = "8a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
const MOVE_WORK_ID = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";

type SeedWorkItem = {
  workItemId: string;
  title: string;
  goalId?: string;
  ownerPubkey?: string;
  reviewerPubkey?: string;
  dueAt?: string;
  status?:
    | "active"
    | "paused"
    | "blocked"
    | "done_unverified"
    | "done_verified";
};

type SeedGoal = { goalId: string; title: string; parentGoalId?: string };

function goalHeadEvent(
  relaySecret: Uint8Array,
  ownerPubkey: string,
  goal: SeedGoal = { goalId: GOAL_ID, title: "Complete the launch brief" },
) {
  return finalizeEvent(
    {
      kind: 30642,
      created_at: Math.floor(Date.now() / 1_000),
      tags: [["d", `company:goal:${goal.goalId}`]],
      content: JSON.stringify({
        schemaVersion: 1,
        goalId: goal.goalId,
        status: "active",
        title: goal.title,
        goal: {
          schemaVersion: 1,
          goalId: goal.goalId,
          ...(goal.parentGoalId ? { parentGoalId: goal.parentGoalId } : {}),
          title: goal.title,
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

function companyWorkHeadEvent(
  relaySecret: Uint8Array,
  ownerPubkey: string,
  workItem: SeedWorkItem,
) {
  return finalizeEvent(
    {
      kind: 30634,
      created_at: Math.floor(Date.now() / 1_000),
      tags: [
        ["h", GENERAL_CHANNEL_ID],
        ["d", `company:work:${workItem.workItemId}`],
      ],
      content: JSON.stringify({
        schemaVersion: 1,
        workItemId: workItem.workItemId,
        title: workItem.title,
        status: workItem.status ?? "active",
        assignedPubkeys: [workItem.ownerPubkey ?? ownerPubkey],
        approverPubkeys: workItem.reviewerPubkey
          ? [workItem.reviewerPubkey]
          : [],
        deliverables: [],
        requesterPubkey: workItem.ownerPubkey ?? ownerPubkey,
        doneCondition: `The work for ${workItem.title} is complete.`,
        ...(workItem.goalId ? { goalId: workItem.goalId } : {}),
        ...(workItem.dueAt
          ? {
              acceptedAt: new Date(Date.now() - 60_000).toISOString(),
              dueAt: workItem.dueAt,
            }
          : {}),
        sourceActionEventId: "c".repeat(64),
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
  workItems: SeedWorkItem[] = [],
  goals: SeedGoal[] = [{ goalId: GOAL_ID, title: "Complete the launch brief" }],
) {
  const relaySecret = generateSecretKey();
  const relaySelf = getPublicKey(relaySecret);
  if (CAPTURE_COMPANY_WORK_MATRIX) {
    await page.addInitScript(() => {
      window.localStorage.removeItem("buzz-theme");
      window.localStorage.removeItem("buzz-follow-system");
    });
  }
  await seedActiveIdentity(page, TEST_IDENTITIES.tyler);
  await installMockBridge(page, {
    companyWorkEvents: workItems.map((workItem) =>
      companyWorkHeadEvent(relaySecret, TEST_IDENTITIES.tyler.pubkey, workItem),
    ),
    companyWorkActionErrors,
    companyWorkRelayPrivateKey: bytesToHex(relaySecret),
    goalEvents: goals.map((goal) =>
      goalHeadEvent(relaySecret, TEST_IDENTITIES.tyler.pubkey, goal),
    ),
    goalRelayPrivateKey: bytesToHex(relaySecret),
    relayRequiresMembership: true,
    relayRole: "owner",
    relaySelf,
    searchProfiles: [
      {
        pubkey: TEST_IDENTITIES.tyler.pubkey,
        displayName: "Tyler",
        isAgent: false,
      },
      {
        pubkey: TEST_IDENTITIES.alice.pubkey,
        displayName: "Alice",
        isAgent: false,
      },
      {
        pubkey: TEST_IDENTITIES.bob.pubkey,
        displayName: "Briefing Agent",
        isAgent: true,
      },
    ],
  });
}

async function activateByKeyboard(
  page: import("@playwright/test").Page,
  control: import("@playwright/test").Locator,
) {
  await control.focus();
  await page.keyboard.press("Enter");
}

async function captureCompanyWorkMatrix(
  page: import("@playwright/test").Page,
  label: string,
) {
  if (!CAPTURE_COMPANY_WORK_MATRIX) return;
  const outputDirectory = resolve(
    process.cwd(),
    "test-results/company-work-v8-comparison",
  );
  mkdirSync(outputDirectory, { recursive: true });
  for (const [width, height] of [
    [1728, 1117],
    [1440, 900],
  ] as const) {
    await page.setViewportSize({ width, height });
    for (const theme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await page.waitForFunction(
        (shouldBeDark) =>
          document.documentElement.classList.contains("dark") === shouldBeDark,
        theme === "dark",
      );
      await waitForAnimations(page);
      await page.screenshot({
        path: resolve(
          outputDirectory,
          `${label}-${width}x${height}-${theme}.png`,
        ),
      });
    }
  }
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 1280, height: 720 });
}

test("company work keeps its chat source, review history, and goal link", async ({
  page,
}) => {
  if (CAPTURE_COMPANY_WORK_MATRIX) test.setTimeout(120_000);
  await installCompanyWorkMock(page);
  await page.goto(`/#/channels/${GENERAL_CHANNEL_ID}`);
  const joinButton = page.getByRole("button", {
    name: "Join to participate",
  });
  await expect(joinButton).toBeVisible({ timeout: 30_000 });
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
  const newMessagesButton = page.getByRole("button", {
    name: /new messages/,
  });
  if (await newMessagesButton.isVisible()) await newMessagesButton.click();
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
  await captureCompanyWorkMatrix(page, "work-detail");
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
  await page.goto(`/#/channels/${GENERAL_CHANNEL_ID}`);
  await expect(page.getByTestId("reference-goal-button")).toBeVisible();
  await waitForMockLiveSubscription(page, "general");
  const destinationRootId = await page.evaluate((pubkey) => {
    const event = window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
      channelName: "general",
      content: "Final review thread",
      pubkey,
    });
    if (!event) throw new Error("The mock message seam is unavailable.");
    return event.id;
  }, TEST_IDENTITIES.tyler.pubkey);
  await page.goto(`/#/work/detail/${workItemId}`);
  await expect(page.getByTestId("company-work-verification")).toContainText(
    "The final brief meets the done condition.",
  );
  await activateByKeyboard(
    page,
    page.getByRole("button", { name: "Move to another thread" }),
  );
  const moveScreen = page.getByTestId("company-work-move");
  await expect(moveScreen).toContainText(
    "Choose an existing thread you can access. A move cannot silently change who can see the work.",
  );
  await captureCompanyWorkMatrix(page, "work-move");
  await page.getByTestId(`company-work-move-root-${destinationRootId}`).click();
  await page.getByRole("button", { name: "Review move" }).click();
  await expect(moveScreen).toContainText("Same audience");
  await captureCompanyWorkMatrix(page, "work-move-confirm");
  await page.getByRole("button", { name: "Move work item" }).click();
  await expect(page.getByTestId("company-work-detail")).toContainText(
    "moved this work item to a new thread.",
  );

  await page.goto(
    `/#/channels/${GENERAL_CHANNEL_ID}?messageId=${sourceEventId}&threadRootId=${sourceEventId}`,
  );
  const movedReference = page.getByTestId(
    `company-work-moved-reference-${workItemId}`,
  );
  await expect(movedReference).toBeVisible();
  await expect(movedReference).toContainText(
    "moved this work item to another thread.",
  );
  await movedReference
    .getByRole("button", { name: "Open moved thread" })
    .click();
  await expect(
    page.getByTestId(`company-work-current-card-${workItemId}`),
  ).toBeVisible();
  await captureCompanyWorkMatrix(page, "work-thread-panel");
  await page.getByRole("button", { name: "Full timeline" }).click();
  await expect(page.getByTestId("company-work-full-timeline")).toContainText(
    "moved this work item to a new thread.",
  );
  await captureCompanyWorkMatrix(page, "work-full-timeline");
  await page.goto(`/#/work/detail/${workItemId}`);
  await expect(page.getByTestId("company-work-detail")).toBeVisible({
    timeout: 30_000,
  });
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
  await captureCompanyWorkMatrix(page, "goal-linked-work");
  await goalDetail.getByRole("button", { name: "Link work" }).click();
  await expect(page.getByTestId("goal-work-link-form")).toBeVisible();
  await expect(
    page.getByTestId(`goal-work-link-checkbox-${workItemId}`),
  ).toBeChecked();
});

test("goal work links retain and retry only the failed exact-head action", async ({
  page,
}) => {
  const headConflict =
    "conflict: company work item changed; retry from its latest head";
  await installCompanyWorkMock(
    page,
    [headConflict],
    [
      { workItemId: LINK_FAILURE_WORK_ID, title: "A review the launch plan" },
      { workItemId: LINK_SUCCESS_WORK_ID, title: "B approve the final brief" },
    ],
  );
  await page.goto(`/#/channels/${GENERAL_CHANNEL_ID}`);
  const joinButton = page.getByRole("button", {
    name: "Join to participate",
  });
  await expect(joinButton).toBeVisible({ timeout: 30_000 });
  await joinButton.click();
  await page.goto(`/#/goals/link/${GOAL_ID}`);

  const form = page.getByTestId("goal-work-link-form");
  await expect(form).toBeVisible();
  const failedCheckbox = page.getByTestId(
    `goal-work-link-checkbox-${LINK_FAILURE_WORK_ID}`,
  );
  const successfulCheckbox = page.getByTestId(
    `goal-work-link-checkbox-${LINK_SUCCESS_WORK_ID}`,
  );
  await failedCheckbox.focus();
  await page.keyboard.press("Space");
  await successfulCheckbox.focus();
  await page.keyboard.press("Space");

  const saveButton = page.getByRole("button", { name: "Save work links" });
  await saveButton.focus();
  await page.keyboard.press("Enter");

  await expect(
    page.getByTestId(`goal-work-link-error-${LINK_FAILURE_WORK_ID}`),
  ).toContainText("company work item changed");
  await expect(
    page.getByTestId(`goal-work-link-item-${LINK_SUCCESS_WORK_ID}`),
  ).toContainText("Saved");
  await expect(
    page.getByTestId("goal-work-link-partial-failure"),
  ).toContainText("Some work links could not be saved");
  await expect(failedCheckbox).toBeChecked();
  await expect(successfulCheckbox).toBeChecked();

  await page.getByRole("button", { name: "Retry failed links" }).click();
  await expect(page).toHaveURL(new RegExp(`/goals/${GOAL_ID}$`));
  const goalDetail = page.getByTestId("goal-detail");
  await expect(
    goalDetail.getByTestId(`company-work-row-${LINK_FAILURE_WORK_ID}`),
  ).toBeVisible();
  await expect(
    goalDetail.getByTestId(`company-work-row-${LINK_SUCCESS_WORK_ID}`),
  ).toBeVisible();
});

test("company work filters intersect real owners, statuses, and goal descendants", async ({
  page,
}) => {
  const parentGoalId = "4a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
  const childGoalId = "5a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
  const otherGoalId = "6a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
  const tylerWorkId = "1a1657ac-f7aa-5db0-b632-d8bbeb6dfb51";
  const aliceWorkId = "2a1657ac-f7aa-5db0-b632-d8bbeb6dfb51";
  const agentWorkId = "3a1657ac-f7aa-5db0-b632-d8bbeb6dfb51";
  const unrelatedWorkId = "4a1657ac-f7aa-5db0-b632-d8bbeb6dfb51";
  await installCompanyWorkMock(
    page,
    [],
    [
      {
        workItemId: tylerWorkId,
        title: "Prepare launch outline",
        goalId: parentGoalId,
      },
      {
        workItemId: aliceWorkId,
        title: "Draft customer brief",
        goalId: childGoalId,
        ownerPubkey: TEST_IDENTITIES.alice.pubkey,
      },
      {
        workItemId: agentWorkId,
        title: "Review customer brief",
        goalId: childGoalId,
        ownerPubkey: TEST_IDENTITIES.bob.pubkey,
        status: "blocked",
      },
      {
        workItemId: unrelatedWorkId,
        title: "Prepare sales update",
        goalId: otherGoalId,
        ownerPubkey: TEST_IDENTITIES.alice.pubkey,
      },
    ],
    [
      { goalId: parentGoalId, title: "Launch customer plan" },
      {
        goalId: childGoalId,
        parentGoalId,
        title: "Customer brief",
      },
      { goalId: otherGoalId, title: "Sales update" },
    ],
  );
  await page.goto(`/#/channels/${GENERAL_CHANNEL_ID}`);
  await page.getByRole("button", { name: "Join to participate" }).click();
  await expect(page.getByTestId("reference-goal-button")).toBeVisible();
  await page.goto("/#/company-work");

  const list = page.getByTestId("company-work-list");
  await expect(list.getByText("4 commitments", { exact: true })).toBeVisible();
  const ownerFilter = page.getByTestId("company-work-owner-filter");
  const goalFilter = page.getByTestId("company-work-goal-filter");
  await expect(
    page.getByTestId("company-work-status-filter").locator("option:checked"),
  ).toHaveText("All statuses");
  await expect(ownerFilter).toContainText("Anyone");
  await expect(goalFilter).toContainText("Any goal");
  await ownerFilter.click();
  const ownerSearch = page.getByRole("textbox", { name: "Search owners" });
  await ownerSearch.fill("Alice");
  await ownerSearch.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("company-work-filter-chips")).toContainText(
    "Owner: Alice",
  );
  await expect(
    page.getByTestId(`company-work-row-${aliceWorkId}`),
  ).toBeVisible();
  await expect(
    page.getByTestId(`company-work-row-${unrelatedWorkId}`),
  ).toBeVisible();
  await expect(page.getByTestId(`company-work-row-${tylerWorkId}`)).toHaveCount(
    0,
  );

  await goalFilter.click();
  const goalSearch = page.getByRole("textbox", { name: "Search goals" });
  await goalSearch.fill("Launch customer plan");
  await goalSearch.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("company-work-filter-chips")).toContainText(
    "Goal: Launch customer plan + sub-goals",
  );
  await expect(
    page.getByTestId(`company-work-row-${aliceWorkId}`),
  ).toBeVisible();
  await expect(
    page.getByTestId(`company-work-row-${unrelatedWorkId}`),
  ).toHaveCount(0);

  await page.getByTestId("company-work-status-filter").selectOption("blocked");
  await expect(list.getByText("0 commitments", { exact: true })).toBeVisible();
  await expect(list.getByText("No work matches these filters")).toBeVisible();
  await page
    .getByRole("button", { name: "Clear Status: blocked filter" })
    .click();
  await expect(
    page.getByTestId(`company-work-row-${aliceWorkId}`),
  ).toBeVisible();
  await expect(page.getByTestId(`company-work-row-${agentWorkId}`)).toHaveCount(
    0,
  );

  await page.getByRole("button", { name: "Clear Owner: Alice filter" }).click();
  await expect(
    page.getByTestId(`company-work-row-${tylerWorkId}`),
  ).toBeVisible();
  await expect(
    page.getByTestId(`company-work-row-${agentWorkId}`),
  ).toBeVisible();
  await expect(
    page.getByTestId(`company-work-row-${unrelatedWorkId}`),
  ).toHaveCount(0);

  await page.getByTestId("company-work-clear-all").click();
  await expect(list.getByText("4 commitments", { exact: true })).toBeVisible();
  await captureCompanyWorkMatrix(page, "work-list-all");
  await ownerFilter.click();
  const agentSearch = page.getByRole("textbox", { name: "Search owners" });
  await agentSearch.fill("AI employee");
  await agentSearch.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(
    page.getByTestId(`company-work-row-${agentWorkId}`),
  ).toBeVisible();
  await expect(page.getByTestId(`company-work-row-${aliceWorkId}`)).toHaveCount(
    0,
  );
  await captureCompanyWorkMatrix(page, "work-list-filters");
});

test("company work tracking reads current owner records and keeps unavailable automation off", async ({
  page,
}) => {
  if (CAPTURE_COMPANY_WORK_MATRIX) test.setTimeout(120_000);
  const aliceWorkId = "4a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
  const tylerWorkId = "5a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
  const dueWorkId = "6a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
  const dueAt = new Date(Date.now() + 86_400_000).toISOString();
  await installCompanyWorkMock(
    page,
    [],
    [
      {
        workItemId: aliceWorkId,
        title: "Prepare the client handover",
        ownerPubkey: TEST_IDENTITIES.alice.pubkey,
      },
      { workItemId: tylerWorkId, title: "Review the launch brief" },
      {
        workItemId: dueWorkId,
        title: "Prepare the October campaign",
        reviewerPubkey: TEST_IDENTITIES.alice.pubkey,
        dueAt,
      },
    ],
  );

  await page.goto(`/#/channels/${GENERAL_CHANNEL_ID}`);
  const joinButton = page.getByRole("button", {
    name: "Join to participate",
  });
  await expect(joinButton).toBeVisible({ timeout: 30_000 });
  await joinButton.click();
  await expect(page.getByTestId("reference-goal-button")).toBeVisible();
  await page.goto(`/#/work/tracking/person/${TEST_IDENTITIES.alice.pubkey}`);
  const commitments = page.getByTestId("company-work-person-commitments");
  await expect(commitments).toContainText("Prepare the client handover");
  await expect(
    page.getByTestId(`company-work-person-row-${tylerWorkId}`),
  ).toHaveCount(0);
  await captureCompanyWorkMatrix(page, "work-person-commitments");

  await page.goto(`/#/work/tracking/timeline/${dueWorkId}`);
  await expect(
    page.getByRole("heading", { name: "Work context" }),
  ).toBeVisible();
  const dueDate = new Date(dueAt);
  const expectedDue = `${new Intl.DateTimeFormat(undefined, {
    weekday: "long",
  }).format(dueDate)}, ${new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
  }).format(dueDate)}`;
  await expect(page.getByText("Reviewer", { exact: true })).toBeVisible();
  await expect(page.getByText("Due", { exact: true })).toBeVisible();
  await expect(page.getByText(expectedDue, { exact: true })).toBeVisible();
  await captureCompanyWorkMatrix(page, "work-timeline-due");

  await page.goto(`/#/work/tracking/watchdog/${aliceWorkId}`);
  await expect(page.getByText("Watchdog is off")).toBeVisible();
  await expect(
    page.getByText("No interval is selected or saved."),
  ).toBeVisible();
  await expect(page.getByRole("spinbutton")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Save changes" }),
  ).toBeDisabled();
  await captureCompanyWorkMatrix(page, "work-watchdog-off");

  await page.goto(`/#/work/tracking/watchdog-saved/${aliceWorkId}`);
  await expect(
    page.getByText("Watchdog settings were not saved"),
  ).toBeVisible();
  await expect(page.getByText("The watchdog remains off")).toBeVisible();
  await captureCompanyWorkMatrix(page, "work-watchdog-saved");

  await page.goto(`/#/work/tracking/suggestion/${aliceWorkId}`);
  await expect(page.getByText("Suggestions unavailable")).toBeVisible();
  await expect(
    page.getByText("Messages never create work automatically."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Track this?" })).toHaveCount(
    0,
  );
  await captureCompanyWorkMatrix(page, "work-suggestion-unavailable");
});

test("company work move keeps its destination on failure and preserves standalone roots on edit", async ({
  page,
}) => {
  const failureMessage =
    "restricted: moving work would change conversation membership or permissions.";
  await installCompanyWorkMock(
    page,
    [failureMessage],
    [{ workItemId: MOVE_WORK_ID, title: "Prepare the launch brief" }],
  );
  await page.goto(`/#/channels/${GENERAL_CHANNEL_ID}`);
  await page.getByRole("button", { name: "Join to participate" }).click();
  await expect(page.getByTestId("reference-goal-button")).toBeVisible();
  await waitForMockLiveSubscription(page, "general");
  const destinationRootId = await page.evaluate((pubkey) => {
    const event = window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
      channelName: "general",
      content: "Reviewed launch plan",
      pubkey,
    });
    if (!event) throw new Error("The mock message seam is unavailable.");
    return event.id;
  }, TEST_IDENTITIES.tyler.pubkey);

  await page.goto(`/#/work/move/${MOVE_WORK_ID}`);
  const moveScreen = page.getByTestId("company-work-move");
  const destination = page.getByTestId(
    `company-work-move-root-${destinationRootId}`,
  );
  await expect(destination).toBeVisible();
  await destination.click();
  const reviewButton = page.getByRole("button", { name: "Review move" });
  await expect(reviewButton).toBeEnabled();
  await reviewButton.click();
  await expect(moveScreen).toContainText("Same audience");
  await page.getByRole("button", { name: "Move work item" }).click();

  await expect(page.getByTestId("company-work-move-failure")).toContainText(
    failureMessage,
  );
  await captureCompanyWorkMatrix(page, "work-move-failed");
  const failedHead = await page.evaluate((id) => {
    const events = JSON.parse(
      window.localStorage.getItem("buzz-e2e-company-work-events-v1") ?? "[]",
    ) as Array<{ kind: number; content: string }>;
    const event = events.find(
      (candidate) =>
        candidate.kind === 30634 &&
        (JSON.parse(candidate.content) as { workItemId?: string })
          .workItemId === id,
    );
    return event
      ? (JSON.parse(event.content) as { threadRootEventId?: string })
      : null;
  }, MOVE_WORK_ID);
  expect(failedHead?.threadRootEventId).toBeUndefined();

  await page.getByRole("button", { name: "Retry move" }).click();
  await expect(page.getByTestId("company-work-detail")).toContainText(
    "Prepare the launch brief",
  );
  await expect(page.getByTestId("company-work-detail")).toContainText(
    "moved this work item to a new thread.",
  );
  await expect(page.getByTestId("company-work-detail")).toContainText(
    "Reviewed launch plan",
  );
  expect(page.url()).toContain(`/work/detail/${MOVE_WORK_ID}`);

  await page.getByRole("button", { name: "Edit work item" }).click();
  await page.getByTestId("company-work-title").fill("Prepare the final brief");
  await page.getByRole("button", { name: "Save work item" }).click();
  await expect(page.getByTestId("company-work-detail")).toContainText(
    "Prepare the final brief",
  );
  const movedHead = await page.evaluate((id) => {
    const events = JSON.parse(
      window.localStorage.getItem("buzz-e2e-company-work-events-v1") ?? "[]",
    ) as Array<{ kind: number; content: string }>;
    const event = events.find(
      (candidate) =>
        candidate.kind === 30634 &&
        (JSON.parse(candidate.content) as { workItemId?: string })
          .workItemId === id,
    );
    return event
      ? (JSON.parse(event.content) as {
          workItemId: string;
          threadRootEventId?: string;
        })
      : null;
  }, MOVE_WORK_ID);
  expect(movedHead?.workItemId).toBe(MOVE_WORK_ID);
  expect(movedHead?.threadRootEventId).toBe(destinationRootId);
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
