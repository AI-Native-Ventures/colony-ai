import { expect, test } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";
import { waitForAnimations } from "../helpers/animations";

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
  await expect(page.getByTestId("work-area-tab-shared")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByTestId("colony-shared-workspace")).toBeVisible();
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

test("conversation workspace indexes recent message media, files and links back to their thread", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/channels/9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50");
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
  const imageUrl = `https://relay.example/media/${"a".repeat(64)}.png`;
  const secondImageUrl = `https://relay.example/media/${"c".repeat(64)}.png`;
  const fileUrl = `https://relay.example/media/${"b".repeat(64)}.pdf`;
  await page.evaluate(
    ({ imageUrl, secondImageUrl, fileUrl }) => {
      window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
        channelName: "general",
        content: `Spring review: ![campaign image](${imageUrl}) ![detail](${secondImageUrl}) [brief](${fileUrl}) https://example.com/campaign`,
        createdAt: Math.floor(Date.now() / 1000),
        extraTags: [
          [
            "imeta",
            `url ${imageUrl}`,
            "m image/png",
            "filename spring-campaign.png",
          ],
          [
            "imeta",
            `url ${secondImageUrl}`,
            "m image/png",
            "filename spring-detail.png",
          ],
          [
            "imeta",
            `url ${fileUrl}`,
            "m application/pdf",
            "filename spring-brief.pdf",
          ],
        ],
      });
    },
    { imageUrl, secondImageUrl, fileUrl },
  );

  await page.getByTestId("channel-work-area-trigger").click();
  const workspace = page.getByTestId("colony-shared-workspace");
  await expect(workspace.getByTestId("colony-shared-media")).toContainText(
    "spring-campaign.png",
  );
  await workspace.getByRole("button", { name: "Next media" }).click();
  await expect(
    workspace.locator(".colony-canary-shared-carousel"),
  ).toContainText("2 of 2");
  if (process.env.COLONY_CANARY_WORKSPACE_SHOT) {
    await waitForAnimations(page);
    await page.screenshot({ path: process.env.COLONY_CANARY_WORKSPACE_SHOT });
  }
  await workspace.getByRole("tab", { name: "Files" }).click();
  await expect(workspace.getByTestId("colony-shared-file")).toContainText(
    "spring-brief.pdf",
  );
  await workspace.getByRole("tab", { name: "Links" }).click();
  await expect(workspace.getByTestId("colony-shared-link")).toContainText(
    "example.com",
  );
  await workspace
    .getByTestId("colony-shared-link")
    .getByRole("button", { name: "Discuss in thread" })
    .click();
  await expect(page.getByTestId("message-thread-panel")).toBeVisible();
  await expect(page.getByTestId("message-thread-head")).toContainText(
    "Spring review",
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

test("conversation workspace is usable as a narrow overlay and returns keyboard focus", async ({
  page,
}) => {
  await page.setViewportSize({ width: 700, height: 700 });
  await page.goto("/#/channels/9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50");
  const trigger = page.getByTestId("channel-work-area-trigger");
  await trigger.click();
  const panel = page.getByTestId("work-area-panel");
  await expect(panel).toBeVisible();
  await expect(page.getByTestId("work-area-layout")).toHaveAttribute(
    "data-overlay",
    "true",
  );
  await expect(
    panel.getByRole("tab", { name: "Workspace", exact: true }),
  ).toBeFocused();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(700);
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(trigger).toBeFocused();
});
