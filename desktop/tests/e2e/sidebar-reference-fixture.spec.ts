import { expect, test, type Locator } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

async function expectUnreadCount(locator: Locator, count: number) {
  await expect(locator).toBeVisible();
  await expect(locator).toHaveText(
    `${count} unread notification${count === 1 ? "" : "s"}`,
  );
  expect(
    await locator.evaluate((element) =>
      element.firstChild?.textContent?.trim(),
    ),
  ).toBe(String(count));
}

test("company shell fixture supplies the approved sidebar rows", async ({
  page,
}) => {
  await installMockBridge(page, {
    referenceWorkspace: true,
    referenceSidebarShell: true,
  });
  await page.goto("/");

  const sidebar = page.getByTestId("app-sidebar");
  await expect(
    sidebar.getByText("olive-studio", { exact: true }),
  ).toBeVisible();
  await expect(sidebar.getByText("marketing", { exact: true })).toBeVisible();
  await expect(sidebar.getByText("sales", { exact: true })).toBeVisible();
  await expect(
    sidebar.getByText("Company forum", { exact: true }),
  ).toBeVisible();
  await expect(sidebar.getByText("Mina", { exact: true })).toBeVisible();
  await expect(sidebar.getByText("Aya", { exact: true })).toBeVisible();
  await expect(sidebar.getByText("Client work", { exact: true })).toHaveCount(
    0,
  );
  await expect(sidebar.getByText("Starred", { exact: true })).toHaveCount(0);
  await expectUnreadCount(
    sidebar.getByTestId("channel-unread-olive-studio"),
    2,
  );
  await expectUnreadCount(sidebar.getByTestId("channel-unread-sales"), 3);
  await expectUnreadCount(
    sidebar.getByTestId("channel-unread-Company forum"),
    1,
  );
  await expectUnreadCount(sidebar.getByTestId("channel-unread-Aya"), 1);
  await expect(page.getByTestId("sidebar-home-count")).toHaveCount(0);
  await expect(page.getByTestId("sidebar-profile-user-status")).toContainText(
    "Set a status",
  );

  const streamRows = await sidebar
    .getByTestId("stream-list")
    .locator("[data-channel-id]")
    .evaluateAll((rows) => rows.map((row) => row.getAttribute("data-testid")));
  expect(streamRows).toEqual([
    "channel-olive-studio",
    "channel-marketing",
    "channel-sales",
  ]);

  const dmRows = await sidebar
    .getByTestId("dm-list")
    .locator("[data-channel-id]")
    .evaluateAll((rows) => rows.map((row) => row.getAttribute("data-testid")));
  expect(dmRows).toEqual(["channel-Mina", "channel-Aya"]);
});
