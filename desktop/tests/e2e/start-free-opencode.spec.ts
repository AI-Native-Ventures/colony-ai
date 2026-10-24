import { expect, test } from "@playwright/test";
import { openR17ConnectionSetup, r17Runtime } from "../helpers/onboarding";

// Start free: Colony installs its own OpenCode and runs agents on OpenCode's
// free model. These specs pin the Connect contract (default choice, install,
// failure, ended) against the mock bridge; the packaged gate proves the real
// download and reply.

const opencodeMissing = r17Runtime("opencode", "not_installed", {
  status: "unknown",
});
const opencodeInstalled = r17Runtime("opencode", "available", {
  status: "not_applicable",
});

test("start free is the default and finishes with a real reply", async ({
  page,
}) => {
  await openR17ConnectionSetup(page, {
    startFree: true,
    runtimes: [opencodeMissing],
    mock: {
      acpRuntimesCatalogAfterInstall: [opencodeInstalled],
      installAcpRuntimeOutputLines: ["Downloading OpenCode v1.19.2"],
      installAcpRuntimeResult: { success: true, steps: [] },
      onboardingConnectionResult: {
        reply: "Hello! What shall we work on first?",
        model: "opencode/deepseek-v4.1-flash-free",
        startupMs: 20,
        totalMs: 50,
      },
    },
  });
  await expect(page.getByTestId("onboarding-mode-free")).toBeChecked();
  await expect(
    page.getByText("Free while OpenCode offers it.", { exact: false }),
  ).toBeVisible();
  await page.getByTestId("onboarding-test-connection").click();
  await expect(
    page.getByText("Hello! What shall we work on first?"),
  ).toBeVisible();
});

test("start free install failure offers retry and own AI", async ({ page }) => {
  await openR17ConnectionSetup(page, {
    startFree: true,
    runtimes: [opencodeMissing],
    mock: {
      installAcpRuntimeResult: {
        success: false,
        steps: [
          {
            step: "opencode",
            command: "Colony OpenCode v1.19.2",
            success: false,
            stdout: "",
            stderr: "download OpenCode HTTP 503: Service Unavailable",
            exit_code: null,
            hint: "Check your internet connection and try again. Choose Use your own AI to connect Claude Code, Codex or OpenRouter instead.",
          },
        ],
      },
    },
  });
  await page.getByTestId("onboarding-test-connection").click();
  await expect(page.getByTestId("onboarding-test-connection")).toBeVisible();
  await expect(
    page.getByText("Check your internet connection and try again.", {
      exact: false,
    }),
  ).toBeVisible();
  await page.getByTestId("start-free-use-own").click();
  await expect(page.getByTestId("onboarding-mode-own")).toBeChecked();
});

test("start free shows the ended screen when the free model is gone", async ({
  page,
}) => {
  await openR17ConnectionSetup(page, {
    startFree: true,
    runtimes: [opencodeInstalled],
    mock: {
      installAcpRuntimeResult: { success: true, steps: [] },
      onboardingConnectionResult: {
        error:
          "Selected model is unavailable or this harness does not support model switching. Choose another model.",
        code: "model_unavailable",
      },
    },
  });
  await page.getByTestId("onboarding-test-connection").click();
  await expect(
    page.getByText(
      "OpenCode's free AI has ended. Connect your own AI to continue.",
    ),
  ).toBeVisible();
  await expect(page.getByText(/big-pickle/i)).toHaveCount(0);
  await page.getByTestId("start-free-use-own").click();
  await expect(page.getByTestId("onboarding-mode-own")).toBeChecked();
});

test("mode choice is a keyboard radio group", async ({ page }) => {
  await openR17ConnectionSetup(page, {
    startFree: true,
    runtimes: [opencodeMissing],
  });
  await page.getByTestId("onboarding-mode-free").focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByTestId("onboarding-mode-own")).toBeChecked();
  await expect(page.getByTestId("onboarding-mode-own")).toBeFocused();
  // Native radios wrap: ArrowUp from the first card lands on the last.
  await page.keyboard.press("ArrowUp");
  await expect(page.getByTestId("onboarding-mode-free")).toBeChecked();
});

test("mode choice and Back are locked while Start free installs", async ({
  page,
}) => {
  await openR17ConnectionSetup(page, {
    startFree: true,
    runtimes: [opencodeMissing],
    mock: {
      installAcpRuntimeDelayMs: 2000,
      installAcpRuntimeResult: {
        success: false,
        steps: [
          {
            step: "opencode",
            command: "Colony OpenCode v1.19.2",
            success: false,
            stdout: "",
            stderr: "download OpenCode request failed: timed out",
            exit_code: null,
          },
        ],
      },
    },
  });
  await page.getByTestId("onboarding-test-connection").click();
  await expect(page.getByTestId("start-free-installing")).toBeVisible();
  await expect(page.getByTestId("onboarding-mode-own")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Back" })).toBeDisabled();
  await expect(page.getByTestId("onboarding-test-connection")).toBeVisible();
  await expect(page.getByTestId("onboarding-mode-own")).toBeEnabled();
});

test("an unsupported computer shows the reason and no retry", async ({
  page,
}) => {
  await openR17ConnectionSetup(page, {
    startFree: true,
    runtimes: [opencodeMissing],
    mock: {
      installAcpRuntimeResult: {
        success: false,
        steps: [
          {
            step: "opencode-unsupported",
            command: "Colony OpenCode v1.19.2",
            success: false,
            stdout: "",
            stderr: "Start free is not available on linux-riscv64 yet.",
            exit_code: null,
            hint: "Choose Use your own AI to connect Claude Code, Codex or OpenRouter instead.",
          },
        ],
      },
    },
  });
  await page.getByTestId("onboarding-test-connection").click();
  await expect(
    page.getByText("Start free is not available on linux-riscv64 yet."),
  ).toBeVisible();
  // Nothing to retry: the Test button stays off, Use your own AI is the way on.
  await expect(page.getByTestId("onboarding-test-connection")).toBeDisabled();
  await expect(page.getByTestId("start-free-use-own")).toBeVisible();
});

test("a slow first hello says it is still waiting", async ({ page }) => {
  await openR17ConnectionSetup(page, {
    startFree: true,
    runtimes: [opencodeInstalled],
    mock: {
      installAcpRuntimeResult: { success: true, steps: [] },
      onboardingConnectionDelayMs: 120_000,
    },
  });
  await page.clock.install();
  await page.getByTestId("onboarding-test-connection").click();
  const hint = page.getByTestId("onboarding-slow-reply");
  await expect(hint).toBeAttached();
  await expect(hint).toHaveText("");
  await page.clock.fastForward(21_000);
  await expect(hint).toHaveText(
    "Still waiting. When the AI is busy, this can take a few minutes. You can keep waiting or cancel.",
  );
  await expect(page.getByRole("button", { name: "Cancel test" })).toBeEnabled();
});
