import { expect, test } from "@playwright/test";
import { bytesToHex } from "@noble/hashes/utils.js";
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
} from "nostr-tools/pure";

import {
  KIND_MEMBER_POSITION_HEAD,
  KIND_STREAM_MESSAGE,
  KIND_WORK_ITEM_HEAD,
} from "../../src/shared/constants/kinds";
import { installMockBridge, TEST_IDENTITIES } from "../helpers/bridge";

const OWNER_PUBKEY = TEST_IDENTITIES.tyler.pubkey;
const EMPLOYEE_NAME = "Mina";
const EMPLOYEE_TITLE = "Social Media Manager";
const EMPLOYEE_WORK_ITEM_ID = "e3a4b5c6-d7e8-49f0-a1b2-c3d4e5f60718";
const GENERAL_CHANNEL_ID = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";

function positionHead(input: {
  relaySecret: Uint8Array;
  pubkey: string;
  title: string;
  kind: "human" | "employee";
  managerPubkey?: string;
  status?: "active" | "paused" | "terminated";
  reason?: string;
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
        status: input.status ?? "active",
        ...(input.reason ? { reason: input.reason } : {}),
        sourceActionEventId: "b".repeat(64),
        updatedAt: new Date().toISOString(),
      }),
    },
    input.relaySecret,
  );
}

function companyWorkHeadEvent(relaySecret: Uint8Array, assignedPubkey: string) {
  return finalizeEvent(
    {
      kind: KIND_WORK_ITEM_HEAD,
      created_at: Math.floor(Date.now() / 1_000),
      tags: [
        ["h", GENERAL_CHANNEL_ID],
        ["d", `company:work:${EMPLOYEE_WORK_ITEM_ID}`],
      ],
      content: JSON.stringify({
        schemaVersion: 1,
        workItemId: EMPLOYEE_WORK_ITEM_ID,
        title: "Prepare the launch brief",
        status: "active",
        assignedPubkeys: [assignedPubkey],
        approverPubkeys: [],
        deliverables: [],
        requesterPubkey: OWNER_PUBKEY,
        doneCondition: "The launch brief is ready for review.",
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
        ({ name, kind }) =>
          window.__BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?.({
            channelName: name,
            kind,
          }) ?? false,
        { name: channelName, kind: KIND_STREAM_MESSAGE },
      ),
    )
    .toBe(true);
}

async function emitEmployeeMessage(
  page: import("@playwright/test").Page,
  pubkey: string,
  content: string,
) {
  await page.evaluate(
    ({ memberPubkey, messageContent, kind }) => {
      window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
        channelName: "general",
        content: messageContent,
        kind,
        pubkey: memberPubkey,
      });
    },
    {
      memberPubkey: pubkey,
      messageContent: content,
      kind: KIND_STREAM_MESSAGE,
    },
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
  const unlinkedPubkey = getPublicKey(generateSecretKey());
  const workerPubkey = getPublicKey(generateSecretKey());
  const alicePubkey = TEST_IDENTITIES.alice.pubkey;
  const bobPubkey = TEST_IDENTITIES.bob.pubkey;
  await page.addInitScript((identity) => {
    window.localStorage.setItem(
      "buzz:e2e-identity-override.v1",
      JSON.stringify(identity),
    );
  }, TEST_IDENTITIES.tyler);
  await installMockBridge(page, {
    relaySelf,
    companyMemberRelayPrivateKeyHex: bytesToHex(relaySecret),
    companyMemberActionErrors: ["restricted: e2e member write rejected."],
    searchProfiles: [
      { pubkey: OWNER_PUBKEY, displayName: "tyler" },
      { pubkey: alicePubkey, displayName: "alice" },
      { pubkey: bobPubkey, displayName: "bob" },
      { pubkey: unlinkedPubkey, displayName: "Unlinked Mina" },
    ],
    companyMemberPositionEvents: [
      positionHead({
        relaySecret,
        pubkey: alicePubkey,
        title: "Account Manager",
        kind: "human",
        managerPubkey: OWNER_PUBKEY,
      }),
      positionHead({
        relaySecret,
        pubkey: employeePubkey,
        title: EMPLOYEE_TITLE,
        kind: "employee",
        managerPubkey: OWNER_PUBKEY,
      }),
      positionHead({
        relaySecret,
        pubkey: unlinkedPubkey,
        title: "Campaign Designer",
        kind: "employee",
        managerPubkey: OWNER_PUBKEY,
      }),
      positionHead({
        relaySecret,
        pubkey: bobPubkey,
        title: "Designer",
        kind: "human",
        managerPubkey: alicePubkey,
      }),
    ],
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
      {
        pubkey: unlinkedPubkey,
        ownerPubkey: OWNER_PUBKEY,
        name: "Unlinked Mina",
        agentType: "agent",
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
    companyWorkEvents: [companyWorkHeadEvent(relaySecret, employeePubkey)],
    channelsReadErrors: Array.from(
      { length: 4 },
      () => "invalid: e2e forced channel read failure.",
    ),
    visualChannels: [{ id: GENERAL_CHANNEL_ID, name: "general" }],
  });

  await page.goto("/#/team");
  await expect(page.getByTestId("company-team-screen")).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByTestId("sidebar-team-count")).toHaveText("5");
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
  await expect(page.getByRole("tab", { name: "Overview" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "History" })).toBeEnabled();
  await expect(page.getByTestId("company-human-role")).toContainText("Human");
  await expect(page.getByTestId("company-human-role")).toContainText(
    "Reporting line",
  );
  await expect(page.getByRole("tab", { name: "Instructions" })).toHaveCount(0);
  await page.goto(`/#/team/edit/${alicePubkey}`);
  await expect(page).toHaveURL(new RegExp(`/team/edit/${alicePubkey}$`));
  await page.getByLabel("Title").fill("Chief of Staff");
  await page.getByLabel("Reports to").selectOption(employeePubkey);
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "e2e member write rejected",
  );
  await expect(page.getByLabel("Title")).toHaveValue("Chief of Staff");
  await expect(page.getByLabel("Reports to")).toHaveValue(employeePubkey);
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page).toHaveURL(new RegExp(`/team/detail/${alicePubkey}$`));
  await expect(page.getByTestId("company-team-member-profile")).toContainText(
    "Chief of Staff",
  );
  await expect(page.getByTestId("company-human-role")).toContainText(
    EMPLOYEE_NAME,
  );
  await page.getByRole("tab", { name: "History" }).click();
  await expect(
    page.getByTestId("company-member-position-history"),
  ).toContainText("Position changed");
  await expect(
    page.getByTestId("company-member-position-history"),
  ).toContainText("Chief of Staff");

  await page.goto(`/#/team/detail/${unlinkedPubkey}`);
  await expect(page.getByTestId("company-position-unlinked")).toBeVisible();
  await expect(page.getByTestId("company-position-record")).toContainText(
    "Campaign Designer",
  );
  await expect(page.getByTestId("company-position-record")).toContainText(
    "Position exists",
  );
  await expect(
    page.getByRole("button", { name: "Connect a managed agent" }),
  ).toBeDisabled();

  await page.goto("/#/team");
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
  await expect(page.getByTestId("employee-doing-now")).toContainText(
    "Could not load current work",
  );
  await page.getByRole("button", { name: "Retry current work" }).click();
  await expect(page.getByTestId("employee-doing-now")).toContainText(
    "Prepare the launch brief",
  );
  await expect(
    page.getByTestId(`employee-work-${EMPLOYEE_WORK_ITEM_ID}`),
  ).toBeVisible();

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
  await expect(page.getByTestId("employee-unavailable-duties")).toContainText(
    "Not available yet.",
  );
  await page.getByRole("tab", { name: "Lessons" }).click();
  await expect(page.getByTestId("employee-lessons")).toContainText(
    "Not available yet.",
  );

  await page.getByRole("tab", { name: "History" }).click();
  await expect(page.getByTestId("employee-history")).toContainText(
    "Configuration changed",
  );
  await page.reload();
  await expect(page.getByTestId("company-employee-profile")).toBeVisible();
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
  await page.evaluate(() => {
    const e2e = window.__BUZZ_E2E__ as {
      mock?: { companyMemberActionErrors?: string[] };
    };
    e2e.mock?.companyMemberActionErrors?.push(
      "restricted: e2e member write rejected.",
    );
  });
  await page.getByRole("button", { name: "Pause employee" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "e2e member write rejected",
  );
  await expect(page.getByLabel("Reason")).toHaveValue(
    "Reviewing the October workload.",
  );
  await page.evaluate(() => {
    const e2e = window.__BUZZ_E2E__ as {
      mock?: { companyMemberActionErrors?: string[] };
    };
    if (e2e.mock) e2e.mock.companyMemberActionErrors = [];
  });
  await page.getByRole("button", { name: "Pause employee" }).click();
  await expect(page.getByTestId("company-paused-banner")).toContainText(
    "Reviewing the October workload.",
  );

  await page.goto(`/#/channels/${GENERAL_CHANNEL_ID}`);
  await waitForMockLiveSubscription(page, "general");
  await emitEmployeeMessage(
    page,
    employeePubkey,
    "The latest campaign draft is attached to this thread.",
  );
  await expect(page.getByTestId("employee-message-status-paused")).toHaveText(
    "Paused by manager: Reviewing the October workload.",
  );
  await page.getByTestId("open-employee-history").click();
  await expect(page).toHaveURL(
    new RegExp(`/team/detail/${employeePubkey}\\?tab=history$`),
  );
  await expect(page.getByTestId("employee-history")).toBeVisible();

  await page.goto(`/#/team/detail/${employeePubkey}`);
  await expect(page.getByTestId("company-employee-profile")).toBeVisible();
  await page.getByRole("tab", { name: "Overview" }).click();
  await page.getByRole("button", { name: "Terminate employee" }).click();
  await expect(page.getByTestId("company-team-archive-screen")).toBeVisible();
  await page.getByLabel("Reason").fill("The role has ended after review.");
  await page.getByRole("button", { name: "Terminate employee" }).click();
  await expect(page.getByTestId("company-position-header")).toContainText(
    EMPLOYEE_TITLE,
  );
  await expect(page.getByTestId("company-terminated-banner")).toBeVisible();

  await page.goto(`/#/channels/${GENERAL_CHANNEL_ID}`);
  await waitForMockLiveSubscription(page, "general");
  await emitEmployeeMessage(page, employeePubkey, "The handoff is complete.");
  await expect(
    page.getByTestId("employee-message-status-terminated").last(),
  ).toHaveText("Terminated: The role has ended after review.");
  await expect(page.getByTestId("open-employee-history").last()).toBeVisible();

  await page.goto(`/#/team/detail/${bobPubkey}`);
  await expect(page.getByTestId("company-team-member-profile")).toContainText(
    "Designer",
  );
  await expect(page.getByTestId("company-member-doing-now")).toContainText(
    "No current commitments.",
  );
});
