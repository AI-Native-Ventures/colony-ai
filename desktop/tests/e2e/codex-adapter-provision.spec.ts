import { expect, test, type Page } from "@playwright/test";

import {
  REFERENCE_AGENTS,
  REFERENCE_CHANNEL_IDS,
} from "../../src/testing/e2eReferenceWorkspace";
import { installMockBridge } from "../helpers/bridge";

const CLAUDE_AVAILABLE = {
  id: "claude",
  label: "Claude Code",
  avatar_url: "",
  availability: "available",
  command: "claude-agent-acp",
  binary_path: "/private/tmp/colony-runtimes/claude/claude-agent-acp",
  default_args: [],
  mcp_command: null,
  install_hint: "",
  install_instructions_url:
    "https://github.com/agentclientprotocol/claude-agent-acp",
  can_auto_install: true,
  underlying_cli_path: "/private/tmp/claude",
  node_required: false,
  auth_status: { status: "logged_in" },
  source: "builtin",
};

const CODEX_MISSING = {
  id: "codex",
  label: "Codex",
  avatar_url: "",
  availability: "adapter_missing",
  command: null,
  binary_path: null,
  default_args: [],
  mcp_command: "buzz-dev-mcp",
  install_hint: "Colony will set up Codex.",
  install_instructions_url: "https://developers.openai.com/codex/cli/",
  can_auto_install: true,
  underlying_cli_path: "/private/tmp/colony-runtimes/codex/bin/codex",
  node_required: true,
  auth_status: { status: "logged_out" },
  source: "builtin",
};

const CODEX_READY = {
  ...CODEX_MISSING,
  availability: "available",
  command: "codex-acp",
  binary_path: "/private/tmp/colony-runtimes/codex/bin/codex-acp",
};

const SCOUT_PERSONA = {
  id: "persona-scout-codex-provision",
  displayName: "Scout",
  systemPrompt: "You are Scout.",
  runtime: "claude",
  model: "claude-sonnet-4-5",
  provider: "anthropic",
};

async function openScoutEditor(page: Page) {
  const scout = REFERENCE_AGENTS.scout.pubkey;
  await page.goto(`/#/agents?agent=${scout}`);
  await expect(page.getByTestId("agent-profile-content")).toBeVisible();
  await page.getByTestId("agent-edit-configuration").click();
  const dialog = page.getByTestId("edit-agent-dialog");
  await expect(dialog).toBeVisible();
  await page.locator("#edit-agent-runtime").click();
  await page.getByRole("menuitemradio", { name: /Codex/ }).click();
  return { dialog, scout };
}

test("switching Scout to Codex provisions the missing adapter before saving", async ({
  page,
}) => {
  const scout = REFERENCE_AGENTS.scout.pubkey;
  await installMockBridge(page, {
    referenceWorkspace: true,
    colony3Sidebar: true,
    acpRuntimesCatalog: [CLAUDE_AVAILABLE, CODEX_MISSING],
    acpRuntimesCatalogAfterInstall: [CLAUDE_AVAILABLE, CODEX_READY],
    installAcpRuntimeDelayMs: 900,
    installAcpRuntimeResult: { success: true, steps: [] },
    managedAgents: [
      {
        pubkey: scout,
        name: "Scout",
        personaId: SCOUT_PERSONA.id,
        runtime: "claude",
        model: "claude-sonnet-4-5",
        status: "running",
        channelIds: [REFERENCE_CHANNEL_IDS.scoutDm],
      },
    ],
    personas: [SCOUT_PERSONA],
  });

  const { dialog } = await openScoutEditor(page);
  await page.getByTestId("edit-agent-dialog-submit").click();
  await expect(
    dialog.getByText("Setting up Codex...", { exact: true }),
  ).toBeVisible();
  await expect(dialog).toBeHidden({ timeout: 15_000 });

  const commands = await page.evaluate(
    () =>
      (window as Window & { __BUZZ_E2E_COMMANDS__?: string[] })
        .__BUZZ_E2E_COMMANDS__ ?? [],
  );
  expect(
    commands.filter((command) => command === "install_acp_runtime"),
  ).toHaveLength(1);
  expect(commands.indexOf("install_acp_runtime")).toBeLessThan(
    commands.indexOf("update_managed_agent"),
  );
  await expect(page.getByTestId("chat-header-agent-runtime")).toContainText(
    "Codex",
  );
});

test("a signed-out Codex runtime offers one Sign in to Codex action", async ({
  page,
}) => {
  const scout = REFERENCE_AGENTS.scout.pubkey;
  await installMockBridge(page, {
    referenceWorkspace: true,
    colony3Sidebar: true,
    acpRuntimesCatalog: [CLAUDE_AVAILABLE, CODEX_READY],
    acpAuthMethods: {
      codex: {
        methods: [
          {
            id: "chatgpt-login",
            name: "Sign in with ChatGPT",
            type: "terminal",
            command: ["codex", "login"],
          },
        ],
      },
    },
    connectAcpRuntimeResult: { launched: true },
    managedAgents: [
      {
        pubkey: scout,
        name: "Scout",
        personaId: SCOUT_PERSONA.id,
        runtime: "claude",
        model: "claude-sonnet-4-5",
        status: "running",
        channelIds: [REFERENCE_CHANNEL_IDS.scoutDm],
      },
    ],
    personas: [SCOUT_PERSONA],
  });

  const { dialog } = await openScoutEditor(page);
  const signIn = dialog.getByRole("button", { name: "Sign in to Codex" });
  await expect(signIn).toBeVisible();
  await signIn.click();

  const commands = await page.evaluate(
    () =>
      (window as Window & { __BUZZ_E2E_COMMANDS__?: string[] })
        .__BUZZ_E2E_COMMANDS__ ?? [],
  );
  expect(
    commands.filter((command) => command === "connect_acp_runtime"),
  ).toHaveLength(1);
});
