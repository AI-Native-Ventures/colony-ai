import { expect, test } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";

// Review screenshots of the invited-person screens. Set
// COLONY_INVITE_SHOTS_DIR to capture; without it this spec is skipped.
const outDir = process.env.COLONY_INVITE_SHOTS_DIR;
const RELAY_HOST = "rosebank-studio-0caa3d30b084.colony.example";
const SIZES = [
  { width: 1728, height: 1117 },
  { width: 1440, height: 900 },
] as const;

test.skip(!outDir, "COLONY_INVITE_SHOTS_DIR not set");

for (const size of SIZES) {
  test(`invite screens at ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await installMockBridge(
      page,
      {
        accountLinked: true,
        pendingCommunityDeepLinks: [
          {
            id: "dl-join-1",
            kind: "join",
            relayUrl: `wss://${RELAY_HOST}`,
            code: "v2.abc",
          },
        ],
      },
      { skipCommunitySeed: true, skipOnboardingSeed: true },
    );
    await page.route(`https://${RELAY_HOST}/api/join-policy`, (route) =>
      route.fulfill({ json: {} }),
    );
    await page.goto("/");
    await expect(page.getByTestId("invite-brand")).toBeVisible();
    await waitForAnimations(page);
    await page.screenshot({
      path: `${outDir}/account-with-invite-${size.width}x${size.height}.png`,
    });

    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByLabel("Email address").fill("lerato@example.com");
    await page
      .getByRole("textbox", { name: "Password" })
      .fill("correct-horse-12");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByTestId("invite-join")).toBeEnabled();
    await waitForAnimations(page);
    await page.screenshot({
      path: `${outDir}/invite-${size.width}x${size.height}.png`,
    });
  });
}

test("have an invite link screens", async ({ page }) => {
  await page.setViewportSize(SIZES[0]);
  await installMockBridge(
    page,
    { accountLinked: true },
    { skipCommunitySeed: true, skipOnboardingSeed: true },
  );
  await page.goto("/");
  await expect(page.getByTestId("have-invite-link")).toBeVisible();
  await waitForAnimations(page);
  await page.screenshot({
    path: `${outDir}/account-have-invite-link-1728x1117.png`,
  });
  await page.getByTestId("have-invite-link").click();
  await expect(page.getByLabel("Invite link or code")).toBeFocused();
  await waitForAnimations(page);
  await page.screenshot({ path: `${outDir}/paste-invite-1728x1117.png` });
});
