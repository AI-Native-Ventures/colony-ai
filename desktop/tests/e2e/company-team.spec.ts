import { mkdirSync } from "node:fs";
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
} from "../../src/shared/constants/kinds";
import { waitForAnimations } from "../helpers/animations";
import { installMockBridge, TEST_IDENTITIES } from "../helpers/bridge";

const OWNER_PUBKEY = TEST_IDENTITIES.tyler.pubkey;
const EMPLOYEE_NAME = "Mina";
const EMPLOYEE_TITLE = "Social Media Manager";
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

test("Team lists members and lets an owner edit, terminate and rehire an employee", async ({
  page,
}) => {
  test.setTimeout(90_000);
  async function captureRoute(name: string) {
    mkdirSync("output/playwright/company-design", { recursive: true });
    for (const width of [1728, 1440]) {
      await page.setViewportSize({
        width,
        height: width === 1728 ? 1117 : 900,
      });
      await waitForAnimations(page);
      await page.screenshot({
        path: `output/playwright/company-design/app-${name}-${width}-smoke.png`,
      });
    }
  }
  const relaySecret = generateSecretKey();
  const relaySelf = getPublicKey(relaySecret);
  const employeeSecret = generateSecretKey();
  const employeePubkey = getPublicKey(employeeSecret);
  const unlinkedPubkey = getPublicKey(generateSecretKey());
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
      employeePositionEvent,
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
  await expect(
    page
      .getByRole("navigation", { name: "Breadcrumb" })
      .locator('[aria-current="page"]'),
  ).toHaveText("Team");
  await expect(
    page.getByTestId(`company-team-member-${OWNER_PUBKEY}`),
  ).toContainText("Founder · Human");
  await expect(page.getByTestId("company-team-list")).toContainText("bob");
  await expect(page.getByTestId("company-team-list")).not.toContainText(
    "Mina worker",
  );

  await expect(page.getByRole("tab", { name: "Reporting lines" })).toHaveCount(
    0,
  );
  await page.getByTestId(`company-team-member-${alicePubkey}`).click();
  await expect(page).toHaveURL(new RegExp(`/team/detail/${alicePubkey}$`));
  await expect(page.getByTestId("company-team-member-profile")).toBeVisible();
  await expect(page.getByRole("tab", { name: "History" })).toHaveCount(0);
  await expect(page.getByTestId("company-team-member-profile")).toContainText(
    "Account Manager · Human",
  );
  await expect(page.getByTestId("company-human-role")).toContainText(
    "Reports to",
  );
  await expect(
    page.getByRole("button", { name: "Edit role and reporting" }),
  ).toBeVisible();
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

  await page.goto(`/#/team/detail/${unlinkedPubkey}`);
  await expect(
    page.getByRole("heading", { name: "Unlinked Mina", level: 1 }),
  ).toBeVisible();
  await expect(page.getByText("Campaign Designer").first()).toBeVisible();
  await expect(page.getByText("Not on this device")).toBeVisible();
  await captureRoute("team-unlinked");
  await page.goto("/#/team");
  await page.getByTestId(`company-team-member-${employeePubkey}`).click();
  await expect(page.getByTestId("agent-profile")).toBeVisible();
  await expect(page.getByTestId("company-position-header")).toContainText(
    "AI employee · Reports to",
  );
  await expect(page.getByTestId("agent-profile")).toContainText(EMPLOYEE_TITLE);
  await expect(
    page.getByTestId("agent-profile").getByRole("button", {
      name: "Message",
      exact: true,
    }),
  ).toBeVisible();

  await page.getByRole("button", { name: "More agent actions" }).click();
  await expect(
    page.getByRole("menuitem", { name: "Edit role and reporting" }),
  ).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Pause employee" }),
  ).toHaveCount(0);
  await page.getByRole("menuitem", { name: "Edit role and reporting" }).click();
  await expect(page.getByTestId("team-dialog-edit-role")).toBeVisible();
  await expect(page.getByLabel("Title")).toHaveValue(EMPLOYEE_TITLE);
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByTestId("team-dialog-edit-role")).toHaveCount(0);
  await page.getByRole("button", { name: "More agent actions" }).click();
  await page.getByRole("menuitem", { name: "Terminate employee" }).click();
  await expect(page.getByTestId("team-dialog-terminate")).toBeVisible();
  await page.getByLabel("Reason").fill("The role has ended after review.");
  await page.evaluate(() => {
    window.__BUZZ_E2E__?.mock?.companyMemberActionErrors?.push(
      "restricted: e2e member write rejected.",
    );
    window.__BUZZ_E2E_COMMAND_LOG__ = [];
  });
  await page.getByRole("button", { name: "Terminate employee" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "e2e member write rejected",
  );
  expect(
    await page.evaluate(
      () =>
        window.__BUZZ_E2E_COMMAND_LOG__?.filter(
          (entry) => entry.command === "stop_managed_agent",
        ).length,
    ),
  ).toBe(0);
  await expect(page.getByLabel("Reason")).toHaveValue(
    "The role has ended after review.",
  );
  await page.evaluate(() => {
    if (window.__BUZZ_E2E__?.mock)
      window.__BUZZ_E2E__.mock.companyMemberActionErrors = [];
  });
  await page.getByRole("button", { name: "Terminate employee" }).click();
  await expect(page.getByTestId("team-dialog-terminate")).toHaveCount(0);
  await expect(page.getByTestId("agent-profile")).toContainText(EMPLOYEE_TITLE);
  await expect(page.getByTestId("company-terminated-banner")).toBeVisible();

  await page.evaluate(() => {
    if (window.__BUZZ_E2E__?.mock)
      window.__BUZZ_E2E__.mock.channelsReadErrors = [];
  });
  await page.goto(`/#/channels/${GENERAL_CHANNEL_ID}`);
  await waitForMockLiveSubscription(page, "general");
  await emitEmployeeMessage(page, employeePubkey, "The handoff is complete.");
  await expect(
    page.getByTestId("employee-message-status-terminated").last(),
  ).toHaveText("Terminated: The role has ended after review.");

  await page.goto(`/#/team/detail/${employeePubkey}`);
  await page.getByRole("button", { name: "Review rehire" }).click();
  await expect(page.getByTestId("team-dialog-rehire")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Approve and rehire" }),
  ).toBeDisabled();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Approve and rehire" }).click();
  await expect(page.getByTestId("company-terminated-banner")).toHaveCount(0);
  await expect(page.getByTestId("company-position-header")).toContainText(
    "AI employee",
  );
  await expect
    .poll(() =>
      page.evaluate((pubkey) => {
        const events = JSON.parse(
          localStorage.getItem("buzz-e2e-company-member-position-events-v1") ??
            "[]",
        );
        return events
          .map((event: { content: string }) => JSON.parse(event.content))
          .find((head: { pubkey: string }) => head.pubkey === pubkey)?.status;
      }, employeePubkey),
    )
    .toBe("active");
  await page.goto(`/#/team/detail/${bobPubkey}`);
  await expect(page.getByTestId("company-team-member-profile")).toContainText(
    "Designer",
  );
  await expect(page.getByTestId("company-human-role")).toContainText("alice");
});
