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
  await page.getByRole("button", { name: "Create an account" }).click();
  await expect(page.getByTestId("onboarding-scene-account")).toBeVisible();
}

async function openSignIn(page: Page) {
  await startR17AccountAuth(page);
  await expect(page.getByTestId("onboarding-scene-signin")).toBeVisible();
}

async function expectAdvancedScreens(page: Page) {
  await expect(
    page.getByRole("button", { name: "Create a Colony sign-in" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Use a sign-in I already have" }),
  ).toBeVisible();
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

  await page.getByTestId("account-auth-back-from-advanced").click();
  await expect(page.getByTestId("onboarding-scene-account")).toBeVisible();
});

test("Create account offers Advanced sign-in options that open the advanced screens", async ({
  page,
}) => {
  await openCreateAccount(page);
  await expect(advancedEntry(page)).toBeVisible();

  await advancedEntry(page).click();
  await expectAdvancedScreens(page);
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
  await expect(page.getByTestId("onboarding-scene-account")).toBeVisible();
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

async function connectAiLater(page: Page) {
  await expect(
    page.getByRole("heading", { name: "Connect Colony to AI" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Set up later" }).click();
}

test("an existing key continues through AI setup to the community choice", async ({
  page,
}) => {
  await openAdvancedFromSignIn(page);
  await page
    .getByRole("button", { name: "Use a sign-in I already have" })
    .click();
  await page
    .getByTestId("nostr-import-nsec-input")
    .fill(
      nsecEncode(
        Uint8Array.from(Buffer.from(TEST_IDENTITIES.tyler.privateKey, "hex")),
      ),
    );
  await page.getByTestId("nostr-import-submit").click();

  await connectAiLater(page);
  await expect(
    page.getByRole("heading", { name: "Join or create a community" }),
  ).toBeVisible();
  await expect(page.getByTestId("community-choice-join")).toBeVisible();
  await expect(page.getByTestId("community-choice-create")).toBeVisible();
  await expect(page.getByTestId("community-choice-existing")).toBeVisible();
});

test("a new sign-in continues through backup and AI setup, then opens a new community", async ({
  page,
}) => {
  await openAdvancedFromSignIn(page);
  await page.getByRole("button", { name: "Create a Colony sign-in" }).click();
  await page.getByTestId("onboarding-create-private-key").click();
  await page.getByTestId("onboarding-next").click();

  await connectAiLater(page);
  await page.getByTestId("community-choice-create").click();
  await page.getByLabel("Community address").fill("north-star");
  await page.getByRole("button", { name: "Create community" }).click();
  await expect(page.getByTestId("app-sidebar")).toBeVisible();
});
