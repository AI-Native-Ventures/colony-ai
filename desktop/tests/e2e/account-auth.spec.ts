import { expect, test, type Page } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

type AccountAuthMethod =
  | "signUp"
  | "verifyEmail"
  | "resendCode"
  | "signIn"
  | "signInWithGoogle"
  | "requestReset"
  | "confirmReset"
  | "claimAccount"
  | "changePassword"
  | "getAccount";

async function startFirstRun(page: Page) {
  await installMockBridge(
    page,
    { accountLinked: true },
    { skipCommunitySeed: true, skipOnboardingSeed: true },
  );
  await page.goto("/");
  await expect(page.getByTestId("account-auth-screen-choice")).toBeVisible();
}

async function queueAuthError(
  page: Page,
  method: AccountAuthMethod,
  error: Record<string, unknown>,
) {
  await page.evaluate(
    ({ method: nextMethod, error: nextError }) => {
      const queue = (
        window as Window & {
          __BUZZ_E2E_QUEUE_ACCOUNT_AUTH_ERROR__?: (
            method: AccountAuthMethod,
            error: Record<string, unknown>,
          ) => void;
        }
      ).__BUZZ_E2E_QUEUE_ACCOUNT_AUTH_ERROR__;
      if (!queue) throw new Error("Account API mock was not installed.");
      queue(nextMethod, nextError);
    },
    { method, error },
  );
}

async function accountAuthCalls(page: Page) {
  return page.evaluate(() => {
    return (
      (
        window as Window & {
          __BUZZ_E2E_ACCOUNT_AUTH_CALLS__?: Array<{
            method: AccountAuthMethod;
            route: string;
            email?: string;
            purpose?: "verify" | "reset";
          }>;
        }
      ).__BUZZ_E2E_ACCOUNT_AUTH_CALLS__ ?? []
    );
  });
}

async function expectNoKeyCopy(page: Page) {
  const visibleText = await page.locator("body").innerText();
  expect(visibleText).not.toMatch(/\bkey\b/i);
}

async function finishMachineSetup(page: Page) {
  await expect(page.getByTestId("onboarding-page-2")).toBeVisible();
  await page.getByTestId("onboarding-setup-skip").click();
  await expect(page.getByTestId("welcome-setup")).toBeVisible();
}

test("keyboard signup verifies email and installs the account identity", async ({
  page,
}) => {
  await startFirstRun(page);
  await expectNoKeyCopy(page);

  await page.keyboard.press("Tab");
  await expect(page.getByTestId("account-auth-create")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("account-auth-screen-signup")).toBeVisible();
  await expectNoKeyCopy(page);

  await page.keyboard.press("Tab");
  await page.keyboard.type("signup@example.com");
  await page.keyboard.press("Tab");
  await page.keyboard.type("correct-horse-12");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");

  await expect(page.getByTestId("account-auth-screen-verify")).toBeVisible();
  await expectNoKeyCopy(page);
  await page.keyboard.press("Tab");
  await page.keyboard.type("123456");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");

  await finishMachineSetup(page);
  const calls = await accountAuthCalls(page);
  expect(calls.map(({ route }) => route)).toContain(
    "POST /api/accounts/signup",
  );
  expect(calls.map(({ route }) => route)).toContain(
    "POST /api/accounts/verify",
  );
  expect(calls.find(({ method }) => method === "signUp")?.email).toBe(
    "signup@example.com",
  );
  await expect(page.getByTestId("account-claim-prompt")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("nsec1");
});

test("sign in reaches the workspace setup path", async ({ page }) => {
  await startFirstRun(page);
  await expectNoKeyCopy(page);
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("account-auth-screen-signin")).toBeVisible();
  await expectNoKeyCopy(page);

  await page.keyboard.press("Tab");
  await page.keyboard.type("signin@example.com");
  await page.keyboard.press("Tab");
  await page.keyboard.type("correct-horse-12");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await finishMachineSetup(page);
  const calls = await accountAuthCalls(page);
  expect(calls.map(({ route }) => route)).toContain(
    "POST /api/accounts/signin",
  );
});

test("Google sign in uses the same account installation path", async ({
  page,
}) => {
  await startFirstRun(page);
  await expectNoKeyCopy(page);
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await finishMachineSetup(page);
  const calls = await accountAuthCalls(page);
  expect(calls.map(({ route }) => route)).toContain(
    "POST /api/accounts/google",
  );
});

test("forgot password requests a code and signs in after reset", async ({
  page,
}) => {
  await page.clock.install();
  await startFirstRun(page);
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await expect(
    page.getByTestId("account-auth-screen-reset-request"),
  ).toBeVisible();
  await expectNoKeyCopy(page);
  await page.keyboard.press("Tab");
  await page.keyboard.type("reset@example.com");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await expect(
    page.getByTestId("account-auth-screen-reset-confirm"),
  ).toBeVisible();
  await expectNoKeyCopy(page);
  await expect(
    page.getByRole("button", { name: "Resend code in 60s" }),
  ).toBeDisabled();
  await page.clock.fastForward(60_000);
  await page.keyboard.press("Tab");
  await page.keyboard.type("123456");
  await page.keyboard.press("Tab");
  await page.keyboard.type("new-correct-horse-12");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("button", { name: "Resend code in 60s" }),
  ).toBeDisabled();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Enter");
  await finishMachineSetup(page);
  const calls = await accountAuthCalls(page);
  expect(calls.map(({ route }) => route)).toContain(
    "POST /api/accounts/reset/request",
  );
  expect(calls.map(({ route }) => route)).toContain(
    "POST /api/accounts/reset/confirm",
  );
  expect(calls.find(({ method }) => method === "resendCode")?.purpose).toBe(
    "reset",
  );
});

test("account auth screens never show key wording", async ({ page }) => {
  await startFirstRun(page);
  await expectNoKeyCopy(page);
  await page.getByTestId("account-auth-create").click();
  await expectNoKeyCopy(page);
  await page.getByRole("button", { name: "Back" }).click();
  await page.getByTestId("account-auth-signin").click();
  await expectNoKeyCopy(page);
  await page.getByRole("button", { name: "Forgot password?" }).click();
  await expectNoKeyCopy(page);
  await page.getByLabel("Email").fill("guard@example.com");
  await page.getByRole("button", { name: "Send reset code" }).click();
  await expect(
    page.getByTestId("account-auth-screen-reset-confirm"),
  ).toBeVisible();
  await expectNoKeyCopy(page);
});

test("contract errors are announced and email_unverified moves to verification", async ({
  page,
}) => {
  await page.clock.install();
  await startFirstRun(page);
  await page.getByTestId("account-auth-create").click();
  await page.getByLabel("Email").fill("errors@example.com");
  await page.getByLabel("Password (at least 10 characters)").fill("short");
  await expect(page.getByTestId("account-auth-password-issue")).toBeVisible();
  await expect(page.getByTestId("account-auth-submit-signup")).toBeDisabled();
  await page
    .getByLabel("Password (at least 10 characters)")
    .fill("long-enough-12");

  await queueAuthError(page, "signUp", { error: "invalid_request" });
  await page.getByTestId("account-auth-submit-signup").click();
  await expect(page.getByRole("alert")).toHaveText(
    "Please check the information and try again.",
  );

  await queueAuthError(page, "signUp", { error: "weak_password" });
  await page.getByTestId("account-auth-submit-signup").click();
  await expect(page.getByRole("alert")).toHaveText(
    "Use a password with at least 10 characters.",
  );

  await queueAuthError(page, "signUp", { error: "email_taken" });
  await page.getByTestId("account-auth-submit-signup").click();
  await expect(page.getByRole("alert")).toHaveText(
    "An account with this email already exists. Sign in instead.",
  );
  await page.getByRole("button", { name: "Go to sign in" }).click();
  await page.getByLabel("Password").fill("correct-horse-12");

  await queueAuthError(page, "signIn", { error: "invalid_credentials" });
  await page.getByTestId("account-auth-submit-signin").click();
  await expect(page.getByRole("alert")).toHaveText(
    "The email or password was not accepted.",
  );

  await queueAuthError(page, "signIn", { error: "email_unverified" });
  await page.getByTestId("account-auth-submit-signin").click();
  await expect(page.getByTestId("account-auth-screen-verify")).toBeVisible();
  await expect(page.getByRole("status")).toContainText(
    "Your email still needs verification.",
  );

  await page.getByLabel("6-digit code").fill("123456");
  await queueAuthError(page, "verifyEmail", { error: "invalid_credentials" });
  await page.getByRole("button", { name: "Verify email" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "That code was not accepted. Check it and try again.",
  );

  await queueAuthError(page, "verifyEmail", { error: "code_expired" });
  await page.getByRole("button", { name: "Verify email" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "This code has expired. Request a new one to continue.",
  );

  await page.clock.fastForward(60_000);
  await page.getByRole("button", { name: "Resend code" }).click();
  const calls = await accountAuthCalls(page);
  expect(calls.find(({ method }) => method === "resendCode")?.purpose).toBe(
    "verify",
  );
  await expect(
    page.getByRole("button", { name: "Resend code in 60s" }),
  ).toBeDisabled();
  await page.clock.fastForward(60_000);
  await queueAuthError(page, "resendCode", {
    error: "rate_limited",
    retry_after_secs: 2,
  });
  await page.getByRole("button", { name: "Resend code" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Too many attempts. Try again in 2 seconds.",
  );
  await expect(
    page.getByRole("button", { name: "Resend code in 2s" }),
  ).toBeDisabled();
});

test("the persistent claim prompt stays non-blocking when the relay is unavailable", async ({
  page,
}) => {
  await installMockBridge(page, { accountLinked: false });
  await page.goto("/");
  await expect(page.getByTestId("app-sidebar")).toBeVisible();
  await expect(page.getByTestId("account-claim-prompt")).toBeVisible();
  await expectNoKeyCopy(page);

  await page.getByTestId("account-claim-start").click();
  await page.getByLabel("Email").fill("claim@example.com");
  await page
    .getByLabel("Password (at least 10 characters)")
    .fill("claim-password-12");
  await queueAuthError(page, "claimAccount", { error: "Failed to fetch" });
  await page.getByTestId("account-auth-submit-claim").click();

  await expect(page.getByRole("alert")).toContainText(
    "Your workspace is still ready to use. Try again later.",
  );
  await expect(page.getByTestId("app-sidebar")).toBeVisible();

  await queueAuthError(page, "claimAccount", { error: "identity_taken" });
  await page.getByTestId("account-auth-submit-claim").click();
  await expect(page.getByRole("alert")).toHaveText(
    "This identity is already linked to an account. Sign in instead.",
  );
  await page.getByRole("button", { name: "Go to sign in" }).click();
  await expect(page.getByTestId("account-auth-screen-signin")).toBeVisible();
});

test("claim verification connects the existing identity and clears the prompt", async ({
  page,
}) => {
  await installMockBridge(page, { accountLinked: false });
  await page.goto("/");
  await expect(page.getByTestId("account-claim-prompt")).toBeVisible();
  await page.getByTestId("account-claim-start").focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await page.keyboard.type("claim@example.com");
  await page.keyboard.press("Tab");
  await page.keyboard.type("claim-password-12");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("account-auth-screen-verify")).toBeVisible();
  await page.keyboard.press("Tab");
  await page.keyboard.type("123456");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("account-claim-prompt")).toHaveCount(0);
  const calls = await accountAuthCalls(page);
  expect(calls.map(({ route }) => route)).toContain("POST /api/accounts/claim");
  expect(calls.map(({ route }) => route)).toContain(
    "POST /api/accounts/verify",
  );
});
