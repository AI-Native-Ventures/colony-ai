import { mkdirSync, writeFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge, TEST_IDENTITIES } from "../helpers/bridge";
import { COLONY3_NOW } from "../helpers/colony3Fixture";
import { r17Runtime, seedActiveIdentity } from "../helpers/onboarding";

/**
 * Colony 3.0 first-run proof. Captures the app at each first-run board's size
 * (1440x960) so `scripts/colony3-proof-report.mjs` can lay every capture next
 * to the design reference. Not a regression gate: it writes PNGs and checks
 * that each state can be reached.
 *
 * COLONY3_PROOF_DIR chooses where the captures land.
 */
const OUT =
  process.env.COLONY3_PROOF_DIR ?? "test-results/colony3-first-run-proof";
const DOMAIN = "colony.ainative.ventures";
const OWNER_PUBKEY = "deadbeef".repeat(8);

type Capture = { name: string; board: string; title: string };
const captures: Capture[] = [];

test.describe.configure({ mode: "serial", timeout: 120_000 });

test.beforeEach(async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.clock.setFixedTime(new Date(COLONY3_NOW));
});

test.afterAll(() => {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/captures.json`, JSON.stringify(captures, null, 2));
});

async function shot(page: Page, capture: Capture) {
  await waitForAnimations(page);
  await page.waitForTimeout(250);
  await page.screenshot({
    animations: "disabled",
    path: `${OUT}/${capture.name}.png`,
  });
  captures.push(capture);
}

type Business = {
  id: string;
  name: string;
  slug: string;
  normalized_host: string;
  owner_pubkey: string;
};

const LERATO: Business = {
  id: "c27e6bf6-9794-49e0-91f0-e398cb343013",
  name: "Lerato Social",
  slug: "lerato-social",
  normalized_host: `lerato-social.${DOMAIN}`,
  owner_pubkey: OWNER_PUBKEY,
};

/** First run with an account: the sign-up screen, with the business routes mocked. */
async function openFirstRun(
  page: Page,
  options: {
    businesses?: Business[];
    mock?: Partial<NonNullable<Parameters<typeof installMockBridge>[1]>>;
  } = {},
) {
  await installMockBridge(
    page,
    { ...options.mock, accountLinked: true },
    { skipCommunitySeed: true, skipOnboardingSeed: true },
  );
  await page.route("**/api/communities/config", (route) =>
    route.fulfill({
      json: {
        self_serve: true,
        domain: DOMAIN,
        public: true,
        max_per_owner: 3,
      },
    }),
  );
  await page.route("**/api/communities/mine", (route) =>
    route.fulfill({
      json: {
        owner_pubkey: OWNER_PUBKEY,
        communities: options.businesses ?? [],
      },
    }),
  );
  await page.route("**/api/communities/availability?**", async (route) => {
    const slug = new URL(route.request().url()).searchParams.get("name") ?? "";
    await route.fulfill({
      json: {
        name: slug,
        normalized_host: `${slug}.${DOMAIN}`,
        available: true,
      },
    });
  });
  await page.route("**/api/communities", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    const slug =
      (JSON.parse(route.request().postData() ?? "{}") as { name?: string })
        .name ?? "";
    await route.fulfill({
      json: {
        community: {
          id: LERATO.id,
          name: slug,
          slug,
          normalized_host: `${slug}.${DOMAIN}`,
          owner_pubkey: OWNER_PUBKEY,
        },
      },
    });
  });
  await page.goto("/");
  await expect(page.getByTestId("onboarding-scene-account")).toBeVisible();
}

async function signIn(page: Page) {
  await page
    .getByRole("button", { name: "Sign in", exact: true })
    .first()
    .click();
  await expect(page.getByTestId("onboarding-scene-signin")).toBeVisible();
  await page.getByLabel("Email address").fill("lerato@example.com");
  await page.locator("#signin-password").fill("studio-afternoons");
  await page.getByTestId("account-auth-submit-signin").click();
}

test("account and sign-in", async ({ page }) => {
  await openFirstRun(page);
  await page.getByLabel("Your name").fill("Lerato Molefe");
  await page.getByLabel("Your name").focus();
  await shot(page, {
    name: "01-account",
    board: "OnboardingAccount",
    title: "Create your account",
  });
  await page
    .getByRole("button", { name: "Sign in", exact: true })
    .first()
    .click();
  await page.getByLabel("Email address").fill("lerato@example.com");
  await page.locator("#signin-password").fill("studio-afternoons");
  await page.locator("#signin-password").focus();
  await shot(page, { name: "02-signin", board: "SignIn", title: "Sign in" });
});

test("verify and reset", async ({ page }) => {
  await openFirstRun(page);
  await page.getByLabel("Your name").fill("Lerato Molefe");
  await page.getByLabel("Email address").fill("lerato@example.com");
  await page.locator("#account-password").fill("studio-afternoons");
  await page.getByTestId("account-auth-submit-signup").click();
  await expect(page.getByTestId("onboarding-scene-verify")).toBeVisible();
  for (const [index, digit] of ["4", "8", "2"].entries())
    await page.getByLabel(`Digit ${index + 1} of 6`).fill(digit);
  await page.getByLabel("Digit 4 of 6").focus();
  await shot(page, {
    name: "03-verify",
    board: "OnboardingVerify",
    title: "Check your email",
  });
  // Reset password: request a code, enter it, then choose a new password.
  await page.goto("/");
  await expect(page.getByTestId("onboarding-scene-account")).toBeVisible();
  await page
    .getByRole("button", { name: "Sign in", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "Forgot password?" }).click();
  await page.getByLabel("Email address").fill("lerato@example.com");
  await page.getByRole("button", { name: /^Send (reset )?code$/ }).click();
  await expect(page.getByTestId("onboarding-scene-email-sent")).toBeVisible();
  await page.getByLabel("Digit 1 of 6").evaluate((element, value) => {
    const clipboard = new DataTransfer();
    clipboard.setData("text/plain", value);
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: clipboard,
      }),
    );
  }, "719042");
  await page.getByTestId("otp-continue").click();
  await expect(page.getByTestId("onboarding-scene-new-password")).toBeVisible();
  await page.locator("#otp-password").fill("olive-house-spring");
  await page.locator("#otp-confirm").fill("olive-house-spri");
  await page.locator("#otp-confirm").focus();
  await shot(page, {
    name: "04-reset-password",
    board: "ResetPassword",
    title: "Reset password",
  });
});

test("business, connect, hello, connected", async ({ page }) => {
  const claude = r17Runtime("claude", "available", { status: "logged_in" });
  const codex = r17Runtime("codex", "not_installed", { status: "unknown" });
  await openFirstRun(page, {
    mock: {
      acpRuntimesCatalog: [claude, codex],
      aiSubscriptions: [
        {
          id: "claude",
          signedIn: true,
          source: "live",
          plan: "Max",
          windows: [{ label: "Weekly", remainingPercent: 70, resetsAt: null }],
        },
      ],
      onboardingConnectionDelayMs: 600_000,
      onboardingConnectionResult: {
        reply: "Hi Lerato! I’m here and ready when you are.",
        startupMs: 80,
        totalMs: 400,
      },
    },
  });
  await signIn(page);
  await expect(page.getByTestId("onboarding-scene-business")).toBeVisible();
  await page.getByLabel("Business name").fill("Lerato Social");
  await page
    .getByLabel("What does your business do?")
    .fill(
      "We run social media for independent shops, mostly around Johannesburg.",
    );
  await page.getByLabel("What does your business do?").focus();
  await shot(page, {
    name: "05-business",
    board: "OnboardingBusiness",
    title: "What are you building?",
  });
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByTestId("onboarding-scene-connect")).toBeVisible();
  await expect(
    page.getByTestId("onboarding-connect-runtime-claude"),
  ).toBeVisible();
  await shot(page, {
    name: "06-connect",
    board: "OnboardingConnect",
    title: "Connect your AI",
  });
  await page.getByTestId("onboarding-test-connection").click();
  await expect(page.getByTestId("onboarding-testing")).toBeVisible();
  await shot(page, {
    name: "07-testing",
    board: "OnboardingTesting",
    title: "A first hello",
  });
});

test("connected and no reply", async ({ page }) => {
  const claude = r17Runtime("claude", "available", { status: "logged_in" });
  await openFirstRun(page, {
    mock: {
      acpRuntimesCatalog: [claude],
      discoverAgentModels: {
        supportsSwitching: true,
        models: [{ id: "claude-sonnet", name: "Claude Sonnet" }],
      },
      onboardingConnectionResult: {
        reply: "Hi Lerato! I’m here and ready when you are.",
        model: "claude-sonnet",
        startupMs: 80,
        totalMs: 400,
      },
    },
  });
  await signIn(page);
  await page.getByLabel("Business name").fill("Lerato Social");
  await page
    .getByLabel("What does your business do?")
    .fill("We run social media for independent shops.");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    page.getByTestId("onboarding-connect-runtime-claude"),
  ).toBeVisible();
  await page.getByTestId("onboarding-test-connection").click();
  await expect(
    page.getByRole("heading", { name: "That’s a good start." }),
  ).toBeVisible();
  await shot(page, {
    name: "08-connected",
    board: "OnboardingConnected",
    title: "That’s a good start",
  });
});

test("returning user", async ({ page }) => {
  await openFirstRun(page, { businesses: [LERATO] });
  await signIn(page);
  await expect(page.getByTestId("onboarding-business-list")).toBeVisible();
  await shot(page, {
    name: "09-returning-user",
    board: "ReturningUser",
    title: "Where shall we go?",
  });
});

test("advanced sign-in and profile", async ({ page }) => {
  await openFirstRun(page);
  await page.getByTestId("account-auth-advanced").click();
  await expect(page.getByTestId("machine-onboarding-gate")).toBeVisible();
  await page.getByTestId("advanced-tab-file").click();
  await shot(page, {
    name: "10-advanced-sign-in",
    board: "AdvancedSignIn",
    title: "Advanced sign-in",
  });
  await page.getByTestId("advanced-create").click();
  await expect(page.getByTestId("onboarding-page-1")).toBeVisible();
  await page.getByTestId("onboarding-display-name").fill("Lerato Molefe");
  await shot(page, {
    name: "11-profile-name",
    board: "OnboardingProfile",
    title: "Your name and photo, step 1",
  });
  await page.getByTestId("onboarding-next").click();
  await expect(page.getByTestId("onboarding-page-avatar")).toBeVisible();
  await shot(page, {
    name: "12-profile-photo",
    board: "OnboardingProfile",
    title: "Your name and photo, step 2",
  });
});

test("fixture scenes: ready, invite, startup", async ({ page }) => {
  const visual = (scene: string) =>
    page.goto(`/tests/visual/onboarding.html?scene=${scene}`);
  await visual("community-entry");
  await expect(
    page.getByTestId("onboarding-scene-community-entry"),
  ).toBeVisible();
  await shot(page, {
    name: "13-ready",
    board: "OnboardingReady",
    title: "Getting your Colony ready",
  });
  await visual("invite");
  await expect(page.getByTestId("onboarding-scene-invite")).toBeVisible();
  await shot(page, {
    name: "14-invite",
    board: "OnboardingInvite",
    title: "You’re invited",
  });
  await page.goto("/tests/visual/onboarding.html?reskin=native-unavailable");
  await expect(page.getByTestId("startup-problem")).toBeVisible();
  await shot(page, {
    name: "15-startup-errors",
    board: "StartupErrors",
    title: "Startup problems",
  });
});

test("community start and add", async ({ page }) => {
  await seedActiveIdentity(page, TEST_IDENTITIES.tyler);
  await page.addInitScript((pubkey) => {
    window.localStorage.setItem(
      `buzz-machine-onboarding-complete.v2:${pubkey}`,
      "true",
    );
  }, TEST_IDENTITIES.tyler.pubkey);
  await installMockBridge(
    page,
    {},
    {
      relayWsUrl: "ws://localhost:3000",
      skipOnboardingSeed: true,
      skipCommunitySeed: true,
    },
  );
  await page.route("**/api/communities/config", (route) =>
    route.fulfill({
      json: {
        self_serve: true,
        domain: DOMAIN,
        public: true,
        max_per_owner: 3,
      },
    }),
  );
  await page.route("**/api/communities/mine", (route) =>
    route.fulfill({
      json: {
        owner_pubkey: TEST_IDENTITIES.tyler.pubkey,
        communities: [
          { ...LERATO, owner_pubkey: TEST_IDENTITIES.tyler.pubkey },
        ],
      },
    }),
  );
  await page.route("**/api/communities/availability?**", (route) =>
    route.fulfill({
      json: {
        name: "lerato-social",
        normalized_host: `lerato-social.${DOMAIN}`,
        available: true,
      },
    }),
  );
  await page.goto("/");
  await expect(page.getByTestId("welcome-setup")).toBeVisible();
  await expect(
    page.getByTestId(`welcome-owned-business-${LERATO.id}`),
  ).toBeVisible();
  await shot(page, {
    name: "16-community-start",
    board: "CommunityStart",
    title: "Join or create a community",
  });
  await page.getByTestId("community-choice-create").click();
  await expect(page.getByTestId("self-serve-community-create")).toBeVisible();
  await page.getByTestId("self-serve-community-name").fill("lerato-social");
  await expect(
    page.getByTestId("self-serve-community-availability"),
  ).toHaveText("That address is available.");
  await shot(page, {
    name: "17-community-add",
    board: "CommunityAdd",
    title: "Add a community",
  });
});

test("community failed and edit", async ({ page }) => {
  const colony = {
    id: "colony3-lerato",
    name: "Lerato Social",
    relayUrl: `wss://lerato-social.${DOMAIN}`,
    addedAt: "2026-01-01T00:00:00.000Z",
  };
  await page.addInitScript(
    (list) => {
      window.localStorage.setItem("buzz-communities", JSON.stringify(list));
      window.localStorage.setItem("buzz-active-community-id", list[0].id);
    },
    [colony],
  );
  await installMockBridge(
    page,
    {
      applyCommunityErrorByRelayUrl: {
        [colony.relayUrl]: "relay unreachable: connection refused",
      },
    },
    { skipCommunitySeed: true },
  );
  await page.goto("/");
  await expect(page.getByTestId("community-apply-error")).toBeVisible();
  await shot(page, {
    name: "18-community-failed",
    board: "CommunityFailed",
    title: "Community connection failed",
  });
  await page.getByTestId("community-apply-error-edit").click();
  await expect(
    page.getByRole("heading", { name: "Change community" }),
  ).toBeVisible();
  await shot(page, {
    name: "19-community-edit",
    board: "CommunityEdit",
    title: "Edit community",
  });
});
