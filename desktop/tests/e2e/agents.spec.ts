import { expect, test } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";
import { openAgentsDirectoryView } from "../helpers/agentWorkspace";

test.beforeEach(async ({ page }) => {
  await installMockBridge(page);
});

async function gotoApp(page: import("@playwright/test").Page) {
  let lastError: unknown = null;

  for (const attempt of [0, 1]) {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForInvokeBridge(page);

    try {
      await expect(page.getByTestId("sidebar-primary-menu")).toBeVisible({
        timeout: 10_000,
      });
      return;
    } catch (error) {
      lastError = error;
      if (attempt === 1) {
        throw error;
      }
    }
  }

  throw lastError;
}

async function waitForInvokeBridge(page: import("@playwright/test").Page) {
  await page.waitForFunction(
    () => {
      const tauriWindow = window as Window & {
        __BUZZ_E2E_INVOKE_MOCK_COMMAND__?: unknown;
        __TAURI_INTERNALS__?: {
          invoke?: unknown;
        };
      };

      return (
        typeof tauriWindow.__BUZZ_E2E_INVOKE_MOCK_COMMAND__ === "function" ||
        typeof tauriWindow.__TAURI_INTERNALS__?.invoke === "function"
      );
    },
    null,
    { timeout: 5_000 },
  );
}

test("agent defaults stays in the header without an actions menu", async ({
  page,
}) => {
  await installMockBridge(page, {
    acpRuntimesCatalog: [
      {
        auth_status: { status: "logged_in" },
        availability: "available",
        avatar_url: "",
        binary_path: "/usr/local/bin/codex",
        can_auto_install: false,
        command: "codex",
        default_args: [],
        id: "codex",
        install_hint: "",
        install_instructions_url: "https://example.com",
        label: "Codex",
        login_hint: null,
        mcp_command: null,
        node_required: false,
        underlying_cli_path: null,
      },
    ],
    globalAgentConfig: {
      env_vars: {},
      model: "gpt-5.5[high]",
      preferred_runtime: "codex",
      provider: null,
    },
  });
  await gotoApp(page);
  // Agent defaults, Invite a person, and Add agent remain on the directory route.
  await openAgentsDirectoryView(page);

  await expect(page.getByTestId("agent-header-actions-button")).toHaveCount(0);
  await expect(
    page.getByRole("menuitem", { name: "Import agent" }),
  ).toHaveCount(0);

  const defaultsButton = page.getByTestId("agent-defaults-button");
  await expect(defaultsButton).toHaveText("Agent defaults");
  await defaultsButton.click();
  const defaultsDialog = page.getByTestId("agent-ai-defaults-dialog");
  await expect(defaultsDialog).toBeVisible();
  await expect(
    defaultsDialog.getByTestId("global-agent-default-harness"),
  ).toHaveAttribute("data-value", "codex");
  await expect(
    defaultsDialog.getByTestId("global-agent-default-harness"),
  ).toContainText("Codex");
  await expect(
    defaultsDialog.getByTestId("global-agent-model"),
  ).toHaveAttribute("data-value", "gpt-5.5[high]");
  await expect(defaultsDialog.getByTestId("global-agent-model")).toContainText(
    "GPT-5.5 (high)",
  );
  await page.keyboard.press("Escape");
  await expect(defaultsDialog).toHaveCount(0);
});

test("unconfigured agent defaults use the setup label", async ({ page }) => {
  await gotoApp(page);
  await openAgentsDirectoryView(page);

  await expect(page.getByTestId("agent-defaults-button")).toHaveText(
    "Set agent defaults",
  );
});
