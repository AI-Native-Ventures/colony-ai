import { expect, test } from "@playwright/test";

import {
  openR17ConnectionSetup,
  R17_BUSINESS_PROFILE_KEY,
  type R17ConnectionSetupOptions,
  r17Runtime,
} from "../helpers/onboarding";

async function openR17AgentDefaultsSettings(
  page: import("@playwright/test").Page,
  options: R17ConnectionSetupOptions = {},
) {
  await openR17ConnectionSetup(page, options);
  await page.getByRole("button", { name: "Open my Colony" }).click();
  await page.getByTestId("open-settings").click();
  await page.getByTestId("profile-popover-settings").click();
  await expect(page.getByTestId("settings-view")).toBeVisible();
  await page.getByTestId("settings-nav-agents").click();
  await expect(page.getByTestId("settings-agents")).toBeVisible();
  await expect(page.getByTestId("settings-global-agent-config")).toBeVisible();
}

async function mockCommand<T>(
  page: import("@playwright/test").Page,
  command: string,
) {
  return page.evaluate(async (name) => {
    const invoke = (
      window as Window & {
        __BUZZ_E2E_INVOKE_MOCK_COMMAND__?: (
          commandName: string,
          payload: unknown,
        ) => Promise<unknown>;
      }
    ).__BUZZ_E2E_INVOKE_MOCK_COMMAND__;
    if (!invoke) throw new Error("Mock command bridge is not installed.");
    return (await invoke(name, null)) as T;
  }, command);
}

test("R17 connection setup discovers local apps and keeps its route choices available", async ({
  page,
}) => {
  await openR17ConnectionSetup(page, {
    runtimes: [
      r17Runtime("claude", "available", { status: "logged_in" }),
      r17Runtime("codex", "available", { status: "logged_in" }),
    ],
    discoveryDelayMs: 1_000,
  });

  await expect(
    page.getByRole("heading", { name: "Connect your AI." }),
  ).toBeVisible();
  await expect(page.getByTestId("onboarding-runtime-loading")).toBeVisible();
  await expect(
    page.getByTestId("onboarding-connect-runtime-claude"),
  ).toBeVisible();
  await expect(
    page.getByTestId("onboarding-connect-runtime-codex"),
  ).toBeVisible();
  await expect(
    page.getByTestId("onboarding-connect-runtime-claude").getByRole("button"),
  ).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "Bring your own key" }).click();
  await expect(
    page.getByRole("heading", { name: "Connect directly to a provider" }),
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: "API key" })).toHaveAttribute(
    "type",
    "password",
  );
  await expect(page.getByRole("button", { name: "Check key" })).toBeVisible();

  await page.getByRole("button", { name: "OpenRouter" }).click();
  await expect(
    page.getByRole("heading", { name: "Your OpenRouter account" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Subscriptions" }).click();
  await expect(
    page.getByRole("heading", { name: "On this computer" }),
  ).toBeVisible();
});

test("R17 onboarding can continue when provider discovery fails", async ({
  page,
}) => {
  await openR17ConnectionSetup(page, { discoveryError: true });

  const discoveryNotice = page.getByRole("alert").filter({
    hasText: "We couldn’t check this computer.",
  });
  await expect(discoveryNotice).toBeVisible();
  await expect(discoveryNotice).not.toContainText("Mock ACP runtime discovery");
  await expect(
    page.getByRole("button", { name: "Bring your own key" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open my Colony" }),
  ).toBeEnabled();

  const savedBusiness = await page.evaluate((key) => {
    return JSON.parse(window.localStorage.getItem(key) ?? "null");
  }, R17_BUSINESS_PROFILE_KEY);
  expect(savedBusiness).toMatchObject({
    name: "North Star",
    website: "northstar.example",
  });

  await page.getByRole("button", { name: "Open my Colony" }).click();
  await expect(page.getByTestId("app-sidebar")).toBeVisible();
  await page.getByTestId("open-settings").click();
  await page.getByTestId("profile-popover-settings").click();
  await expect(page.getByTestId("settings-view")).toBeVisible();
  await page.getByTestId("settings-nav-agents").click();
  await expect(page.getByTestId("settings-global-agent-config")).toBeVisible();
});

test("R17 Agent Defaults are available from Settings after workspace entry", async ({
  page,
}) => {
  await openR17AgentDefaultsSettings(page, {
    runtimes: [r17Runtime("claude", "available", { status: "logged_in" })],
    mock: {
      globalAgentConfig: {
        env_vars: {},
        provider: null,
        model: null,
        preferred_runtime: "claude",
      },
    },
  });

  await expect(page.getByTestId("global-agent-default-harness")).toHaveText(
    "Claude Code",
  );
  await expect(
    page.getByRole("button", { name: "Save defaults" }),
  ).toBeDisabled();
});

test("R17 Agent Defaults show a model placeholder after empty discovery", async ({
  page,
}) => {
  await openR17AgentDefaultsSettings(page, {
    runtimes: [r17Runtime("claude", "available", { status: "logged_in" })],
    mock: {
      discoverAgentModels: { models: [], supportsSwitching: false },
      globalAgentConfig: {
        env_vars: {},
        provider: null,
        model: null,
        preferred_runtime: "claude",
      },
    },
  });

  await expect(page.getByTestId("global-agent-default-harness")).toHaveText(
    "Claude Code",
  );
  await expect(page.getByTestId("global-agent-model")).toHaveText(
    "Select a model",
  );
  await expect(
    page.getByRole("button", { name: "Save defaults" }),
  ).toBeVisible();
});

test("R17 Agent Defaults keep the model control and explain discovery failures", async ({
  page,
}) => {
  await openR17AgentDefaultsSettings(page, {
    runtimes: [r17Runtime("claude", "available", { status: "logged_in" })],
    mock: {
      discoverAgentModelsError: "CLI discovery timed out",
      globalAgentConfig: {
        env_vars: {},
        provider: null,
        model: null,
        preferred_runtime: "claude",
      },
    },
  });

  await expect(page.getByTestId("global-agent-default-harness")).toHaveText(
    "Claude Code",
  );
  await expect(page.getByTestId("global-agent-model")).toBeVisible();
  await expect(page.getByText(/Could not load live models/i)).toBeVisible();
});

test("R17 Agent Defaults persist model changes only after an explicit save", async ({
  page,
}) => {
  await openR17AgentDefaultsSettings(page, {
    runtimes: [r17Runtime("claude", "available", { status: "logged_in" })],
    mock: {
      discoverAgentModels: {
        models: [{ id: "claude-opus-4-20250514", name: "Claude Opus 4" }],
        supportsSwitching: true,
      },
      globalAgentConfig: {
        env_vars: {},
        provider: null,
        model: null,
        preferred_runtime: "claude",
      },
    },
  });

  await expect(page.getByTestId("global-agent-model")).toBeVisible();
  await page.getByTestId("global-agent-model").click();
  await page
    .getByTestId("global-agent-model-option-claude-opus-4-20250514")
    .click();
  await expect(
    page.getByRole("button", { name: "Save defaults" }),
  ).toBeEnabled();
  expect(
    await mockCommand<number>(page, "get_global_agent_config_set_call_count"),
  ).toBe(0);

  await page.getByRole("button", { name: "Save defaults" }).click();
  await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
  expect(
    await mockCommand<number>(page, "get_global_agent_config_set_call_count"),
  ).toBe(1);
  await expect
    .poll(() =>
      mockCommand<{ model: string | null }>(page, "get_global_agent_config"),
    )
    .toMatchObject({ model: "claude-opus-4-20250514" });
});

test("R17 Agent Defaults keep a failed save editable and allow retry", async ({
  page,
}) => {
  await openR17AgentDefaultsSettings(page, {
    runtimes: [r17Runtime("claude", "available", { status: "logged_in" })],
    mock: {
      discoverAgentModels: {
        models: [{ id: "claude-opus-4-20250514", name: "Claude Opus 4" }],
        supportsSwitching: true,
      },
      globalAgentConfig: {
        env_vars: {},
        provider: null,
        model: null,
        preferred_runtime: "claude",
      },
      setGlobalAgentConfigErrors: ["Temporary settings save failure.", null],
    },
  });

  await page.getByTestId("global-agent-model").click();
  await page
    .getByTestId("global-agent-model-option-claude-opus-4-20250514")
    .click();
  await page.getByRole("button", { name: "Save defaults" }).click();
  await expect(page.getByText("Couldn't save.", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save defaults" }),
  ).toBeEnabled();

  await page.getByRole("button", { name: "Save defaults" }).click();
  await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
  expect(
    await mockCommand<number>(page, "get_global_agent_config_set_call_count"),
  ).toBe(2);
});
