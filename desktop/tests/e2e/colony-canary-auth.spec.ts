import { expect, test, type Page } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";
import { waitForAnimations } from "../helpers/animations";

const ACCOUNT_PUBKEY = "deadbeef".repeat(8);
const DEFAULT_POLICY = {
  terms_markdown: "Colony terms",
  privacy_markdown: "Colony privacy",
  age_attestation_required: false,
  version: "2026-10-13",
};

async function startFirstRun(
  page: Page,
  communities: Array<{
    id: string;
    name: string;
    slug: string;
    normalized_host: string;
    owner_pubkey: string;
  }> = [],
  joinPolicy: typeof DEFAULT_POLICY | null = DEFAULT_POLICY,
) {
  await installMockBridge(
    page,
    {
      accountLinked: true,
      legacyAccountFlow: false,
      joinPolicy,
    },
    { skipCommunitySeed: true, skipOnboardingSeed: true },
  );
  await page.route("**/api/communities/config", (route) =>
    route.fulfill({
      json: {
        self_serve: true,
        domain: "accounts-test.colony.ainative.ventures",
        public: true,
        max_per_owner: 3,
      },
    }),
  );
  await page.route("**/api/communities/mine", (route) =>
    route.fulfill({
      json: { owner_pubkey: ACCOUNT_PUBKEY, communities },
    }),
  );
  await page.goto("/");
  await expect(page.getByTestId("canary-auth-email")).toBeVisible();
}

async function calls(page: Page) {
  return page.evaluate(
    () =>
      (
        window as Window & {
          __BUZZ_E2E_ACCOUNT_AUTH_CALLS__?: Array<{
            method: string;
            route: string;
            email?: string;
            purpose?: string;
            termsVersion?: string;
          }>;
        }
      ).__BUZZ_E2E_ACCOUNT_AUTH_CALLS__ ?? [],
  );
}

test("the approved email-code first run reaches account identity without a password", async ({
  page,
}) => {
  await startFirstRun(page);
  await expect(
    page.getByRole("heading", { name: "Welcome and sign in" }),
  ).toBeVisible();
  await expect(page.getByLabel("Password")).toHaveCount(0);
  await expect(
    page.locator('.colony-canary-first-run-scout [data-ant-portrait="Scout"]'),
  ).toBeVisible();
  if (process.env.COLONY_CANARY_AUTH_EMAIL_SHOT) {
    await waitForAnimations(page);
    await page.screenshot({ path: process.env.COLONY_CANARY_AUTH_EMAIL_SHOT });
  }
  await page.getByLabel("Email address").fill(" owner@example.com ");
  await page.getByRole("button", { name: "Continue with email" }).click();
  await expect(page.getByTestId("canary-auth-code")).toBeVisible();
  await expect(
    page.getByText("owner@example.com", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Send a new code in/ }),
  ).toBeDisabled();
  await expect(page.getByLabel("6-digit code")).toBeFocused();
  await expect(page.getByText(/works for 15 minutes/)).toBeVisible();
  if (process.env.COLONY_CANARY_AUTH_CODE_SHOT) {
    await waitForAnimations(page);
    await page.screenshot({ path: process.env.COLONY_CANARY_AUTH_CODE_SHOT });
  }
  await page.setViewportSize({ width: 700, height: 700 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(700);
  await page.getByLabel("6-digit code").fill("123456");
  await expect(page.getByTestId("onboarding-scene-business")).toBeVisible();
  const authCalls = await calls(page);
  expect(authCalls.map((call) => call.route)).toContain(
    "POST /api/accounts/code/start",
  );
  expect(authCalls.map((call) => call.route)).toContain(
    "POST /api/accounts/code/verify",
  );
  expect(
    authCalls.some((call) => call.route === "POST /api/accounts/signup"),
  ).toBe(false);
  expect(
    authCalls.some((call) => call.route === "POST /api/accounts/signin"),
  ).toBe(false);
  expect(
    authCalls.find((call) => call.method === "verifyEmailSignIn")?.termsVersion,
  ).toBe("2026-10-13");
});

test("wrong code clears and refocuses entry; resend uses code start", async ({
  page,
}) => {
  await page.clock.install();
  await startFirstRun(page);
  await page.getByLabel("Email address").fill("owner@example.com");
  await page.getByRole("button", { name: "Continue with email" }).click();
  await expect(page.getByTestId("canary-auth-code")).toBeVisible();
  await page.evaluate(() => {
    const queue = (
      window as Window & {
        __BUZZ_E2E_QUEUE_ACCOUNT_AUTH_ERROR__?: (
          method: "verifyEmailSignIn",
          error: Record<string, unknown>,
        ) => void;
      }
    ).__BUZZ_E2E_QUEUE_ACCOUNT_AUTH_ERROR__;
    queue?.("verifyEmailSignIn", { error: "invalid_code", attempts_left: 4 });
  });
  await page.getByLabel("6-digit code").fill("111111");
  await expect(page.getByRole("alert")).toContainText("That code didn't work");
  await expect(page.getByLabel("6-digit code")).toHaveValue("");
  await expect(page.getByLabel("6-digit code")).toBeFocused();
  await page.clock.fastForward(31_000);
  await page
    .getByRole("button", { name: "Send a new code", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Check your email for a new code",
  );
  expect(await calls(page)).toContainEqual(
    expect.objectContaining({
      method: "startEmailSignIn",
      route: "POST /api/accounts/code/start",
    }),
  );
  await waitForAnimations(page);
  await expect(page.getByTestId("canary-auth-code")).toBeVisible();
});

test("a malformed email stays on the first screen without an account request", async ({
  page,
}) => {
  await startFirstRun(page);
  await page.getByLabel("Email address").fill("not-an-email");
  await page.getByRole("button", { name: "Continue with email" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "That email doesn't look right",
  );
  await expect(page.getByTestId("canary-auth-email")).toBeVisible();
  expect(
    (await calls(page)).some((call) => call.method === "startEmailSignIn"),
  ).toBe(false);
});

test("an age-required policy gates sign-in and records its exact revision", async ({
  page,
}) => {
  await startFirstRun(page, [], {
    ...DEFAULT_POLICY,
    age_attestation_required: true,
    version: "policy-revision-2",
  });
  const email = page.getByRole("button", { name: "Continue with email" });
  const google = page.getByRole("button", { name: "Continue with Google" });
  await expect(email).toBeDisabled();
  await expect(google).toBeDisabled();
  await page
    .getByRole("checkbox", { name: "I am at least 18 years old." })
    .check();
  await expect(google).toBeEnabled();
  await page.getByLabel("Email address").fill("owner@example.com");
  await email.click();
  await page.getByLabel("6-digit code").fill("123456");
  await expect(page.getByTestId("onboarding-scene-business")).toBeVisible();
  expect(
    (await calls(page)).find((call) => call.method === "verifyEmailSignIn")
      ?.termsVersion,
  ).toBe("policy-revision-2");
});

test("an unconfigured join policy keeps email sign-in available without dead policy links", async ({
  page,
}) => {
  await startFirstRun(page, [], null);
  await expect(
    page.getByRole("button", { name: "Terms", exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("Email address").fill("owner@example.com");
  await page.getByRole("button", { name: "Continue with email" }).click();
  await page.getByLabel("6-digit code").fill("123456");
  await expect(page.getByTestId("onboarding-scene-business")).toBeVisible();
});

test("returning email-code sign-in opens the owner's existing business", async ({
  page,
}) => {
  const community = {
    id: "c27e6bf6-9794-49e0-91f0-e398cb343013",
    name: "North Star",
    slug: "north-star",
    normalized_host: "north-star.accounts-test.colony.ainative.ventures",
    owner_pubkey: ACCOUNT_PUBKEY,
  };
  await startFirstRun(page, [community]);
  await page.getByLabel("Email address").fill("returning@example.com");
  await page.getByRole("button", { name: "Continue with email" }).click();
  await page.getByLabel("6-digit code").fill("123456");
  await expect(page.getByTestId("onboarding-scene-businesses")).toBeVisible();
  await expect(page.getByTestId("onboarding-business-list")).toContainText(
    "North Star",
  );
  await page.getByTestId(`onboarding-business-${community.id}`).click();
  await expect(page.getByTestId("app-sidebar")).toBeVisible();
});

test("email code keeps entered digits through a network failure", async ({
  page,
}) => {
  await startFirstRun(page);
  await page.getByLabel("Email address").fill("retry@example.com");
  await page.getByRole("button", { name: "Continue with email" }).click();
  await page.evaluate(() => {
    window.__BUZZ_E2E_QUEUE_ACCOUNT_AUTH_ERROR__?.("verifyEmailSignIn", {
      error: "Failed to fetch",
    });
  });
  await page.getByLabel("6-digit code").fill("123456");
  await expect(page.getByRole("alert")).toContainText("isn't answering");
  await expect(page.getByLabel("6-digit code")).toHaveValue("123456");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByTestId("onboarding-scene-business")).toBeVisible();
});

test("Google waits for its native result once", async ({ page }) => {
  await startFirstRun(page);
  await page.evaluate(() => {
    const client = window.__BUZZ_E2E_ACCOUNT_AUTH_CLIENT__;
    if (!client) throw new Error("Account mock unavailable");
    const original = client.signInWithGoogle.bind(client);
    client.signInWithGoogle = async () => {
      await new Promise<void>((resolve) => {
        (window as unknown as { releaseGoogle: () => void }).releaseGoogle =
          resolve;
      });
      return original();
    };
  });
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect(page.getByTestId("canary-auth-google")).toContainText(
    "Finish signing in in your browser",
  );
  await page.evaluate(() =>
    (window as unknown as { releaseGoogle: () => void }).releaseGoogle(),
  );
  await expect(page.getByTestId("onboarding-scene-business")).toBeVisible();
  expect(
    (await calls(page)).filter((call) => call.method === "signInWithGoogle"),
  ).toHaveLength(1);
});

test("cancelled Google sign-in returns to the email path", async ({ page }) => {
  await startFirstRun(page);
  await page.getByLabel("Email address").fill("owner@example.com");
  await page.evaluate(() => {
    window.__BUZZ_E2E_QUEUE_ACCOUNT_AUTH_ERROR__?.("signInWithGoogle", {
      code: "google_sign_in_cancelled",
    });
  });
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect(page.getByTestId("canary-auth-email")).toBeVisible();
  await expect(page.getByRole("alert")).toContainText(
    "You closed Google sign-in",
  );
  await expect(page.getByLabel("Email address")).toHaveValue(
    "owner@example.com",
  );
  await page.getByRole("button", { name: "Continue with email" }).click();
  await expect(page.getByTestId("canary-auth-code")).toBeVisible();
});
