import { expect, test } from "@playwright/test";

import { installMockBridge, TEST_IDENTITIES } from "../helpers/bridge";
import { waitForAnimations } from "../helpers/animations";

const relaySelf = TEST_IDENTITIES.outsider.pubkey;

test("People shows the relay roster without calling an admin a partner", async ({
  page,
}) => {
  await installMockBridge(page, { relayRequiresMembership: true, relaySelf });
  await page.goto("/#/settings?section=people");

  const people = page.getByTestId("settings-people");
  await expect(people.getByRole("heading", { name: "People" })).toHaveCount(2);
  await expect(people.getByText("owner", { exact: true })).toBeVisible();
  await expect(people.getByText("member", { exact: true })).toBeVisible();
  await expect(people.getByText("partner", { exact: true })).toHaveCount(0);
  await expect(people.getByText(/Partner permissions/)).toBeVisible();
  await expect(people.getByRole("button", { name: /Remove/ })).toHaveCount(0);
  if (process.env.COLONY_CANARY_PEOPLE_SHOT) {
    await waitForAnimations(page);
    await page.screenshot({ path: process.env.COLONY_CANARY_PEOPLE_SHOT });
  }
  await page.setViewportSize({ width: 700, height: 800 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(700);
  if (process.env.COLONY_CANARY_PEOPLE_NARROW_SHOT) {
    await waitForAnimations(page);
    await page.screenshot({
      path: process.env.COLONY_CANARY_PEOPLE_NARROW_SHOT,
    });
  }
});

test("People keeps an admin's actual relay role visible", async ({ page }) => {
  await installMockBridge(page, {
    relayRequiresMembership: true,
    relayRole: "admin",
    relaySelf,
  });
  await page.goto("/#/settings?section=people");

  const people = page.getByTestId("settings-people");
  await expect(
    people.getByText("admin", { exact: true }).first(),
  ).toBeVisible();
  await expect(people.getByText("partner", { exact: true })).toHaveCount(0);
});

test("People keeps the owner visible while employee ants stay on Team", async ({
  page,
}) => {
  const ownerPubkey = "deadbeef".repeat(8);
  await installMockBridge(page, {
    relayRequiresMembership: true,
    relaySelf,
    relayMembers: [
      { pubkey: ownerPubkey, role: "owner" },
      { pubkey: TEST_IDENTITIES.alice.pubkey, role: "member" },
    ],
    relayAgents: [
      {
        pubkey: TEST_IDENTITIES.alice.pubkey,
        ownerPubkey,
        name: "Mina",
        agentType: "agent",
      },
    ],
    searchProfiles: [
      { pubkey: ownerPubkey, displayName: "Lerato Mokoena" },
      {
        pubkey: TEST_IDENTITIES.alice.pubkey,
        displayName: "Mina",
        isAgent: true,
      },
    ],
  });
  await page.goto("/#/settings?section=people");

  const people = page.getByTestId("settings-people");
  await expect(people.getByText("Lerato Mokoena")).toBeVisible();
  await expect(people.getByText(/Just you for now/)).toBeVisible();
  await expect(people.getByText("Mina", { exact: true })).toHaveCount(0);
});

test("People does not offer invite creation to a member", async ({ page }) => {
  await installMockBridge(page, {
    relayRequiresMembership: true,
    relayRole: "member",
    relaySelf,
  });
  await page.goto("/#/settings?section=people");

  const people = page.getByTestId("settings-people");
  await expect(
    people.getByText(/cannot manage this company’s people/),
  ).toBeVisible();
  await expect(people.getByTestId("people-copy-invite")).toHaveCount(0);
});

test("Partner sees the people roster without removal or unfinished invites", async ({
  page,
}) => {
  await installMockBridge(page, {
    relayRequiresMembership: true,
    relayRole: "partner",
    relaySelf,
  });
  await page.goto("/#/settings?section=people");

  const people = page.getByTestId("settings-people");
  await expect(people.getByText("partner", { exact: true })).toBeVisible();
  await expect(people.getByText("member", { exact: true })).toBeVisible();
  await expect(
    people.getByText(/Only the owner can remove people/),
  ).toBeVisible();
  await expect(people.getByTestId("people-copy-invite")).toHaveCount(0);
  await expect(people.getByRole("button", { name: /Remove/ })).toHaveCount(0);
});

test("People mints a one-use seven-day member link once and keeps it when copied again", async ({
  page,
}) => {
  await installMockBridge(page, { relayRequiresMembership: true, relaySelf });
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  const requestBodies: unknown[] = [];
  const inviteUrl = "https://colony.example/join/test-invite";
  await page.route("**/api/invites", async (route) => {
    requestBodies.push(route.request().postDataJSON());
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        code: "test-invite",
        expires_at: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
        url: inviteUrl,
        max_uses: 1,
        uses_remaining: 1,
      }),
    });
  });
  await page.goto("/#/settings?section=people");

  const people = page.getByTestId("settings-people");
  const copy = people.getByTestId("people-copy-invite");
  await expect(copy).toBeEnabled();
  await copy.click();
  await expect(
    people.getByRole("status").filter({ hasText: "Link copied" }),
  ).toBeVisible();
  await expect(
    people.getByRole("textbox", { name: "Invite link" }),
  ).toHaveValue(inviteUrl);
  await copy.click();
  await expect(
    people.getByRole("status").filter({ hasText: "Link copied" }),
  ).toBeVisible();
  expect(requestBodies).toEqual([{ ttl_secs: 604800, max_uses: 1 }]);
});

test("People disables invite creation when the relay is disconnected", async ({
  page,
}) => {
  await installMockBridge(page, { relayRequiresMembership: true, relaySelf });
  await page.goto("/#/settings?section=people");
  await expect(page.getByTestId("people-copy-invite")).toBeEnabled();
  await page.evaluate(() =>
    window.__BUZZ_E2E_SET_RELAY_CONNECTION_STATE__?.("disconnected"),
  );
  await expect(page.getByTestId("people-copy-invite")).toBeDisabled();
  await expect(page.getByTestId("settings-people")).toContainText(
    "Creating an invite needs the internet",
  );
});

test("People keeps a minted link visible if clipboard access fails", async ({
  page,
}) => {
  await installMockBridge(page, { relayRequiresMembership: true, relaySelf });
  await page.context().grantPermissions([]);
  const inviteUrl = "https://colony.example/join/copy-fallback";
  let mintCount = 0;
  await page.route("**/api/invites", async (route) => {
    mintCount += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        code: "copy-fallback",
        expires_at: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
        url: inviteUrl,
        max_uses: 1,
        uses_remaining: 1,
      }),
    });
  });
  await page.goto("/#/settings?section=people");

  const people = page.getByTestId("settings-people");
  const copy = people.getByTestId("people-copy-invite");
  await copy.click();
  await expect(people.getByRole("alert")).toContainText("copy manually");
  await expect(
    people.getByRole("textbox", { name: "Invite link" }),
  ).toHaveValue(inviteUrl);
  await copy.click();
  await expect(people.getByRole("alert")).toContainText("copy manually");
  expect(mintCount).toBe(1);
});

test("People rejects an already expired invite response and retries", async ({
  page,
}) => {
  await installMockBridge(page, { relayRequiresMembership: true, relaySelf });
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  let mintCount = 0;
  await page.route("**/api/invites", async (route) => {
    mintCount += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        code: `test-invite-${mintCount}`,
        expires_at:
          Math.floor(Date.now() / 1000) + (mintCount === 1 ? -1 : 604800),
        url: `https://colony.example/join/test-invite-${mintCount}`,
        max_uses: 1,
        uses_remaining: 1,
      }),
    });
  });
  await page.goto("/#/settings?section=people");

  const people = page.getByTestId("settings-people");
  const copy = people.getByTestId("people-copy-invite");
  await copy.click();
  await expect(people.getByRole("alert")).toContainText("already expired");
  await expect(
    people.getByRole("textbox", { name: "Invite link" }),
  ).toHaveCount(0);
  await copy.click();
  await expect(
    people.getByRole("textbox", { name: "Invite link" }),
  ).toHaveValue("https://colony.example/join/test-invite-2");
  expect(mintCount).toBe(2);
});
