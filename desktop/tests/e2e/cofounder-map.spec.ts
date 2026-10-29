import { expect, test } from "@playwright/test";
import { bytesToHex } from "@noble/hashes/utils.js";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";

import { waitForAnimations } from "../helpers/animations";
import { TEST_IDENTITIES, installMockBridge } from "../helpers/bridge";
import type {
  MockCompanyFunctionHead,
  MockWorkerRun,
} from "../../src/testing/e2eBridge";

const OWNER_PUBKEY = "deadbeef".repeat(8);
const AYA_PUBKEY = TEST_IDENTITIES.alice.pubkey;
const WORKER_ID = "11111111-1111-4111-8111-111111111111";

const EMPTY_APPROVAL_SWITCHES = {
  approveEveryHire: false,
  approvePlaybookChanges: false,
  approveEveryDiscoveryCampaign: false,
};

function functionHead(
  functionId: MockCompanyFunctionHead["function"],
  state: MockCompanyFunctionHead["state"],
  leadPubkey?: string,
): MockCompanyFunctionHead {
  return { function: functionId, state, leadPubkey: leadPubkey ?? null };
}

function workerRun(overrides: Partial<MockWorkerRun> = {}): MockWorkerRun {
  const now = Math.floor(Date.now() / 1000);
  const run: MockWorkerRun = {
    workerId: WORKER_ID,
    parentPubkey: AYA_PUBKEY,
    label: "Research: Linden guesthouses",
    model: "gemini-flash",
    status: "done",
    startedAt: now - 120,
    deadlineAt: now + 480,
    finishedAt: now - 20,
    inputTokens: 240,
    outputTokens: 510,
    costUsd: 0.06,
    outputText: "Three guesthouses match the brief.",
    ...overrides,
  };
  if (run.status !== "running") return run;
  return {
    workerId: run.workerId,
    parentPubkey: run.parentPubkey,
    label: run.label,
    model: run.model,
    status: run.status,
    startedAt: run.startedAt,
    deadlineAt: run.deadlineAt,
    inputTokens: run.inputTokens,
    outputTokens: run.outputTokens,
  };
}

function fixture({
  role = "owner",
  enabled = true,
  includeAya = true,
  functionHeads = [
    functionHead("sales", "filled", AYA_PUBKEY),
    functionHead("operations", "covered_by_scout"),
  ],
  workerRuns = [],
}: {
  role?: "owner" | "admin" | "member";
  enabled?: boolean;
  includeAya?: boolean;
  functionHeads?: MockCompanyFunctionHead[];
  workerRuns?: MockWorkerRun[];
} = {}) {
  const relaySecret = generateSecretKey();
  return {
    relaySelf: getPublicKey(relaySecret),
    companyMemberRelayPrivateKeyHex: bytesToHex(relaySecret),
    relayRole: role,
    relayRequiresMembership: true,
    relayMembers: [
      { pubkey: OWNER_PUBKEY, role },
      ...(includeAya ? [{ pubkey: AYA_PUBKEY, role: "member" as const }] : []),
    ],
    cofounderSettings: {
      enabled,
      moneyPreference: "cheapest_first" as const,
      approvalSwitches: EMPTY_APPROVAL_SWITCHES,
    },
    companyFunctionHeads: functionHeads,
    companyWorkerRuns: workerRuns,
    searchProfiles: includeAya
      ? [{ pubkey: AYA_PUBKEY, displayName: "Aya", isAgent: true }]
      : [],
    relayAgents: includeAya
      ? [
          {
            pubkey: AYA_PUBKEY,
            ownerPubkey: OWNER_PUBKEY,
            name: "Aya",
            agentType: "agent",
            status: "online" as const,
          },
        ]
      : [],
    managedAgents: includeAya
      ? [
          {
            pubkey: AYA_PUBKEY,
            name: "Aya",
            status: "running" as const,
            channelNames: ["general"],
          },
        ]
      : [],
  };
}

test.describe("co-founder mode desktop", () => {
  test("owner sees the company-only switch and turns it on", async ({
    page,
  }) => {
    await installMockBridge(page, fixture({ enabled: false }));
    await page.goto("/#/settings?section=experimental");

    const toggle = page.getByRole("switch", { name: "Co-founder mode" });
    await expect(toggle).toBeVisible();
    await expect(
      page.getByText(/ only · Owner and admins can switch it/),
    ).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-checked", "false");

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await page.getByTestId("settings-back-to-app").click();
    await page.getByTestId("sidebar-nav-company-toggle").click();
    await expect(page.getByTestId("sidebar-company-map")).toBeVisible();
  });

  test("a member sees the co-founder switch read-only", async ({ page }) => {
    await installMockBridge(page, fixture({ role: "member", enabled: false }));
    await page.goto("/#/settings?section=experimental");

    const toggle = page.getByRole("switch", { name: "Co-founder mode" });
    await expect(toggle).toBeVisible();
    await expect(toggle).toBeDisabled();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
  });

  test("the radial map shows Scout and five ordered company functions", async ({
    page,
  }) => {
    await installMockBridge(page, fixture());
    await page.goto("/#/company/map");

    const map = page.getByTestId("cofounder-map-stage");
    await expect(
      page.getByRole("heading", { name: "Company map" }),
    ).toBeVisible();
    await expect(page.getByTestId("cofounder-map-scout")).toContainText(
      "Scout",
    );
    const functions = map.locator("[data-function]");
    await expect(functions).toHaveCount(5);
    await expect
      .poll(() =>
        functions.evaluateAll((nodes) =>
          nodes.map((node) => node.getAttribute("data-function")),
        ),
      )
      .toEqual(["sales", "operations", "customer_success", "finance", "brand"]);
    await expect(map.getByTestId("cofounder-map-sales")).toHaveAttribute(
      "aria-label",
      "Sales, led by Aya",
    );
    await expect(map.getByTestId("cofounder-map-operations")).toContainText(
      "Covered by Scout",
    );
    await expect(map.getByTestId("cofounder-map-sales")).toHaveAttribute(
      "data-state",
      "filled",
    );
    await expect(map.getByTestId("cofounder-map-operations")).toHaveAttribute(
      "data-state",
      "covered_by_scout",
    );
    for (const functionId of ["customer_success", "finance", "brand"]) {
      await expect(
        map.getByTestId(`cofounder-map-${functionId}`),
      ).toHaveAttribute("data-state", "empty");
    }
    const mapText = await map.innerText();
    expect(mapText).not.toMatch(/\d+ leads|Sub-functions/i);
  });

  test("the Sales page shows Aya and her worker output", async ({ page }) => {
    await installMockBridge(page, fixture({ workerRuns: [workerRun()] }));
    await page.goto("/#/company/map");

    await page.getByTestId("cofounder-map-sales").click();
    await expect(page.getByRole("heading", { name: "Sales" })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Aya", exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId("cofounder-worker-list")).toContainText(
      "Workers under Aya",
    );
    await expect(page.getByTestId("cofounder-worker-runs")).toContainText(
      "Research: Linden guesthouses",
    );
    await page.getByRole("button", { name: "Open output" }).click();
    await expect(
      page.getByTestId(`cofounder-worker-output-${WORKER_ID}`),
    ).toContainText("Three guesthouses match the brief.");
  });

  test("Finance shows the Bookkeeper suggestion and hire route", async ({
    page,
  }) => {
    await installMockBridge(page, fixture());
    await page.goto("/#/company/map");

    await page.getByTestId("cofounder-map-finance").click();
    await expect(
      page.getByRole("heading", { name: "Finance", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Hire a Bookkeeper" }),
    ).toBeVisible();
    const fillSlot = page.getByTestId("cofounder-fill-slot");
    await expect(fillSlot).toHaveAttribute("href", /hire\/roles/);
    await fillSlot.click();
    await expect(page).toHaveURL(/#\/hire\/roles$/);
  });

  test("a slot whose lead left the team is displayed as empty", async ({
    page,
  }) => {
    await installMockBridge(
      page,
      fixture({
        includeAya: false,
        functionHeads: [functionHead("sales", "filled", AYA_PUBKEY)],
      }),
    );
    await page.goto("/#/company/map");

    await expect(page.getByTestId("cofounder-map-sales")).toHaveAttribute(
      "data-state",
      "empty",
    );
    await expect(page.getByTestId("cofounder-map-sales")).toHaveAttribute(
      "aria-label",
      "Sales, empty slot",
    );
  });

  test("a running worker past its deadline shows Failed", async ({ page }) => {
    const now = Math.floor(Date.now() / 1000);
    await installMockBridge(
      page,
      fixture({
        workerRuns: [
          workerRun({
            status: "running",
            startedAt: now - 600,
            deadlineAt: now - 1,
          }),
        ],
      }),
    );
    await page.goto("/#/company/map");

    await page.getByTestId("cofounder-map-sales").click();
    await expect(
      page.getByTestId(`cofounder-worker-status-${WORKER_ID}`),
    ).toHaveText("Failed");
  });

  test("captures map at 1440 and 390 pixels in the selected theme", async ({
    page,
  }) => {
    await installMockBridge(page, fixture());
    const theme = process.env.COLONY3_PROOF_THEME === "dark" ? "dark" : "light";
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/#/company/map");
    await expect(page.getByTestId("cofounder-map-stage")).toBeVisible();
    await waitForAnimations(page);
    await page.screenshot({
      fullPage: true,
      path: `test-results/cofounder-map-${theme}-1440.png`,
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await waitForAnimations(page);
    await page.screenshot({
      fullPage: true,
      path: `test-results/cofounder-map-${theme}-390.png`,
    });
  });
});
