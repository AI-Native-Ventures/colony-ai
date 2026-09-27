import { expect, test } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";
import { expectUnreadBadgeCount } from "../helpers/unreadBadge";

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
  await expectUnreadBadgeCount(
    sidebar.getByTestId("channel-unread-olive-studio"),
    2,
  );
  await expect(sidebar.getByTestId("channel-unread-olive-studio")).toHaveCSS(
    "height",
    "17px",
  );
  await expectUnreadBadgeCount(sidebar.getByTestId("channel-unread-sales"), 3);
  await expectUnreadBadgeCount(
    sidebar.getByTestId("channel-unread-Company forum"),
    1,
  );
  await expectUnreadBadgeCount(sidebar.getByTestId("channel-unread-Aya"), 1);
  await expect(sidebar.getByTestId("channel-avatar-Mina")).toHaveCSS(
    "width",
    "18px",
  );
  await expect(sidebar.getByTestId("channel-presence-Mina")).toBeVisible();
  const minaRow = sidebar.getByTestId("channel-Mina");
  const [minaRowBounds, minaAvatarBounds, minaPresenceBounds] =
    await Promise.all([
      minaRow.boundingBox(),
      sidebar.getByTestId("channel-avatar-Mina").boundingBox(),
      sidebar.getByTestId("channel-presence-Mina").boundingBox(),
    ]);
  expect(minaRowBounds).not.toBeNull();
  expect(minaAvatarBounds).not.toBeNull();
  expect(minaPresenceBounds).not.toBeNull();
  expect(minaPresenceBounds?.x).toBeGreaterThan(
    (minaAvatarBounds?.x ?? 0) + (minaAvatarBounds?.width ?? 0),
  );
  expect(minaPresenceBounds?.x).toBeGreaterThanOrEqual(
    (minaRowBounds?.x ?? 0) + (minaRowBounds?.width ?? 0) - 30,
  );
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
