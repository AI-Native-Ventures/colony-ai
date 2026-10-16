import { expect, test } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { openR17ConnectionSetup, r17Runtime } from "../helpers/onboarding";

// Screenshots of every Start free state for the visual pass and proof pages.
const SHOT_DIR =
  process.env.COLONY_START_FREE_SHOT_DIR ?? "test-results/start-free";

const opencodeMissing = r17Runtime("opencode", "not_installed", {
  status: "unknown",
});
const opencodeInstalled = r17Runtime("opencode", "available", {
  status: "not_applicable",
});

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`Start free states at ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await openR17ConnectionSetup(page, {
      startFree: true,
      runtimes: [opencodeMissing],
      mock: {
        installAcpRuntimeDelayMs: 1500,
        installAcpRuntimeOutputLines: ["Downloading OpenCode v1.19.2"],
        installAcpRuntimeResults: [
          {
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
          { success: true, steps: [] },
        ],
        acpRuntimesCatalogAfterInstall: [opencodeInstalled],
        onboardingConnectionResult: {
          error:
            "Selected model is unavailable or this harness does not support model switching. Choose another model.",
          code: "model_unavailable",
        },
      },
    });

    await expect(page.getByTestId("start-free-continue")).toBeVisible();
    await waitForAnimations(page);
    await page.screenshot({
      path: `${SHOT_DIR}/01-start-free-${viewport.width}.png`,
    });

    await page.getByTestId("start-free-continue").click();
    await expect(page.getByTestId("start-free-installing")).toBeVisible();
    await page.screenshot({
      path: `${SHOT_DIR}/02-installing-${viewport.width}.png`,
    });

    await expect(page.getByTestId("start-free-retry")).toBeVisible();
    await waitForAnimations(page);
    await page.screenshot({
      path: `${SHOT_DIR}/03-install-failed-${viewport.width}.png`,
    });

    await page.getByTestId("start-free-retry").click();
    await expect(
      page.getByText(
        "OpenCode's free AI has ended. Connect your own AI to continue.",
      ),
    ).toBeVisible({ timeout: 15_000 });
    await waitForAnimations(page);
    await page.screenshot({
      path: `${SHOT_DIR}/04-ended-${viewport.width}.png`,
    });

    await page.getByTestId("start-free-use-own").click();
    await expect(page.getByTestId("onboarding-mode-own")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await waitForAnimations(page);
    await page.screenshot({
      path: `${SHOT_DIR}/05-use-your-own-${viewport.width}.png`,
    });
  });
}
