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
    page.getByRole("heading", { name: "Choose a preview command" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Configure preview" }),
  ).toBeVisible();
  await expect(page.getByLabel("Development command")).toHaveValue("");
  await expect(page.getByLabel("Local preview URL")).toHaveValue("");
});

test("Preview reads the not-started state without a fake start action", async ({
  page,
}) => {
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
  await expect(page.getByRole("button", { name: "Start preview" })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: "Configure preview" }),
  ).toHaveCount(0);
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
  await expect(page.getByRole("button", { name: "Retry preview" })).toHaveCount(
    0,
  );
});

test("Review shows the no-pull-request state and returns to the agent session", async ({
  page,
}) => {
  await bootFactoryPane(page);
  await runTool(page, "Review").click();

  await expect(
    page.getByRole("heading", { name: "No pull request linked" }),
  ).toBeVisible();
  await expect(page.getByLabel("Pull request URL")).toHaveValue("");
  await expect(page.getByLabel("Pull request URL")).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await page.getByRole("button", { name: "Open agent session" }).click();
  await expect(page.getByRole("log", { name: /transcript/ })).toBeVisible();
});
