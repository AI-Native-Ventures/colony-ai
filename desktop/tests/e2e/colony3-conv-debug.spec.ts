import { test } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

for (const variant of ["current", "inside", "inside-hover-pad"]) {
  test(`reply click ${variant}`, async ({ page }) => {
    await installMockBridge(page, {});
    if (variant !== "current") {
      await page.addInitScript((v) => {
        window.addEventListener("DOMContentLoaded", () => {
          const style = document.createElement("style");
          style.textContent =
            v === "inside"
              ? '[data-testid^="message-action-bar-"]{}' +
                'article[data-testid="message-row"] > div:last-child{top:0 !important;transform:translateY(-50%)}'
              : 'article[data-testid="message-row"] > div:last-child{top:-8px !important}';
          document.head.appendChild(style);
        });
      }, variant);
    }
    await page.goto("/");
    await page.getByTestId("channel-general").click();
    const input = page
      .getByTestId("channel-composer-overlay")
      .getByTestId("message-input");
    await input.fill(`Debug ${variant}`);
    await input.press("Enter");
    const row = page
      .getByTestId("message-timeline")
      .getByTestId("message-row")
      .last();
    await row.hover();
    await row.getByRole("button", { name: "Reply" }).click({ force: true });
    await page.waitForTimeout(1500);
    console.log(
      "RESULT",
      variant,
      await page.getByTestId("message-thread-panel").count(),
    );
  });
}
