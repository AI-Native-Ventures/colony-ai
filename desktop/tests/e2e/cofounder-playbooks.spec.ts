import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";
import { bytesToHex } from "@noble/hashes/utils.js";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";

import { waitForAnimations } from "../helpers/animations";
import { TEST_IDENTITIES, installMockBridge } from "../helpers/bridge";
import {
  DELIVERY_PLAYBOOK_ID,
  NORTHLINE_JOB_ID,
  PLANE_TREE_JOB_ID,
  deliveryJobs,
  deliveryPlaybook,
} from "../../src/testing/cofounderPlaybookFixtures";

const OWNER_PUBKEY = "deadbeef".repeat(8);
const SCOUT_PUBKEY = TEST_IDENTITIES.alice.pubkey;
const EMPTY_APPROVAL_SWITCHES = {
  approveEveryHire: false,
  approvePlaybookChanges: false,
  approveEveryDiscoveryCampaign: false,
};

function fixture({
  enabled = true,
  role = "owner",
}: {
  enabled?: boolean;
  role?: "owner" | "admin" | "member";
} = {}) {
  const relaySecret = generateSecretKey();
  return {
    relaySelf: getPublicKey(relaySecret),
    companyMemberRelayPrivateKeyHex: bytesToHex(relaySecret),
    relayRole: role,
    relayRequiresMembership: true,
    relayMembers: [{ pubkey: OWNER_PUBKEY, role }],
    cofounderSettings: {
      enabled,
      moneyPreference: "cheapest_first" as const,
      approvalSwitches: EMPTY_APPROVAL_SWITCHES,
    },
    managedAgents: [
      {
        pubkey: SCOUT_PUBKEY,
        name: "Scout",
        personaId: "builtin:fizz",
        status: "running" as const,
        channelNames: ["general"],
      },
    ],
    relayAgents: [
      {
        pubkey: SCOUT_PUBKEY,
        ownerPubkey: OWNER_PUBKEY,
        name: "Scout",
        agentType: "agent",
        status: "online" as const,
        channelNames: ["general"],
      },
    ],
    searchProfiles: [
      { pubkey: SCOUT_PUBKEY, displayName: "Scout", isAgent: true },
    ],
    companyPlaybooks: [
      deliveryPlaybook({
        scoutPubkey: SCOUT_PUBKEY,
        ownerPubkey: OWNER_PUBKEY,
      }),
    ],
    companyPlaybookJobs: deliveryJobs({
      scoutPubkey: SCOUT_PUBKEY,
      ownerPubkey: OWNER_PUBKEY,
    }),
  };
}

async function openOperations(page: import("@playwright/test").Page) {
  await installMockBridge(page, fixture());
  await page.goto("/#/company/function/operations");
  await expect(page.getByTestId("cofounder-playbook-screen")).toBeVisible();
}

test.describe("co-founder playbooks", () => {
  test("Today routes playbook approvals to Operations", async ({ page }) => {
    await installMockBridge(page, fixture());
    await page.goto("/#/today");

    const needsYou = page.getByTestId("today-playbook-needs-you");
    await expect(needsYou).toBeVisible();
    const change = needsYou.getByTestId(
      `today-playbook-need-playbook:${DELIVERY_PLAYBOOK_ID}`,
    );
    await expect(change).toContainText("Change to Delivery playbook");
    const launchApproval = needsYou.getByTestId(
      `today-playbook-need-playbook-step:${NORTHLINE_JOB_ID}:launch`,
    );
    await expect(
      launchApproval.getByText("Launch", { exact: true }),
    ).toBeVisible();
    await expect(launchApproval).toContainText(
      "Northline Interiors · You say go live",
    );

    await change.getByRole("link").click();
    await expect(page.getByTestId("cofounder-playbook-screen")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Delivery playbook" }),
    ).toBeVisible();
  });

  test("Needs you actions approve the playbook change and job step", async ({
    page,
  }) => {
    await installMockBridge(page, fixture());
    await page.goto("/#/today");

    const needsYou = page.getByTestId("today-playbook-needs-you");
    const change = needsYou.getByTestId(
      `today-playbook-need-playbook:${DELIVERY_PLAYBOOK_ID}`,
    );
    await change.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(change).toHaveCount(0);

    const launchApproval = needsYou.getByTestId(
      `today-playbook-need-playbook-step:${NORTHLINE_JOB_ID}:launch`,
    );
    await launchApproval
      .getByRole("button", { name: "Approve", exact: true })
      .click();
    await expect(launchApproval).toHaveCount(0);
  });

  test("Operations reads the playbook and job actions from the relay model", async ({
    page,
  }) => {
    await openOperations(page);

    await expect(
      page.getByRole("heading", { name: "Delivery playbook" }),
    ).toBeVisible();
    await expect(page.getByText("2 approval points")).toBeVisible();
    await expect(page.getByTestId("playbook-step-logins")).toContainText(
      "log in or share access",
    );
    await expect(
      page.getByTestId(`playbook-job-${NORTHLINE_JOB_ID}`),
    ).toContainText("Needs you");

    const detailToggle = page.getByTestId("playbook-step-toggle-brief");
    await detailToggle.focus();
    await detailToggle.press("Enter");
    await expect(detailToggle).toHaveAttribute("aria-expanded", "true");
    await detailToggle.click();
    await expect(detailToggle).toHaveAttribute("aria-expanded", "false");

    const versionHistory = page.getByTestId("playbook-version-history");
    await versionHistory.locator("summary").click();
    await expect(
      versionHistory.getByText("Version 1", { exact: false }),
    ).toBeVisible();
    await expect(
      versionHistory.getByText("Version 2", { exact: false }),
    ).toBeVisible();

    await page.getByTestId("playbook-approve-change").click();
    await expect(
      page
        .locator(".cf3-playbook-meta")
        .getByText("Version 3", { exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId("playbook-dismiss-change")).toHaveCount(0);

    await page.getByTestId(`playbook-job-${PLANE_TREE_JOB_ID}`).click();
    const dialog = page.getByTestId("playbook-job-detail");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Current step: Website build.");
    await page.getByTestId("playbook-job-complete-step").click();
    await expect(dialog).toContainText("Current step: Your approval.");
    await expect(dialog).toContainText("Needs your approval.");
    await page.getByTestId("playbook-job-approve-step").click();
    await page.getByTestId("playbook-job-start-step").click();
    await page.getByTestId("playbook-job-complete-step").click();
    await expect(dialog).toContainText("Current step: Present to client.");
  });

  test("playbook approvals stay hidden when co-founder mode is off", async ({
    page,
  }) => {
    await installMockBridge(page, fixture({ enabled: false }));
    await page.goto("/#/company/function/operations");

    await expect(page.getByTestId("cofounder-function-screen")).toContainText(
      "Co-founder mode is off",
    );
    await expect(page.getByTestId("cofounder-playbook-screen")).toHaveCount(0);
    await expect(page.getByTestId("playbook-step-brief")).toHaveCount(0);
  });

  test("only owners and admins can approve playbook changes", async ({
    page,
  }) => {
    await installMockBridge(page, fixture({ role: "member" }));
    await page.goto("/#/company/function/operations");

    await expect(page.getByTestId("cofounder-playbook-screen")).toBeVisible();
    await expect(page.getByTestId("playbook-approve-change")).toHaveCount(0);
    await expect(
      page.getByText("Only an owner or admin can approve this change."),
    ).toBeVisible();
  });

  test("captures the Operations playbook at desktop and phone widths", async ({
    page,
  }) => {
    await openOperations(page);
    await expect(page.getByTestId("playbook-version-history")).toBeVisible();

    const theme = process.env.COLONY3_PROOF_THEME === "dark" ? "dark" : "light";
    const outputDir = join(process.cwd(), "test-results", "cofounder-playbook");
    mkdirSync(outputDir, { recursive: true });

    await page.setViewportSize({ width: 1440, height: 1200 });
    await waitForAnimations(page);
    await page.screenshot({
      fullPage: true,
      path: join(outputDir, `${theme}-1440.png`),
    });

    await page.setViewportSize({ width: 390, height: 3200 });
    await waitForAnimations(page);
    await page.screenshot({
      fullPage: true,
      path: join(outputDir, `${theme}-390.png`),
    });
  });
});
