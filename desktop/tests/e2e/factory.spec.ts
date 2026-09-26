import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import type {
  FactoryRun,
  FactoryRunEvent,
  FactoryScope,
} from "../../src/shared/api/factoryRuntime";
import { factoryPlanStorageKey } from "../../src/features/factory/plans/factoryPlanStore";
import type {
  MockFactoryProjectSeed,
  MockFactoryRunSeed,
} from "../../src/testing/e2eBridge";
import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";

const OWNER = "deadbeef".repeat(8);
const AGENT = "a".repeat(64);
const SCOPE: FactoryScope = {
  relayUrl: "ws://localhost:3000",
  identityPubkey: OWNER,
  businessCommunityId: "e2e-default-community",
  clientChannelId: null,
};

const PROJECTS: MockFactoryProjectSeed[] = [
  {
    dtag: "portal",
    name: "Client portal",
    description:
      "One place for clients to review designs, leave feedback and approve a version.",
    repositoryDtag: "client-portal",
    repositoryName: "client-portal",
    cloneUrl: "https://example.test/lerato-social/client-portal.git",
  },
  {
    dtag: "website",
    name: "Agency website",
    description:
      "A fast, accessible home for the agency, its work and its services.",
    repositoryDtag: "website",
    repositoryName: "website",
    cloneUrl: "https://example.test/lerato-social/website.git",
  },
  {
    dtag: "ops",
    name: "Studio operations",
    description:
      "Content hand-offs, capacity and monthly reporting for the studio.",
    repositoryDtag: "studio-ops",
    repositoryName: "studio-ops",
    cloneUrl: "https://example.test/lerato-social/studio-ops.git",
  },
];

function runRecord(
  id: string,
  title: string,
  status: FactoryRun["status"],
  projectDtag = "portal",
  error: string | null = null,
  parentRunId: string | null = null,
  transcript?: Array<{ kind: string; text: string }>,
): MockFactoryRunSeed {
  const project = PROJECTS.find((item) => item.dtag === projectDtag);
  const now = "2026-09-26T08:00:00.000Z";
  const projectId = `30621:${OWNER}:${projectDtag}`;
  const repositoryId = project
    ? `30617:${OWNER}:${project.repositoryDtag}`
    : null;
  const run: FactoryRun = {
    id,
    scope: SCOPE,
    projectId,
    repositoryId,
    checkoutPath: `/home/e2e/${project?.repositoryName ?? projectDtag}`,
    agentId: AGENT,
    harnessId: "codex",
    parentRunId,
    status,
    createdAt: now,
    updatedAt: now,
    acpSessionId:
      status === "running" || status === "waiting" ? `acp-${id}` : null,
    error,
  };
  const entries = transcript ?? [
    { kind: "user_prompt", text: title },
    { kind: "assistant_output", text: `Runtime output for ${title}.` },
  ];
  const events: FactoryRunEvent[] = entries.map((entry, index) => ({
    sequence: index + 1,
    runId: id,
    createdAt: now,
    kind: entry.kind,
    payload: { text: entry.text },
    scope: SCOPE,
  }));
  return { run, events };
}

const RUNS: MockFactoryRunSeed[] = [
  runRecord("run-building", "Implement the client approval flow", "running"),
  runRecord(
    "run-access",
    "Check access after the API change",
    "waiting",
    "portal",
    "Waiting for the API contract.",
  ),
  runRecord(
    "run-dependent",
    "Start when the API is ready",
    "blocked",
    "portal",
    "Depends on the API session.",
  ),
  runRecord(
    "run-api-subagent",
    "Inspect the API response contract",
    "waiting",
    "portal",
    "Waiting for the parent session.",
    "run-building",
  ),
  runRecord(
    "run-export-failed",
    "Fix the report export",
    "error",
    "ops",
    "The local worker exited with an error.",
  ),
  runRecord(
    "run-reconnecting",
    "Verify restart recovery",
    "running",
    "website",
  ),
  runRecord("run-site", "Update the services page", "running", "website"),
  runRecord("s-ops", "Monthly reporting export", "done", "ops"),
];

const SCREENSHOT_RUNS: MockFactoryRunSeed[] = [
  runRecord(
    "run-building",
    "Client portal build",
    "running",
    "portal",
    null,
    null,
    [
      {
        kind: "user_prompt",
        text: "Let's build the client approval experience from our agreed plan. Keep the API, interface and access checks in separate working copies.",
      },
      {
        kind: "assistant_output",
        text: "The plan is approved. I've delegated the API and review interface. Access QA is waiting for the API contract; I'm keeping that dependency visible.",
      },
      {
        kind: "assistant_output",
        text: "You can work directly with any child agent. Their changes return here for the release review before we prepare a pull request.",
      },
    ],
  ),
  runRecord(
    "run-api",
    "Approval API",
    "running",
    "portal",
    null,
    "run-building",
    [
      { kind: "user_prompt", text: "Build the version-aware approval API." },
      {
        kind: "assistant_output",
        text: "The approval record includes the content version and client. I am checking the stale-version path before wiring up the response.",
      },
    ],
  ),
  runRecord(
    "run-review",
    "Client review experience",
    "blocked",
    "portal",
    "Waiting for the API contract.",
    "run-building",
    [
      { kind: "user_prompt", text: "Build the client review interface." },
      {
        kind: "assistant_output",
        text: "I need the API contract before connecting the approval action.",
      },
    ],
  ),
  runRecord(
    "run-access",
    "Access and review QA",
    "waiting",
    "portal",
    "Waiting for the API contract.",
    "run-building",
    [
      {
        kind: "user_prompt",
        text: "Check client membership and review access.",
      },
    ],
  ),
  runRecord(
    "run-reconnecting",
    "Services page",
    "running",
    "website",
    null,
    null,
    [
      {
        kind: "user_prompt",
        text: "Make the service offer easy to understand.",
      },
      {
        kind: "assistant_output",
        text: "I have the structure and approved service details. One pricing decision changes the page layout.",
      },
    ],
  ),
  runRecord(
    "run-export-failed",
    "Reporting export",
    "error",
    "ops",
    "The local worker exited with an error.",
    null,
    [{ kind: "user_prompt", text: "Fix the monthly reporting export." }],
  ),
  runRecord("s-ops", "Monthly reporting export", "done", "ops"),
];

const PLAN_FIXTURE = {
  id: "portal-plan",
  projectId: `30621:${OWNER}:portal`,
  title: "Client approvals, without the back-and-forth",
  outcome:
    "Clients can review the exact content version, request changes or approve it. Every decision stays attached to the work.",
  acceptanceCriteria: [
    "An approval belongs to one version and one client.",
    "New uploads invalidate previous approvals.",
    "Keyboard and mobile review work end to end.",
  ],
  tasks: [
    {
      id: "task-api",
      title: "Version-aware approval API",
      dependencies: [],
      status: "ready" as const,
    },
    {
      id: "task-ui",
      title: "Review screen and feedback",
      dependencies: [],
      status: "ready" as const,
    },
    {
      id: "task-access",
      title: "Cross-client access checks",
      dependencies: ["task-api"],
      status: "blocked" as const,
    },
    {
      id: "task-review",
      title: "End-to-end release review",
      dependencies: ["task-api", "task-ui", "task-access"],
      status: "blocked" as const,
    },
  ],
  revisions: [
    {
      version: 1,
      updatedAt: "2026-09-24T08:00:00.000Z",
      title: "Client approvals",
    },
    {
      version: 2,
      updatedAt: "2026-09-26T08:00:00.000Z",
      title: "Client approvals, without the back-and-forth",
    },
  ],
  status: "approved" as const,
  updatedAt: "2026-09-26T08:00:00.000Z",
};

async function enableProjectsFeature(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "buzz-feature-overrides-v1",
      JSON.stringify({ projects: true }),
    );
  });
}

async function seedFactoryPlans(page: Page, plans: unknown[]) {
  const key = factoryPlanStorageKey(SCOPE);
  await page.addInitScript(
    ({ storageKey, records }) => {
      window.localStorage.setItem(storageKey, JSON.stringify(records));
    },
    { storageKey: key, records: plans },
  );
}

function factoryUrl(path: string) {
  return `/#${path.startsWith("/") ? path : `/${path}`}`;
}

async function bootFactoryPage(page: Page, path = "/factory") {
  await enableProjectsFeature(page);
  await installMockBridge(page, {
    factoryProjects: PROJECTS,
    factoryRuns: RUNS,
    factorySnapshotFailureRunIds: ["run-reconnecting"],
    factoryLocalRepositories: [
      { name: "client-portal", path: "/home/e2e/client-portal" },
      { name: "website", path: "/home/e2e/website" },
      { name: "studio-ops", path: "/home/e2e/studio-ops" },
    ],
    managedAgents: [
      {
        pubkey: AGENT,
        name: "Local Codex",
        runtime: "codex",
        backend: { type: "local" },
      },
    ],
  });
  await page.goto(factoryUrl(path), { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("factory-workspace")).toBeVisible();
}

async function getCommands(page: Page) {
  return page.evaluate(() => window.__BUZZ_E2E_COMMANDS__ ?? []);
}

test("Factory routes use real project and run records", async ({ page }) => {
  await bootFactoryPage(page);
  await expect(
    page.getByRole("heading", { name: "Software Factory" }),
  ).toBeVisible();
  const deskTabs = page.getByRole("tablist", { name: "Factory desk tabs" });
  await expect(deskTabs).toBeVisible();
  await expect(
    deskTabs.getByRole("tab", { name: /Build desk/ }),
  ).toHaveAttribute("aria-selected", "true");

  const agentTree = page.getByRole("list", { name: "Workspace agents" });
  await expect(
    agentTree.locator("[data-testid='factory-agent-tree-item']"),
  ).toHaveCount(8);
  await expect(
    agentTree.locator('[data-depth="1"]').getByRole("button", {
      name: "Inspect the API response contract, Waiting",
    }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Filter workspace agents" })
    .fill("Inspect the API response");
  await expect(
    agentTree.locator("[data-testid='factory-agent-tree-item']"),
  ).toHaveCount(2);
  await expect(agentTree.locator('[data-depth="0"]')).toHaveCount(1);
  await expect(
    agentTree.getByRole("button", {
      name: "Update the services page, Running",
    }),
  ).toHaveCount(0);
  await page.getByRole("textbox", { name: "Filter workspace agents" }).fill("");

  const navigation = page.getByRole("navigation", { name: "Factory views" });
  await expect(
    navigation.getByRole("button", { name: "Workbench" }),
  ).toHaveAttribute("aria-current", "page");
  await expect(
    page
      .getByTestId("factory-workspace")
      .locator(".fx-pane-tabs")
      .getByRole("tab", {
        name: "Implement the client approval flow, Working",
      }),
  ).toBeVisible();
  await expect(
    page.getByText("Runtime output for Implement the client approval flow."),
  ).toBeVisible();
  await expect(
    page.getByRole("log", {
      name: "Implement the client approval flow transcript",
    }),
  ).toBeVisible();

  await navigation.getByRole("button", { name: "Projects" }).click();
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
  await expect(page.locator(".fx-project-card")).toHaveCount(3);
  await expect(
    page
      .locator(".fx-project-card")
      .filter({ hasText: "Client portal" })
      .locator("footer"),
  ).toBeVisible();
  await expect(
    page
      .locator(".fx-project-card")
      .filter({ hasText: "Client portal" })
      .locator("footer"),
  ).toContainText("lerato-social/client-portal");
  await page
    .locator(".fx-project-card")
    .filter({ hasText: "Client portal" })
    .click();
  await expect(page).toHaveURL(/#\/factory\/project\//);
  await expect(
    page.getByRole("heading", { name: "Client portal" }),
  ).toBeVisible();
  await expect(
    page.getByText("lerato-social/client-portal", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("/home/e2e/client-portal", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Browse repository" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Issues" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Change reviews" }),
  ).toBeVisible();

  await navigation.getByRole("button", { name: "Plans & tasks" }).click();
  await expect(
    page.getByRole("heading", { name: "Plans that keep moving" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Client approvals, without the back-and-forth",
    }),
  ).toHaveCount(0);
});

test("Factory workbench delegated rows follow the native parent graph", async ({
  page,
}) => {
  await bootFactoryPage(page);

  const delegatedWork = page.getByRole("region", { name: "Delegated work" });
  await expect(
    delegatedWork.getByRole("button", {
      name: "Inspect the API response contract, Waiting",
    }),
  ).toBeVisible();
  await expect(
    delegatedWork.getByRole("button", {
      name: "Check access after the API change, Waiting",
    }),
  ).toHaveCount(0);
});

test("Factory project creation opens the new project in Factory", async ({
  page,
}) => {
  await bootFactoryPage(page, "/factory/projects");

  await page.getByRole("button", { name: "Add project" }).click();
  const dialog = page.getByTestId("create-project-dialog");
  await expect(dialog).toBeVisible();
  await page.getByTestId("create-project-name").fill("Factory trial");
  await page.getByTestId("create-project-submit").click();

  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/#\/factory\/project\//);
  await expect(
    page.getByRole("heading", { name: "Factory trial" }),
  ).toBeVisible();
});

test("Factory sessions filter by native status and states show runtime failures", async ({
  page,
}) => {
  await bootFactoryPage(page, "/factory/sessions");

  await expect(
    page.getByRole("heading", { name: "Every session, wherever you left it" }),
  ).toBeVisible();
  await expect(page.getByText("8 sessions across 3 projects")).toBeVisible();
  await page.getByLabel("Filter sessions").selectOption("waiting");
  const sessionTable = page.locator(".fx-session-table");
  await expect(sessionTable.locator(".fx-session-row")).toHaveCount(2);
  await expect(sessionTable).toContainText("Waiting");
  await expect(
    sessionTable.getByText("Fix the report export", { exact: true }),
  ).toHaveCount(0);

  await page.goto(factoryUrl("/factory/states"), {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByRole("heading", { name: "Waiting" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Blocked" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Interrupted session" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Reconnecting" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /The local worker exited with an error/ }),
  ).toBeVisible();
  await expect(page.getByText("Reconnecting to this session")).toBeVisible();
  await expect(page.getByText("Apply sample update")).toHaveCount(0);
  await expect(page.getByText("Preview this state")).toHaveCount(0);
});

test("Factory start stores the prompt and leaving the destination only detaches", async ({
  page,
}) => {
  await bootFactoryPage(page);

  await page
    .getByTestId("factory-workspace")
    .locator("header")
    .getByRole("button", { name: "Add agent" })
    .click();
  const dialog = page.getByRole("dialog", { name: "Add an agent session" });
  await dialog.getByLabel("Task").fill("Build the portal search");
  await dialog.getByLabel("Project").selectOption(`30621:${OWNER}:portal`);
  await dialog.getByLabel("Harness").selectOption(AGENT);
  await dialog
    .getByLabel("Starting direction")
    .fill("Keep client data scoped to the active workspace.");
  await dialog.getByRole("button", { name: "Start session" }).click();

  await expect(
    page
      .locator(".fx-agent-message")
      .filter({ hasText: "Build the portal search" }),
  ).toBeVisible();
  await expect
    .poll(async () => (await getCommands(page)).includes("factory_run_create"))
    .toBe(true);

  await page.getByTestId("factory-return-to-workspace").click();
  await expect(page.getByTestId("factory-workspace")).toHaveCount(0);
  await expect
    .poll(async () => (await getCommands(page)).includes("factory_run_detach"))
    .toBe(true);
  expect(await getCommands(page)).not.toContain("factory_run_cancel");
});

test("Factory cancellation invokes the explicit host cancel command", async ({
  page,
}) => {
  await bootFactoryPage(page);

  await page
    .getByRole("navigation", { name: "Factory views" })
    .getByRole("button", { name: "Sessions" })
    .click();
  const session = page
    .locator(".fx-session-row")
    .filter({ hasText: "Implement the client approval flow" });
  await session
    .getByRole("button", { name: "Manage Implement the client approval flow" })
    .click();
  const sessionActions = page.getByRole("dialog", {
    name: "Implement the client approval flow",
  });
  await sessionActions.getByRole("button", { name: "Stop session" }).click();

  await expect(session.getByText("Cancelled", { exact: true })).toBeVisible();
  expect(await getCommands(page)).toContain("factory_run_cancel");
});

test("Factory pane draft persists through detach and reattach", async ({
  page,
}) => {
  await bootFactoryPage(page);

  const draft = page.getByRole("textbox", {
    name: "Draft for Implement the client approval flow",
  });
  await draft.fill("Keep the API and review work in separate checkouts.");
  await expect
    .poll(async () =>
      (await getCommands(page)).includes("factory_run_set_draft"),
    )
    .toBe(true);

  await page.getByTestId("factory-return-to-workspace").click();
  await expect(page.getByTestId("factory-workspace")).toHaveCount(0);
  await page.goto(factoryUrl("/factory"), { waitUntil: "domcontentloaded" });

  await expect(
    page.getByRole("textbox", {
      name: "Draft for Implement the client approval flow",
    }),
  ).toHaveValue("Keep the API and review work in separate checkouts.");
  expect(await getCommands(page)).toContain("factory_run_get_draft");
  expect(await getCommands(page)).toContain("factory_run_detach");
  expect(await getCommands(page)).not.toContain("factory_run_cancel");
});

test("Factory review route shows run output and no simulated change review", async ({
  page,
}) => {
  await bootFactoryPage(page, "/factory/review/s-ops");

  await expect(
    page.getByRole("heading", { name: "Monthly reporting export" }),
  ).toBeVisible();
  await expect(
    page.getByText("Runtime output for Monthly reporting export."),
  ).toBeVisible();
  await expect(page.getByText("Run sample checks")).toHaveCount(0);
  await expect(page.getByText("Approve changes")).toHaveCount(0);
  await expect(page.getByText("Working changes")).toHaveCount(0);
});

test("Factory plans and dependent tasks persist for the active workspace", async ({
  page,
}) => {
  await bootFactoryPage(page, "/factory/plans");

  await page.getByRole("button", { name: "New plan" }).click();
  const planDialog = page.getByRole("dialog", { name: "Create a plan" });
  await expect(planDialog.getByLabel("Project").locator("option")).toHaveCount(
    PROJECTS.length + 1,
  );
  await planDialog.getByLabel("Project").selectOption(`30621:${OWNER}:portal`);
  await planDialog.getByLabel("Plan name").fill("Scoped access review");
  await planDialog
    .getByLabel("Outcome")
    .fill("Keep each approval within one client workspace.");
  await planDialog
    .getByLabel("Acceptance criteria · one per line")
    .fill("Current membership is checked\nRevocation cancels child sessions");
  await planDialog.getByRole("button", { name: "Create plan" }).click();

  await expect(
    page.getByRole("heading", { name: "Scoped access review" }),
  ).toBeVisible();
  const factoryNavigator = page.getByRole("region", {
    name: "Factory navigator",
  });
  const createdPlanArtifact = factoryNavigator.getByRole("button", {
    name: /Scoped access review/,
  });
  await expect(createdPlanArtifact).toBeVisible();
  await createdPlanArtifact.click();
  await expect(page).toHaveURL(/#\/factory\/plan\/[0-9a-f-]{36}$/i);
  await expect(
    page.getByRole("heading", { name: "Scoped access review" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add task" }).click();
  const taskDialog = page.getByRole("dialog", { name: "Add a task" });
  await taskDialog.getByLabel("Task outcome").fill("Verify client membership");
  await taskDialog.getByRole("button", { name: "Add task" }).click();

  await page.getByRole("button", { name: "Add task" }).click();
  const dependentTaskDialog = page.getByRole("dialog", { name: "Add a task" });
  await dependentTaskDialog
    .getByLabel("Task outcome")
    .fill("Cancel runs after revocation");
  await dependentTaskDialog
    .getByLabel("Starts after")
    .selectOption({ label: "Verify client membership" });
  await dependentTaskDialog.getByRole("button", { name: "Add task" }).click();
  await expect(page.getByText("After Verify client membership")).toBeVisible();

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("heading", { name: "Scoped access review" }),
  ).toBeVisible();
  await expect(page.getByText("After Verify client membership")).toBeVisible();
});

test("Factory route screenshots cover both reference sizes and themes", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await enableProjectsFeature(page);
  await seedFactoryPlans(page, [
    PLAN_FIXTURE,
    {
      ...PLAN_FIXTURE,
      id: "website-plan",
      projectId: `30621:${OWNER}:website`,
      title: "Refresh the services experience",
      outcome: "Explain the studio services with clear monthly pricing.",
      acceptanceCriteria: ["Make the retainer scope clear."],
      tasks: PLAN_FIXTURE.tasks.slice(0, 2),
      revisions: [
        {
          version: 1,
          updatedAt: "2026-09-24T08:00:00.000Z",
          title: "Services",
        },
      ],
      status: "review" as const,
    },
    {
      ...PLAN_FIXTURE,
      id: "ops-plan",
      projectId: `30621:${OWNER}:ops`,
      title: "Monthly reporting export",
      outcome: "Deliver monthly reports without manual spreadsheet work.",
      acceptanceCriteria: ["Export the approved report."],
      tasks: PLAN_FIXTURE.tasks.slice(0, 2),
      revisions: [
        {
          version: 1,
          updatedAt: "2026-09-24T08:00:00.000Z",
          title: "Reporting",
        },
      ],
      status: "approved" as const,
    },
  ]);
  await installMockBridge(page, {
    factoryProjects: PROJECTS,
    factoryRuns: SCREENSHOT_RUNS,
    factorySnapshotFailureRunIds: ["run-reconnecting"],
    factoryLocalRepositories: [
      { name: "client-portal", path: "/home/e2e/client-portal" },
      { name: "website", path: "/home/e2e/website" },
      { name: "studio-ops", path: "/home/e2e/studio-ops" },
    ],
    managedAgents: [
      {
        pubkey: AGENT,
        name: "Local Codex",
        runtime: "codex",
        backend: { type: "local" },
      },
    ],
  });

  const outDir = join("test-results", "factory-r19");
  await mkdir(outDir, { recursive: true });
  for (const viewport of [
    { width: 1728, height: 1117 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    for (const theme of ["buzz", "buzz-dark"] as const) {
      await page.emulateMedia({
        colorScheme: theme === "buzz-dark" ? "dark" : "light",
      });
      await page.addInitScript(
        ({ owner, relayUrl }) => {
          window.localStorage.setItem("buzz-theme", "buzz");
          window.localStorage.setItem("buzz-follow-system", "true");
          window.localStorage.removeItem("buzz-theme-cache");
          window.localStorage.removeItem(
            `buzz-community-theme.v1:${owner}:${encodeURIComponent(relayUrl)}`,
          );
          window.localStorage.removeItem(
            `buzz-community-theme-outbox.v1:${owner}:${encodeURIComponent(relayUrl)}`,
          );
          window.localStorage.removeItem(
            `buzz-community-theme-migrated.v1:${owner}`,
          );
        },
        { owner: OWNER, relayUrl: SCOPE.relayUrl },
      );
      await page.goto(factoryUrl("/factory"), {
        waitUntil: "domcontentloaded",
      });
      await expect(page.getByTestId("factory-workspace")).toBeVisible();
      await expect(page.locator("html")).toHaveClass(
        theme === "buzz-dark" ? /dark/ : /light/,
      );
      await expect
        .poll(async () =>
          page
            .getByTestId("app-sidebar")
            .evaluate((sidebar) =>
              Math.round(sidebar.getBoundingClientRect().width),
            ),
        )
        .toBe(260);
      const shellBounds = await page.evaluate(() => ({
        sidebarRight: document
          .querySelector('[data-testid="app-sidebar"]')
          ?.getBoundingClientRect().right,
        workspaceLeft: document
          .querySelector(".fx-workspace")
          ?.getBoundingClientRect().left,
      }));
      expect(shellBounds.workspaceLeft).toBeGreaterThanOrEqual(
        (shellBounds.sidebarRight ?? 0) - 1,
      );
      const suffix = `${theme}-${viewport.width}x${viewport.height}`;
      const capture = async (name: string) => {
        await waitForAnimations(page);
        await page.screenshot({ path: join(outDir, `${suffix}-${name}.png`) });
      };

      await capture("factory");
      const navigation = page.getByRole("navigation", {
        name: "Factory views",
      });
      await navigation.getByRole("button", { name: "Projects" }).click();
      await expect(
        page.getByRole("heading", { name: "Projects" }),
      ).toBeVisible();
      await capture("projects");
      await page
        .locator(".fx-project-card")
        .filter({ hasText: "Client portal" })
        .click();
      await expect(
        page.getByRole("heading", { name: "Client portal" }),
      ).toBeVisible();
      await capture("project-portal");
      await navigation.getByRole("button", { name: "Plans & tasks" }).click();
      await expect(
        page.getByRole("heading", { name: "Plans that keep moving" }),
      ).toBeVisible();
      await capture("plans");
      await page
        .locator(".fx-plan-row")
        .filter({ hasText: "Client approvals, without the back-and-forth" })
        .click();
      await expect(
        page.getByRole("heading", { name: PLAN_FIXTURE.title }),
      ).toBeVisible();
      await capture("plan-portal");
      await page.goto(factoryUrl("/factory/review/s-ops"), {
        waitUntil: "domcontentloaded",
      });
      await expect(
        page.getByRole("heading", { name: "Monthly reporting export" }),
      ).toBeVisible();
      await capture("review-s-ops");
      await page
        .getByRole("navigation", { name: "Factory views" })
        .getByRole("button", { name: "Sessions" })
        .click();
      await expect(
        page.getByRole("heading", {
          name: "Every session, wherever you left it",
        }),
      ).toBeVisible();
      await capture("sessions");
      await page.goto(factoryUrl("/factory/states"), {
        waitUntil: "domcontentloaded",
      });
      await expect(
        page.getByRole("heading", { name: "Interrupted session" }),
      ).toBeVisible();
      await capture("states");
    }
  }
});
