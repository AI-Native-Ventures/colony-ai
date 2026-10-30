import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { bytesToHex } from "@noble/hashes/utils.js";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";

import { waitForAnimations } from "../helpers/animations";
import { TEST_IDENTITIES, installMockBridge } from "../helpers/bridge";
import type {
  MockCompanyFunctionHead,
  MockWorkerRun,
} from "../../src/testing/e2eBridge";
import { COFOUNDER_NUMBERS_FIXTURE } from "../../src/testing/cofounderNumbersFixtures";
import type { CofounderNumbersFixture } from "../../src/features/cofounder/cofounderNumbers";

const OWNER_PUBKEY = "deadbeef".repeat(8);
const AYA_PUBKEY = TEST_IDENTITIES.alice.pubkey;
const SCOUT_PUBKEY = TEST_IDENTITIES.bob.pubkey;
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
  includeScout = false,
  numbers = COFOUNDER_NUMBERS_FIXTURE,
  functionHeads = [
    functionHead("sales", "filled", AYA_PUBKEY),
    functionHead("operations", "covered_by_scout"),
  ],
  workerRuns = [],
}: {
  role?: "owner" | "admin" | "member";
  enabled?: boolean;
  includeAya?: boolean;
  includeScout?: boolean;
  numbers?: CofounderNumbersFixture;
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
      ...(includeScout
        ? [{ pubkey: SCOUT_PUBKEY, role: "member" as const }]
        : []),
    ],
    cofounderSettings: {
      enabled,
      moneyPreference: "cheapest_first" as const,
      approvalSwitches: EMPTY_APPROVAL_SWITCHES,
    },
    cofounderNumbers: numbers,
    companyFunctionHeads: functionHeads,
    companyWorkerRuns: workerRuns,
    searchProfiles: [
      ...(includeAya
        ? [{ pubkey: AYA_PUBKEY, displayName: "Aya", isAgent: true }]
        : []),
      ...(includeScout
        ? [{ pubkey: SCOUT_PUBKEY, displayName: "Scout", isAgent: true }]
        : []),
    ],
    relayAgents: [
      ...(includeAya
        ? [
            {
              pubkey: AYA_PUBKEY,
              ownerPubkey: OWNER_PUBKEY,
              name: "Aya",
              agentType: "agent",
              status: "online" as const,
            },
          ]
        : []),
      ...(includeScout
        ? [
            {
              pubkey: SCOUT_PUBKEY,
              ownerPubkey: OWNER_PUBKEY,
              name: "Scout",
              agentType: "agent",
              status: "online" as const,
            },
          ]
        : []),
    ],
    managedAgents: [
      ...(includeAya
        ? [
            {
              pubkey: AYA_PUBKEY,
              name: "Aya",
              status: "running" as const,
              channelNames: ["general"],
            },
          ]
        : []),
      ...(includeScout
        ? [
            {
              pubkey: SCOUT_PUBKEY,
              name: "Scout",
              status: "running" as const,
              channelNames: ["general"],
            },
          ]
        : []),
    ],
  };
}

async function seedCofounderTheme(
  page: import("@playwright/test").Page,
  theme: "light" | "dark",
) {
  await page.addInitScript(
    ({ name, pubkey, relayUrl }) => {
      const preference = {
        version: 1,
        theme: name,
        accent: "#5B45BE",
        followSystem: false,
      };
      localStorage.setItem("buzz-theme", name);
      localStorage.setItem("buzz-follow-system", "false");
      localStorage.setItem("buzz-accent-color", "#5B45BE");
      localStorage.setItem(
        `buzz-community-theme.v1:${pubkey}:${encodeURIComponent(relayUrl)}`,
        JSON.stringify(preference),
      );
    },
    {
      name: theme === "dark" ? "buzz-dark" : "buzz",
      pubkey: OWNER_PUBKEY,
      relayUrl: "ws://localhost:3000",
    },
  );
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

  test("an empty Sales slot shows Scout's worker run with output and Free cost", async ({
    page,
  }) => {
    await installMockBridge(
      page,
      fixture({
        includeAya: false,
        includeScout: true,
        functionHeads: [],
        workerRuns: [
          workerRun({
            parentPubkey: SCOUT_PUBKEY,
            label: "Research: 3 guesthouse marketing ideas",
            model: "nvidia/nemotron-3-ultra-550b-a55b:free",
            costUsd: undefined,
            outputText: "Idea 1. Idea 2. Idea 3.",
          }),
        ],
      }),
    );
    await page.goto("/#/company/map");

    await page.getByTestId("cofounder-map-sales").click();
    await expect(page.getByTestId("cofounder-worker-list")).toContainText(
      "Workers under Scout",
    );
    const runs = page.getByTestId("cofounder-worker-runs");
    await expect(runs).toContainText("Research: 3 guesthouse marketing ideas");
    await expect(
      page.getByTestId(`cofounder-worker-status-${WORKER_ID}`),
    ).toHaveText("Done");
    await expect(runs).toContainText("Free");
    await expect(runs).not.toContainText("Cost unavailable");
    await page.getByRole("button", { name: "Open output" }).click();
    await expect(
      page.getByTestId(`cofounder-worker-output-${WORKER_ID}`),
    ).toContainText("Idea 1. Idea 2. Idea 3.");
  });

  test("Company Work lists worker runs with status, output and cost", async ({
    page,
  }) => {
    await installMockBridge(
      page,
      fixture({
        includeAya: false,
        includeScout: true,
        functionHeads: [],
        workerRuns: [
          workerRun({
            parentPubkey: SCOUT_PUBKEY,
            label: "Research: 3 guesthouse marketing ideas",
            model: "nvidia/nemotron-3-ultra-550b-a55b:free",
            costUsd: 0,
            outputText: "Idea 1. Idea 2. Idea 3.",
          }),
        ],
      }),
    );
    await page.goto("/#/work");

    const list = page.getByTestId("cofounder-worker-list");
    await expect(list).toContainText("Worker runs");
    await expect(page.getByTestId("cofounder-worker-runs")).toContainText(
      "Research: 3 guesthouse marketing ideas",
    );
    await expect(
      page.getByTestId(`cofounder-worker-status-${WORKER_ID}`),
    ).toHaveText("Done");
    await expect(list).toContainText("Free");
    await page.getByRole("button", { name: "Open output" }).click();
    await expect(
      page.getByTestId(`cofounder-worker-output-${WORKER_ID}`),
    ).toContainText("Idea 1. Idea 2. Idea 3.");
  });

  test("all five function pages show scorecards and goals when enabled", async ({
    page,
  }) => {
    await installMockBridge(page, fixture());
    for (const functionId of [
      "sales",
      "operations",
      "customer_success",
      "finance",
      "brand",
    ]) {
      await page.goto(`/#/company/function/${functionId}`);
      await expect(page.getByTestId("cofounder-function-screen")).toBeVisible();
      await expect(page.getByTestId("cofounder-scorecard")).toBeVisible();
      await expect(page.getByTestId("cofounder-goals")).toBeVisible();
    }
  });

  test("the owner can edit, approve, and reject a proposed goal", async ({
    page,
  }) => {
    await installMockBridge(page, fixture());
    await page.goto("/#/company/function/sales");

    const goals = page.getByTestId("cofounder-goals");
    const propose = goals.getByTestId("cofounder-propose-goal");
    await propose.focus();
    await page.keyboard.press("Enter");
    const proposal = goals.getByTestId(
      "cofounder-goal-proposal-sales-follow-up-goal",
    );
    await expect(proposal).toBeVisible();
    await proposal.getByRole("button", { name: "Edit goal" }).click();
    await page
      .getByLabel("Goal", { exact: true })
      .fill("Follow up with 8 new leads in November");
    await page.getByLabel("Target", { exact: true }).fill("8");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(proposal).toContainText(
      "Follow up with 8 new leads in November",
    );
    await proposal.getByRole("button", { name: "Approve goal" }).focus();
    await page.keyboard.press("Enter");
    await expect(goals.getByRole("status")).toHaveText("Goal approved.");
    await expect(goals).toContainText("Follow up with 8 new leads in November");

    await goals.getByTestId("cofounder-propose-goal").click();
    await goals
      .getByTestId("cofounder-goal-proposal-sales-follow-up-goal")
      .getByRole("button", { name: "Reject goal" })
      .click();
    await expect(goals.getByRole("status")).toHaveText(
      "Goal proposal rejected.",
    );
    await expect(
      goals.getByTestId("cofounder-goal-proposal-sales-follow-up-goal"),
    ).toHaveCount(0);
  });

  test("non-owners can review a proposed goal but cannot decide it", async ({
    page,
  }) => {
    const salesGoals = COFOUNDER_NUMBERS_FIXTURE.goals.sales;
    if (!salesGoals?.suggested)
      throw new Error("Sales goal fixture is missing.");
    const numbers: CofounderNumbersFixture = {
      ...COFOUNDER_NUMBERS_FIXTURE,
      goals: {
        ...COFOUNDER_NUMBERS_FIXTURE.goals,
        sales: {
          ...salesGoals,
          proposed: [salesGoals.suggested],
          suggested: null,
        },
      },
    };
    await installMockBridge(page, fixture({ role: "member", numbers }));
    await page.goto("/#/company/function/sales");

    const goals = page.getByTestId("cofounder-goals");
    const proposal = goals.getByTestId(
      "cofounder-goal-proposal-sales-follow-up-goal",
    );
    await expect(proposal).toBeVisible();
    await expect(proposal).toContainText("Waiting for the owner to review");
    await expect(
      proposal.getByRole("button", { name: "Approve goal" }),
    ).toHaveCount(0);
    await expect(
      proposal.getByRole("button", { name: "Edit goal" }),
    ).toHaveCount(0);
    await expect(
      proposal.getByRole("button", { name: "Reject goal" }),
    ).toHaveCount(0);
  });

  test("weekly review presents each function and routes decisions through Needs you", async ({
    page,
  }) => {
    await installMockBridge(page, fixture());
    await page.goto("/#/company/weekly-review");

    const review = page.getByTestId("cofounder-weekly-review-card");
    await expect(review).toBeVisible();
    await expect(page.getByText("Friday 30 October")).toBeVisible();
    for (const functionName of [
      "Sales",
      "Operations",
      "Customer Success",
      "Finance",
      "Brand",
    ]) {
      await expect(review).toContainText(functionName);
    }
    await expect(review).toContainText("What worked");
    await expect(review).toContainText("Missed:");
    await expect(
      review.getByRole("heading", { name: "Needs you · 2" }),
    ).toBeVisible();
    await expect(review.getByTestId("weekly-review-needs-you")).toContainText(
      "Approve the November plan",
    );

    const plan = review.getByTestId("weekly-review-decision-november-plan");
    await plan.getByRole("button", { name: "Open plan" }).click();
    await expect(plan).toContainText("Get 5 Horizon Labs clients in November");
    await plan.getByRole("button", { name: "Approve plan" }).last().click();
    await expect(plan).toContainText("Approved in this preview.");
    await expect(
      review.getByRole("heading", { name: "Needs you · 1" }),
    ).toBeVisible();

    const hire = review.getByTestId(
      "weekly-review-decision-customer-success-hire",
    );
    await hire.getByRole("button", { name: "Yes, hire" }).click();
    await expect(hire).toContainText("Marked to hire in this preview.");
  });

  test("weekly review and function data remain hidden when co-founder mode is off", async ({
    page,
  }) => {
    await installMockBridge(page, fixture({ enabled: false }));
    await page.goto("/#/company/weekly-review");
    await expect(page.getByTestId("cofounder-weekly-review")).toContainText(
      "Co-founder mode is off",
    );
    await expect(page.getByTestId("cofounder-weekly-review-card")).toHaveCount(
      0,
    );

    await page.goto("/#/company/function/sales");
    await expect(page.getByTestId("cofounder-scorecard")).toHaveCount(0);
    await expect(page.getByTestId("cofounder-goals")).toHaveCount(0);
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

  test("captures weekly review and Sales goals at 1440 and 390 in light and dark", async ({
    browser,
    page,
  }) => {
    test.setTimeout(120_000);
    const screenshotDir = "test-results/cofounder-phase5";
    mkdirSync(screenshotDir, { recursive: true });

    for (const theme of ["light", "dark"] as const) {
      const capturePage = theme === "light" ? page : await browser.newPage();
      await seedCofounderTheme(capturePage, theme);
      await installMockBridge(capturePage, fixture());
      await capturePage.emulateMedia({ colorScheme: theme });

      for (const viewport of [
        { width: 1440, height: 1000 },
        { width: 390, height: 844 },
      ]) {
        await capturePage.setViewportSize(viewport);
        for (const screen of [
          {
            name: "weekly-review",
            path: "/#/company/weekly-review",
            testId: "cofounder-weekly-review-card",
          },
          {
            name: "function-sales",
            path: "/#/company/function/sales",
            testId: "cofounder-scorecard",
          },
        ]) {
          await capturePage.goto(screen.path);
          await expect(capturePage.getByTestId(screen.testId)).toBeVisible();
          await expect
            .poll(() =>
              capturePage.evaluate(() =>
                document.documentElement.classList.contains("dark"),
              ),
            )
            .toBe(theme === "dark");
          await waitForAnimations(capturePage);
          await capturePage.screenshot({
            animations: "disabled",
            fullPage: true,
            path: join(
              screenshotDir,
              `${screen.name}-${theme}-${viewport.width}.png`,
            ),
          });
        }
      }
      if (theme === "dark") await capturePage.close();
    }
  });
});
