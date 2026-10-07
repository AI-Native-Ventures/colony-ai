// Real-run proof of the visible browser tab's two UI-level behaviours on the PACKAGED app, on a
// throwaway profile the gate already holds (profile label from state.json, throwaway HOME, keychain-deny
// sandbox, exactly as c105-dock.mjs relaunches it). No new account, no login, nothing typed into a form.
//
//   BT-reload         an app reload keeps the page tab: the dock shows the same page, selected, at the same
//                     address, and the page loads again (live pages end at reload by design, the tab does not).
//   BT-remove-forget  Remove this community from this device forgets that community's browser profile: a
//                     cookie set in its visible browser is gone afterwards, and no retry record is left.
//
// BT-remove-forget needs a community that is stuck. The proof seeds one entry into the profile's own
// community list (relay ws://127.0.0.1:1, nothing listens there, no relay is contacted) and removes it
// through the real escape screen. That seed is the only stored state this script writes; it is named in the
// row. A row whose precondition is not reached is BLOCKED with the screen text, never PASS.
//
//   cd desktop
//   COLONY_REAL_RUN=1 AI_APP='/path/to/Colony.app' AI_OUT=/Users/mac/worktrees/.lanes/phase2/real-run-browser-ui \
//     node tests/real-run/browser-tab-ui.mjs <profile label>

import { mkdir } from "node:fs/promises";
import path from "node:path";
import { startFixtureSite } from "../electron/browser-fixture-site.mjs";
import {
  OUT,
  Rec,
  closeApp,
  instrument,
  launch,
  loadState,
  progress,
  shot,
  sleep,
  waitForLoad,
} from "./ai-lib.mjs";
import { stuckCommunity } from "./browser-tab-rows.mjs";

if (process.env.COLONY_REAL_RUN !== "1" || process.env.CI)
  throw new Error("COLONY_REAL_RUN=1 required, local only");
const [label] = process.argv.slice(2);
if (!label) throw new Error("Usage: node browser-tab-ui.mjs <profile label>");
const state = await loadState();
if (!state[label]?.userDataDir)
  throw new Error(
    `no profile "${label}" in state; this proof never creates an account`,
  );
await mkdir(path.join(OUT, "screenshots"), { recursive: true });

const rec = new Rec(`BT-${label}`);
const { server, base } = await startFixtureSite();
await waitForLoad();
await progress(`[BT-${label}] relaunching profile ${label}`);
const { application, page, version } = await launch({
  privateDir: state[label].privateDir,
  userDataDir: state[label].userDataDir,
});
instrument(page, rec, label);
rec.notes.version = version;

const bodyText = async (n = 500) =>
  (
    await page
      .locator("body")
      .innerText()
      .catch(() => "")
  )
    .replace(/\s+/gu, " ")
    .slice(0, n);
const dock = () => page.getByTestId("work-area-panel");
const shown = (id) =>
  dock().locator('section[role="tabpanel"]:not([hidden])').getByTestId(id);
const pageTabs = () =>
  dock().getByRole("tablist", { name: "Work area tabs" }).getByRole("tab");
const hostTabs = () => page.evaluate(() => window.colonyBrowserHost.listTabs());
const parseTitle = (entry) => {
  try {
    return JSON.parse(entry.title);
  } catch {
    return null;
  }
};
async function until(read, what, timeoutMs = 25_000) {
  const started = Date.now();
  for (;;) {
    const value = await read().catch(() => null);
    if (value) return value;
    if (Date.now() - started > timeoutMs)
      throw new Error(`timed out waiting for ${what}`);
    await sleep(150);
  }
}
async function step(id, name, run) {
  try {
    const outcome = await run();
    // A step reports BLOCKED itself when a precondition is not reached.
    rec.row(
      id,
      name,
      outcome?.status ?? "PASS",
      outcome?.detail ?? "observed",
      {
        screenshot: await shot(page, rec, id),
      },
    );
  } catch (error) {
    rec.row(id, name, "FAIL", `${error.message}. Page: ${await bodyText()}`, {
      screenshot: await shot(page, rec, `${id}-failed`),
    });
  }
}
const blocked = (detail) => ({ status: "BLOCKED", detail });

// Any channel of the profile's community will do: the dock is per channel.
async function openAnyChannel() {
  const id = await until(
    () =>
      page.evaluate(() => {
        const ids = [...document.querySelectorAll('[data-testid^="channel-"]')]
          .map((element) => element.getAttribute("data-testid"))
          .filter((value) => value && !value.startsWith("channel-work-area"));
        return ids[0] ?? null;
      }),
    "a channel in the sidebar",
    60_000,
  );
  await page.getByTestId(id).first().click({ timeout: 8000 });
  await page
    .getByTestId("channel-work-area-trigger")
    .waitFor({ timeout: 15_000 });
  return id;
}
async function openBrowserPage(url) {
  if (
    !(await dock()
      .isVisible()
      .catch(() => false))
  )
    await page
      .getByTestId("channel-work-area-trigger")
      .click({ timeout: 8000 });
  await dock().waitFor({ timeout: 8000 });
  const first = page.getByTestId("work-area-open-browser");
  if (await first.isVisible().catch(() => false)) await first.click();
  else {
    await page.getByTestId("work-area-add-tab").click({ timeout: 6000 });
    await page.getByTestId("work-area-add-browser").click({ timeout: 6000 });
  }
  const address = shown("browser-address");
  await address.waitFor({ timeout: 8000 });
  await address.fill(url);
  await address.press("Enter");
}

try {
  let channelId;
  const probeUrl = `${base}/probe?set=UI`;

  await step(
    "BT-reload",
    "An app reload keeps the browser page tab: same page, selected, same address, loads again",
    async () => {
      channelId = await openAnyChannel();
      await openBrowserPage(probeUrl);
      const live = await until(async () => {
        const tab = (await hostTabs()).find((entry) =>
          entry.url.includes("/probe"),
        );
        const parsed = tab ? parseTitle(tab) : null;
        return parsed?.cookie?.includes("scope=UI") ? tab : null;
      }, "the page to load and set its cookie");
      const tabsBefore = await pageTabs().count();
      rec.notes.reload = { channelId, tabsBefore, liveHostTab: live.id };

      await page.reload();
      await page.waitForLoadState("domcontentloaded", { timeout: 30_000 });
      await until(
        () => page.getByTestId(channelId).first().isVisible(),
        "the sidebar after reload",
        60_000,
      );
      await page.getByTestId(channelId).first().click({ timeout: 8000 });
      await page
        .getByTestId("channel-work-area-trigger")
        .waitFor({ timeout: 15_000 });
      if (
        !(await dock()
          .isVisible()
          .catch(() => false))
      )
        await page
          .getByTestId("channel-work-area-trigger")
          .click({ timeout: 8000 });
      await dock().waitFor({ timeout: 10_000 });

      const tabsAfter = await pageTabs().count();
      if (tabsAfter !== tabsBefore)
        throw new Error(
          `the dock had ${tabsBefore} tabs before the reload and ${tabsAfter} after`,
        );
      const selected = await dock()
        .locator('[role="tab"][aria-selected="true"]')
        .count();
      if (selected !== 1)
        throw new Error(`${selected} tabs are selected after the reload`);
      const addressValue = await shown("browser-address").inputValue({
        timeout: 8000,
      });
      if (addressValue !== probeUrl)
        throw new Error(
          `the address after the reload is ${addressValue}, expected ${probeUrl}`,
        );
      const again = await until(async () => {
        const tab = (await hostTabs()).find((entry) =>
          entry.url.includes("/probe"),
        );
        const parsed = tab ? parseTitle(tab) : null;
        return parsed?.cookie?.includes("scope=UI") ? tab : null;
      }, "the page to load again after the reload");
      return {
        detail: `${tabsAfter} tabs kept; address ${addressValue}; host tab ${live.id} before, ${again.id} after (live pages end at reload, the tab stays and loads again)`,
      };
    },
  );

  await step(
    "BT-remove-forget",
    "Remove this community from this device forgets its browser profile (seeded stuck community, no relay)",
    async () => {
      const stuckId = `real-run-stuck-${Date.now()}`;
      // Precondition: the stuck community's visible browser holds a cookie.
      const seeded = await page.evaluate(
        async ({ id, url }) => {
          const tab = await window.colonyBrowserHost.createTab({
            businessId: id,
            url,
          });
          return tab.id;
        },
        { id: stuckId, url: `${base}/probe?set=STUCK` },
      );
      const held = await until(async () => {
        const tab = (await hostTabs()).find((entry) => entry.id === seeded);
        const parsed = tab ? parseTitle(tab) : null;
        return parsed?.cookie?.includes("scope=STUCK") ? parsed : null;
      }, "the stuck community's browser to hold its cookie");
      rec.notes.removal = { stuckId, cookieBefore: held.cookie };

      // The only stored state this script writes: one stuck community made active.
      const original = await page.evaluate(
        ({ community }) => {
          const list = JSON.parse(
            localStorage.getItem("buzz-communities") ?? "[]",
          );
          const active = localStorage.getItem("buzz-active-community-id");
          localStorage.setItem(
            "buzz-communities",
            JSON.stringify([...list, community]),
          );
          localStorage.setItem("buzz-active-community-id", community.id);
          return { count: list.length, active };
        },
        { community: stuckCommunity(stuckId) },
      );
      if (original.count === 0)
        return blocked(
          "the profile has no community of its own to land on after the removal",
        );
      await page.reload();
      const screen = page.getByTestId("community-apply-error");
      const reached = await screen.waitFor({ timeout: 90_000 }).then(
        () => true,
        () => false,
      );
      if (!reached)
        return blocked(
          `the stuck-community screen never appeared. Page: ${await bodyText()}`,
        );
      await screen
        .getByRole("button", {
          name: /^Remove this community from this device/,
        })
        .click({ timeout: 8000 });
      await screen
        .getByTestId("community-escape-remove-confirm")
        .click({ timeout: 8000 });
      await until(
        () => screen.count().then((count) => count === 0),
        "the escape screen to go",
        30_000,
      );
      await until(
        () => page.getByTestId("sidebar-profile-avatar-button").isVisible(),
        "the workspace to return",
        60_000,
      );

      const after = await page.evaluate((id) => {
        const list = JSON.parse(
          localStorage.getItem("buzz-communities") ?? "[]",
        );
        return {
          stillListed: list.some((community) => community.id === id),
          pending: localStorage.getItem("colony-browser-forget-pending.v1"),
        };
      }, stuckId);
      if (after.stillListed)
        throw new Error("the stuck community is still in the device's list");
      if (after.pending !== null)
        throw new Error(`a browser cleanup is still pending: ${after.pending}`);
      const live = (await hostTabs()).filter(
        (entry) => entry.businessId === stuckId,
      );
      if (live.length)
        throw new Error(
          `${live.length} browser tabs of the removed community are still live`,
        );

      // The proof of the forget: the same business, a fresh tab, no cookie.
      const probeId = await page.evaluate(
        async ({ id, url }) =>
          (await window.colonyBrowserHost.createTab({ businessId: id, url }))
            .id,
        { id: stuckId, url: `${base}/probe` },
      );
      const fresh = await until(async () => {
        const tab = (await hostTabs()).find((entry) => entry.id === probeId);
        return tab ? parseTitle(tab) : null;
      }, "the fresh probe of the removed community");
      await page.evaluate(
        (id) => window.colonyBrowserHost.closeTab(id),
        probeId,
      );
      if (fresh.cookie.includes("scope=STUCK") || fresh.local !== null)
        throw new Error(
          `the removed community's profile survived: cookie "${fresh.cookie}", local ${fresh.local}`,
        );
      return {
        detail: `cookie "${held.cookie}" before the removal; after it a fresh tab sees "${fresh.cookie}" and local ${fresh.local}; no retry record; list restored to ${original.count} communities`,
      };
    },
  );
} finally {
  rec.notes.endedAt = new Date().toISOString();
  await rec.write();
  await new Promise((resolve) => server.close(resolve));
  await closeApp(application);
  await progress(`[BT-${label}] done, ${rec.rows.length} rows`);
}
process.exitCode = rec.rows.every((row) => row.status === "PASS") ? 0 : 1;
