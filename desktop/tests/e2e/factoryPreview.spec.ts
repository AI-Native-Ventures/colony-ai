import { hexToBytes } from "@noble/hashes/utils.js";
import { expect, test, type Page } from "@playwright/test";
import { finalizeEvent, getPublicKey } from "nostr-tools/pure";

import type {
  FactoryRun,
  FactoryRunEvent,
  FactoryScope,
} from "../../src/shared/api/factoryRuntime";
import { KIND_FACTORY_RUN_HEAD } from "../../src/shared/constants/kinds";
import type {
  MockFactoryProjectSeed,
  MockFactoryRunSeed,
} from "../../src/testing/e2eBridge";
import { installMockBridge, TEST_IDENTITIES } from "../helpers/bridge";

const OWNER = "deadbeef".repeat(8);
const RUN_ID = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
const RELAY_SECRET = hexToBytes(TEST_IDENTITIES.charlie.privateKey);
const RELAY_SELF = getPublicKey(RELAY_SECRET);
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
    description: "One place for clients to review a project.",
    repositoryDtag: "client-portal",
    repositoryName: "client-portal",
    cloneUrl: "https://example.test/lerato-social/client-portal.git",
  },
];
const RUN: FactoryRun = {
  id: RUN_ID,
  scope: SCOPE,
  projectId: `30621:${OWNER}:portal`,
  repositoryId: `30617:${OWNER}:client-portal`,
  checkoutPath: "/home/e2e/client-portal",
  agentId: "a".repeat(64),
  harnessId: "codex",
  parentRunId: null,
  status: "running",
  createdAt: "2026-09-29T09:00:00.000Z",
  updatedAt: "2026-09-29T09:00:00.000Z",
  acpSessionId: "acp-factory-preview-fixture",
  error: null,
};
const RUN_EVENT: FactoryRunEvent = {
  sequence: 1,
  runId: RUN_ID,
  createdAt: RUN.createdAt,
  kind: "user_prompt",
  payload: { text: "Build the client portal." },
  scope: SCOPE,
};
const FACTORY_RUNS: MockFactoryRunSeed[] = [{ run: RUN, events: [RUN_EVENT] }];

function runHeadEvent(
  preview: Record<string, unknown>,
  pullRequest?: Record<string, unknown>,
) {
  const head = {
    schemaVersion: 1,
    runId: RUN_ID,
    runOwnerPubkey: OWNER,
    preview,
    ...(pullRequest ? { pullRequest } : {}),
    updatedAt: "2026-09-29T09:00:00.000Z",
  };
  return finalizeEvent(
    {
      kind: KIND_FACTORY_RUN_HEAD,
      created_at: Math.floor(Date.now() / 1_000),
      tags: [["d", `company:factory-run:${RUN_ID}`]],
      content: JSON.stringify(head),
    },
    RELAY_SECRET,
  );
}

async function bootFactoryPane(
  page: Page,
  previewHead?: ReturnType<typeof runHeadEvent>,
  factoryRunActionErrors?: string[],
) {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "buzz-feature-overrides-v1",
      JSON.stringify({ projects: true }),
    );
  });
  await installMockBridge(page, {
    factoryProjects: PROJECTS,
    factoryRuns: FACTORY_RUNS,
    factoryRunRecordEvents: previewHead ? [previewHead] : [],
    ...(factoryRunActionErrors ? { factoryRunActionErrors } : {}),
    relaySelf: RELAY_SELF,
    relayRole: "owner",
  });
  await page.goto("/#/factory", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("factory-workspace")).toBeVisible();
}

function runTool(page: Page, label: string) {
  return page
    .locator(".fx-agent-pane")
    .getByRole("button", { name: label, exact: true });
}

test("Preview shows the unconfigured state and blank configuration fields", async ({
  page,
}) => {
  await bootFactoryPane(page);
  await runTool(page, "Preview").click();

  await expect(
    page.getByRole("heading", { name: "Configure preview" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Configure preview" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Configure preview" }).click();
  const configuration = page.locator(".fx-preview-config");
  await expect(configuration.getByLabel("Start command")).toHaveValue("");
  await expect(
    configuration.getByRole("spinbutton", { name: "Port" }),
  ).toHaveValue("");
  await expect(configuration.getByLabel("Ready when")).toHaveValue("");
  await expect(
    configuration.getByLabel("Readiness path or message"),
  ).toHaveValue("");
  await expect(
    page.getByRole("button", { name: "Save configuration" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Save configuration" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Check the preview settingsA command, valid port and readiness check are required.",
  );
});

test("Preview saves configuration separately from starting the runtime", async ({
  page,
}) => {
  await bootFactoryPane(page);
  await runTool(page, "Preview").click();
  await page.getByRole("button", { name: "Configure preview" }).click();
  const configuration = page.locator(".fx-preview-config");
  await configuration.getByLabel("Start command").fill("pnpm dev");
  await configuration.getByRole("spinbutton", { name: "Port" }).fill("4173");
  await configuration.getByLabel("Ready when").selectOption("http_endpoint");
  await configuration.getByLabel("Readiness path or message").fill("/health");
  await configuration
    .getByRole("button", { name: "Save configuration" })
    .click();

  await expect(
    page.getByRole("heading", { name: "Preview stopped" }),
  ).toBeVisible();
  await expect(page.getByText("pnpm dev", { exact: true })).toBeVisible();
  await expect(page.getByText("4173", { exact: true })).toBeVisible();
  await expect(
    page.getByText("HTTP endpoint responds at /health"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Start preview" }),
  ).toBeDisabled();
});

test("Preview preserves the legacy not-started state", async ({ page }) => {
  await bootFactoryPane(
    page,
    runHeadEvent({
      state: "not_started",
      command: "pnpm dev",
      localUrl: "http://127.0.0.1:4100",
    }),
  );
  await runTool(page, "Preview").click();

  await expect(
    page.getByRole("heading", { name: "Preview has not started" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Run the development server for this project to open its preview.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Start preview" })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: "Edit configuration" }),
  ).toHaveCount(0);
});

test("Preview presents a configured not-started record as stopped", async ({
  page,
}) => {
  await bootFactoryPane(
    page,
    runHeadEvent({
      state: "not_started",
      command: "pnpm dev",
      localUrl: "http://127.0.0.1:4100",
      port: 4100,
      readiness: { mode: "http_endpoint", value: "/health" },
    }),
  );
  await runTool(page, "Preview").click();

  await expect(
    page.getByRole("heading", { name: "Preview stopped" }),
  ).toBeVisible();
  await expect(page.getByText("4100", { exact: true })).toBeVisible();
  await expect(
    page.getByText("HTTP endpoint responds at /health"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Start preview" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Edit configuration" }),
  ).toBeVisible();
});

test("Preview shows the recorded failure reason and startup output", async ({
  page,
}) => {
  await bootFactoryPane(
    page,
    runHeadEvent({
      state: "failed",
      command: "pnpm dev",
      localUrl: "http://127.0.0.1:4100",
      reason: "The development server exited before it was ready.",
      startupOutput: "Missing script: dev",
    }),
  );
  await runTool(page, "Preview").click();

  await expect(
    page.getByRole("heading", { name: "Preview failed to start" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "The development server exited before it was ready. Your agent session is still running.",
    ),
  ).toBeVisible();
  await expect(page.getByText("Startup output")).toBeVisible();
  await expect(page.locator(".fx-preview-output pre")).toHaveText(
    "Missing script: dev",
  );
  await expect(
    page.getByRole("button", { name: "Retry starting preview" }),
  ).toHaveCount(0);
});

test("Preview keeps configuration inputs after a failed save", async ({
  page,
}) => {
  await bootFactoryPane(page, undefined, ["invalid: run record write failed"]);
  await runTool(page, "Preview").click();
  await page.getByRole("button", { name: "Configure preview" }).click();

  const configuration = page.locator(".fx-preview-config");
  await configuration.getByLabel("Start command").fill("pnpm dev");
  await configuration.getByRole("spinbutton", { name: "Port" }).fill("4173");
  await configuration.getByLabel("Ready when").selectOption("http_endpoint");
  await configuration.getByLabel("Readiness path or message").fill("/health");
  await configuration
    .getByRole("button", { name: "Save configuration" })
    .click();

  await expect(page.getByRole("alert")).toHaveText(
    "Could not saveYour inputs are kept. Review them or retry without starting again.",
  );
  await expect(configuration.getByLabel("Start command")).toHaveValue(
    "pnpm dev",
  );
  await expect(
    configuration.getByRole("spinbutton", { name: "Port" }),
  ).toHaveValue("4173");
  await expect(configuration.getByLabel("Ready when")).toHaveValue(
    "http_endpoint",
  );
  await expect(
    configuration.getByLabel("Readiness path or message"),
  ).toHaveValue("/health");
  await expect(
    page.getByRole("button", { name: "Retry starting preview" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("note").getByText("Preview runtime unavailable"),
  ).toBeVisible();
});

test("Preview reads the recorded lifecycle states without starting a process", async ({
  page,
}) => {
  const readiness = { mode: "http_endpoint", value: "/health" };
  const states: Array<{
    title: string;
    control: string;
    preview: Record<string, unknown>;
    url?: string;
    notice?: string;
  }> = [
    {
      title: "Starting preview",
      control: "Stop preview",
      preview: {
        state: "starting",
        command: "pnpm dev",
        localUrl: "http://127.0.0.1:4173",
        port: 4173,
        readiness,
      },
      notice: "Waiting for readiness",
    },
    {
      title: "Preview running",
      control: "Stop preview",
      preview: {
        state: "running",
        command: "pnpm dev",
        localUrl: "http://127.0.0.1:4173",
        url: "http://127.0.0.1:4173/",
        port: 4173,
        readiness,
      },
      url: "http://127.0.0.1:4173/",
    },
    {
      title: "Preview stopped",
      control: "Start preview",
      preview: {
        state: "stopped",
        command: "pnpm dev",
        localUrl: "http://127.0.0.1:4173",
        port: 4173,
        readiness,
      },
    },
    {
      title: "Preview failed",
      control: "Retry starting preview",
      preview: {
        state: "failed",
        command: "pnpm dev",
        localUrl: "http://127.0.0.1:4173",
        port: 4173,
        readiness,
        reason: "The preview process exited before readiness.",
        startupOutput: "Missing script: dev",
      },
      notice: "Preview runtime unavailable",
    },
  ];

  for (const [index, state] of states.entries()) {
    const statePage = index === 0 ? page : await page.context().newPage();
    await bootFactoryPane(statePage, runHeadEvent(state.preview));
    await runTool(statePage, "Preview").click();

    await expect(
      statePage.getByRole("heading", { name: state.title }),
    ).toBeVisible();
    await expect(
      statePage.getByRole("button", { name: state.control }),
    ).toBeDisabled();
    if (state.title === "Starting preview") {
      await expect(
        statePage.getByText(
          "The process has started but has not passed its readiness check.",
        ),
      ).toBeVisible();
    }
    if (state.notice) {
      await expect(
        statePage.getByText(state.notice, { exact: true }),
      ).toBeVisible();
    }
    if (state.url) {
      await expect(
        statePage.locator(".fx-preview-running-url code"),
      ).toHaveText(state.url);
    }

    if (statePage !== page) await statePage.close();
  }
});

test("Review opens the attach form when no pull request is linked", async ({
  page,
}) => {
  await bootFactoryPane(page);
  await runTool(page, "Review").click();

  await expect(
    page.getByRole("heading", { name: "Attach a pull request" }),
  ).toBeVisible();
  await expect(page.getByLabel("Pull request URL")).toHaveValue("");
  await expect(page.getByLabel("Pull request URL")).toBeEnabled();
  await page
    .getByLabel("Pull request URL")
    .fill("https://code.example.test/team/app/issues/57");
  await page.getByRole("button", { name: "Attach pull request" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "This is not a pull request URLPaste the full URL, including its pull request or merge request number.",
  );
  await expect(page.getByLabel("Pull request URL")).toHaveValue(
    "https://code.example.test/team/app/issues/57",
  );
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("log", { name: /transcript/ })).toBeVisible();
});

test("Review keeps a pull request URL after a failed save", async ({
  page,
}) => {
  await bootFactoryPane(page, undefined, ["invalid: run record write failed"]);
  await runTool(page, "Review").click();
  const url = "https://code.example.test/team/app/pull/57";
  await page.getByLabel("Pull request URL").fill(url);
  await page.getByRole("button", { name: "Attach pull request" }).click();

  await expect(page.getByRole("alert")).toHaveText(
    "Could not saveYour inputs are kept. Review them or retry without starting again.",
  );
  await expect(page.getByLabel("Pull request URL")).toHaveValue(url);
});

test("Review attaches a valid pull request after the relay accepts it", async ({
  page,
}) => {
  await bootFactoryPane(page);
  await runTool(page, "Review").click();
  const url = "https://github.com/team/project/pull/57";
  await page.getByLabel("Pull request URL").fill(url);
  await page.getByRole("button", { name: "Attach pull request" }).click();

  await expect(
    page.getByRole("heading", { name: "Pull request #57" }),
  ).toBeVisible();
  await expect(page.getByText("unknown", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: url })).toHaveAttribute(
    "href",
    url,
  );
});

test("Review displays only the linked record and preserves it while editing", async ({
  page,
}) => {
  await bootFactoryPane(
    page,
    runHeadEvent(
      { state: "not_configured" },
      {
        url: "https://code.example.test/team/app/pull/57",
        number: 57,
        state: "unknown",
        checkResults: [
          { name: "Typecheck", status: "queued" },
          { name: "Lint", status: "passed" },
        ],
        reviewHandoff: "Please review the changed files.",
      },
    ),
  );
  await runTool(page, "Review").click();

  await expect(
    page.getByRole("heading", { name: "Pull request #57" }),
  ).toBeVisible();
  await expect(page.getByText("unknown", { exact: true })).toBeVisible();
  await expect(page.getByText("Typecheck")).toBeVisible();
  await expect(
    page.getByText("Please review the changed files."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Request a review" }),
  ).toBeDisabled();

  await page.getByRole("button", { name: "Change linked request" }).click();
  await expect(page.getByLabel("Pull request URL")).toHaveValue(
    "https://code.example.test/team/app/pull/57",
  );
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(
    page.getByRole("heading", { name: "Pull request #57" }),
  ).toBeVisible();
});
