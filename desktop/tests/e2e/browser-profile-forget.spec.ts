import { expect, test, type Page } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";
import { openSettings } from "../helpers/settings";
import {
  installBrowserHostFake,
  type FakeCall,
} from "./helpers/browserHostFake";

// A community's browser logins and cookies must not outlive it on this device,
// and none may outlive a sign-out. The host can refuse (a download is still
// stopping), so a refusal is recorded and finished at the next start.

const PENDING_KEY = "colony-browser-forget-pending.v1";
const REMOVED_ERROR =
  "relay returned 403 Forbidden: You must be a relay member to access this relay";
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

const calls = (page: Page, op?: string) =>
  page.evaluate(
    (wanted) =>
      (window.__browserFake?.calls ?? []).filter(
        (call) => !wanted || call.op === wanted,
      ),
    op,
  ) as Promise<FakeCall[]>;

const forgets = (page: Page, businessId: string) =>
  page.evaluate(
    (id) =>
      (window.__browserFake?.calls ?? [])
        .filter(
          (call) =>
            ["closeBusiness", "forgetBusiness"].includes(call.op) &&
            call.businessId === id,
        )
        .map((call) => call.op),
    businessId,
  );

// Seeded once: the init script runs again on a reload, and a reload must keep
// what the person removed.
async function openStuckCommunity(page: Page) {
  await page.addInitScript(
    ({ list, active }) => {
      if (window.localStorage.getItem("buzz-communities")) return;
      window.localStorage.setItem("buzz-communities", JSON.stringify(list));
      window.localStorage.setItem("buzz-active-community-id", active);
    },
    { list: [COLONY, COLONY_AI], active: COLONY.id },
  );
  await installBrowserHostFake(page);
  await installMockBridge(
    page,
    { channelsReadErrorByRelayUrl: { [COLONY.relayUrl]: REMOVED_ERROR } },
    { skipCommunitySeed: true },
  );
  await page.goto("/");
  await expect(page.getByTestId("community-apply-error")).toBeVisible({
    timeout: 15_000,
  });
}

async function removeStuckCommunity(page: Page) {
  const screen = page.getByTestId("community-apply-error");
  await screen
    .getByRole("button", { name: /^Remove this community from this device/ })
    .click();
  await screen.getByTestId("community-escape-remove-confirm").click();
  await expect(page.getByTestId("community-apply-error")).toHaveCount(0);
}

test.describe("browser profiles leave the device with the person's data", () => {
  test("removing a stuck community ends its browser tabs, then forgets its profile, and no other", async ({
    page,
  }) => {
    await openStuckCommunity(page);
    await removeStuckCommunity(page);

    await expect
      .poll(() => forgets(page, COLONY.id))
      .toContain("forgetBusiness");
    const ops = await forgets(page, COLONY.id);
    expect(ops.indexOf("closeBusiness")).toBeGreaterThanOrEqual(0);
    expect(ops.indexOf("closeBusiness")).toBeLessThan(
      ops.indexOf("forgetBusiness"),
    );
    expect(await forgets(page, COLONY_AI.id)).not.toContain("forgetBusiness");
    expect(
      await page.evaluate((key) => localStorage.getItem(key), PENDING_KEY),
    ).toBeNull();
  });

  test("a forget the host refuses is recorded, and finished at the next start", async ({
    page,
  }) => {
    await openStuckCommunity(page);
    await page.evaluate(() => {
      if (window.__browserFake) window.__browserFake.failForget = true;
    });
    await removeStuckCommunity(page);

    await expect
      .poll(() =>
        page.evaluate((key) => localStorage.getItem(key), PENDING_KEY),
      )
      .toBe(JSON.stringify({ all: false, businessIds: [COLONY.id] }));
    // It was tried more than once before being given up on for this run.
    expect(
      (await calls(page, "forgetBusiness")).filter(
        (call) => call.businessId === COLONY.id,
      ).length,
    ).toBeGreaterThan(1);

    // The next start: the host works again and the record is honoured, once.
    await page.reload();
    await expect
      .poll(async () =>
        (await calls(page, "forgetBusiness")).map((call) => call.businessId),
      )
      .toEqual([COLONY.id]);
    await expect
      .poll(() =>
        page.evaluate((key) => localStorage.getItem(key), PENDING_KEY),
      )
      .toBeNull();
  });

  test("signing out forgets every browser profile before the sign-out is sent", async ({
    page,
  }) => {
    await installBrowserHostFake(page);
    await installMockBridge(page);
    await page.goto("/");
    await openSettings(page, "security");
    await page.getByTestId("signout-open-dialog").click();
    await page.getByTestId("signout-confirm").click();

    await expect
      .poll(async () => (await calls(page, "forgetAll")).length)
      .toBe(1);
    expect((await calls(page, "forgetAll"))[0].signOutAlreadySent).toBe(false);
    await expect
      .poll(() =>
        page.evaluate(
          () => window.__BUZZ_E2E_COMMANDS__?.includes("sign_out") ?? false,
        ),
      )
      .toBe(true);
  });

  test("a sign-out the host cannot finish still signs out, and the profiles are cleared next start", async ({
    page,
  }) => {
    await installBrowserHostFake(page);
    await installMockBridge(page);
    await page.goto("/");
    await page.evaluate(() => {
      if (window.__browserFake) window.__browserFake.failForget = true;
    });
    await openSettings(page, "security");
    await page.getByTestId("signout-open-dialog").click();
    await page.getByTestId("signout-confirm").click();

    await expect
      .poll(() =>
        page.evaluate(
          () => window.__BUZZ_E2E_COMMANDS__?.includes("sign_out") ?? false,
        ),
      )
      .toBe(true);
    expect(
      await page.evaluate((key) => localStorage.getItem(key), PENDING_KEY),
    ).toBe(JSON.stringify({ all: true, businessIds: [] }));

    await page.reload();
    await expect
      .poll(async () => (await calls(page, "forgetAll")).length)
      .toBe(1);
    await expect
      .poll(() =>
        page.evaluate((key) => localStorage.getItem(key), PENDING_KEY),
      )
      .toBeNull();
  });
});
