import { expect, test } from "@playwright/test";
import { installMockBridge } from "../helpers/bridge";

import {
  mockOpenRouterUnlinked,
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
    page.getByRole("heading", { name: "Let’s connect your first agent." }),
  ).toBeVisible();

  await expect(
    page.getByTestId("onboarding-connect-runtime-claude"),
  ).toBeVisible();
  await expect(
    page.getByTestId("onboarding-connect-runtime-codex"),
  ).toBeVisible();
  await expect(
    page
      .getByTestId("onboarding-connect-runtime-claude")
      .locator(".runtime-select"),
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

  // Onboarding offers two paths only. Bring-your-own-key and the other
  // harnesses stay under Settings > Agents.
  await expect(page.getByRole("radio")).toHaveCount(2);
  await expect(
    page.getByRole("radio", { name: "Bring your own key" }),
  ).toHaveCount(0);
  await expect(page.getByText(/^More tools \(/)).toHaveCount(0);
  await expect(
    page.getByTestId("onboarding-connect-runtime-buzz-agent"),
  ).toHaveCount(0);

  await page.getByRole("radio", { name: "Colony Agent", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Your OpenRouter account" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Colony credits", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Provider", { exact: true })).toHaveCount(0);
  await page
    .getByRole("radio", { name: "Claude Code or Codex", exact: true })
    .click();
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
    page.getByRole("radio", { name: "Colony Agent", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Skip for now" }),
  ).toBeEnabled();

  const savedBusiness = await page.evaluate((key) => {
    return JSON.parse(window.localStorage.getItem(key) ?? "null");
  }, R17_BUSINESS_PROFILE_KEY);
  expect(savedBusiness).toMatchObject({
    name: "North Star",
    website: "northstar.example",
  });

  await page.getByRole("button", { name: "Skip for now" }).click();
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
  // Colony Agent is its own path, never a card in the subscription list.
  await expect(
    page.getByTestId("onboarding-connect-runtime-buzz-agent"),
  ).toHaveCount(0);
  await expect(page.getByTestId("onboarding-ai-not-ready")).toHaveCount(0);
  await mockOpenRouterUnlinked(page);
  await page.getByRole("radio", { name: "Colony Agent", exact: true }).click();
  await expect(
    page.getByRole("radio", { name: "Colony Agent", exact: true }),
  ).toBeChecked();
  const credits = page.getByTestId("onboarding-credits-coming-soon");
  await expect(credits).toContainText("Colony credits");
  await expect(credits).toContainText("Coming soon");
  await expect(credits.getByRole("button")).toHaveCount(0);
  await expect(page.getByTestId("onboarding-colony-agent-saved")).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: "Connect OpenRouter", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".form-content .lede[role=status]")).toHaveCount(0);
  await expect(credits).not.toContainText(/balance|Unavailable|12\.50/);
  await expect(page.getByRole("button", { name: "Reload prices" })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: "Skip for now" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Skip for now" }).click();
  await expect(page.getByTestId("app-sidebar")).toBeVisible();
});

test("R17 Colony Agent saved in Settings is tested from onboarding without editing keys", async ({
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
        provider: "anthropic",
        model: "fixture/model",
        env_vars: { ANTHROPIC_API_KEY: "e2e-fixture-key" },
      },
    },
  });
  await page.getByRole("radio", { name: "Colony Agent", exact: true }).click();
  const saved = page.getByTestId("onboarding-colony-agent-saved");
  await expect(saved).toContainText("saved in Settings");
  await expect(page.locator(".harness-state")).toHaveText("Included");
  await expect(page.getByTestId("onboarding-provider-key")).toHaveCount(0);
  await saved
    .getByRole("button", { name: "Test Colony Agent", exact: true })
    .click();
  await expect(page.getByTestId("onboarding-scene-connected")).toBeVisible();
  const request = await page.evaluate(() =>
    window.__BUZZ_E2E_COMMAND_PAYLOADS__?.find(
      (entry) => entry.command === "test_onboarding_connection",
    ),
  );
  expect(request?.payload).toMatchObject({
    config: {
      preferred_runtime: "buzz-agent",
      provider: "anthropic",
      model: "fixture/model",
    },
  });
});

test("R17 explicit skip opens Colony without saving a connection", async ({
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
  await page.getByRole("button", { name: "Skip for now", exact: true }).click();
  await expect(page.getByTestId("app-sidebar")).toBeVisible();
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
  await page.getByRole("radio", { name: "Colony Agent", exact: true }).click();
  await expect(page.locator(".harness-state")).toHaveText(
    "Git for Windows needed",
  );
  await expect(
    page
      .getByTestId("onboarding-colony-agent")
      .getByRole("alert")
      .filter({ hasText: "Install Git for Windows" }),
  ).toContainText("https://gitforwindows.org/");
  // A configured provider is not enough while the prerequisite is missing.
  await expect(page.getByTestId("onboarding-colony-agent-saved")).toHaveCount(
    0,
  );
  await page
    .getByRole("radio", { name: "Claude Code or Codex", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Skip for now", exact: true }),
  ).toBeEnabled();
});
