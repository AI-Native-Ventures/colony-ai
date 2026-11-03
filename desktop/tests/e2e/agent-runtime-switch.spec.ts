import { expect, test } from "@playwright/test";

import {
  REFERENCE_AGENTS,
  REFERENCE_CHANNEL_IDS,
} from "../../src/testing/e2eReferenceWorkspace";
import { installMockBridge } from "../helpers/bridge";

test("Scout switches from Claude Code to Codex and the DM header reports the running runtime", async ({
  page,
}) => {
  const scout = REFERENCE_AGENTS.scout.pubkey;
  await installMockBridge(page, {
    referenceWorkspace: true,
    colony3Sidebar: true,
    updateManagedAgentDelayMs: 700,
    acpRuntimesCatalog: [
      {
        id: "codex",
        label: "Codex",
        avatar_url: "",
        availability: "available",
        command: "codex-acp",
        binary_path: "/usr/local/bin/codex-acp",
        default_args: [],
        mcp_command: "buzz-dev-mcp",
        install_hint: "Install the Codex CLI and ACP adapter.",
        install_instructions_url: "https://developers.openai.com/codex/cli/",
        can_auto_install: false,
        requires_external_cli: true,
        underlying_cli_path: "/usr/local/bin/codex",
        node_required: false,
        auth_status: { status: "logged_in" },
        source: "builtin",
      },
    ],
    managedAgents: [
      {
        pubkey: scout,
        name: "Scout",
        personaId: "persona-scout-runtime-switch",
        runtime: "claude",
        model: "claude-sonnet-4-5",
        status: "running",
        channelIds: [REFERENCE_CHANNEL_IDS.scoutDm],
      },
    ],
    personas: [
      {
        id: "persona-scout-runtime-switch",
        displayName: "Scout",
        systemPrompt: "You are Scout.",
        runtime: "claude",
        model: "claude-sonnet-4-5",
        provider: "anthropic",
      },
    ],
  });

  await page.goto(`/#/agents?agent=${scout}`);
  await expect(page.getByTestId("agent-profile-content")).toBeVisible();
  await page.waitForFunction(
    () =>
      typeof (
        window as Window & {
          __BUZZ_E2E_SEED_ACTIVE_TURNS__?: unknown;
        }
      ).__BUZZ_E2E_SEED_ACTIVE_TURNS__ === "function",
  );
  await page.evaluate((agentPubkey) => {
    const seed = (
      window as Window & {
        __BUZZ_E2E_SEED_ACTIVE_TURNS__?: (turn: {
          agentPubkey: string;
          channelId: string;
          turnId: string;
        }) => void;
      }
    ).__BUZZ_E2E_SEED_ACTIVE_TURNS__;
    seed?.({
      agentPubkey,
      channelId: "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50",
      turnId: "runtime-switch-active-turn",
    });
  }, scout);
  const workingOn = page.getByRole("region", { name: "Working on" });
  await expect(workingOn.getByText("Working", { exact: true })).toBeVisible();
  await page.getByTestId("agent-edit-configuration").click();
  const editDialog = page.getByTestId("edit-agent-dialog");
  await expect(editDialog).toBeVisible();
  await page.locator("#edit-agent-runtime").click();
  await page.getByRole("menuitemradio", { name: /Codex/ }).click();
  const modelSelect = page.locator("#edit-agent-model");
  await expect(modelSelect).toBeEnabled();
  await modelSelect.click();
  const codexDefaultModel = page.getByRole("menuitemradio", {
    name: "GPT-5.5",
    exact: true,
  });
  await expect(codexDefaultModel).toBeVisible();
  await codexDefaultModel.click();
  await expect(page.getByTestId("edit-agent-dialog-submit")).toBeEnabled();
  await page.getByTestId("edit-agent-dialog-submit").click();

  const switchingNoticeSeen = await editDialog
    .getByText("Switching to Codex...", { exact: true })
    .waitFor({ state: "visible", timeout: 1500 })
    .then(
      () => true,
      () => false,
    );
  const queueNoticeSeen = await editDialog
    .getByText(
      "The current turn will stop. Queued mentions will remain queued.",
      { exact: true },
    )
    .waitFor({ state: "visible", timeout: 1500 })
    .then(
      () => true,
      () => false,
    );
  await expect(editDialog).toBeHidden();
  await page.evaluate((channelId) => {
    window.location.hash = `/channels/${channelId}`;
  }, REFERENCE_CHANNEL_IDS.scoutDm);
  await expect(page).toHaveURL(
    new RegExp(`#\\/channels\\/${REFERENCE_CHANNEL_IDS.scoutDm}$`, "u"),
  );
  await expect(page.getByTestId("chat-header")).toBeVisible();
  await expect(page.getByTestId("chat-header-agent-runtime")).toContainText(
    "Codex",
  );
  await expect(page.getByTestId("chat-header-agent-runtime")).toContainText(
    "GPT-5.5",
  );
  expect(switchingNoticeSeen).toBe(true);
  expect(queueNoticeSeen).toBe(true);
});
