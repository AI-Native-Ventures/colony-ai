import { expect, test, type Page } from "@playwright/test";
import { nsecEncode } from "nostr-tools/nip19";

import { TEST_IDENTITIES } from "../helpers/bridge";
import { startR17AccountAuth } from "../helpers/onboarding";

const ENTRY_NAME = "Advanced sign-in options";

function advancedEntry(page: Page) {
  return page.getByRole("button", { name: ENTRY_NAME, exact: true });
}

async function openCreateAccount(page: Page) {
  await startR17AccountAuth(page);
  await page.getByRole("button", { name: "Create an account" }).first().click();
  await expect(page.getByTestId("onboarding-scene-account")).toBeVisible();
}

async function openSignIn(page: Page) {
  await startR17AccountAuth(page);
  await expect(page.getByTestId("onboarding-scene-signin")).toBeVisible();
}

// The designed advanced screen shows every way in on one page.
async function expectAdvancedScreens(page: Page) {
  await expect(
    page.getByRole("heading", { name: "Advanced sign-in options" }),
  ).toBeVisible();
  await expect(page.getByTestId("advanced-create")).toBeVisible();
  await expect(page.getByTestId("advanced-import")).toBeVisible();
}

async function tabTo(page: Page, target: ReturnType<typeof advancedEntry>) {
  await page.getByLabel("Email address").focus();
  for (let presses = 0; presses < 12; presses += 1) {
    if (await target.evaluate((node) => node === document.activeElement)) {
      return;
    }
    await page.keyboard.press("Tab");
  }
  await expect(target).toBeFocused();
}

test("Sign in offers Advanced sign-in options that open the advanced screens", async ({
  page,
}) => {
  await openSignIn(page);
  await expect(advancedEntry(page)).toBeVisible();

  await advancedEntry(page).click();
  await expectAdvancedScreens(page);

  // Back returns to the screen the person came from.
  await page.getByTestId("account-auth-back-from-advanced").click();
  await expect(page.getByTestId("onboarding-scene-signin")).toBeVisible();
});

test("Create account offers Advanced sign-in options that open the advanced screens", async ({
  page,
}) => {
  await openCreateAccount(page);
  await expect(advancedEntry(page)).toBeVisible();

  await advancedEntry(page).click();
  await expectAdvancedScreens(page);

  await page.getByTestId("account-auth-back-from-advanced").click();
  await expect(page.getByTestId("onboarding-scene-account")).toBeVisible();
});

test("the advanced entry is reachable and operable from the keyboard", async ({
  page,
}) => {
  await openSignIn(page);
  await tabTo(page, advancedEntry(page));
  // Keyboard focus must be visible, not just present.
  await expect(advancedEntry(page)).toHaveCSS("outline-style", "solid");
  await page.keyboard.press("Enter");
  await expectAdvancedScreens(page);

  await page.getByTestId("account-auth-back-from-advanced").click();
  await expect(page.getByTestId("onboarding-scene-signin")).toBeVisible();
  await tabTo(page, advancedEntry(page));
  await page.keyboard.press("Space");
  await expectAdvancedScreens(page);
});

for (const [screen, open] of [
  ["Sign in", openSignIn],
  ["Create account", openCreateAccount],
] as const) {
  test(`${screen} exposes the advanced entry as one named button`, async ({
    page,
  }) => {
    await open(page);
    // getByRole skips aria-hidden subtrees, so a match proves the entry is
    // exposed; the count proves there is exactly one such screen reader stop.
    await expect(advancedEntry(page)).toHaveCount(1);
    await expect(advancedEntry(page)).toBeEnabled();
    expect(
      await advancedEntry(page).evaluate(
        (node) => node.closest("[aria-hidden='true']") === null,
      ),
    ).toBe(true);
  });
}

async function openAdvancedFromSignIn(page: Page) {
  await openSignIn(page);
  await advancedEntry(page).click();
  await expectAdvancedScreens(page);
}

async function nameThenPhoto(page: Page) {
  // After an advanced sign-in the order is name and photo, business, connect.
  await expect(page.getByTestId("onboarding-page-1")).toBeVisible();
  await page.getByTestId("onboarding-display-name").fill("Lerato Molefe");
  await page.getByTestId("onboarding-next").click();
  await expect(page.getByTestId("onboarding-page-avatar")).toBeVisible();
  await page.getByTestId("onboarding-next").click();
}

test("an existing key continues to name and photo, then the business form", async ({
  page,
}) => {
  await openAdvancedFromSignIn(page);
  // The business list is read for the imported key, not the mock account's.
  await page.route("**/api/communities/mine", (route) =>
    route.fulfill({
      json: { owner_pubkey: TEST_IDENTITIES.tyler.pubkey, communities: [] },
    }),
  );
  await page.getByTestId("advanced-tab-key").click();
  await page
    .getByTestId("nostr-import-nsec-input")
    .fill(
      nsecEncode(
        Uint8Array.from(Buffer.from(TEST_IDENTITIES.tyler.privateKey, "hex")),
      ),
    );
  await page.getByTestId("nostr-import-submit").click();

  await nameThenPhoto(page);
  await expect(page.getByTestId("onboarding-scene-business")).toBeVisible();
});

test("a new sign-in continues to name and photo, business, then Connect", async ({
  page,
}) => {
  await openAdvancedFromSignIn(page);
  await page.getByTestId("advanced-create").click();

  await nameThenPhoto(page);
  await expect(page.getByTestId("onboarding-scene-business")).toBeVisible();
  await page.getByLabel("Business name").fill("North Star");
  await page
    .getByLabel("What does your business do?")
    .fill("An independent design studio.");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByTestId("onboarding-scene-connect")).toBeVisible();
});
