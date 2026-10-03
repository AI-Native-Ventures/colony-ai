import { expect, test } from "@playwright/test";
import { installMockBridge, TEST_IDENTITIES } from "../helpers/bridge";
import { waitForAnimations } from "../helpers/animations";

for (const viewport of [
  { width: 1728, height: 1117 },
  { width: 1440, height: 900 },
]) {
  test(`live transcript loading uses Scout presence at ${viewport.width}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await installMockBridge(page);
    await page.goto("/");
    await expect(page.getByTestId("app-sidebar")).toBeVisible();
    await page.evaluate(
      async ({ agentPubkey, channelId }) => {
        window.__BUZZ_E2E_SEED_ACTIVE_TURNS__?.({
          agentPubkey,
          channelId,
          turnId: "scout-presence-proof",
        });
        await window.__BUZZ_E2E_MOUNT_AGENT_SESSION_PANEL__?.({
          agentPubkey,
          channelId,
        });
      },
      {
        agentPubkey: TEST_IDENTITIES.charlie.pubkey,
        channelId: "94a444a4-c0a3-5966-ab05-530c6ddc2301",
      },
    );
    await expect(
      page.getByRole("heading", { name: "charlie", exact: true }),
    ).toBeVisible();
    const indicator = page.getByRole("status", {
      name: "Waiting for ACP activity",
    });
    await expect(indicator).toHaveAttribute("role", "status");
    await expect(indicator).toHaveAttribute(
      "aria-label",
      "Waiting for ACP activity",
    );
    await expect(
      indicator.locator('.scout-ant[data-pose="working"] svg'),
    ).toBeVisible();
    await expect(indicator.locator(".bee-sprite,.buzz-logo__mark")).toHaveCount(
      0,
    );
    await indicator.scrollIntoViewIfNeeded();
    await waitForAnimations(page);
    await page.screenshot({
      path: `test-results/onboarding-r2-proof/scout-turn-${viewport.width}.png`,
    });
  });
}
