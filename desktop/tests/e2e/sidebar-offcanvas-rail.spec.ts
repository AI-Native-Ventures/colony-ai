import { expect, test, type Page } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";
import { waitForAnimations } from "../helpers/animations";

const SHOTS = "test-results/sidebar-offcanvas-rail";
const THEME_STORAGE_KEY = "buzz-theme";
const RELAY_URL = "ws://localhost:3000";

const COMMUNITY_A = {
  id: "ws-a",
  name: "Alpha",
  relayUrl: RELAY_URL,
  addedAt: "2026-01-01T00:00:00.000Z",
};
const COMMUNITY_B = {
  id: "ws-b",
  name: "Bravo",
  relayUrl: "ws://localhost:3001",
  addedAt: "2026-01-02T00:00:00.000Z",
};

async function setup(page: Page, theme: string) {
  await page.setViewportSize({ width: 960, height: 540 });
  await page.addInitScript(
    ({ key, value }) => {
      window.localStorage.setItem(key, value);
    },
    { key: THEME_STORAGE_KEY, value: theme },
  );
  await installMockBridge(page, undefined, { skipCommunitySeed: true });
  await page.addInitScript(
    ({ list, active }) => {
      window.localStorage.setItem("buzz-communities", JSON.stringify(list));
      window.localStorage.setItem("buzz-active-community-id", active);
    },
    { list: [COMMUNITY_A, COMMUNITY_B], active: COMMUNITY_A.id },
  );
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("community-rail")).toBeVisible();
  await expect(page.getByTestId("app-sidebar")).toBeVisible();
}

/**
 * The app sidebar collapses to an icon rail. The community rail remains visible
 * and interactive in every theme while the workspace navigation is collapsed.
 */
for (const theme of ["buzz", "buzz-dark", "vesper"]) {
  test(`collapsed sidebar keeps the community rail usable in ${theme}`, async ({
    page,
  }) => {
    await setup(page, theme);
    await waitForAnimations(page);
    await page.screenshot({ path: `${SHOTS}/${theme}-expanded.png` });

    const communityRail = page.getByTestId("community-rail");
    const communityButton = page.getByTestId(
      `community-rail-button-${COMMUNITY_B.id}`,
    );
    const railBoxBeforeCollapse = await communityRail.boundingBox();
    expect(railBoxBeforeCollapse).not.toBeNull();

    await page.getByRole("button", { name: "Toggle Sidebar" }).click();
    await expect(
      page.locator('[data-state="collapsed"][data-collapsible="icon"]'),
    ).toHaveCount(1);

    await expect(page.getByTestId("community-rail")).toBeVisible();
    await expect(
      page.getByTestId(`community-rail-button-${COMMUNITY_B.id}`),
    ).toBeVisible();
    const railBoxAfterCollapse = await communityRail.boundingBox();
    expect(railBoxAfterCollapse).not.toBeNull();
    expect(railBoxAfterCollapse?.x).toBe(railBoxBeforeCollapse?.x);
    expect(railBoxAfterCollapse?.y).toBe(railBoxBeforeCollapse?.y);

    await communityButton.click();
    await expect(communityButton).toHaveAttribute("aria-current", "true");
    await waitForAnimations(page);
    await page.screenshot({ path: `${SHOTS}/${theme}-collapsed.png` });
  });
}
