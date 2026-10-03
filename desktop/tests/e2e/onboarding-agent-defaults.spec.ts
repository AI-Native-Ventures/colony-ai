import { expect, test } from "@playwright/test";
import { installMockBridge } from "../helpers/bridge";

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
  // Settings tests seed an existing workspace. Connect has its own real-turn gate.
  await installMockBridge(page, {
    ...options.mock,
    accountLinked: true,
    acpRuntimesCatalog: options.runtimes ?? [],
  });
  await page.goto("/");
  await expect(page.getByTestId("open-settings")).toBeVisible();
  await page.getByTestId("open-settings").click();
  await page.getByTestId("profile-popover-settings").click();
  await expect(page.getByTestId("settings-view")).toBeVisible();
  await page.getByTestId("settings-group-agents-group").click();
  await expect(
    page.getByTestId("settings-inner-agent-defaults"),
  ).toHaveAttribute("aria-selected", "true");
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
      {
        ...r17Runtime("buzz-agent", "available", { status: "not_applicable" }),
        model_env_var: "BUZZ_AGENT_MODEL",
        provider_env_var: "BUZZ_AGENT_PROVIDER",
      },
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
  const subscription = page.getByTestId("onboarding-connect-runtime-claude");
  const logo = subscription
    .locator(".provider-top img, .provider-top svg")
    .first();
  const logoSize = await logo.boundingBox();
  expect(logoSize?.width).toBeGreaterThan(0);
  expect(logoSize?.width).toBeLessThanOrEqual(64);
  expect(logoSize?.height).toBeLessThanOrEqual(64);
  const selectStyle = await subscription
    .locator(".runtime-select")
    .evaluate((button) => {
      const style = getComputedStyle(button);
      return { alignment: style.textAlign, border: style.borderTopWidth };
    });
  expect(selectStyle).toEqual({ alignment: "left", border: "0px" });

  await page.getByRole("button", { name: "Bring your own key" }).click();
  await expect(
    page.getByRole("heading", { name: "Connect directly to a provider" }),
  ).toBeVisible();
  await expect(page.getByTestId("global-agent-provider")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Test connection" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save AI default" }),
  ).toBeDisabled();

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
  await page.getByTestId("settings-group-agents-group").click();
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

test("R17 bundled agent without a provider is not ready and credits are coming soon", async ({
  page,
}) => {
  await openR17ConnectionSetup(page, {
    runtimes: [
      r17Runtime("buzz-agent", "available", { status: "not_applicable" }),
    ],
  });
  const card = page.getByTestId("onboarding-connect-runtime-buzz-agent");
  await expect(card).toContainText("No AI connected yet");
  await expect(card).not.toContainText("Ready");
  await expect(
    page.getByText("AI employees will not reply", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open AI settings" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Colony credits", exact: true })
    .click();
  const credits = page.getByTestId("onboarding-credits-coming-soon");
  await expect(credits).toContainText("Coming soon");
  await expect(credits).not.toContainText(/balance|Unavailable|12\.50/);
  await expect(page.getByRole("button", { name: "Reload prices" })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: "Open my Colony" }),
  ).toBeEnabled();
});

test("R17 OpenRouter saves a tested provider default through the real form", async ({
  page,
}) => {
  await openR17ConnectionSetup(page, {
    runtimes: [
      {
        ...r17Runtime("buzz-agent", "available", { status: "not_applicable" }),
        model_env_var: "BUZZ_AGENT_MODEL",
        provider_env_var: "BUZZ_AGENT_PROVIDER",
      },
    ],
    mock: {
      globalAgentConfig: {
        preferred_runtime: "buzz-agent",
        provider: "openrouter",
        model: "fixture/model",
        env_vars: {},
      },
      discoverAgentModels: {
        models: [{ id: "fixture/model", name: "Fixture model" }],
        supportsSwitching: true,
        selectedModel: "fixture/model",
      },
    },
  });
  await page.getByRole("button", { name: "OpenRouter", exact: true }).click();
  const key = page.getByTestId("persona-provider-api-key");
  await expect(key).toHaveAttribute("type", "password");
  await key.fill("e2e-fixture-key");
  await expect(
    page.getByRole("button", { name: "Save AI default" }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Test connection", exact: true })
    .click();
  await expect(
    page.getByText("Connection works.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Save AI default" }).click();
  await expect(
    page.getByText("AI connected and saved as your default."),
  ).toBeVisible();
  await expect(page.locator(".harness-state")).toHaveText("Configured");
  await expect(
    page.getByText("AI employees will not reply", { exact: false }),
  ).toHaveCount(0);
  expect(
    await mockCommand(page, "get_global_agent_config_set_call_count"),
  ).toBe(1);
  expect(await mockCommand(page, "get_global_agent_config")).toMatchObject({
    preferred_runtime: "buzz-agent",
    provider: "openrouter",
    model: "fixture/model",
  });
});

test("R17 explicit skip can open the working defaults path in Settings", async ({
  page,
}) => {
  await openR17ConnectionSetup(page, {
    runtimes: [
      {
        ...r17Runtime("buzz-agent", "available", { status: "not_applicable" }),
        model_env_var: "BUZZ_AGENT_MODEL",
        provider_env_var: "BUZZ_AGENT_PROVIDER",
      },
    ],
  });
  await page
    .getByRole("button", { name: "Open AI settings", exact: true })
    .click();
  await expect(page.getByTestId("settings-view")).toBeVisible();
  await expect(page.getByTestId("settings-global-agent-config")).toBeVisible();
  await expect(page.getByTestId("global-agent-provider")).toBeVisible();
  expect(
    await mockCommand(page, "get_global_agent_config_set_call_count"),
  ).toBe(0);
});

test("bundled agent readiness names missing Git for Windows before claiming Ready", async ({
  page,
}) => {
  await openR17ConnectionSetup(page, {
    runtimes: [
      r17Runtime("buzz-agent", "available", { status: "not_applicable" }),
    ],
    mock: {
      globalAgentConfig: {
        preferred_runtime: "buzz-agent",
        provider: "openrouter",
        model: "fixture/model",
        env_vars: { OPENROUTER_API_KEY: "e2e-fixture-key" },
      },
      discoverAgentModels: {
        models: [{ id: "fixture/model", name: "Fixture model" }],
        supportsSwitching: true,
        selectedModel: "fixture/model",
      },
      gitBashPrerequisite: {
        available: false,
        path: null,
        install_instructions_url: "https://gitforwindows.org/",
        install_hint: "Install Git for Windows",
      },
    },
  });
  const card = page.getByTestId("onboarding-connect-runtime-buzz-agent");
  await expect(card).toContainText(
    "Install Git for Windows from https://gitforwindows.org/",
  );
  await expect(card).not.toContainText("Ready on this computer");
  await expect(card.locator(".provider-status.is-connected")).toHaveCount(0);
  await page.getByRole("button", { name: "OpenRouter", exact: true }).click();
  await expect(page.locator(".harness-state")).toHaveText(
    "Git for Windows needed",
  );
  await expect(page.getByRole("alert")).toContainText(
    "Install Git for Windows",
  );
  await expect(
    page.getByRole("button", { name: "Test connection", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Open my Colony", exact: true }),
  ).toBeEnabled();
});
