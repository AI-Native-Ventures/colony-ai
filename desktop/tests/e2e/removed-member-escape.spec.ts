import { expect, test, type Page } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";

// What the production relay returns to a person who was removed from the
// community: the native layer wraps the relay's 403 text with its status.
const REMOVED_ERROR =
  "relay returned 403 Forbidden: You must be a relay member to access this relay";
const RAW_RELAY_TEXT = /relay returned \d{3}/i;
// Wrapper text the native layer adds around a relay failure.
const RELAY_WRAPPER_TEXT = /query failed|relay unreachable/i;
// What the packaged app shows after Retry: the backend re-applies the
// community and its owned-agent query wraps the same 403.
const NESTED_REFUSAL =
  "relay owned-agent query failed: relay returned 403 Forbidden: You must be a relay member to access this relay";
const PLAIN_REASON = "You must be a relay member to access this relay";
const PLAIN_SERVER_SENTENCE =
  "Colony could not reach this community. Try again.";

const COLONY = {
  id: "community-colony",
  name: "Colony",
  relayUrl: "ws://localhost:3000",
  addedAt: "2026-01-01T00:00:00.000Z",
};
const COLONY_AI = {
  id: "community-colony-ai",
  name: "Colony AI",
  relayUrl: "ws://localhost:3001",
  addedAt: "2026-01-02T00:00:00.000Z",
};

// Seeds before the bridge is installed: React reads storage on mount, and the
// bridge is what triggers the mount.
async function seedCommunities(
  page: Page,
  communities: Array<Record<string, unknown>>,
  activeId: string,
) {
  await page.addInitScript(
    ({ list, active }) => {
      window.localStorage.setItem("buzz-communities", JSON.stringify(list));
      window.localStorage.setItem("buzz-active-community-id", active);
    },
    { list: communities, active: activeId },
  );
}

async function openAsRemovedMember(
  page: Page,
  communities: Array<Record<string, unknown>>,
  options: { autoConnectDefaultRelay?: boolean } = {},
) {
  await seedCommunities(page, communities, COLONY.id);
  await installMockBridge(
    page,
    { channelsReadErrorByRelayUrl: { [COLONY.relayUrl]: REMOVED_ERROR } },
    { skipCommunitySeed: true, ...options },
  );
  await page.goto("/");
  // The workspace retries its first failed read once before it gives up.
  await expect(page.getByTestId("community-apply-error")).toBeVisible({
    timeout: 15_000,
  });
}

// Simulates the owner adding the person back: the relay stops refusing them.
function restoreMembership(page: Page) {
  return page.evaluate((relayUrl) => {
    const mock = (
      window as Window & {
        __BUZZ_E2E__?: {
          mock?: { channelsReadErrorByRelayUrl?: Record<string, string> };
        };
      }
    ).__BUZZ_E2E__?.mock;
    if (mock?.channelsReadErrorByRelayUrl) {
      delete mock.channelsReadErrorByRelayUrl[relayUrl];
    }
  }, COLONY.relayUrl);
}

// Makes the next community applies fail the way the real backend does on
// Retry (pass null to stop failing). The mock reads this at call time.
function failApplies(page: Page, error: string | null) {
  return page.evaluate(
    ({ relayUrl, applyError }) => {
      const mock = (
        window as Window & {
          __BUZZ_E2E__?: {
            mock?: { applyCommunityErrorByRelayUrl?: Record<string, string> };
          };
        }
      ).__BUZZ_E2E__?.mock;
      if (!mock) return;
      const next = { ...(mock.applyCommunityErrorByRelayUrl ?? {}) };
      if (applyError === null) delete next[relayUrl];
      else next[relayUrl] = applyError;
      mock.applyCommunityErrorByRelayUrl = next;
    },
    { relayUrl: COLONY.relayUrl, applyError: error },
  );
}

// Presses Retry and waits until the re-apply has failed (the app logs the raw
// error to the console, which is where raw text belongs), so assertions run
// against the screen Retry produced and not the one it replaced.
async function retryUntilApplyFails(page: Page) {
  const failed = page.waitForEvent("console", {
    predicate: (message) =>
      message.text().includes("Failed to apply community to backend"),
    timeout: 15_000,
  });
  await page
    .getByTestId("community-apply-error")
    .getByRole("button", { name: "Retry" })
    .click();
  await failed;
}

async function expectNoRawRelayText(page: Page) {
  await expect(page.locator("body")).not.toContainText(RAW_RELAY_TEXT);
  await expect(page.locator("body")).not.toContainText(RELAY_WRAPPER_TEXT);
}

// The small Details line: the relay's own reason in plain words, same text on
// the first view and after every Retry.
async function expectPlainDetails(page: Page) {
  await expect(
    page
      .getByTestId("community-apply-error")
      .getByTestId("community-apply-error-details"),
  ).toHaveText(`Details: ${PLAIN_REASON}`);
  await expectNoRawRelayText(page);
}

function readStorage(page: Page, key: string) {
  return page.evaluate((storageKey) => {
    return window.localStorage.getItem(storageKey);
  }, key);
}

test.describe("removed member escape", () => {
  test("a removed member with one community gets the escape screen, never raw relay text", async ({
    page,
  }) => {
    await openAsRemovedMember(page, [COLONY], {
      autoConnectDefaultRelay: true,
    });
    const screen = page.getByTestId("community-apply-error");

    // Plain copy with the community name. No switch list: there is nothing to
    // switch to, and the copy does not point at one.
    await expect(
      screen.getByTestId("community-apply-error-message"),
    ).toHaveText(
      "This sign-in is not a member of Colony. Remove it from this device, or ask for an invitation.",
    );
    await expect(screen.getByTestId("community-escape-switch")).toHaveCount(0);
    await expect(screen.getByRole("button", { name: "Retry" })).toBeFocused();

    // The workspace is gone: no empty shell, no red text, no raw relay status.
    await expect(page.getByTestId("sidebar-profile-avatar-button")).toHaveCount(
      0,
    );
    await expect(page.locator("body")).not.toContainText(RAW_RELAY_TEXT);

    // Remove always works, by keyboard, and lands on first-run setup.
    const remove = screen.getByRole("button", {
      name: /^Remove this community from this device/,
    });
    await remove.focus();
    await page.keyboard.press("Enter");
    await expect(
      screen.getByTestId("community-escape-remove-keep"),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      screen.getByTestId("community-escape-remove-confirm"),
    ).toBeFocused();
    await page.keyboard.press("Enter");

    await expect(page.getByText("Join or create a community")).toBeVisible();
    await expect(page.getByTestId("community-choice-join")).toBeVisible();
    await expect(page.getByTestId("community-apply-error")).toHaveCount(0);
    await expect(page.getByTestId("sidebar-profile-avatar-button")).toHaveCount(
      0,
    );
    await expect.poll(() => readStorage(page, "buzz-communities")).toBeNull();
    await expect
      .poll(() => readStorage(page, "buzz-community-discovery-after-leave"))
      .toBe("1");
  });

  test("with two communities, Switch leaves the denied one for the other", async ({
    page,
  }) => {
    await openAsRemovedMember(page, [COLONY, COLONY_AI]);
    const screen = page.getByTestId("community-apply-error");

    await expect(
      screen.getByTestId("community-apply-error-message"),
    ).toHaveText(
      "This sign-in is not a member of Colony. Switch to another community or remove this one.",
    );
    await expect(page.locator("body")).not.toContainText(RAW_RELAY_TEXT);

    // The switch action is first and holds focus; Enter activates it.
    const switchButton = screen.getByRole("button", {
      name: "Switch to Colony AI",
    });
    await expect(switchButton).toBeFocused();
    await page.keyboard.press("Enter");

    await expect(page.getByTestId("community-apply-error")).toHaveCount(0);
    await expect(
      page.getByTestId("sidebar-profile-avatar-button"),
    ).toBeVisible();
    await expect(
      page.getByTestId(`community-rail-button-${COLONY_AI.id}`),
    ).toHaveAttribute("aria-current", "true");
    await expect
      .poll(() => readStorage(page, "buzz-active-community-id"))
      .toBe(COLONY_AI.id);
    // The refusal belonged to Colony: it never follows the person to Colony AI.
    await expect(page.getByTestId("sidebar-relay-error")).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText(RAW_RELAY_TEXT);
  });

  test("with two communities, Remove lands on the other community", async ({
    page,
  }) => {
    await openAsRemovedMember(page, [COLONY, COLONY_AI]);
    const screen = page.getByTestId("community-apply-error");

    await screen
      .getByRole("button", { name: /^Remove this community from this device/ })
      .click();
    await screen.getByTestId("community-escape-remove-confirm").click();

    await expect(page.getByTestId("community-apply-error")).toHaveCount(0);
    await expect(
      page.getByTestId("sidebar-profile-avatar-button"),
    ).toBeVisible();
    await expect
      .poll(() => readStorage(page, "buzz-active-community-id"))
      .toBe(COLONY_AI.id);
    await expect
      .poll(async () => {
        const raw = await readStorage(page, "buzz-communities");
        return (JSON.parse(raw ?? "[]") as Array<{ id: string }>).map(
          (community) => community.id,
        );
      })
      .toEqual([COLONY_AI.id]);
    await expect(page.locator("body")).not.toContainText(RAW_RELAY_TEXT);
  });

  test("Retry keeps the screen while refused and returns to the workspace once re-added", async ({
    page,
  }) => {
    await openAsRemovedMember(page, [COLONY, COLONY_AI]);
    const screen = page.getByTestId("community-apply-error");

    await expectPlainDetails(page);

    // Still removed: Retry re-checks and the same screen comes back.
    await screen.getByRole("button", { name: "Retry" }).click();
    await expect(screen).toBeVisible({ timeout: 15_000 });
    await expect(
      screen.getByTestId("community-apply-error-message"),
    ).toContainText("not a member of Colony");
    await expectPlainDetails(page);

    // Added back: Retry opens the workspace again.
    await restoreMembership(page);
    await screen.getByRole("button", { name: "Retry" }).click();
    await expect(page.getByTestId("community-apply-error")).toHaveCount(0, {
      timeout: 15_000,
    });
    await expect(
      page.getByTestId("sidebar-profile-avatar-button"),
    ).toBeVisible();
    await expect
      .poll(() => readStorage(page, "buzz-active-community-id"))
      .toBe(COLONY.id);
    await expect(page.locator("body")).not.toContainText(RAW_RELAY_TEXT);
  });

  test("Retry that fails with the nested apply error keeps Details plain, then success returns to the workspace", async ({
    page,
  }) => {
    await openAsRemovedMember(page, [COLONY, COLONY_AI]);
    const screen = page.getByTestId("community-apply-error");
    await expectPlainDetails(page);

    // Still refused, twice: the wrapped backend text never reaches Details.
    await failApplies(page, NESTED_REFUSAL);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await retryUntilApplyFails(page);
      await expect(screen).toBeVisible({ timeout: 15_000 });
      await expect(
        screen.getByTestId("community-apply-error-message"),
      ).toHaveText(
        "This sign-in is not a member of Colony. Switch to another community or remove this one.",
      );
      await expectPlainDetails(page);
    }

    // Added back: Retry opens the workspace again.
    await failApplies(page, null);
    await restoreMembership(page);
    await screen.getByRole("button", { name: "Retry" }).click();
    await expect(page.getByTestId("community-apply-error")).toHaveCount(0, {
      timeout: 15_000,
    });
    await expect(
      page.getByTestId("sidebar-profile-avatar-button"),
    ).toBeVisible();
    await expectNoRawRelayText(page);
  });

  test("Retry that fails with another relay error shows one plain sentence and no raw text", async ({
    page,
  }) => {
    await openAsRemovedMember(page, [COLONY, COLONY_AI]);
    const screen = page.getByTestId("community-apply-error");
    const message = screen.getByTestId("community-apply-error-message");
    const details = screen.getByTestId("community-apply-error-details");

    // The relay is up but failing.
    await failApplies(
      page,
      "relay owned-agent query failed: relay returned 500 Internal Server Error: upstream exploded",
    );
    await retryUntilApplyFails(page);
    await expect(message).toHaveText(PLAIN_SERVER_SENTENCE);
    await expect(details).toHaveCount(0);
    await expectNoRawRelayText(page);
    await expect(page.locator("body")).not.toContainText("upstream exploded");

    // The relay cannot be reached.
    await failApplies(
      page,
      "relay owned-agent query failed: relay unreachable: could not connect to relay",
    );
    await retryUntilApplyFails(page);
    await expect(message).toHaveText("Can't reach the relay.");
    await expect(details).toHaveCount(0);
    await expectNoRawRelayText(page);

    // Healthy again: Retry opens the workspace.
    await failApplies(page, null);
    await restoreMembership(page);
    await screen.getByRole("button", { name: "Retry" }).click();
    await expect(page.getByTestId("community-apply-error")).toHaveCount(0, {
      timeout: 15_000,
    });
    await expect(
      page.getByTestId("sidebar-profile-avatar-button"),
    ).toBeVisible();
  });

  test("any other relay error shows one plain sentence with Retry, not raw text", async ({
    page,
  }) => {
    await seedCommunities(page, [COLONY], COLONY.id);
    await installMockBridge(
      page,
      {
        channelsReadErrorByRelayUrl: {
          [COLONY.relayUrl]:
            "relay returned 500 Internal Server Error: upstream exploded",
        },
      },
      { skipCommunitySeed: true },
    );
    await page.goto("/");

    const notice = page.getByTestId("sidebar-relay-error");
    await expect(notice).toBeVisible({ timeout: 15_000 });
    await expect(notice).toContainText(
      "Colony could not reach this community. Try again.",
    );
    await expect(page.locator("body")).not.toContainText(RAW_RELAY_TEXT);
    await expect(page.locator("body")).not.toContainText("upstream exploded");
    // Not a membership problem: the workspace stays and no escape screen shows.
    await expect(page.getByTestId("community-apply-error")).toHaveCount(0);

    // Retry re-reads the channels, and the notice clears once the relay is well.
    await restoreMembership(page);
    await page.getByTestId("sidebar-relay-error-retry").click();
    await expect(notice).toHaveCount(0, { timeout: 15_000 });
  });

  // Skipped in CI. The state the final gate flagged: still refused after Retry.
  test("captures the escape screen after Retry", async ({ page }) => {
    const outDir = process.env.REMOVED_MEMBER_SHOTS_DIR;
    test.skip(!outDir, "set REMOVED_MEMBER_SHOTS_DIR to capture screenshots");
    await page.setViewportSize({ width: 1440, height: 900 });
    await openAsRemovedMember(page, [COLONY, COLONY_AI]);
    await failApplies(page, NESTED_REFUSAL);
    await retryUntilApplyFails(page);
    await expectPlainDetails(page);
    await waitForAnimations(page);
    await page.screenshot({
      path: `${outDir}/escape-after-retry-1440x900.png`,
    });
  });

  // Skipped in CI. Set REMOVED_MEMBER_SHOTS_DIR to capture the PR screenshots
  // at the two window sizes the design review uses.
  for (const scenario of [
    { name: "one-community", communities: [COLONY] },
    { name: "two-communities", communities: [COLONY, COLONY_AI] },
  ]) {
    test(`captures the escape screen (${scenario.name})`, async ({ page }) => {
      const outDir = process.env.REMOVED_MEMBER_SHOTS_DIR;
      test.skip(!outDir, "set REMOVED_MEMBER_SHOTS_DIR to capture screenshots");
      await page.setViewportSize({ width: 1728, height: 1117 });
      await openAsRemovedMember(page, scenario.communities);
      for (const [width, height] of [
        [1728, 1117],
        [1440, 900],
      ]) {
        await page.setViewportSize({ width, height });
        await waitForAnimations(page);
        await page.screenshot({
          path: `${outDir}/escape-${scenario.name}-${width}x${height}.png`,
        });
      }
    });
  }
});
