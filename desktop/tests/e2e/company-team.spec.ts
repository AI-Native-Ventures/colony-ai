import { expect, test } from "@playwright/test";
import { bytesToHex } from "@noble/hashes/utils.js";
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
} from "nostr-tools/pure";

import {
  KIND_DUTY_HEAD,
  KIND_MEMBER_POSITION_HEAD,
} from "../../src/shared/constants/kinds";
import { installMockBridge, TEST_IDENTITIES } from "../helpers/bridge";

const OWNER_PUBKEY = TEST_IDENTITIES.tyler.pubkey;
const EMPLOYEE_NAME = "Mina";
const EMPLOYEE_TITLE = "Social Media Manager";

function positionHead(input: {
  relaySecret: Uint8Array;
  pubkey: string;
  title: string;
  kind: "human" | "employee";
  managerPubkey?: string;
}) {
  return finalizeEvent(
    {
      kind: KIND_MEMBER_POSITION_HEAD,
      created_at: Math.floor(Date.now() / 1_000),
      tags: [["d", `company:member:${input.pubkey}`]],
      content: JSON.stringify({
        schemaVersion: 1,
        pubkey: input.pubkey,
        title: input.title,
        ...(input.managerPubkey ? { managerPubkey: input.managerPubkey } : {}),
        kind: input.kind,
        status: "active",
        sourceActionEventId: "b".repeat(64),
        updatedAt: new Date().toISOString(),
      }),
    },
    input.relaySecret,
  );
}

function dutyHead(input: { relaySecret: Uint8Array; employeePubkey: string }) {
  const dutyId = "9d55771d-6404-4f92-9c6b-4ff59aa12260";
  const channelId = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
  const now = new Date().toISOString();
  return finalizeEvent(
    {
      kind: KIND_DUTY_HEAD,
      created_at: Math.floor(Date.now() / 1_000),
      tags: [
        ["d", `company:duty:${dutyId}`],
        ["p", input.employeePubkey],
      ],
      content: JSON.stringify({
        schemaVersion: 1,
        dutyId,
        proposal: {
          schemaVersion: 1,
          dutyId,
          employeePubkey: input.employeePubkey,
          title: "Review the weekly content calendar",
          scheduleText: "Every Monday at 08:00",
          scheduleCron: "0 8 * * 1",
          timeZone: "UTC",
          channelId,
          instructions: "Review the calendar and flag exceptions.",
        },
        status: "active",
        proposedByPubkey: TEST_IDENTITIES.tyler.pubkey,
        approvedByPubkey: TEST_IDENTITIES.tyler.pubkey,
        approvedAt: now,
        sourceAskId: "7d2d873b-f5a6-4b95-bb2f-2ac0ae2f74f8",
        sourceAskChannelId: channelId,
        workflowDefinitionHash: "c".repeat(64),
        createdAt: now,
        updatedAt: now,
        sourceActionEventId: "d".repeat(64),
      }),
    },
    input.relaySecret,
  );
}

test("Team shows mixed reporting lines and lets an owner edit and pause an employee", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const relaySecret = generateSecretKey();
  const relaySelf = getPublicKey(relaySecret);
  const employeeSecret = generateSecretKey();
  const employeePubkey = getPublicKey(employeeSecret);
  const workerPubkey = getPublicKey(generateSecretKey());
  const alicePubkey = TEST_IDENTITIES.alice.pubkey;
  const bobPubkey = TEST_IDENTITIES.bob.pubkey;
  const employeePositionEvent = positionHead({
    relaySecret,
    pubkey: employeePubkey,
    title: EMPLOYEE_TITLE,
    kind: "employee",
    managerPubkey: OWNER_PUBKEY,
  });
  await page.addInitScript((identity) => {
    window.localStorage.setItem(
      "buzz:e2e-identity-override.v1",
      JSON.stringify(identity),
    );
  }, TEST_IDENTITIES.tyler);
  await installMockBridge(page, {
    relaySelf,
    companyMemberRelayPrivateKeyHex: bytesToHex(relaySecret),
    searchProfiles: [
      { pubkey: OWNER_PUBKEY, displayName: "tyler" },
      { pubkey: alicePubkey, displayName: "alice" },
      { pubkey: bobPubkey, displayName: "bob" },
    ],
    companyMemberPositionEvents: [
      positionHead({
        relaySecret,
        pubkey: alicePubkey,
        title: "Account Manager",
        kind: "human",
        managerPubkey: OWNER_PUBKEY,
      }),
      employeePositionEvent,
      positionHead({
        relaySecret,
        pubkey: bobPubkey,
        title: "Designer",
        kind: "human",
        managerPubkey: alicePubkey,
      }),
    ],
    companyDutyHeads: [dutyHead({ relaySecret, employeePubkey })],
    companyDutyRelayPrivateKeyHex: bytesToHex(relaySecret),
    companyLessonRelayPrivateKeyHex: bytesToHex(relaySecret),
    relayMembers: [
      { pubkey: OWNER_PUBKEY, role: "owner" },
      { pubkey: alicePubkey, role: "member" },
      { pubkey: bobPubkey, role: "member" },
    ],
    relayAgents: [
      {
        pubkey: employeePubkey,
        ownerPubkey: OWNER_PUBKEY,
        name: EMPLOYEE_NAME,
        agentType: "agent",
      },
      {
        pubkey: workerPubkey,
        ownerPubkey: OWNER_PUBKEY,
        name: "Mina worker",
        agentType: "worker",
      },
    ],
    managedAgents: [
      {
        pubkey: employeePubkey,
        name: EMPLOYEE_NAME,
        systemPrompt: "Existing employee instructions.",
        status: "running",
        channelNames: ["general"],
      },
      {
        pubkey: workerPubkey,
        name: "Mina worker",
        status: "running",
        channelNames: ["general"],
      },
    ],
  });

  await page.goto("/#/team");
  await expect(page.getByTestId("company-team-screen")).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByTestId("sidebar-team-count")).toHaveText("4");
  await expect(page.getByTestId("company-team-list")).toContainText(
    EMPLOYEE_NAME,
  );
  await expect(page.getByTestId("company-team-list")).toContainText("alice");
  await expect(page.getByTestId("company-team-list")).toContainText("bob");
  await expect(page.getByTestId("company-team-list")).not.toContainText(
    "Mina worker",
  );

  await page.getByRole("tab", { name: "Reporting lines" }).click();
  const tree = page.getByRole("tree", { name: "Reporting lines" });
  const treeItems = tree.getByRole("treeitem");
  await treeItems.first().focus();
  await page.keyboard.press("ArrowDown");
  await expect(treeItems.nth(1)).toBeFocused();

  await page.getByRole("tab", { name: "Everyone" }).click();
  await page.getByTestId(`company-team-member-${alicePubkey}`).click();
  await expect(page).toHaveURL(new RegExp(`/team/detail/${alicePubkey}$`));
  await expect(page.getByTestId("company-team-member-profile")).toBeVisible();
  await page.getByRole("button", { name: "Edit role and reporting" }).click();
  await expect(page).toHaveURL(new RegExp(`/team/edit/${alicePubkey}$`));
  await page.getByLabel("Title").fill("Chief of Staff");
  await page.getByLabel("Reports to").selectOption(employeePubkey);
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page).toHaveURL(new RegExp(`/team/detail/${alicePubkey}$`));
  await expect(page.getByTestId("company-team-member-profile")).toContainText(
    "Chief of Staff",
  );
  await expect(page.getByTestId("company-team-member-profile")).toContainText(
    `Reports to ${EMPLOYEE_NAME}`,
  );
  await expect(page.getByTestId("company-team-member-profile")).toContainText(
    "Responsibilities",
  );
  await expect(page.getByTestId("company-human-direct-reports")).toContainText(
    "bob",
  );

  await page.getByTestId(`company-human-report-${bobPubkey}`).click();
  await expect(page).toHaveURL(new RegExp(`/team/detail/${bobPubkey}$`));
  await expect(page.getByTestId("company-team-member-profile")).toContainText(
    "Designer",
  );

  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByTestId(`company-team-member-${employeePubkey}`).click();
  await expect(page.getByTestId("company-employee-profile")).toBeVisible();
  await expect(page.getByTestId("company-position-header")).toContainText(
    `${EMPLOYEE_TITLE} · Employee · active`,
  );
  await expect(
    page.getByTestId("company-position-header").getByRole("button", {
      name: "Message",
    }),
  ).toBeVisible();
  await expect(
    page.getByTestId("company-employee-direct-reports"),
  ).toContainText("alice");

  await page.getByRole("tab", { name: "Instructions" }).click();
  await expect(page.getByTestId("employee-instructions")).toContainText(
    "Existing employee instructions.",
  );
  await page.getByRole("button", { name: "Edit instructions" }).click();
  await expect(
    page.getByTestId("employee-instructions-editor").getByRole("heading", {
      name: "Edit instructions",
    }),
  ).toBeVisible();
  await expect(
    page.getByTestId("employee-instructions-editor").getByRole("button"),
  ).toHaveText(["Save changes", "Cancel"]);
  await page
    .getByTestId("employee-system-instructions")
    .fill("First revised employee instructions.");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByTestId("employee-instructions")).toContainText(
    "First revised employee instructions.",
  );
  await page.getByRole("button", { name: "Edit instructions" }).click();
  await page
    .getByTestId("employee-system-instructions")
    .fill("Second revised employee instructions.");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByTestId("employee-instructions")).toContainText(
    "Second revised employee instructions.",
  );

  await page.getByRole("tab", { name: "Salary" }).click();
  await expect(page.getByTestId("employee-unavailable-salary")).toContainText(
    "Not available yet.",
  );
  await page.getByRole("tab", { name: "Workers" }).click();
  await expect(page.getByTestId("employee-unavailable-workers")).toContainText(
    "Not available yet.",
  );
  await page.getByRole("tab", { name: "Duties" }).click();
  await expect(page.getByTestId("employee-duties")).toContainText("Routines");
  const duty = page.getByTestId(
    "employee-duty-9d55771d-6404-4f92-9c6b-4ff59aa12260",
  );
  await expect(duty).toContainText("Review the weekly content calendar");
  await duty.click();
  await expect(page.getByTestId("employee-duty-detail")).toContainText(
    "Run history",
  );
  await expect(page.getByTestId("employee-duty-detail")).toContainText(
    "Not run yet",
  );
  await page.getByRole("button", { name: "Routines" }).click();
  await page.getByRole("tab", { name: "Lessons" }).click();
  await expect(page.getByTestId("employee-lessons")).toContainText(
    "Lessons with evidence",
  );
  await expect(page.getByTestId("employee-lessons")).toContainText("Memory");
  await page.getByRole("button", { name: "Propose lesson" }).click();
  await page
    .getByLabel("Lesson", { exact: true })
    .fill("Keep campaign conclusions linked to their sources.");
  await page.getByLabel("Supporting evidence").fill(employeePositionEvent.id);
  await page.getByRole("button", { name: "Save candidate" }).click();
  await expect(page.getByTestId("employee-lesson-detail")).toContainText(
    "Keep campaign conclusions linked to their sources.",
  );
  await expect(page.getByTestId("employee-lesson-detail")).toContainText(
    "Confidence: unassessed",
  );

  await page.getByRole("tab", { name: "History" }).click();
  await expect(page.getByTestId("employee-history")).toContainText(
    "Configuration changed",
  );
  await page.reload();
  await expect(page.getByTestId("company-employee-profile")).toBeVisible();
  await page.getByRole("tab", { name: "Lessons" }).click();
  await page.getByTestId(/^employee-lesson-/).click();
  await expect(page.getByTestId("employee-lesson-detail")).toContainText(
    "Keep campaign conclusions linked to their sources.",
  );
  await page.getByRole("tab", { name: "History" }).click();
  await expect(page.getByTestId("employee-history")).toContainText(
    "Second revised employee instructions.",
  );
  await page.getByRole("button", { name: "Review undo" }).click();
  await page.getByRole("button", { name: "Restore these values" }).click();
  await expect(page.getByTestId("employee-history")).toContainText(
    "Configuration restored",
  );

  await page.getByRole("tab", { name: "Overview" }).click();
  await page.getByRole("button", { name: "Pause employee" }).click();
  await expect(page.getByTestId("company-team-pause-screen")).toBeVisible();
  await page.getByLabel("Reason").fill("Reviewing the October workload.");
  await page.getByRole("button", { name: "Pause employee" }).click();
  await expect(page.getByTestId("company-paused-banner")).toContainText(
    "Reviewing the October workload.",
  );

  await page.getByRole("button", { name: "Terminate employee" }).click();
  await expect(page.getByTestId("company-team-archive-screen")).toBeVisible();
  await page.getByLabel("Reason").fill("The role has ended after review.");
  await page.getByRole("button", { name: "Terminate employee" }).click();
  await expect(page.getByTestId("company-position-header")).toContainText(
    EMPLOYEE_TITLE,
  );
  await expect(page.getByTestId("company-terminated-banner")).toBeVisible();
});
