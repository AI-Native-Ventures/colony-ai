import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";
import { openChannelWithThreads, summaryOf } from "../helpers/threadRoots";

// Six threads in view, one open: shows which one. Screenshots only, so the same
// spec can run against a build without the wash (CHAT_FEEL_SHOTS_DIR picks
// where the PNGs go).

const OUT = process.env.CHAT_FEEL_SHOTS_DIR ?? "test-results/thread-tint";

const CASES = [
  { name: "violet", accent: null, width: 1440, height: 900 },
  { name: "teal", accent: "#1F7A70", width: 1440, height: 900 },
  { name: "violet-1280", accent: null, width: 1280, height: 800 },
] as const;

for (const shot of CASES) {
  test(`six threads, one open: ${shot.name}`, async ({ page }) => {
    await page.setViewportSize({ width: shot.width, height: shot.height });
    if (shot.accent) {
      const accent = shot.accent;
      await page.addInitScript((value) => {
        window.localStorage.setItem("buzz-accent-color", value);
      }, accent);
    }
    await installMockBridge(page);
    const roots = await openChannelWithThreads(page);
    await summaryOf(page, roots[2].id).click();
    await expect(page.getByTestId("message-thread-panel")).toBeVisible();
    await waitForAnimations(page);
    // Bring the first of the six threads to the top so all of them show.
    await page
      .getByText("Launch topic number 1", { exact: true })
      .first()
      .evaluate((element) => {
        element.scrollIntoView({ block: "start" });
        element.closest("[data-testid='message-timeline']")?.scrollBy(0, -150);
      });
    // Park the pointer in an empty corner so no hover surface muddies the shot.
    await page.mouse.move(shot.width - 3, 3);
    await page.waitForTimeout(400);
    await mkdir(OUT, { recursive: true });
    await page.screenshot({ path: `${OUT}/open-thread-${shot.name}.png` });
  });
}
