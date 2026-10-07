import { expect, test, type Page } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";
import { installBrowserHostFake } from "./helpers/browserHostFake";

// Review screenshots for the Browser tab at the two reference viewports, to sit
// beside the frozen r15 `workspace/browser` scene. The page itself is a native
// Electron view that a plain browser does not render, so the screenshots draw a
// labelled stand-in over the page area; everything else (tabs, toolbar,
// notices, start and error states, status bar) is the real component.

const OUT =
  process.env.COLONY_BROWSER_SHOTS ?? "test-results/work-area-browser";

const dock = (page: Page) => page.getByTestId("work-area-panel");
const address = (page: Page) => page.getByTestId("browser-address");

async function standIn(page: Page, heading: string) {
  await page.evaluate((text) => {
    const fill = document.querySelector<HTMLElement>(
      ".colony-browser-slot-fill",
    );
    if (!fill) return;
    const rect = fill.getBoundingClientRect();
    const node = document.createElement("div");
    node.setAttribute("data-testid", "page-stand-in");
    node.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;background:#fbf8f1;color:#2d2a24;font-family:Georgia,serif;padding:40px;box-sizing:border-box;z-index:2147483000;pointer-events:none`;
    node.innerHTML = `<div style="font-size:12px;letter-spacing:.08em;opacity:.6">STAND-IN FOR THE NATIVE PAGE VIEW</div><h1 style="font-size:40px;margin:24px 0 8px;font-weight:400">${text}</h1><p style="max-width:520px;line-height:1.5;opacity:.75">The browser draws the real page here. In this screenshot a plain element fills the same box, because Playwright's browser has no Electron view to show.</p>`;
    document.body.appendChild(node);
  }, heading);
}

for (const viewport of [
  { width: 1728, height: 1117 },
  { width: 1440, height: 900 },
]) {
  test(`browser tab screenshots at ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await installBrowserHostFake(page, { contentSize: viewport });
    await installMockBridge(page);
    await page.goto("/");
    await page.getByTestId("channel-general").click();
    await expect(page.getByTestId("chat-title")).toHaveText("general");

    // Empty dock: Browser is offered first.
    await page.getByTestId("channel-work-area-trigger").click();
    await expect(page.getByTestId("work-area-empty")).toBeVisible();
    await waitForAnimations(page);
    await page.screenshot({
      path: `${OUT}/browser-empty-${viewport.width}.png`,
    });

    // Start page.
    await page.getByTestId("work-area-open-browser").click();
    await expect(page.getByTestId("browser-start")).toBeVisible();
    await waitForAnimations(page);
    await page.screenshot({
      path: `${OUT}/browser-start-${viewport.width}.png`,
    });

    // A loaded page, with a second tab and a finished download.
    await address(page).fill("olivehouse.test");
    await address(page).press("Enter");
    await expect(address(page)).toHaveValue("https://olivehouse.test/");
    await page.getByTestId("browser-new-tab").click();
    await address(page).fill("olivehouse.test/collection");
    await address(page).press("Enter");
    await expect(address(page)).toHaveValue(
      "https://olivehouse.test/collection",
    );
    await expect(page.getByTestId("browser-page-slot")).toBeVisible();
    await page.evaluate(() => {
      const tab = window.__browserFake?.tabs().at(-1);
      if (tab)
        window.__browserFake?.download(tab.id, "spring-brief.pdf", "completed");
    });
    await expect(page.getByTestId("browser-notice-download")).toBeVisible();
    await page.mouse.move(5, 5);
    await standIn(page, "the olive house");
    await waitForAnimations(page);
    await page.screenshot({
      path: `${OUT}/browser-page-${viewport.width}.png`,
    });

    // A page that cannot load.
    await page
      .locator("[data-testid=page-stand-in]")
      .evaluate((node) => node.remove());
    await page.getByTestId("browser-new-tab").click();
    await address(page).fill("unreachable.test");
    await address(page).press("Enter");
    await expect(page.getByTestId("browser-error")).toBeVisible();
    await waitForAnimations(page);
    await page.screenshot({
      path: `${OUT}/browser-error-${viewport.width}.png`,
    });

    // A refused address.
    await address(page).fill("file:///etc/passwd");
    await address(page).press("Enter");
    await expect(page.getByTestId("browser-address-error")).toBeVisible();
    await expect(dock(page)).toBeVisible();
    await waitForAnimations(page);
    await page.screenshot({
      path: `${OUT}/browser-refused-${viewport.width}.png`,
    });
  });
}
