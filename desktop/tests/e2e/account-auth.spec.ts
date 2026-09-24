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

const BUSINESS_DOMAIN = "accounts-test.colony.ainative.ventures";
const MOCK_ACCOUNT_PUBKEY = "deadbeef".repeat(8);

async function startFirstRun(
  page: Page,
  communities: Array<{
    id: string;
    name: string;
    slug: string;
    normalized_host: string;
    owner_pubkey: string;
  }> = [],
) {
  await installMockBridge(
    page,
    { accountLinked: true },
    { skipCommunitySeed: true, skipOnboardingSeed: true },
  );
  await page.route("**/api/communities/config", (route) =>
    route.fulfill({
      json: {
        self_serve: true,
        domain: BUSINESS_DOMAIN,
        public: true,
        max_per_owner: 3,
      },
    }),
  );
  await page.route("**/api/communities/mine", (route) =>
    route.fulfill({
      json: { owner_pubkey: MOCK_ACCOUNT_PUBKEY, communities },
    }),
  );
  await page.route("**/api/communities/availability?**", async (route) => {
    const slug = new URL(route.request().url()).searchParams.get("name") ?? "";
    await route.fulfill({
      json: {
        name: slug,
        normalized_host: `${slug}.${BUSINESS_DOMAIN}`,
        available: true,
      },
    });
  });
  await page.route("**/api/communities", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    const body = JSON.parse(route.request().postData() ?? "{}") as {
      name?: string;
    };
    const slug = body.name ?? "";
    await route.fulfill({
      json: {
        community: {
          id: "c27e6bf6-9794-49e0-91f0-e398cb343013",
          name: slug,
          slug,
          normalized_host: `${slug}.${BUSINESS_DOMAIN}`,
          owner_pubkey: MOCK_ACCOUNT_PUBKEY,
        },
      },
    });
  });
  await page.goto("/");
  await expect(page.getByTestId("google-account-scene")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
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
  await expect(page.getByTestId("onboarding-scene-business")).toBeVisible();
  await page.getByLabel("Business name").fill("North Star");
  await page.getByLabel("Website").fill("northstar.example");
  await page.locator("#business-logo").setInputFiles({
    name: "north-star.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="8" fill="#6f56a8"/></svg>',
    ),
  });
  await page
    .getByLabel("What does your business do?")
    .fill("An independent design studio.");
  const continueButton = page.getByRole("button", { name: "Continue" });
  await expect(continueButton).toBeEnabled();
  await continueButton.click();
  await expect(page.getByTestId("onboarding-scene-connect")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        JSON.parse(
          window.localStorage.getItem(
            "colony-business-profile.v1:c27e6bf6-9794-49e0-91f0-e398cb343013",
          ) ?? "null",
        ),
      ),
    )
    .toMatchObject({ name: "North Star", website: "northstar.example" });
}

test("keyboard signup verifies email and installs the account identity", async ({
  page,
}) => {
  await startFirstRun(page);
  await expectNoKeyCopy(page);

  const createAccount = page.getByRole("button", {
    name: "Create an account",
  });
  await createAccount.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Create your account" }),
  ).toBeVisible();
  await expectNoKeyCopy(page);

  await page.getByLabel("Your name").fill("Lerato Molefe");
  await page.getByLabel("Email address").fill("signup@example.com");
  await page
    .getByRole("textbox", { name: "Password" })
    .fill("correct-horse-12");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();

  await expect(page.getByTestId("account-auth-screen-verify")).toBeVisible();
  await expectNoKeyCopy(page);
  await page.getByLabel("6-digit code").fill("123456");
  await page.getByTestId("account-auth-verify").click();

  await finishMachineSetup(page);
  const savedBusiness = await page.evaluate(() =>
    JSON.parse(
      window.localStorage.getItem(
        "colony-business-profile.v1:c27e6bf6-9794-49e0-91f0-e398cb343013",
      ) ?? "null",
    ),
  );
  expect(savedBusiness).toMatchObject({
    name: "North Star",
    website: "northstar.example",
    description: "An independent design studio.",
  });
  expect(savedBusiness.logoDataUrl).toMatch(/^data:image\/svg\+xml;base64,/);
  expect(savedBusiness.logoUrl).toBe(savedBusiness.logoDataUrl);
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
  await expect(page.getByRole("form", { name: "Sign in" })).toBeVisible();
  await expectNoKeyCopy(page);

  await page.getByLabel("Email address").fill("signin@example.com");
  await page
    .getByRole("textbox", { name: "Password" })
    .fill("correct-horse-12");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await finishMachineSetup(page);
  const calls = await accountAuthCalls(page);
  expect(calls.map(({ route }) => route)).toContain(
    "POST /api/accounts/signin",
  );
});

test("returning account can open an owned business", async ({ page }) => {
  const community = {
    id: "41cce33a-57f9-4d4c-bd2c-7c9c9d30d33b",
    name: "North Star",
    slug: "north-star",
    normalized_host: `north-star.${BUSINESS_DOMAIN}`,
    owner_pubkey: MOCK_ACCOUNT_PUBKEY,
  };
  await startFirstRun(page, [community]);
  await page.getByLabel("Email address").fill("returning@example.com");
  await page
    .getByRole("textbox", { name: "Password" })
    .fill("correct-horse-12");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();

  await expect(page.getByTestId("onboarding-scene-businesses")).toBeVisible();
  await expect(page.getByTestId("onboarding-business-list")).toContainText(
    community.name,
  );
  await page.getByTestId(`onboarding-business-${community.id}`).click();
  await expect(page.getByTestId("app-sidebar")).toBeVisible();
});

test("Google sign in uses the same account installation path", async ({
  page,
}) => {
  await startFirstRun(page);
  await expectNoKeyCopy(page);
  const continueWithGoogle = page.getByRole("button", {
    name: "Continue with Google",
  });
  await continueWithGoogle.focus();
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
  await page.getByRole("button", { name: "Forgot password?" }).click();
  await expect(
    page.getByTestId("account-auth-screen-reset-request"),
  ).toBeVisible();
  await expectNoKeyCopy(page);
  await page.getByLabel("Email address").fill("reset@example.com");
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(
    page.getByTestId("account-auth-screen-reset-confirm"),
  ).toBeVisible();
  await expectNoKeyCopy(page);
  await expect(
    page.getByRole("button", { name: "Resend code in 60s" }),
  ).toBeDisabled();
  await page.clock.fastForward(60_000);
  await page.getByRole("button", { name: "Resend code" }).click();
  await expect(
    page.getByRole("button", { name: "Resend code in 60s" }),
  ).toBeDisabled();
  await page.getByLabel("6-digit code").fill("123456");
  await page
    .getByLabel("New password (at least 10 characters)")
    .fill("new-correct-horse-12");
  await page.getByTestId("account-auth-reset-confirm").click();
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
  await page.getByRole("button", { name: "Create an account" }).click();
  await expectNoKeyCopy(page);
  await page.getByLabel("Your name").fill("Lerato Molefe");
  await page.getByLabel("Email address").fill("guard@example.com");
  await page
    .getByRole("textbox", { name: "Password" })
    .fill("correct-horse-12");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page.getByTestId("account-auth-screen-verify")).toBeVisible();
  await expectNoKeyCopy(page);
  await page.getByRole("button", { name: "Back" }).click();
  await page.getByRole("button", { name: "Sign in" }).click();
  await expectNoKeyCopy(page);
  await page.getByRole("button", { name: "Forgot password?" }).click();
  await expectNoKeyCopy(page);
  await page.getByLabel("Email address").fill("guard@example.com");
  await page.getByRole("button", { name: "Send reset link" }).click();
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
  await page.getByRole("button", { name: "Create an account" }).click();
  await page.getByLabel("Your name").fill("Erin Example");
  await page.getByLabel("Email address").fill("errors@example.com");
  await page.getByRole("textbox", { name: "Password" }).fill("long-enough-12");

  await queueAuthError(page, "signUp", { error: "invalid_request" });
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page.getByRole("alert")).toHaveText(
    "Please check the information and try again.",
  );

  await queueAuthError(page, "signUp", { error: "weak_password" });
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page.getByRole("alert")).toHaveText(
    "Use a password with at least 10 characters.",
  );

  await queueAuthError(page, "signUp", { error: "email_taken" });
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page.getByRole("alert")).toHaveText(
    "This email already has an account. Sign in instead.",
  );
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Password" })
    .fill("correct-horse-12");

  await queueAuthError(page, "signIn", { error: "invalid_credentials" });
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "The email or password was not accepted.",
  );

  await queueAuthError(page, "signIn", { error: "email_unverified" });
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByTestId("account-auth-screen-verify")).toBeVisible();
  await expect(page.getByRole("status")).toContainText(
    "Your email still needs verification.",
  );
  await expectNoKeyCopy(page);

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
  const rateLimitTime = await page.evaluate(() => Date.now() + 60_000);
  await page.clock.pauseAt(new Date(rateLimitTime));
  await queueAuthError(page, "resendCode", {
    error: "rate_limited",
    retry_after_secs: 2,
  });
  await page.getByRole("button", { name: "Resend code" }).click();
  await expect(page.getByRole("alert")).toContainText(
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

test("claim verification can be deferred without blocking the workspace", async ({
  page,
}) => {
  await installMockBridge(page, { accountLinked: false });
  await page.goto("/");
  await expect(page.getByTestId("app-sidebar")).toBeVisible();
  await page.getByTestId("account-claim-start").click();
  await expectNoKeyCopy(page);
  await page.getByLabel("Email").fill("later@example.com");
  await page
    .getByLabel("Password (at least 10 characters)")
    .fill("claim-password-12");
  await page.getByTestId("account-auth-submit-claim").click();
  await expect(page.getByTestId("account-auth-screen-verify")).toBeVisible();
  await expectNoKeyCopy(page);

  await page
    .getByTestId("account-auth-screen-verify")
    .getByRole("button", { name: "Later" })
    .click();
  await expect(page.getByTestId("account-claim-start")).toBeVisible();
  await expect(page.getByTestId("app-sidebar")).toBeVisible();
});
