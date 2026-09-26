import { expect, type Page, test } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge, TEST_IDENTITIES } from "../helpers/bridge";
import {
  completeR17BusinessSetup,
  openR17BusinessSetup,
  seedActiveIdentity,
  startR17AccountAuth,
} from "../helpers/onboarding";

const BLANK_TYLER_IDENTITY = {
  ...TEST_IDENTITIES.tyler,
  username: "",
};

const SHOT_DIR = "test-results/onboarding-docked-cta";
const COMMUNITY_ONBOARDING_TRANSACTION_STORAGE_KEY =
  "buzz-community-onboarding-transaction.v1";

test.use({ viewport: { width: 1280, height: 800 } });

async function expectSharedCardGeometry(page: Page, expectedWidth = 610) {
  const geometry = await page
    .getByTestId("onboarding-content-card")
    .evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const styles = window.getComputedStyle(element);
      return {
        borderRadius: styles.borderRadius,
        height: rect.height,
        paddingBottom: styles.paddingBottom,
        paddingLeft: styles.paddingLeft,
        paddingRight: styles.paddingRight,
        paddingTop: styles.paddingTop,
        width: rect.width,
      };
    });

  expect(geometry.width).toBeCloseTo(expectedWidth, 0);
  expect(geometry.height).toBeCloseTo(664, 0);
  expect(geometry.borderRadius).toBe("32px");
  expect(geometry.paddingTop).toBe("48px");
  expect(geometry.paddingRight).toBe("48px");
  expect(geometry.paddingBottom).toBe("48px");
  expect(geometry.paddingLeft).toBe("48px");
}

async function expectProfileFooterMatchesContentGutters(page: Page) {
  const geometry = await page.evaluate(() => {
    const input = document
      .querySelector<HTMLElement>("#onboarding-display-name")
      ?.getBoundingClientRect();
    const back = document
      .querySelector<HTMLElement>('[data-testid="onboarding-back"]')
      ?.getBoundingClientRect();
    const next = document
      .querySelector<HTMLElement>('[data-testid="onboarding-next"]')
      ?.getBoundingClientRect();
    if (!input || !back || !next) {
      throw new Error("Profile controls are missing");
    }
    return {
      backLeft: back.left,
      inputLeft: input.left,
      inputRight: input.right,
      nextRight: next.right,
    };
  });

  expect(geometry.backLeft).toBeCloseTo(geometry.inputLeft, 0);
  expect(geometry.nextRight).toBeCloseTo(geometry.inputRight, 0);
}

test("R17 signup and email verification screens fit the onboarding card", async ({
  page,
}) => {
  await startR17AccountAuth(page);
  await expect(page.getByTestId("google-account-scene")).toBeVisible();
  await waitForAnimations(page);
  await page.screenshot({ path: `${SHOT_DIR}/01-account-sign-in.png` });

  await page.getByRole("button", { name: "Create an account" }).click();
  await expect(
    page.getByRole("heading", { name: "Create your account" }),
  ).toBeVisible();
  await page.getByLabel("Your name").fill("Lerato Molefe");
  await page.getByLabel("Email address").fill("signup@example.com");
  await page
    .getByRole("textbox", { name: "Password" })
    .fill("correct-horse-12");
  await waitForAnimations(page);
  await page.screenshot({ path: `${SHOT_DIR}/02-account-create.png` });

  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page.getByTestId("account-auth-screen-verify")).toBeVisible();
  for (let index = 1; index <= 6; index += 1) {
    await expect(page.getByLabel("Digit " + index + " of 6")).toBeVisible();
  }
  await expect(page.getByTestId("otp-continue")).toBeDisabled();
  await expect(page.locator("body")).not.toContainText(/\bkey\b|nsec1/i);
  await waitForAnimations(page);
  await page.screenshot({ path: `${SHOT_DIR}/03-email-code.png` });
});

test("R17 password reset code stays in view at a short desktop height", async ({
  page,
}) => {
  await page.setViewportSize({ width: 900, height: 620 });
  await startR17AccountAuth(page);
  await page.getByRole("button", { name: "Forgot password?" }).click();
  await expect(
    page.getByTestId("account-auth-screen-reset-request"),
  ).toBeVisible();
  await page.getByLabel("Email address").fill("reset@example.com");
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(
    page.getByTestId("account-auth-screen-reset-confirm"),
  ).toBeVisible();
  const firstDigit = page.getByLabel("Digit 1 of 6");
  await expect(firstDigit).toBeVisible();
  const digitBox = await firstDigit.boundingBox();
  expect(digitBox).not.toBeNull();
  expect((digitBox?.y ?? 0) + (digitBox?.height ?? 0)).toBeLessThan(620);
  await expect(page.getByTestId("otp-continue")).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/\bkey\b|nsec1/i);
  await waitForAnimations(page);
  await page.screenshot({ path: `${SHOT_DIR}/04-reset-code-short.png` });
});

test("R17 business details lead into the designed provider connection screen", async ({
  page,
}) => {
  await openR17BusinessSetup(page);
  await expect(page.getByTestId("onboarding-scene-business")).toBeVisible();
  await waitForAnimations(page);
  await page.screenshot({ path: `${SHOT_DIR}/05-business-details.png` });

  await completeR17BusinessSetup(page);
  await expect(page.getByTestId("onboarding-scene-connect")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Connect your AI." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open my Colony" }),
  ).toBeEnabled();
  await expect(page.locator("body")).not.toContainText(/\bkey\b|nsec1/i);
  await waitForAnimations(page);
  await page.screenshot({ path: `${SHOT_DIR}/06-provider-connect.png` });
});

test("relay onboarding: profile and avatar docked CTAs", async ({ page }) => {
  await seedActiveIdentity(page, BLANK_TYLER_IDENTITY);
  await installMockBridge(page, undefined, { skipOnboardingSeed: true });
  await page.goto("/");

  await expect(page.getByTestId("onboarding-page-1")).toBeVisible();
  await expectSharedCardGeometry(page, 610);
  await expect(page.getByTestId("onboarding-back")).toBeVisible();
  await page.getByTestId("onboarding-display-name").fill("Ada Lovelace");
  await waitForAnimations(page);
  await expectProfileFooterMatchesContentGutters(page);
  await page.screenshot({ path: `${SHOT_DIR}/04-profile.png` });

  await page.getByTestId("onboarding-next").click();
  await expect(page.getByTestId("onboarding-page-avatar")).toBeVisible();
  await page
    .getByTestId("onboarding-avatar-url")
    .fill("https://example.com/onboarding-avatar.png");
  await waitForAnimations(page);
  await page.screenshot({ path: `${SHOT_DIR}/05-avatar.png` });
});

test("community onboarding: profile and starter-team cards", async ({
  page,
}) => {
  await seedActiveIdentity(page, BLANK_TYLER_IDENTITY);
  await page.addInitScript(
    ({ pubkey, transactionStorageKey }) => {
      window.localStorage.setItem(
        `buzz-machine-onboarding-complete.v2:${pubkey}`,
        "true",
      );
      const timestamp = new Date().toISOString();
      window.localStorage.setItem(
        transactionStorageKey,
        JSON.stringify({
          id: "screenshot-community-profile",
          source: "first-community",
          stage: "profile",
          relayUrl: "ws://localhost:3000",
          communityName: "Default",
          communityId: "e2e-default-community",
          addedCommunity: true,
          createdAt: timestamp,
          updatedAt: timestamp,
        }),
      );
    },
    {
      pubkey: BLANK_TYLER_IDENTITY.pubkey,
      transactionStorageKey: COMMUNITY_ONBOARDING_TRANSACTION_STORAGE_KEY,
    },
  );
  await installMockBridge(
    page,
    { profileHasEvent: false },
    {
      relayWsUrl: "ws://localhost:3000",
      skipOnboardingSeed: true,
    },
  );
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Build your profile" }),
  ).toBeVisible();
  await expect(page.getByTestId("onboarding-content-card")).toBeVisible();
  await expectSharedCardGeometry(page);
  await waitForAnimations(page);
  await page.screenshot({ path: `${SHOT_DIR}/06-community-profile.png` });

  await page.getByTestId("community-profile-name-key").fill("Ada Lovelace");
  await page.getByTestId("community-profile-next").click();
  await expect(
    page.getByRole("heading", { name: "Meet your starter team" }),
  ).toBeVisible();
  await expectSharedCardGeometry(page);
  await waitForAnimations(page);
  await page.screenshot({ path: `${SHOT_DIR}/07-starter-team.png` });
});
