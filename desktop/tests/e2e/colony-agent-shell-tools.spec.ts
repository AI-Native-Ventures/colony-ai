import { expect, test } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";
import { openR17ConnectionSetup, r17Runtime } from "../helpers/onboarding";
import { openSettings } from "../helpers/settings";

// A fresh Windows PC has no Git for Windows, so the Colony Agent cannot run its
// shell tool. The native host can download its own pinned copy into Colony's
// folder. These specs pin the contract the person sees (offer, progress, plain
// failure with Try again, done) against the mock bridge; the Windows CI job
// proves the real download and that bash runs.

const MISSING_BUT_FIXABLE = {
  available: false,
  path: null,
  install_instructions_url: "https://git-scm.com/download/win",
  install_hint: "Install Git for Windows",
  managed_install_supported: true,
};

const SETUP_OK = {
  success: true,
  steps: [
    {
      step: "git-bash",
      command: "Colony shell tools (MinGit 2.56.0.4)",
      success: true,
      stdout: "The shell tools are ready.",
      stderr: "",
      exit_code: null,
    },
  ],
  restarted_count: 0,
  failed_restart_count: 0,
  log_path: null,
};

const SETUP_FAILED = {
  success: false,
  steps: [
    {
      step: "git-bash",
      command: "Colony shell tools (MinGit 2.56.0.4)",
      success: false,
      stdout: "",
      stderr: "download shell tools request failed: dns error",
      exit_code: null,
      hint: "Check your internet connection and try again. If it keeps failing, install Git for Windows from https://git-scm.com/download/win and restart Colony.",
    },
  ],
  restarted_count: 0,
  failed_restart_count: 0,
  log_path: null,
};

const BUZZ_AGENT = {
  id: "buzz-agent",
  label: "Buzz Agent",
  avatar_url: "",
  availability: "available",
  command: "buzz-agent",
  binary_path: "/usr/local/bin/buzz-agent",
  default_args: [],
  mcp_command: "buzz-dev-mcp",
  install_hint: "",
  install_instructions_url: "https://github.com/block/buzz",
  can_auto_install: false,
  underlying_cli_path: null,
  node_required: false,
  auth_status: { status: "not_applicable" },
};

async function openColonyAgentWithoutGit(
  page: import("@playwright/test").Page,
  mock: Parameters<typeof openR17ConnectionSetup>[1] extends infer O
    ? O extends { mock?: infer M }
      ? M
      : never
    : never,
) {
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
      gitBashAvailableAfterInstall: true,
      ...mock,
    },
  });
  await page.getByRole("radio", { name: "Colony Agent", exact: true }).click();
}

test("the Colony Agent offers its own shell tools and finishes with progress", async ({
  page,
}) => {
  await openColonyAgentWithoutGit(page, {
    gitBashPrerequisite: MISSING_BUT_FIXABLE,
    installAcpRuntimeOutputLines: [
      "Setting up shell tools for the Colony Agent (one time, about 40 MB)",
      "Downloading shell tools: 8 of 38 MB",
      "Unpacking shell tools",
    ],
    installAcpRuntimeByRuntime: {
      "buzz-agent": { delayMs: 1500, result: SETUP_OK },
    },
  });
  const setup = page.getByTestId("onboarding-shell-tools-setup");
  await expect(setup).toContainText("Colony can download them once");
  // No dead end: the install guide for Git is not the only way forward.
  await expect(
    page
      .getByTestId("onboarding-colony-agent")
      .getByRole("alert")
      .filter({ hasText: "Git for Windows" }),
  ).toHaveCount(0);

  await setup.getByRole("button", { name: "Set up shell tools" }).click();
  await expect(
    setup.getByRole("button", { name: "Setting up…" }),
  ).toBeDisabled();
  await expect(setup.getByRole("status")).toHaveText("Unpacking shell tools");

  // Done: the prerequisite is met, so the offer goes away.
  await expect(setup).toHaveCount(0);
  await expect(
    page
      .getByTestId("onboarding-colony-agent")
      .getByRole("alert")
      .filter({ hasText: "Git for Windows" }),
  ).toHaveCount(0);
});

test("a failed download says so plainly and Try again finishes the setup", async ({
  page,
}) => {
  await openColonyAgentWithoutGit(page, {
    gitBashPrerequisite: MISSING_BUT_FIXABLE,
    installAcpRuntimeByRuntime: {
      "buzz-agent": { results: [SETUP_FAILED, SETUP_OK] },
    },
  });
  const setup = page.getByTestId("onboarding-shell-tools-setup");
  await setup.getByRole("button", { name: "Set up shell tools" }).click();

  const alert = setup.getByRole("alert");
  await expect(alert).toContainText(
    "Check your internet connection and try again.",
  );
  await expect(alert).toContainText(
    "download shell tools request failed: dns error",
  );
  // Never silent and never stuck: the same button now reads Try again.
  await setup.getByRole("button", { name: "Try again" }).click();
  await expect(setup).toHaveCount(0);
});

test("a PC where Colony cannot fetch shell tools keeps the Git for Windows guide", async ({
  page,
}) => {
  await openColonyAgentWithoutGit(page, {
    gitBashPrerequisite: {
      ...MISSING_BUT_FIXABLE,
      managed_install_supported: false,
    },
  });
  await expect(
    page
      .getByTestId("onboarding-colony-agent")
      .getByRole("alert")
      .filter({ hasText: "Install Git for Windows" }),
  ).toContainText("https://gitforwindows.org/");
  await expect(page.getByTestId("onboarding-shell-tools-setup")).toHaveCount(0);
});

test("Settings offers the same one-click setup beside the Git for Windows link", async ({
  page,
}) => {
  await installMockBridge(page, {
    acpRuntimesCatalog: [BUZZ_AGENT],
    gitBashPrerequisite: MISSING_BUT_FIXABLE,
    gitBashAvailableAfterInstall: true,
    installAcpRuntimeByRuntime: {
      "buzz-agent": { results: [SETUP_FAILED, SETUP_OK] },
    },
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await openSettings(page, "harnesses");

  const card = page.getByTestId("doctor-git-bash");
  await expect(card).toContainText("Action needed");
  await expect(
    card.getByRole("button", { name: "Install Git for Windows" }),
  ).toBeVisible();

  await card.getByTestId("doctor-git-bash-setup").click();
  await expect(card.getByRole("alert")).toContainText(
    "Check your internet connection and try again.",
  );
  await expect(card.getByTestId("doctor-git-bash-setup")).toHaveText(
    "Try again",
  );

  await card.getByTestId("doctor-git-bash-setup").click();
  await expect(card).toContainText("Available");
  await expect(card.getByTestId("doctor-git-bash-setup")).toHaveCount(0);
});
