import { expect, test, type Page } from "@playwright/test";

import { installRelayBridge, openCreateChannelDialog } from "../helpers/bridge";
import { assertRelaySeeded } from "../helpers/seed";

// The dock's Canvas tab against a real relay: save, reload, read it back, edit
// again. Runs in the integration project only (it needs the seeded relay).

const isCi = Boolean(process.env.CI);

test.beforeAll(async () => {
  test.setTimeout(isCi ? 90_000 : 30_000);
  await assertRelaySeeded();
});

const dock = (page: Page) => page.getByTestId("work-area-panel");

async function createStream(page: Page, channelName: string) {
  await openCreateChannelDialog(page);
  await page.getByTestId("create-channel-name").fill(channelName);
  await page.getByTestId("create-channel-submit").click();
  await expect(page.getByTestId("stream-list")).toContainText(channelName);
  await expect(page.getByTestId("chat-title")).toHaveText(channelName);
}

test("canvas saved in the dock round-trips through the relay and survives a reload", async ({
  page,
}) => {
  test.setTimeout(isCi ? 120_000 : 60_000);
  const stamp = Date.now();
  const channelName = `work-area-canvas-${stamp}`;
  const first = `# Plan ${stamp}\n\n- first item`;
  const second = `# Plan ${stamp}\n\n- first item\n- second item`;

  // The channel's Canvas and Files labels are part of the workspace chrome,
  // which the app shows from 1440px wide (below that the dock's own "+" menu
  // and the Work area button are the way in).
  await page.setViewportSize({ width: 1440, height: 900 });
  await installRelayBridge(page, "tyler");
  await page.goto("/");
  await createStream(page, channelName);

  // The creator can edit: open the canvas from the channel's Canvas label.
  await page
    .getByTestId("channel-view-tabs")
    .getByRole("button", { name: "Canvas", exact: true })
    .click();
  await expect(
    dock(page).getByRole("tab", { name: "Canvas", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(dock(page).getByTestId("work-area-canvas")).toContainText(
    "No canvas set for this channel.",
  );

  await dock(page).getByTestId("channel-canvas-edit").click();
  await dock(page).getByTestId("channel-canvas-editor").fill(first);
  await dock(page).getByTestId("channel-canvas-save").click();
  // Saved: the preview renders the Markdown that came back, not the textarea.
  await expect(dock(page).getByTestId("channel-canvas-editor")).toHaveCount(0);
  const content = dock(page).getByTestId("channel-canvas-content");
  await expect(
    content.getByRole("heading", { name: `Plan ${stamp}` }),
  ).toBeVisible();
  await expect(content.getByText("first item")).toBeVisible();

  // A fresh page load reads it back from the relay.
  await page.reload();
  await page.getByTestId(`channel-${channelName}`).click();
  await expect(page.getByTestId("chat-title")).toHaveText(channelName);
  // The dock layout survived the reload too: Canvas tab open and selected.
  await expect(
    dock(page).getByRole("tab", { name: "Canvas", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  const reloaded = dock(page).getByTestId("channel-canvas-content");
  await expect(reloaded.getByText("first item")).toBeVisible();

  // Edit starts from the saved text, and the update round-trips as well.
  await dock(page).getByTestId("channel-canvas-edit").click();
  await expect(dock(page).getByTestId("channel-canvas-editor")).toHaveValue(
    first,
  );
  await dock(page).getByTestId("channel-canvas-editor").fill(second);
  await dock(page).getByTestId("channel-canvas-save").click();
  await expect(
    dock(page).getByTestId("channel-canvas-content").getByText("second item"),
  ).toBeVisible();
  await page.reload();
  await page.getByTestId(`channel-${channelName}`).click();
  await expect(
    dock(page).getByTestId("channel-canvas-content").getByText("second item"),
  ).toBeVisible();
});
