import { expect, test } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

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
  await expect(page.getByTestId("sidebar-profile-user-status")).toContainText(
    "Set a status",
  );
});
