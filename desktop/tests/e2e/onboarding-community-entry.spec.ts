import { expect, test } from "@playwright/test";
import { installMockBridge } from "../helpers/bridge";

const pubkey = "deadbeef".repeat(8);
async function openEntry(
  page: Parameters<typeof installMockBridge>[0],
  mock = {},
) {
  await page.addInitScript(
    ({ pubkey }) => {
      const now = new Date().toISOString();
      localStorage.setItem(
        `buzz-machine-onboarding-complete.v2:${pubkey}`,
        "true",
      );
      localStorage.setItem(
        "colony-signup-name.v1:owner@example.com",
        "Amina Owner",
      );
      localStorage.setItem(
        "buzz-community-onboarding-transaction.v1",
        JSON.stringify({
          id: "approved-entry",
          source: "first-community",
          stage: "profile",
          relayUrl: "ws://localhost:3000",
          communityName: "Studio",
          communityId: "e2e-default-community",
          createdAt: now,
          updatedAt: now,
        }),
      );
    },
    { pubkey },
  );
  await installMockBridge(
    page,
    { accountEmail: "owner@example.com", profileHasEvent: false, ...mock },
    { skipOnboardingSeed: true },
  );
  await page.goto("/");
}
test("community entry publishes the account name and opens Welcome without legacy gates", async ({
  page,
}) => {
  await openEntry(page);
  await expect(page.getByTestId("app-sidebar")).toBeVisible();
  await expect(page).toHaveURL(/#\/channels\//);
  await expect(page.getByTestId("chat-title")).toContainText("Welcome");
  await expect(page.locator("body")).not.toContainText(
    /Build your profile|Meet your starter team|Take me to Buzz/,
  );
  const profile = await page.evaluate(() =>
    window.__BUZZ_E2E_INVOKE_MOCK_COMMAND__?.("get_profile", null),
  );
  expect(profile).toMatchObject({
    display_name: "Amina Owner",
  });
  await expect
    .poll(() =>
      page.evaluate(() =>
        localStorage.getItem("buzz-community-onboarding-transaction.v1"),
      ),
    )
    .toBeNull();
});
test("community entry failure retains setup and retries without another form", async ({
  page,
}) => {
  await openEntry(page, {
    createChannelErrors: ["Welcome could not be saved."],
  });
  await expect(page.getByRole("alert")).toContainText(
    "Welcome could not be saved.",
  );
  await expect(page.getByTestId("app-sidebar")).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() =>
        localStorage.getItem("buzz-community-onboarding-transaction.v1"),
      ),
    )
    .toContain("approved-entry");
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByTestId("app-sidebar")).toBeVisible();
});
test("an existing community profile is kept while Welcome is prepared", async ({
  page,
}) => {
  await openEntry(page, { profileHasEvent: true });
  await expect(page.getByTestId("app-sidebar")).toBeVisible();
  const commands = await page.evaluate(
    () => window.__BUZZ_E2E_COMMANDS__ ?? [],
  );
  expect(commands).not.toContain("update_profile");
  expect(commands).toContain("create_channel");
});
