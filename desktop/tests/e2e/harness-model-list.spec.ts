import { expect, test } from "@playwright/test";

import {
  REFERENCE_AGENTS,
  REFERENCE_CHANNEL_IDS,
} from "../../src/testing/e2eReferenceWorkspace";
import { installMockBridge } from "../helpers/bridge";

test("Scout can choose an installed Codex model from the model list", async ({
  page,
}) => {
  const scout = REFERENCE_AGENTS.scout.pubkey;
  await installMockBridge(page, {
    referenceWorkspace: true,
    colony3Sidebar: true,
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
        personaId: "persona-scout-model-list",
        runtime: "claude",
        model: "claude-sonnet-4-5",
        status: "running",
        channelIds: [REFERENCE_CHANNEL_IDS.scoutDm],
      },
    ],
    personas: [
      {
        id: "persona-scout-model-list",
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
  await page.getByTestId("agent-edit-configuration").click();

  const editDialog = page.getByTestId("edit-agent-dialog");
  await expect(editDialog).toBeVisible();
  await page.locator("#edit-agent-runtime").click();
  await page.getByRole("menuitemradio", { name: /Codex/ }).click();

  const modelSelect = page.locator("#edit-agent-model");
  await expect(modelSelect).toBeEnabled();
  await modelSelect.click();
  const codexModel = page.getByRole("menuitemradio", {
    name: "GPT-6 Luna",
    exact: true,
  });
  await expect(codexModel).toBeVisible();
  await codexModel.click();
  await expect(page.getByTestId("edit-agent-dialog-submit")).toBeEnabled();
  await page.getByTestId("edit-agent-dialog-submit").click();
  await expect(editDialog).toBeHidden();

  await page.evaluate((channelId) => {
    window.location.hash = `/channels/${channelId}`;
  }, REFERENCE_CHANNEL_IDS.scoutDm);
  await expect(page.getByTestId("chat-header-agent-runtime")).toContainText(
    "GPT-6 Luna",
  );
});
