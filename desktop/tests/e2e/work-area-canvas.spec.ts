import { expect, test, type Page } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

// The channel Canvas, hosted as a dock tab: opened from the channel's Canvas
// label, same component as channel settings, and an unsaved edit survives the
// dock closing. (Saving against a real relay is in
// work-area-canvas.integration.spec.ts; the mock bridge has no canvas store.)

const dock = (page: Page) => page.getByTestId("work-area-panel");
const canvasLabel = (page: Page) =>
  page
    .getByTestId("channel-view-tabs")
    .getByRole("button", { name: "Canvas", exact: true });

async function boot(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await installMockBridge(page);
  await page.goto("/");
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");
}

test("the Canvas label opens the Canvas tab in the dock", async ({ page }) => {
  await boot(page);
  await expect(dock(page)).toHaveCount(0);
  await canvasLabel(page).click();
  await expect(
    dock(page).getByRole("tab", { name: "Canvas", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  const panel = dock(page).getByRole("tabpanel", { name: "Canvas" });
  await expect(panel).toBeVisible();
  // The mock channel has no canvas: the honest empty state, no invented text.
  await expect(panel.getByTestId("work-area-canvas")).toContainText(
    "No canvas set for this channel.",
  );
  // It is a real tab: Canvas can be added next to Files and closed again.
  await dock(page).getByRole("button", { name: "Close Canvas" }).click();
  await expect(dock(page)).toHaveCount(0);
});

test("an unsaved canvas edit survives closing and reopening the dock", async ({
  page,
}) => {
  await boot(page);
  await canvasLabel(page).click();
  await dock(page).getByTestId("channel-canvas-edit").click();
  const editor = dock(page).getByTestId("channel-canvas-editor");
  await editor.fill("# Launch plan\n\nDraft that must not be lost");

  await dock(page).getByRole("button", { name: "Close work area" }).click();
  await expect(dock(page)).toHaveCount(0);
  await page.getByTestId("channel-work-area-trigger").click();
  await expect(dock(page).getByTestId("channel-canvas-editor")).toHaveValue(
    "# Launch plan\n\nDraft that must not be lost",
  );

  // Switching to another channel and back keeps this channel's edit too.
  await page.getByTestId("channel-random").click();
  await expect(page.getByTestId("chat-title")).toHaveText("random");
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");
  await expect(dock(page).getByTestId("channel-canvas-editor")).toHaveValue(
    "# Launch plan\n\nDraft that must not be lost",
  );

  // Cancel really discards it.
  await dock(page).getByTestId("channel-canvas-cancel").click();
  await dock(page).getByRole("button", { name: "Close work area" }).click();
  await page.getByTestId("channel-work-area-trigger").click();
  await expect(dock(page).getByTestId("channel-canvas-editor")).toHaveCount(0);
});

test("the Canvas tab and the Files tab live side by side and keep their own state", async ({
  page,
}) => {
  await boot(page);
  await canvasLabel(page).click();
  await dock(page).getByTestId("channel-canvas-edit").click();
  await dock(page).getByTestId("channel-canvas-editor").fill("kept");
  await page.getByTestId("work-area-add-tab").click();
  await page.getByTestId("work-area-add-files").click();
  await expect(
    dock(page).getByRole("tab", { name: "Files", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await dock(page).getByRole("tab", { name: "Canvas", exact: true }).click();
  await expect(dock(page).getByTestId("channel-canvas-editor")).toHaveValue(
    "kept",
  );
});
