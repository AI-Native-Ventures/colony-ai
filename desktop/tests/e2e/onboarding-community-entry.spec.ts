import { expect, test } from "@playwright/test";
import {
  startR17AccountAuth,
  completeR17BusinessSetup,
} from "../helpers/onboarding";
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
  await expect(page.getByTestId("onboarding-display-name")).toHaveCount(0);
  await expect(page.getByTestId("onboarding-starter-team")).toHaveCount(0);
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

test("unfinished Welcome setup can be postponed without deleting the business or retry record", async ({
  page,
}) => {
  await openEntry(page, {
    createChannelErrors: ["Welcome could not be saved."],
  });
  await expect(
    page.getByRole("heading", { name: "Your Colony isn’t ready yet." }),
  ).toBeFocused();
  await expect(page.getByRole("button", { name: "Cancel test" })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "Open my Colony for now" }).click();
  await expect(page.getByTestId("app-sidebar")).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry setup" })).toBeVisible();
  expect(
    await page.evaluate(() =>
      localStorage.getItem("buzz-community-onboarding-transaction.v1"),
    ),
  ).toContain('"stage":"deferred"');
  await page.getByRole("button", { name: "Retry setup" }).click();
  await expect(page.getByRole("button", { name: "Retry setup" })).toHaveCount(
    0,
  );
  await expect(page.getByTestId("chat-title")).toContainText("Welcome");
});

test("membership denial retains invitation, identity and community recovery", async ({
  page,
}) => {
  await openEntry(page, {
    profileUpdateError: "restricted: not a relay member",
  });
  await expect(page.getByTestId("membership-denied")).toBeVisible();
  await expect(page.getByTestId("membership-denied-change-key")).toBeVisible();
  await expect(
    page.getByTestId("membership-denied-redeem-invite"),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Change community", exact: true })
    .click();
  await expect(page.getByTestId("community-onboarding-flow")).toBeVisible();
});

test("signup name reaches the kind:0 profile through the rendered first-run path", async ({
  page,
}) => {
  await startR17AccountAuth(page, {
    mock: { accountEmail: "signup@example.com", profileHasEvent: false },
  });
  await page.goto("/");
  await page.getByLabel("Your name").fill("Lerato Molefe");
  await page.getByLabel("Email address").fill("signup@example.com");
  await page
    .getByRole("textbox", { name: "Password" })
    .fill("correct-horse-12");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page.getByTestId("onboarding-scene-verify")).toBeVisible();
  for (let index = 1; index <= 6; index++)
    await page.getByLabel(`Digit ${index} of 6`).fill(String(index));
  await page.getByTestId("otp-continue").click();
  await expect(page.getByTestId("onboarding-scene-business")).toBeVisible();
  await completeR17BusinessSetup(page);
  await page.getByRole("button", { name: "Skip for now", exact: true }).click();
  await expect(page.getByTestId("app-sidebar")).toBeVisible();
  expect(
    await page.evaluate(() =>
      window.__BUZZ_E2E_INVOKE_MOCK_COMMAND__?.("get_profile", null),
    ),
  ).toMatchObject({ display_name: "Lerato Molefe" });
  expect(
    await page.evaluate(() =>
      localStorage.getItem("colony-signup-name.v1:signup@example.com"),
    ),
  ).toBe("Lerato Molefe");
  await expect(page.getByTestId("onboarding-display-name")).toHaveCount(0);
});
