import { hexToBytes } from "@noble/hashes/utils.js";
import { nsecEncode } from "nostr-tools/nip19";
import { waitForAnimations } from "../helpers/animations";
import { expect, test } from "@playwright/test";
import {
  startR17AccountAuth,
  completeR17BusinessSetup,
} from "../helpers/onboarding";
import { installMockBridge, TEST_IDENTITIES } from "../helpers/bridge";

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
  await expect(
    page.locator(
      '[data-testid^="community-profile-"], [data-testid^="community-team-intro-"], [data-testid="community-avatar-open"]',
    ),
  ).toHaveCount(0);
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

test("community membership recovery imports another identity and resumes entry", async ({
  page,
}) => {
  await openEntry(page, {
    profileUpdateError: "restricted: not a relay member",
  });
  await expect(page.getByTestId("membership-denied")).toBeVisible();
  await page.getByTestId("membership-denied-change-key").click();
  await page
    .getByTestId("membership-denied-nsec-input")
    .fill(nsecEncode(hexToBytes(TEST_IDENTITIES.alice.privateKey)));
  await page.getByTestId("membership-denied-import-key").click();
  await expect(page.getByTestId("app-sidebar")).toBeVisible();
  expect(
    await page.evaluate(() => window.__BUZZ_E2E_COMMANDS__ ?? []),
  ).toContain("import_identity");
  await expect(page.getByTestId("onboarding-display-name")).toHaveCount(0);
});

for (const viewport of [
  { width: 1728, height: 1117 },
  { width: 1440, height: 900 },
]) {
  test(`community setup recovery preserves the business at ${viewport.width}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await openEntry(page, {
      createChannelErrors: ["Welcome could not be saved."],
    });
    await expect(
      page.getByRole("heading", { name: "Your Colony isn’t ready yet." }),
    ).toBeFocused();
    await expect(
      page
        .getByRole("list", { name: "Setup progress" })
        .locator('[aria-current="step"]'),
    ).toHaveText("3Connect");
    await expect(page.getByRole("button", { name: "Cancel test" })).toHaveCount(
      0,
    );
    await waitForAnimations(page);
    await page.screenshot({
      path: `${process.env.COLONY_ONBOARDING_PROOF_DIR ?? "test-results/onboarding-design"}/runtime-community-error-${viewport.width}.png`,
    });
  });
}

test("community membership recovery claims a replacement invite and retains retry on failure", async ({
  page,
}) => {
  await openEntry(page, {
    profileUpdateError: "restricted: not a relay member",
  });
  await expect(page.getByTestId("membership-denied")).toBeVisible();
  await page.route("https://recovery.example/api/join-policy", (route) =>
    route.fulfill({ status: 404, body: "" }),
  );
  let claims = 0;
  await page.route("https://recovery.example/api/invites/claim", (route) => {
    claims++;
    return route.fulfill({ status: 400, json: { error: "invite_expired" } });
  });
  await page.getByTestId("membership-denied-redeem-invite").click();
  await page
    .getByTestId("invite-redeem-input")
    .fill("https://recovery.example/invite/fixture-code");
  await page.getByTestId("invite-redeem-submit").click();
  await expect(page.getByRole("alert")).toContainText(
    "This invite has expired. Ask your teammate to send you a new link.",
  );
  expect(claims).toBe(1);
  expect(
    await page.evaluate(() =>
      JSON.parse(
        localStorage.getItem("buzz-community-onboarding-transaction.v1") ??
          "null",
      ),
    ),
  ).toMatchObject({
    source: "membership-recovery",
    stage: "claiming",
    relayUrl: "wss://recovery.example",
    inviteCode: "fixture-code",
  });
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect.poll(() => claims).toBe(2);
  await expect(
    page.getByRole("button", { name: "Change community", exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("onboarding-display-name")).toHaveCount(0);
});
