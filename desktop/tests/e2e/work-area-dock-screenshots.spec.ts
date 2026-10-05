import { rm } from "node:fs/promises";
import { expect, test } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";
import { waitForAnimations } from "../helpers/animations";
import {
  createSampleWorkspace,
  FILE_AGENT,
  installWorkspaceFileHost,
} from "./helpers/workspaceFileHost";

// Review screenshots for the work area dock at the two reference viewports.
// They are artifacts for the PR (compare with the frozen r15 work area scenes),
// and double as a check that the dock renders a real file beside the chat.

const OUT = process.env.COLONY_DOCK_SHOTS ?? "test-results/work-area-dock";
const MESSAGE =
  "# Scout deliverables\n\n- Read `RESEARCH/GROKBOT_FILM_TEARDOWN_2026-09-04.md`\n- Day one: `DAY1_VIDEO_PACK.md`";

for (const viewport of [
  { width: 1728, height: 1117 },
  { width: 1440, height: 900 },
]) {
  test(`dock screenshots at ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const root = await createSampleWorkspace();
    try {
      await installWorkspaceFileHost(page, root);
      await installMockBridge(page, {
        managedAgents: [
          { pubkey: FILE_AGENT, name: "Scout", status: "running" },
        ],
      });
      await page.goto("/");
      await page.getByTestId("channel-general").click();
      await expect(page.getByTestId("chat-title")).toHaveText("general");
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              window.__BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?.({
                channelName: "general",
              }) ?? false,
          ),
        )
        .toBe(true);
      await page.evaluate(
        ({ content, pubkey }) => {
          window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
            channelName: "general",
            content,
            pubkey,
            createdAt: Math.floor(Date.now() / 1000),
          });
        },
        { content: MESSAGE, pubkey: FILE_AGENT },
      );
      const row = page
        .getByTestId("message-row")
        .filter({ hasText: "Scout deliverables" });
      await row
        .getByRole("link", {
          name: "RESEARCH/GROKBOT_FILM_TEARDOWN_2026-09-04.md",
          exact: true,
        })
        .click();
      const dock = page.getByTestId("work-area-panel");
      await expect(
        dock.getByRole("heading", { name: "Film teardown" }),
      ).toBeVisible();
      await waitForAnimations(page);
      await page.screenshot({
        path: `${OUT}/dock-files-${viewport.width}.png`,
      });

      // Closing the last tab closes the dock; opening it again shows the
      // empty state with the tab kinds on offer.
      await dock.getByRole("button", { name: "Close Files" }).click();
      await expect(dock).toHaveCount(0);
      await page.getByTestId("channel-work-area-trigger").click();
      await expect(page.getByTestId("work-area-empty")).toBeVisible();
      await waitForAnimations(page);
      await page.screenshot({
        path: `${OUT}/dock-empty-${viewport.width}.png`,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

// Files list and Canvas tab (second change): same two viewports.
for (const viewport of [
  { width: 1728, height: 1117 },
  { width: 1440, height: 900 },
]) {
  test(`files list and canvas screenshots at ${viewport.width}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const root = await createSampleWorkspace();
    try {
      await installWorkspaceFileHost(page, root);
      await installMockBridge(page, {
        managedAgents: [
          { pubkey: FILE_AGENT, name: "Scout", status: "running" },
        ],
      });
      await page.goto("/");
      await page.getByTestId("channel-general").click();
      await expect(page.getByTestId("chat-title")).toHaveText("general");
      const dock = page.getByTestId("work-area-panel");

      await page
        .getByTestId("channel-view-tabs")
        .getByRole("button", { name: "Files", exact: true })
        .click();
      await expect(
        dock.getByRole("button", { name: /^DAY1_VIDEO_PACK\.md/ }),
      ).toBeVisible();
      await waitForAnimations(page);
      await page.screenshot({ path: `${OUT}/dock-list-${viewport.width}.png` });

      await page
        .getByTestId("channel-view-tabs")
        .getByRole("button", { name: "Canvas", exact: true })
        .click();
      await dock.getByTestId("channel-canvas-edit").click();
      await dock
        .getByTestId("channel-canvas-editor")
        .fill("# Launch plan\n\n- Brief the team\n- Review the designs");
      await waitForAnimations(page);
      await page.screenshot({
        path: `${OUT}/dock-canvas-${viewport.width}.png`,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}
