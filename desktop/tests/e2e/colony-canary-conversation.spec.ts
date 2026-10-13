import { expect, test } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

test.beforeEach(async ({ page }) => {
  await installMockBridge(page);
});

test("conversation keeps real messages, ant agents, workspace and side threads", async ({
  page,
}) => {
  await page.goto("/#/channels/9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50");

  const header = page.getByTestId("colony-conversation-header");
  await expect(header.getByRole("heading", { name: "general" })).toBeVisible();
  await expect(header).toContainText("Company-wide updates");
  await expect(page.getByTestId("channel-view-tabs")).toHaveCount(0);
  await expect(
    page.getByTestId("channel-intro-action-create-agent"),
  ).toHaveCount(0);
  const agentRow = page
    .getByTestId("message-row")
    .filter({ hasText: "Hey team - checking in." });
  await expect(agentRow.locator('[data-ant-portrait="alice"]')).toBeVisible();

  await header.getByRole("button", { name: "Workspace" }).click();
  await expect(page.getByTestId("work-area-panel")).toBeVisible();
  await header.getByRole("button", { name: "Workspace" }).click();

  const root = page
    .getByTestId("message-row")
    .filter({ hasText: "Welcome to general" });
  await root.hover();
  await root.getByRole("button", { name: "Reply" }).click();
  await expect(page.getByTestId("message-thread-panel")).toBeVisible();
  await expect(page.getByTestId("message-thread-head")).toContainText(
    "Welcome to general",
  );
});

test("an empty conversation shows the approved quiet prompt", async ({
  page,
}) => {
  await page.goto("/#/channels/9dae0116-799b-5071-a0a8-fdd30a91a35d");
  await expect(page.getByTestId("colony-conversation-header")).toContainText(
    "random",
  );
  await expect(page.getByTestId("message-channel-intro")).toContainText(
    "What would you like to work on?",
  );
  await expect(
    page
      .getByTestId("message-channel-intro")
      .locator('[data-ant-portrait="Scout"]'),
  ).toBeVisible();
});
