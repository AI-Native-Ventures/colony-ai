import type { Page } from "@playwright/test";

import { expect, test } from "../helpers/harnessModelListTest";

import {
  REFERENCE_AGENTS,
  REFERENCE_CHANNEL_IDS,
} from "../../src/testing/e2eReferenceWorkspace";
import { installMockBridge } from "../helpers/bridge";
import { openR17ConnectionSetup, r17Runtime } from "../helpers/onboarding";

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
  command_candidates: ["codex-acp"],
  underlying_cli_path: "/private/tmp/colony-runtimes/codex/bin/codex",
  node_required: false,
  auth_status: { status: "unknown" },
  login_hint: "Run codex login to authenticate.",
  source: "builtin",
};

const CODEX_READY = {
  ...CODEX_MISSING,
  availability: "available",
  command: "codex-acp",
  binary_path: "/private/tmp/colony-runtimes/codex/bin/codex-acp",
  auth_status: { status: "logged_out" },
};

const CODEX_ADAPTER_OUTDATED = {
  ...CODEX_READY,
  availability: "adapter_outdated",
  auth_status: { status: "unknown" },
};

const CODEX_READY_SIGNED_IN = {
  ...CODEX_READY,
  auth_status: { status: "logged_in" },
};

const CODEX_AUTH_METHODS = {
  methods: [
    {
      id: "api-key",
      name: "API key",
      description: "Use an API key to authenticate",
    },
    {
      id: "chat-gpt",
      name: "ChatGPT",
      description: "Use ChatGPT to authenticate",
    },
    {
      id: "chat-gpt-device-code",
      name: "ChatGPT device code",
      description: "Use ChatGPT device code authentication",
    },
  ],
};

const CODEX_DEVICE_CODE_AUTH_METHODS = {
  methods: [CODEX_AUTH_METHODS.methods[0], CODEX_AUTH_METHODS.methods[2]],
};

const GEMINI_UNAVAILABLE = {
  ...CODEX_MISSING,
  id: "gemini-cli",
  label: "Gemini CLI",
  availability: "not_installed",
  can_auto_install: false,
  auth_status: { status: "unknown" },
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
  const { dialog, scout } = await openScoutEditorWithoutRuntimeChange(page);
  await page.locator("#edit-agent-runtime").click();
  await page.getByRole("menuitemradio", { name: /Codex/ }).click();
  return { dialog, scout };
}

async function openScoutEditorWithoutRuntimeChange(page: Page) {
  const scout = REFERENCE_AGENTS.scout.pubkey;
  await page.goto(`/#/agents?agent=${scout}`);
  await expect(page.getByTestId("agent-profile-content")).toBeVisible();
  await page.getByTestId("agent-edit-configuration").click();
  const dialog = page.getByTestId("edit-agent-dialog");
  await expect(dialog).toBeVisible();
  return { dialog, scout };
}

async function expectCodexAuthMethod(page: Page, methodId: string) {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const calls = (
          window as Window & {
            __BUZZ_E2E_COMMAND_PAYLOADS__?: Array<{
              command: string;
              payload: unknown;
            }>;
          }
        ).__BUZZ_E2E_COMMAND_PAYLOADS__;
        return calls?.find((call) => call.command === "connect_acp_runtime")
          ?.payload;
      }),
    )
    .toMatchObject({
      request: { runtimeId: "codex", methodId },
    });
}

async function expectCodexChatGptAuthMethod(page: Page) {
  await expectCodexAuthMethod(page, "chat-gpt");
}

test("an already-selected missing Codex runtime is recognized and set up", async ({
  page,
}) => {
  await installMockBridge(page, {
    referenceWorkspace: true,
    colony3Sidebar: true,
    acpRuntimesCatalog: [CLAUDE_AVAILABLE, CODEX_MISSING],
    acpRuntimesCatalogAfterInstall: [CLAUDE_AVAILABLE, CODEX_READY_SIGNED_IN],
    installAcpRuntimeDelayMs: 900,
    installAcpRuntimeResult: { success: true, steps: [] },
    managedAgents: [
      {
        pubkey: REFERENCE_AGENTS.scout.pubkey,
        name: "Scout",
        personaId: SCOUT_PERSONA.id,
        runtime: "codex",
        agentCommand: "codex-acp",
        agentArgs: ["acp"],
        agentCommandOverride: "codex-acp",
        model: "gpt-5",
        status: "stopped",
      },
    ],
    personas: [{ ...SCOUT_PERSONA, runtime: "codex" }],
  });

  const { dialog } = await openScoutEditorWithoutRuntimeChange(page);
  await expect(page.locator("#edit-agent-runtime")).toContainText(
    "Codex (adapter missing)",
  );
  await page.getByTestId("edit-agent-dialog-submit").click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { __BUZZ_E2E_COMMANDS__?: string[] })
            .__BUZZ_E2E_COMMANDS__ ?? [],
      ),
    )
    .toContain("install_acp_runtime");
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
});

test("an available app-managed Codex shim with orphaned Node is repaired before save", async ({
  page,
}) => {
  await installMockBridge(page, {
    referenceWorkspace: true,
    colony3Sidebar: true,
    acpRuntimesCatalog: [CLAUDE_AVAILABLE, CODEX_ADAPTER_OUTDATED],
    acpRuntimesCatalogAfterInstall: [CLAUDE_AVAILABLE, CODEX_READY_SIGNED_IN],
    installAcpRuntimeResult: { success: true, steps: [] },
    managedAgents: [
      {
        pubkey: REFERENCE_AGENTS.scout.pubkey,
        name: "Scout",
        personaId: SCOUT_PERSONA.id,
        runtime: "codex",
        agentCommand: "codex-acp",
        model: "gpt-5",
        status: "stopped",
      },
    ],
    personas: [{ ...SCOUT_PERSONA, runtime: "codex" }],
  });

  const { dialog } = await openScoutEditorWithoutRuntimeChange(page);
  await page.getByTestId("edit-agent-dialog-submit").click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { __BUZZ_E2E_COMMANDS__?: string[] })
            .__BUZZ_E2E_COMMANDS__ ?? [],
      ),
    )
    .toContain("install_acp_runtime");
  await expect(dialog).toBeHidden({ timeout: 15_000 });
});

test("switching Scout to Codex provisions the missing adapter before saving", async ({
  page,
}) => {
  const scout = REFERENCE_AGENTS.scout.pubkey;
  await installMockBridge(page, {
    referenceWorkspace: true,
    colony3Sidebar: true,
    acpRuntimesCatalog: [CLAUDE_AVAILABLE, CODEX_MISSING],
    acpRuntimesCatalogAfterInstall: [CLAUDE_AVAILABLE, CODEX_READY_SIGNED_IN],
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
  await page.goto(`/#/channels/${REFERENCE_CHANNEL_IDS.scoutDm}`);
  await expect(page.getByTestId("chat-header")).toBeVisible();
  await expect(page.getByTestId("chat-header-agent-runtime")).toContainText(
    "Codex",
  );
});

test("a signed-out Codex setup pauses the save and offers ChatGPT sign-in", async ({
  page,
}) => {
  await installMockBridge(page, {
    referenceWorkspace: true,
    colony3Sidebar: true,
    acpRuntimesCatalog: [CLAUDE_AVAILABLE, CODEX_MISSING],
    acpRuntimesCatalogAfterInstallSequence: [
      [CLAUDE_AVAILABLE, CODEX_READY],
      [CLAUDE_AVAILABLE, CODEX_READY_SIGNED_IN],
    ],
    acpAuthMethods: { codex: CODEX_AUTH_METHODS },
    connectAcpRuntimeResult: { launched: true },
    installAcpRuntimeResult: { success: true, steps: [] },
    managedAgents: [
      {
        pubkey: REFERENCE_AGENTS.scout.pubkey,
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
  const signIn = dialog.getByRole("button", { name: "Sign in to Codex" });
  await expect(signIn).toBeVisible();
  await expect(dialog).toBeVisible();

  await signIn.click();
  await expectCodexChatGptAuthMethod(page);
  await expect(dialog.getByText(/Codex sign-in is complete/)).toBeVisible();
  await expect(signIn).toBeHidden();
  await page.getByTestId("edit-agent-dialog-submit").click();
  await expect(dialog).toBeHidden();

  const commands = await page.evaluate(
    () =>
      (window as Window & { __BUZZ_E2E_COMMANDS__?: string[] })
        .__BUZZ_E2E_COMMANDS__ ?? [],
  );
  expect(
    commands.filter((command) => command === "install_acp_runtime"),
  ).toHaveLength(1);
  expect(
    commands.filter((command) => command === "connect_acp_runtime"),
  ).toHaveLength(1);
  expect(
    commands.filter((command) => command === "update_managed_agent"),
  ).toHaveLength(1);
});

test("Codex setup failure shows the cause and one retry action", async ({
  page,
}) => {
  await installMockBridge(page, {
    referenceWorkspace: true,
    colony3Sidebar: true,
    acpRuntimesCatalog: [CLAUDE_AVAILABLE, CODEX_MISSING],
    installAcpRuntimeResult: {
      success: false,
      steps: [
        {
          step: "codex",
          command: "npm ci",
          success: false,
          stdout: "",
          stderr: "registry request failed: connection reset",
          exit_code: 1,
        },
      ],
    },
    managedAgents: [
      {
        pubkey: REFERENCE_AGENTS.scout.pubkey,
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
    dialog.getByText(/registry request failed: connection reset/),
  ).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Try again" })).toHaveCount(
    1,
  );
});

test("an unavailable harness Colony cannot start is not offered for agent selection", async ({
  page,
}) => {
  await installMockBridge(page, {
    referenceWorkspace: true,
    colony3Sidebar: true,
    acpRuntimesCatalog: [CLAUDE_AVAILABLE, CODEX_MISSING, GEMINI_UNAVAILABLE],
    managedAgents: [
      {
        pubkey: REFERENCE_AGENTS.scout.pubkey,
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

  await openScoutEditorWithoutRuntimeChange(page);
  await page.locator("#edit-agent-runtime").click();
  await expect(
    page.getByRole("menuitemradio", { name: /Codex/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("menuitemradio", { name: /Gemini CLI/ }),
  ).toHaveCount(0);
});

test("a signed-out Codex runtime offers one Sign in to Codex action", async ({
  page,
}) => {
  const scout = REFERENCE_AGENTS.scout.pubkey;
  await installMockBridge(page, {
    referenceWorkspace: true,
    colony3Sidebar: true,
    acpRuntimesCatalog: [CLAUDE_AVAILABLE, CODEX_READY],
    acpAuthMethods: { codex: CODEX_AUTH_METHODS },
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
  await expectCodexChatGptAuthMethod(page);

  const commands = await page.evaluate(
    () =>
      (window as Window & { __BUZZ_E2E_COMMANDS__?: string[] })
        .__BUZZ_E2E_COMMANDS__ ?? [],
  );
  expect(
    commands.filter((command) => command === "connect_acp_runtime"),
  ).toHaveLength(1);
});

test("Codex onboarding chooses ChatGPT when the API key method is listed first", async ({
  page,
}) => {
  await page.addInitScript(() => window.localStorage.clear());
  await openR17ConnectionSetup(page, {
    runtimes: [r17Runtime("codex", "available", { status: "logged_out" })],
    mock: {
      acpAuthMethods: { codex: CODEX_AUTH_METHODS },
      connectAcpRuntimeResult: { launched: true },
    },
  });

  await expect(page.getByTestId("onboarding-scene-connect")).toBeVisible();
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expectCodexChatGptAuthMethod(page);
  const commands = await page.evaluate(
    () =>
      (window as Window & { __BUZZ_E2E_COMMANDS__?: string[] })
        .__BUZZ_E2E_COMMANDS__ ?? [],
  );
  expect(
    commands.filter((command) => command === "connect_acp_runtime"),
  ).toHaveLength(1);
});

test("Codex onboarding falls back to the ChatGPT device-code auth method", async ({
  page,
}) => {
  await page.addInitScript(() => window.localStorage.clear());
  await openR17ConnectionSetup(page, {
    runtimes: [r17Runtime("codex", "available", { status: "logged_out" })],
    mock: {
      acpAuthMethods: { codex: CODEX_DEVICE_CODE_AUTH_METHODS },
      connectAcpRuntimeResult: { launched: true },
    },
  });

  await expect(page.getByTestId("onboarding-scene-connect")).toBeVisible();
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expectCodexAuthMethod(page, "chat-gpt-device-code");
});
