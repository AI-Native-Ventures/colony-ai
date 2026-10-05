import { expect, type Page, test } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

// People invited to a workspace join it without creating a business: the
// invite is held durably, shown on the account screens, confirmed in the
// invite scene, then claimed. Joining never touches the create-community
// endpoint, and a failed claim never leaves a trap behind.

const RELAY_HOST = "rosebank-studio-0caa3d30b084.colony.example";
const RELAY_WS = `wss://${RELAY_HOST}`;
const INVITE_LINK = `https://${RELAY_HOST}/invite/v2.abc`;
const TRANSACTION_KEY = "buzz-community-onboarding-transaction.v1";
const BUSINESS_DOMAIN = "accounts-test.colony.ainative.ventures";
const MOCK_ACCOUNT_PUBKEY = "deadbeef".repeat(8);
const JOIN_LINK = {
  id: "dl-join-1",
  kind: "join" as const,
  relayUrl: RELAY_WS,
  code: "v2.abc",
};

type FirstRunOptions = {
  claim?: "ok" | "invalid" | "expired" | "offline-then-ok";
  policy?: boolean;
  deepLink?: boolean;
  /** Keep the seeded community: the person already has a workspace. */
  existingUser?: boolean;
};

async function installInviteRoutes(page: Page, options: FirstRunOptions) {
  const counts = { creates: 0, claims: 0, accepts: 0 };
  const claimBodies: Array<{ code?: string; policy_receipt?: string }> = [];
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
      json: { owner_pubkey: MOCK_ACCOUNT_PUBKEY, communities: [] },
    }),
  );
  await page.route("**/api/communities", async (route) => {
    if (route.request().method() === "POST") {
      counts.creates++;
      await route.fulfill({ status: 429, json: { error: "rate_limited" } });
      return;
    }
    await route.continue();
  });
  await page.route(`https://${RELAY_HOST}/api/join-policy`, (route) =>
    route.fulfill({
      json: options.policy
        ? {
            policy: {
              terms_markdown: "# Terms",
              privacy_markdown: "# Privacy",
              age_attestation_required: false,
              version: "v1",
            },
          }
        : {},
    }),
  );
  await page.route(
    `https://${RELAY_HOST}/api/invites/accept-policy`,
    (route) => {
      counts.accepts++;
      return route.fulfill({ json: { receipt: "receipt-1" } });
    },
  );
  await page.route(`https://${RELAY_HOST}/api/invites/claim`, (route) => {
    counts.claims++;
    claimBodies.push(JSON.parse(route.request().postData() ?? "{}"));
    if (options.claim === "invalid") {
      return route.fulfill({ status: 403, json: { error: "invite_invalid" } });
    }
    if (options.claim === "expired") {
      return route.fulfill({ status: 403, json: { error: "invite_expired" } });
    }
    if (options.claim === "offline-then-ok" && counts.claims === 1) {
      return route.abort("connectionrefused");
    }
    return route.fulfill({
      json: {
        status: "joined",
        community_id: "community-1",
        host: RELAY_HOST,
        role: "member",
      },
    });
  });
  return { counts, claimBodies };
}

async function startFirstRun(page: Page, options: FirstRunOptions = {}) {
  await installMockBridge(
    page,
    {
      accountLinked: true,
      pendingCommunityDeepLinks: options.deepLink ? [JOIN_LINK] : [],
    },
    options.existingUser
      ? {}
      : { skipCommunitySeed: true, skipOnboardingSeed: true },
  );
  const recorded = await installInviteRoutes(page, options);
  await page.goto("/");
  return recorded;
}

async function signIn(page: Page, email = "cofounder@example.com") {
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByLabel("Email address").fill(email);
  await page
    .getByRole("textbox", { name: "Password" })
    .fill("correct-horse-12");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

async function pasteCode(page: Page, code: string) {
  await page.getByLabel("Digit 1 of 6").evaluate((element, value) => {
    const clipboard = new DataTransfer();
    clipboard.setData("text/plain", value);
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: clipboard,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, code);
}

async function storedTransaction(page: Page) {
  return page.evaluate(
    (key) => JSON.parse(window.localStorage.getItem(key) ?? "null"),
    TRANSACTION_KEY,
  );
}

async function expectLandedInGeneral(page: Page) {
  await expect(page.getByTestId("chat-title")).toContainText("general");
  await expect(page.getByTestId("onboarding-scene-business")).toHaveCount(0);
}

test("Have an invite link? opens the invite scene and a pasted link joins without a business", async ({
  page,
}) => {
  const { counts, claimBodies } = await startFirstRun(page);
  await expect(page.getByTestId("onboarding-scene-account")).toBeVisible();

  await page.getByTestId("have-invite-link").click();
  await expect(page.getByTestId("onboarding-scene-invite")).toBeVisible();
  await expect(page.getByLabel("Invite link or code")).toBeFocused();
  await page.getByLabel("Invite link or code").fill(INVITE_LINK);
  await page.keyboard.press("Enter");

  // The workspace is named from its host; the code is never shown.
  const brand = page.getByTestId("invite-brand");
  await expect(brand).toContainText("Rosebank Studio");
  await expect(page.getByText("v2.abc")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "You’re invited." }),
  ).toBeVisible();

  await page.getByLabel("Your name").fill("Lerato Molefe");
  await page.getByLabel("Email address").fill("lerato@example.com");
  await page
    .getByRole("textbox", { name: "Password" })
    .fill("correct-horse-12");
  await page.getByTestId("account-auth-submit-signup").click();
  await expect(page.getByTestId("account-auth-screen-verify")).toBeVisible();
  await pasteCode(page, "123456");
  await page.getByTestId("otp-continue").click();

  // Confirm step: no business form, no claim yet.
  await expect(page.getByTestId("onboarding-scene-invite")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "You’re invited." }),
  ).toBeVisible();
  await expect(page.getByTestId("onboarding-scene-business")).toHaveCount(0);
  await expect(page.getByText("lerato@example.com")).toBeVisible();
  expect(counts.claims).toBe(0);
  await page.getByTestId("invite-join").click();

  await expectLandedInGeneral(page);
  expect(counts.claims).toBe(1);
  expect(claimBodies[0]?.code).toBe("v2.abc");
  expect(counts.creates).toBe(0);
  await expect.poll(() => storedTransaction(page)).toBeNull();
});

test("a bare code with the workspace address works and Escape leaves the invite step", async ({
  page,
}) => {
  const { counts } = await startFirstRun(page);
  await page.getByTestId("have-invite-link").click();
  await page.getByLabel("Invite link or code").press("Escape");
  await expect(page.getByTestId("onboarding-scene-account")).toBeVisible();

  await page.getByTestId("have-invite-link").click();
  await page.getByLabel("Invite link or code").fill("v2.abc");
  await page.getByLabel("Workspace address").fill(RELAY_HOST);
  await page.getByTestId("invite-link-continue").click();
  await expect(page.getByTestId("invite-brand")).toContainText(
    "Rosebank Studio",
  );

  await signIn(page);
  await page.getByTestId("invite-join").click();
  await expectLandedInGeneral(page);
  expect(counts.creates).toBe(0);
});

test("a link that is not an invite explains itself instead of failing silently", async ({
  page,
}) => {
  await startFirstRun(page);
  await page.getByTestId("have-invite-link").click();
  await page
    .getByLabel("Invite link or code")
    .fill("https://example.com/hello");
  await page.getByTestId("invite-link-continue").click();
  await expect(page.getByRole("alert")).toContainText("Paste the whole link");
  await expect(page.getByTestId("onboarding-scene-invite")).toBeVisible();
});

test("a deep link at cold start shows the invite on the account screen, not the pending gate", async ({
  page,
}) => {
  const { counts } = await startFirstRun(page, { deepLink: true });
  await expect(page.getByTestId("onboarding-scene-account")).toBeVisible();
  await expect(page.getByTestId("invite-brand")).toContainText(
    "Rosebank Studio",
  );
  await expect(page.getByTestId("pending-invite-gate")).toHaveCount(0);
  // Already invited: the paste link is not offered again.
  await expect(page.getByTestId("have-invite-link")).toHaveCount(0);

  await signIn(page);
  await expect(page.getByTestId("onboarding-scene-invite")).toBeVisible();
  await page.getByTestId("invite-join").click();
  await expectLandedInGeneral(page);
  expect(counts.claims).toBe(1);
  expect(counts.creates).toBe(0);
});

test("a deep link arriving while the account screen is showing surfaces the invite", async ({
  page,
}) => {
  await startFirstRun(page);
  await expect(page.getByTestId("onboarding-scene-account")).toBeVisible();
  await expect(page.getByTestId("invite-brand")).toHaveCount(0);
  await page.evaluate(
    (link) => window.__BUZZ_E2E_PUSH_COMMUNITY_DEEP_LINK__?.(link),
    JOIN_LINK,
  );
  await expect(page.getByTestId("invite-brand")).toContainText(
    "Rosebank Studio",
  );
});

test("a deep link arriving after sign-in becomes the invite scene, not a business form", async ({
  page,
}) => {
  await startFirstRun(page);
  await signIn(page);
  await expect(page.getByTestId("onboarding-scene-business")).toBeVisible();
  await page.evaluate(
    (link) => window.__BUZZ_E2E_PUSH_COMMUNITY_DEEP_LINK__?.(link),
    JOIN_LINK,
  );
  await expect(page.getByTestId("onboarding-scene-invite")).toBeVisible();
  await expect(page.getByTestId("invite-brand")).toContainText(
    "Rosebank Studio",
  );
  await expect(page.getByTestId("onboarding-scene-business")).toHaveCount(0);
});

test("a pending invite survives a reload in the middle of sign-up", async ({
  page,
}) => {
  await startFirstRun(page);
  await page.getByTestId("have-invite-link").click();
  await page.getByLabel("Invite link or code").fill(INVITE_LINK);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("invite-brand")).toContainText(
    "Rosebank Studio",
  );
  expect(await storedTransaction(page)).toMatchObject({
    relayUrl: RELAY_WS,
    inviteCode: "v2.abc",
    stage: "claiming",
  });

  await page.reload();
  await expect(page.getByTestId("onboarding-scene-account")).toBeVisible();
  await expect(page.getByTestId("invite-brand")).toContainText(
    "Rosebank Studio",
  );
  await signIn(page);
  await page.getByTestId("invite-join").click();
  await expectLandedInGeneral(page);
  // Cleared once the claim has succeeded and the person is in.
  await expect.poll(() => storedTransaction(page)).toBeNull();
});

test("a relay that requires terms asks for them, then carries the receipt through the claim", async ({
  page,
}) => {
  const { counts, claimBodies } = await startFirstRun(page, {
    deepLink: true,
    policy: true,
  });
  await signIn(page);
  const join = page.getByTestId("invite-join");
  await expect(join).toBeDisabled();
  await page.getByRole("checkbox").check();
  await expect(join).toBeEnabled();
  await join.click();
  await expectLandedInGeneral(page);
  expect(counts.accepts).toBe(1);
  expect(claimBodies[0]?.policy_receipt).toBe("receipt-1");
});

test("a network failure on the claim says so and Try again joins", async ({
  page,
}) => {
  const { counts } = await startFirstRun(page, {
    deepLink: true,
    claim: "offline-then-ok",
  });
  await signIn(page);
  await page.getByTestId("invite-join").click();
  await expect(page.getByRole("alert")).toContainText(
    "We couldn’t reach this workspace",
  );
  await expect(page.getByTestId("onboarding-scene-business")).toHaveCount(0);
  await page.getByRole("button", { name: "Try again" }).click();
  await expectLandedInGeneral(page);
  expect(counts.claims).toBe(2);
});

for (const [claim, wording] of [
  ["invalid", "We couldn’t use this invite"],
  ["expired", "This invite has expired"],
] as const) {
  test(`a ${claim} code explains why and offers a way forward`, async ({
    page,
  }) => {
    const { counts } = await startFirstRun(page, { deepLink: true, claim });
    await signIn(page);
    await page.getByTestId("invite-join").click();

    const failed = page.getByTestId("invite-failed");
    await expect(failed).toContainText("That invite didn’t work.");
    await expect(failed).toContainText(wording);
    await expect(failed).toContainText("new link");
    await expect(failed).not.toContainText("invite_");
    // Never persisted: a relaunch cannot be trapped by it.
    expect(await storedTransaction(page)).toBeNull();

    await page.getByTestId("invite-use-another-link").click();
    await expect(page.getByLabel("Invite link or code")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("onboarding-scene-account")).toBeVisible();
    expect(counts.creates).toBe(0);
  });
}

test("after a failed invite the person can still create their own business", async ({
  page,
}) => {
  await startFirstRun(page, { deepLink: true, claim: "invalid" });
  await signIn(page);
  await page.getByTestId("invite-join").click();
  await page.getByTestId("invite-create-own-business").click();
  await expect(page.getByTestId("onboarding-scene-business")).toBeVisible();
});

test("an existing user's invite link joins through the same claim and lands in the new workspace", async ({
  page,
}) => {
  const { counts } = await startFirstRun(page, {
    deepLink: true,
    existingUser: true,
  });
  await expect(page.getByTestId("sidebar-profile-avatar-button")).toBeVisible();
  await expect.poll(() => counts.claims).toBe(1);
  expect(counts.creates).toBe(0);
});

test("an invalid invite never strands an existing user, even after a relaunch", async ({
  page,
}) => {
  const { counts } = await startFirstRun(page, {
    deepLink: true,
    existingUser: true,
    claim: "invalid",
  });
  const failed = page.getByTestId("invite-claim-failed");
  await expect(failed).toContainText("That invite didn’t work.");
  await expect(failed).not.toContainText("invite_invalid");
  expect(counts.creates).toBe(0);
  // The failed claim is not persisted, so it cannot come back on launch.
  expect(await storedTransaction(page)).toBeNull();

  await page.getByTestId("invite-claim-leave").click();
  await expect(page.getByTestId("sidebar-profile-avatar-button")).toBeVisible();
  await expect(page.getByTestId("community-onboarding-flow")).toHaveCount(0);
});

test("a failed claim left behind by an older build does not trap the next launch", async ({
  page,
}) => {
  await page.addInitScript(
    ({ key, relay }) => {
      const now = new Date().toISOString();
      window.localStorage.setItem(
        key,
        JSON.stringify({
          id: "stale-1",
          source: "add-community",
          stage: "claiming",
          relayUrl: relay,
          inviteCode: "v2.old",
          communityName: "Old",
          createdAt: now,
          updatedAt: now,
          error: "invite_invalid",
        }),
      );
    },
    { key: TRANSACTION_KEY, relay: RELAY_WS },
  );
  await startFirstRun(page, { existingUser: true });
  await expect(page.getByTestId("sidebar-profile-avatar-button")).toBeVisible();
  await expect(page.getByTestId("community-onboarding-flow")).toHaveCount(0);
  await expect(page.getByText("isn’t ready yet")).toHaveCount(0);
  expect(await storedTransaction(page)).toBeNull();
});
