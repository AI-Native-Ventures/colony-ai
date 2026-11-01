import { expect, test } from "@playwright/test";

import { installMockBridge, openNewMessagePage } from "../helpers/bridge";

const SCOUT_PUBKEY = "ab".repeat(32);

test("red proof: Cmd+K recent Scout row renders the managed ant picture", async ({
  page,
}) => {
  await installMockBridge(page, {
    managedAgents: [
      {
        channelNames: ["general"],
        name: "Scout",
        pubkey: SCOUT_PUBKEY,
        status: "stopped",
      },
    ],
  });
  await page.goto("/");
  await openNewMessagePage(page);

  await page.getByTestId("new-dm-search").fill("Scout");
  const scoutRecipient = page.getByTestId(`new-dm-result-${SCOUT_PUBKEY}`);
  await expect(scoutRecipient).toBeVisible();
  await scoutRecipient.click();
  await page
    .getByTestId("message-input")
    .fill("Scout recent activity avatar red proof");
  await page.getByTestId("send-message").click();
  await expect(page.getByTestId("chat-title")).toContainText("Scout");

  const scoutDmId = page.url().match(/#\/channels\/([^/?]+)/u)?.[1];
  expect(scoutDmId).toBeTruthy();
  await page.keyboard.press("ControlOrMeta+k");

  const recentScoutDm = page.getByTestId(`search-result-channel-${scoutDmId}`);
  await expect(recentScoutDm).toBeVisible();
  const antImage = recentScoutDm.locator("img");
  await expect(
    antImage,
    "Cmd+K recent Scout row should render its managed ant picture",
  ).toBeVisible();
  await expect(antImage).toHaveAttribute(
    "src",
    /^data:image\/svg\+xml;base64,/u,
  );
  const svg = await antImage.evaluate((element) => {
    const source = element.getAttribute("src") ?? "";
    const prefix = "data:image/svg+xml;base64,";
    return source.startsWith(prefix) ? atob(source.slice(prefix.length)) : "";
  });
  expect(svg).toContain('viewBox="-120 -145 240 235"');
});
