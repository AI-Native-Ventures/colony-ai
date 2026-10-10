import { expect, test } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import {
  mockOpenRouterUnlinked,
  openR17ConnectionSetup,
  r17Runtime,
} from "../helpers/onboarding";

const SHOT_DIR =
  process.env.COLONY_TWO_PATHS_SHOT_DIR ?? "test-results/onboarding-two-paths";

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`Connect offers only Claude Code or Codex and Colony Agent at ${viewport.width}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await openR17ConnectionSetup(page, {
      runtimes: [
        r17Runtime("claude", "available", { status: "logged_in" }),
        r17Runtime("codex", "not_installed", { status: "unknown" }),
        r17Runtime("goose", "available", { status: "logged_in" }),
        r17Runtime("buzz-agent", "available", { status: "not_applicable" }),
      ],
    });
    const routes = page.getByRole("radiogroup", { name: "AI connection" });
    await expect(routes.getByRole("radio")).toHaveCount(2);
    await expect(
      routes.getByRole("radio", { name: "Claude Code or Codex", exact: true }),
    ).toBeChecked();
    await expect(
      page.getByTestId("onboarding-connect-runtime-claude"),
    ).toBeVisible();
    await expect(
      page.getByTestId("onboarding-connect-runtime-codex"),
    ).toBeVisible();
    await expect(
      page.getByTestId("onboarding-connect-runtime-goose"),
    ).toHaveCount(0);
    await expect(page.getByText(/^More tools \(/)).toHaveCount(0);
    await routes.scrollIntoViewIfNeeded();
    await waitForAnimations(page);
    await page.screenshot({
      path: `${SHOT_DIR}/01-claude-code-or-codex-${viewport.width}.png`,
    });

    await mockOpenRouterUnlinked(page);
    await routes
      .getByRole("radio", { name: "Colony Agent", exact: true })
      .click();
    const colonyAgent = page.getByTestId("onboarding-colony-agent");
    await expect(
      colonyAgent.getByRole("button", {
        name: "Connect OpenRouter",
        exact: true,
      }),
    ).toBeEnabled();
    const credits = colonyAgent.getByTestId("onboarding-credits-coming-soon");
    await expect(credits).toContainText("Coming soon");
    await expect(page.getByTestId("onboarding-provider-key")).toHaveCount(0);
    await routes.scrollIntoViewIfNeeded();
    await waitForAnimations(page);
    await page.screenshot({
      path: `${SHOT_DIR}/02-colony-agent-${viewport.width}.png`,
    });
    const skip = page.getByRole("button", {
      name: "Skip for now",
      exact: true,
    });
    await skip.scrollIntoViewIfNeeded();
    await expect(skip).toBeEnabled();
    await waitForAnimations(page);
    await page.screenshot({
      path: `${SHOT_DIR}/03-colony-credits-and-skip-${viewport.width}.png`,
    });
  });
}
