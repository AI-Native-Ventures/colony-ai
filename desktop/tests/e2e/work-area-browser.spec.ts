import { expect, test, type Page } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";
import {
  type FakeCall,
  installBrowserHostFake,
} from "./helpers/browserHostFake";

// The work area's Browser tab, bound through the real App with the browser
// host replaced by a contract-faithful fake (tests/e2e/helpers/browserHostFake):
// tabs, address bar, history, refusals, errors, new windows, downloads, the
// native view's fit, keyboard and pointer parity, per-channel memory and lazy
// restore. The URL rules in the fake are the host's real policy functions.
// Real cookies, storage isolation and downloads run against real Electron in
// tests/electron/browser-tab.spec.ts.

const STORAGE_PREFIX = "colony-work-area-browser.v1:";

const dock = (page: Page) => page.getByTestId("work-area-panel");
// Every tab's panel stays mounted; only the shown one is not [hidden]. Browser
// controls are always asked of the shown page.
const panelTid = (page: Page, id: string) =>
  dock(page).locator('section[role="tabpanel"]:not([hidden])').getByTestId(id);
const trigger = (page: Page) => page.getByTestId("channel-work-area-trigger");
const address = (page: Page) => panelTid(page, "browser-address");
// Every browser page is a tab of the dock itself, titled by the page.
const pageTabs = (page: Page) =>
  dock(page).getByRole("tablist", { name: "Work area tabs" });
const pageTab = (page: Page, name: string | RegExp) =>
  pageTabs(page).getByRole("tab", { name });
const notices = (page: Page) => panelTid(page, "browser-notices");

async function openChannel(page: Page, name: string) {
  await page.getByTestId(`channel-${name}`).click();
  await expect(page.getByTestId("chat-title")).toHaveText(name);
}

async function boot(page: Page, options: { fake?: boolean } = {}) {
  await page.setViewportSize({ width: 1440, height: 900 });
  if (options.fake !== false) await installBrowserHostFake(page);
  await installMockBridge(page);
  await page.goto("/");
  await expect(page.getByTestId("home-inbox-list")).toBeVisible();
  await openChannel(page, "general");
  await expect(trigger(page)).toBeVisible();
}

async function openBrowserTab(page: Page) {
  await trigger(page).click();
  await expect(dock(page)).toBeVisible();
  await page.getByTestId("work-area-open-browser").click();
  await expect(pageTab(page, "New tab")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(panelTid(page, "work-area-browser")).toBeVisible();
}

async function newBrowserTab(page: Page) {
  await page.getByTestId("work-area-add-tab").click();
  await page.getByTestId("work-area-add-browser").click();
}

async function go(page: Page, text: string) {
  await address(page).fill(text);
  await address(page).press("Enter");
}

const calls = (page: Page, op?: string) =>
  page.evaluate(
    (wanted) =>
      (window.__browserFake?.calls ?? []).filter(
        (call) => !wanted || call.op === wanted,
      ),
    op,
  ) as Promise<FakeCall[]>;

const hostTabs = (page: Page) =>
  page.evaluate(() => window.__browserFake?.tabs() ?? []);

async function openPage(page: Page, text: string) {
  await openBrowserTab(page);
  await go(page, text);
  await expect(address(page)).toHaveValue(/^https?:\/\//);
}

test.describe("work area Browser tab", () => {
  test("is offered first, opens a start page and says whose browser it is", async ({
    page,
  }) => {
    await boot(page);
    await trigger(page).click();
    const choices = page.locator(".colony-work-area-choice");
    await expect(choices.first()).toHaveAccessibleName("Browser");
    await page.getByTestId("work-area-open-browser").click();

    // The page is a tab of the dock, titled "New tab" until it has a title.
    const tab = pageTab(page, "New tab");
    await expect(tab).toHaveAttribute("aria-selected", "true");
    await expect(panelTid(page, "browser-start")).toContainText(
      "Where are we working?",
    );
    await expect(
      dock(page).getByRole("tabpanel", { name: "New tab" }),
    ).toBeVisible();
    await expect(panelTid(page, "browser-status")).toContainText(
      "Separate browser profile",
    );
    await expect(panelTid(page, "browser-status")).toContainText(
      "Not shared with agents",
    );
    // A blank tab has no page, so the host has been asked for nothing.
    expect(await calls(page, "createTab")).toEqual([]);
    // Back, forward and reload have nothing to do yet.
    await expect(panelTid(page, "browser-back")).toBeDisabled();
    await expect(panelTid(page, "browser-forward")).toBeDisabled();
    await expect(panelTid(page, "browser-reload")).toBeDisabled();
    // A new tab takes the address bar, so typing starts at once.
    await expect(address(page)).toBeFocused();
  });

  test("the globe on the conversation toolbar opens the browser, as in the reference", async ({
    page,
  }) => {
    await boot(page);
    await expect(dock(page)).toHaveCount(0);
    const globe = page.getByRole("button", { name: "Open browser" });
    await globe.focus();
    await page.keyboard.press("Enter");
    await expect(pageTab(page, "New tab")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(panelTid(page, "browser-start")).toBeVisible();
    // Pressing it again focuses the browser tab that is open; it opens no more.
    await globe.click();
    await expect(pageTabs(page).getByRole("tab")).toHaveCount(1);
    await expect(pageTab(page, "New tab")).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  test("navigates in this business's profile, shows the real address, and history drives the host", async ({
    page,
  }) => {
    await boot(page);
    await openBrowserTab(page);
    await go(page, "fixture.test/a");

    await expect(address(page)).toHaveValue("https://fixture.test/a");
    await expect(pageTab(page, "fixture.test/a")).toBeVisible();
    await expect(panelTid(page, "browser-page-slot")).toBeVisible();
    const [created] = await calls(page, "createTab");
    expect(created.url).toBe("https://fixture.test/a");
    // The business is the community: the id the browser store is keyed by.
    const keys = await page.evaluate(
      (prefix) =>
        Object.keys(window.localStorage).filter((key) =>
          key.startsWith(prefix),
        ),
      STORAGE_PREFIX,
    );
    expect(keys).toHaveLength(1);
    expect(created.businessId).toBe(keys[0].slice(STORAGE_PREFIX.length));

    await go(page, "fixture.test/b");
    await expect(address(page)).toHaveValue("https://fixture.test/b");
    await expect(panelTid(page, "browser-back")).toBeEnabled();
    await expect(panelTid(page, "browser-forward")).toBeDisabled();

    await panelTid(page, "browser-back").click();
    await expect(address(page)).toHaveValue("https://fixture.test/a");
    await expect(panelTid(page, "browser-forward")).toBeEnabled();
    await panelTid(page, "browser-forward").click();
    await expect(address(page)).toHaveValue("https://fixture.test/b");

    await panelTid(page, "browser-reload").click();
    await expect.poll(async () => (await calls(page, "reload")).length).toBe(1);
    // Redirects and in-page changes show up: the bar is the page's address.
    await page.evaluate(() => {
      const tab = window.__browserFake?.tabs()[0];
      if (tab)
        window.__browserFake?.emit({
          type: "state",
          tab: { ...tab, url: "https://fixture.test/final" },
        });
    });
    await expect(address(page)).toHaveValue("https://fixture.test/final");
  });

  test("a bare local address opens over http, and an insecure page says so", async ({
    page,
  }) => {
    await boot(page);
    await openBrowserTab(page);
    await go(page, "localhost:3000/app");
    await expect(address(page)).toHaveValue("http://localhost:3000/app");
    await expect(page.getByRole("img", { name: /Not secure/ })).toBeVisible();
    await go(page, "fixture.test");
    await expect(
      page.getByRole("img", { name: "Secure connection" }),
    ).toBeVisible();
  });

  test("refuses file, script, data and browser-internal addresses with a reason and never asks the host", async ({
    page,
  }) => {
    await boot(page);
    await openBrowserTab(page);
    for (const refused of [
      "file:///etc/passwd",
      "javascript:alert(1)",
      "data:text/html,<h1>x</h1>",
      "chrome://settings",
      "blob:https://fixture.test/abc",
      "https://user:secret@fixture.test/",
    ]) {
      await go(page, refused);
      const problem = panelTid(page, "browser-address-error");
      await expect(problem).toBeVisible();
      await expect(problem).toHaveAttribute("role", "alert");
      await expect(address(page)).toHaveAttribute("aria-invalid", "true");
      await expect(address(page)).toHaveAttribute(
        "aria-describedby",
        "colony-browser-address-error",
      );
      // What was typed stays, so it can be fixed rather than retyped.
      await expect(address(page)).toHaveValue(refused);
      await page.keyboard.press("Escape");
      await expect(problem).toHaveCount(0);
    }
    await go(page, "file:///etc/passwd");
    await expect(panelTid(page, "browser-address-error")).toContainText(
      "only opens web pages",
    );
    expect(
      (await calls(page)).filter((call) =>
        ["createTab", "navigate"].includes(call.op),
      ),
    ).toEqual([]);
    expect(await hostTabs(page)).toEqual([]);
  });

  test("refuses link-local and cloud metadata addresses in any spelling, and leaves ordinary private addresses open", async ({
    page,
  }) => {
    await boot(page);
    await openBrowserTab(page);
    for (const refused of [
      "169.254.169.254",
      "http://169.254.169.254/latest/meta-data/",
      "metadata.google.internal",
      "http://[fd00:ec2::254]/",
      "http://2852039166/",
      "http://[::ffff:169.254.169.254]/",
    ]) {
      await go(page, refused);
      const error = panelTid(page, "browser-error");
      await expect(error).toContainText("This address can't be opened here");
      await expect(error).toContainText("link-local or cloud metadata");
      expect(await hostTabs(page)).toEqual([]);
    }
    // A router page is an ordinary private address: the person may open it.
    await go(page, "192.168.1.1");
    await expect(panelTid(page, "browser-error")).toHaveCount(0);
    await expect.poll(async () => (await hostTabs(page)).length).toBe(1);
    expect((await hostTabs(page))[0].url).toBe("https://192.168.1.1/");
  });

  test("a page that cannot load shows an error with Try again; a crash says so", async ({
    page,
  }) => {
    await boot(page);
    await openBrowserTab(page);
    await go(page, "unreachable.test");
    const error = panelTid(page, "browser-error");
    await expect(error).toContainText("This site can't be found");
    await expect(error).toContainText("ERR_NAME_NOT_RESOLVED");
    await expect(error).toContainText("https://unreachable.test/");
    // The page view is not left attached behind the message.
    await expect(panelTid(page, "browser-page-slot")).toHaveCount(0);

    await panelTid(page, "browser-error-retry").click();
    await expect.poll(async () => (await calls(page, "reload")).length).toBe(1);

    await go(page, "fixture.test/ok");
    await expect(error).toHaveCount(0);
    await page.evaluate(() => {
      const tab = window.__browserFake?.tabs()[0];
      if (tab) window.__browserFake?.crash(tab.id);
    });
    await expect(error).toContainText("This page stopped working");
    await panelTid(page, "browser-error-back").click();
  });

  test("loading shows Stop, and a stopped page returns to Reload", async ({
    page,
  }) => {
    await boot(page);
    await openBrowserTab(page);
    await go(page, "slow.test");
    const reload = panelTid(page, "browser-reload");
    await expect(reload).toHaveAccessibleName("Stop loading");
    await reload.click();
    await expect(reload).toHaveAccessibleName("Reload");
    expect((await calls(page, "stop")).length).toBe(1);
  });

  test("tabs: add from the menu, arrows, Delete and Ctrl/Cmd+W close, and the last close closes the dock", async ({
    page,
  }) => {
    await boot(page);
    await openPage(page, "fixture.test/one");
    // The menu always offers Browser, for one more page.
    await newBrowserTab(page);
    await expect(pageTab(page, "New tab")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(panelTid(page, "browser-start")).toBeVisible();
    await expect(address(page)).toBeFocused();
    await go(page, "fixture.test/two");
    await expect(pageTab(page, "fixture.test/two")).toHaveAttribute(
      "aria-selected",
      "true",
    );

    // Ctrl/Cmd+T from the address bar opens a tab and focuses its address.
    await address(page).press("ControlOrMeta+t");
    await expect(pageTabs(page).getByRole("tab")).toHaveCount(3);
    await expect(pageTab(page, "New tab")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(address(page)).toBeFocused();

    // The dock's tab strip: manual activation, as for every other tab.
    const first = pageTab(page, "fixture.test/one");
    await first.focus();
    await page.keyboard.press("ArrowRight");
    await expect(pageTab(page, "fixture.test/two")).toBeFocused();
    await expect(first).toHaveAttribute("aria-selected", "false");
    await page.keyboard.press("End");
    await page.keyboard.press("Home");
    await expect(first).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(first).toHaveAttribute("aria-selected", "true");
    await expect(address(page)).toHaveValue("https://fixture.test/one");

    // Delete closes the focused tab and the host tab goes with it.
    await pageTab(page, "fixture.test/two").focus();
    await page.keyboard.press("Delete");
    await expect(pageTab(page, "fixture.test/two")).toHaveCount(0);
    expect((await calls(page, "closeTab")).length).toBe(1);

    // Ctrl/Cmd+W closes the tab on screen.
    await panelTid(page, "browser-reload").focus();
    await page.keyboard.press("ControlOrMeta+w");
    await expect(pageTab(page, "fixture.test/one")).toHaveCount(0);
    await expect(pageTabs(page).getByRole("tab")).toHaveCount(1);
    expect(await hostTabs(page)).toEqual([]);

    // The last tab's close button closes the dock, as in the reference.
    await page.getByRole("button", { name: "Close New tab" }).click();
    await expect(dock(page)).toHaveCount(0);
    await expect(trigger(page)).toBeFocused();
  });

  test("a window opened by a page becomes a tab beside it; one the host refuses shows a notice", async ({
    page,
  }) => {
    await boot(page);
    await openPage(page, "fixture.test/home");
    const [tab] = await hostTabs(page);
    await page.evaluate((id) => {
      window.__browserFake?.popup(id, "https://popup.test/opened");
    }, tab.id);
    await expect(pageTab(page, "popup.test/opened")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(address(page)).toHaveValue("https://popup.test/opened");
    await expect(pageTabs(page).getByRole("tab")).toHaveCount(2);

    // window.open("file:///...") and friends: refused, said so, page stays.
    // The notice belongs to the page that asked, so look at that page.
    await pageTab(page, "fixture.test/home").click();
    await page.evaluate((id) => {
      window.__browserFake?.popup(id, "file:///etc/passwd");
    }, tab.id);
    const notice = panelTid(page, "browser-notice-blocked");
    await expect(notice).toContainText("Colony does not open");
    await expect(pageTabs(page).getByRole("tab")).toHaveCount(2);
    await page.getByRole("button", { name: "Dismiss message" }).click();
    await expect(notice).toHaveCount(0);
  });

  test("downloads show a result in the notices, with Show in folder only for a finished file", async ({
    page,
  }) => {
    await boot(page);
    await openPage(page, "fixture.test/page");
    await go(page, "files.test/report.pdf");
    const notice = panelTid(page, "browser-notice-download");
    await expect(notice).toContainText(
      "Saved report.pdf to your Downloads folder",
    );
    // A download does not navigate the page away.
    await expect(address(page)).toHaveValue("https://fixture.test/page");
    await expect(notices(page)).toHaveAttribute("aria-live", "polite");

    await panelTid(page, "browser-notice-reveal").click();
    await expect
      .poll(() => page.evaluate(() => window.__browserFake?.revealed))
      .toEqual(["download-1"]);

    await page.evaluate(() => {
      const tab = window.__browserFake?.tabs()[0];
      if (tab) window.__browserFake?.download(tab.id, "big.zip", "interrupted");
    });
    const failed = page
      .getByTestId("browser-notice-download")
      .filter({ hasText: "big.zip" });
    await expect(failed).toContainText("did not finish downloading");
    await expect(failed.getByTestId("browser-notice-reveal")).toHaveCount(0);

    await page.getByRole("button", { name: "Dismiss report.pdf" }).click();
    await expect(notice.filter({ hasText: "report.pdf" })).toHaveCount(0);
  });

  test("the page view is fitted to its slot, hidden for menus and other tabs, and follows resizes", async ({
    page,
  }) => {
    await boot(page);
    await openPage(page, "fixture.test/fit");
    const fill = page.locator(".colony-browser-slot-fill");

    const lastBounds = async () => {
      const attaches = await calls(page, "attach");
      return attaches.at(-1)?.bounds as {
        x: number;
        y: number;
        width: number;
        height: number;
      };
    };
    await expect
      .poll(async () => (await calls(page, "attach")).length)
      .toBeGreaterThan(0);
    const box = await fill.boundingBox();
    const bounds = await lastBounds();
    expect(box).not.toBeNull();
    expect(Math.abs(bounds.x - (box?.x ?? 0))).toBeLessThanOrEqual(1);
    expect(Math.abs(bounds.y - (box?.y ?? 0))).toBeLessThanOrEqual(1);
    expect(Math.abs(bounds.width - (box?.width ?? 0))).toBeLessThanOrEqual(1);
    expect(Math.abs(bounds.height - (box?.height ?? 0))).toBeLessThanOrEqual(1);
    expect((await hostTabs(page))[0].visible).toBe(true);

    // An open menu draws over the page area: the page steps aside.
    await page.getByTestId("work-area-add-tab").click();
    await expect
      .poll(async () => (await hostTabs(page))[0].attached)
      .toBe(false);
    await page.keyboard.press("Escape");
    await expect.poll(async () => (await hostTabs(page))[0].visible).toBe(true);
    await expect(dock(page)).toBeVisible();

    // Resizing the dock moves the page with it.
    const before = (await lastBounds()).width;
    await page.getByRole("separator", { name: "Work area size" }).focus();
    for (let i = 0; i < 5; i += 1) await page.keyboard.press("ArrowRight");
    await expect
      .poll(async () => (await lastBounds()).width)
      .toBeLessThan(before);

    // Another dock tab on screen: the page is away, and comes back with its tab.
    await page.getByTestId("work-area-add-tab").click();
    await page.getByTestId("work-area-add-files").click();
    await expect(
      dock(page).getByRole("tab", { name: "Files", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await expect
      .poll(async () => (await hostTabs(page))[0].attached)
      .toBe(false);
    await pageTab(page, "fixture.test/fit").click();
    await expect.poll(async () => (await hostTabs(page))[0].visible).toBe(true);

    // Closing the dock keeps the page alive but detached.
    await dock(page).getByRole("button", { name: "Close work area" }).click();
    await expect(dock(page)).toHaveCount(0);
    await expect
      .poll(async () => (await hostTabs(page))[0].attached)
      .toBe(false);
    expect(await hostTabs(page)).toHaveLength(1);
    await trigger(page).click();
    await expect.poll(async () => (await hostTabs(page))[0].visible).toBe(true);
  });

  test("keyboard: Ctrl/Cmd+L, Escape undoes a draft, Enter on the page hands it the keyboard, relayed keys work from the page", async ({
    page,
  }) => {
    await boot(page);
    await openPage(page, "fixture.test/keys");

    await panelTid(page, "browser-reload").focus();
    await page.keyboard.press("ControlOrMeta+l");
    await expect(address(page)).toBeFocused();
    await page.keyboard.type("draft.test");
    await expect(address(page)).toHaveValue("draft.test");
    await page.keyboard.press("Escape");
    await expect(address(page)).toHaveValue("https://fixture.test/keys");
    // Escape was the address bar's own, not the dock's.
    await expect(dock(page)).toBeVisible();

    // The page is a native view; the keyboard gets in through its region.
    const slot = panelTid(page, "browser-page-slot");
    await expect(slot).toHaveAccessibleName("Move the keyboard into the page");
    await slot.focus();
    await page.keyboard.press("Enter");
    expect((await calls(page, "focus")).length).toBe(1);

    // From the page the host relays the same keys.
    await go(page, "fixture.test/second");
    await page.evaluate(() => {
      (document.activeElement as HTMLElement | null)?.blur();
    });
    const tabId = (await hostTabs(page))[0].id;
    await page.evaluate(
      (id) => window.__browserFake?.shortcut(id, "back"),
      tabId,
    );
    await expect(address(page)).toHaveValue("https://fixture.test/keys");
    await page.evaluate(
      (id) => window.__browserFake?.shortcut(id, "focus-address"),
      tabId,
    );
    await expect(address(page)).toBeFocused();
    // The dock toggle comes through the page too; the page stays alive behind it.
    await page.evaluate(
      (id) => window.__browserFake?.shortcut(id, "toggle-dock"),
      tabId,
    );
    await expect(dock(page)).toHaveCount(0);
    expect(await hostTabs(page)).toHaveLength(1);
    await trigger(page).click();
    await expect(address(page)).toHaveValue("https://fixture.test/keys");
    await page.evaluate(
      (id) => window.__browserFake?.shortcut(id, "new-tab"),
      tabId,
    );
    await expect(pageTabs(page).getByRole("tab")).toHaveCount(2);
    await expect(address(page)).toBeFocused();
  });

  test("pages are kept per channel, survive a reload, and only the shown one loads again", async ({
    page,
  }) => {
    await boot(page);
    await openPage(page, "fixture.test/one");
    await newBrowserTab(page);
    await go(page, "fixture.test/two");
    await expect(pageTab(page, "fixture.test/two")).toHaveAttribute(
      "aria-selected",
      "true",
    );

    // Another channel has its own, empty, dock; this one is unchanged on return.
    await openChannel(page, "random");
    await expect(dock(page)).toHaveCount(0);
    await trigger(page).click();
    await expect(page.getByTestId("work-area-empty")).toBeVisible();
    await openChannel(page, "general");
    await expect(pageTabs(page).getByRole("tab")).toHaveCount(2);
    expect((await calls(page, "createTab")).length).toBe(2);

    await page.reload();
    await expect(page.getByTestId("channel-general")).toBeVisible();
    await openChannel(page, "general");
    await expect(dock(page)).toBeVisible();
    await expect(pageTabs(page).getByRole("tab")).toHaveCount(2);
    await expect(pageTab(page, "fixture.test/two")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    // Restored pages are dormant: only the one on screen is loaded.
    await expect
      .poll(async () => (await calls(page, "createTab")).map((c) => c.url))
      .toEqual(["https://fixture.test/two"]);
    expect((await calls(page, "closeBusiness")).length).toBeGreaterThanOrEqual(
      1,
    );
    await pageTab(page, /fixture\.test\/one/).click();
    await expect
      .poll(async () => (await calls(page, "createTab")).map((c) => c.url))
      .toEqual(["https://fixture.test/two", "https://fixture.test/one"]);
    await expect(address(page)).toHaveValue("https://fixture.test/one");
  });

  test("the toolbar, tabs and notices are reachable and named for assistive technology", async ({
    page,
  }) => {
    await boot(page);
    await openPage(page, "fixture.test/a11y");
    await expect(
      dock(page).getByRole("toolbar", { name: "Browser controls" }),
    ).toBeVisible();
    for (const name of ["Back", "Forward", "Reload"]) {
      await expect(
        dock(page).getByRole("button", { name, exact: true }),
      ).toHaveCount(1);
    }
    await expect(
      dock(page).getByRole("textbox", { name: "Web address" }),
    ).toHaveValue("https://fixture.test/a11y");
    // One owner per label: each tab's close control is its own named button.
    await expect(
      page.getByRole("button", { name: "Close fixture.test/a11y" }),
    ).toHaveCount(1);
    await expect(notices(page)).toHaveAttribute("role", "status");
    await expect(
      dock(page).getByRole("tabpanel", { name: "fixture.test/a11y" }),
    ).toBeVisible();
    // Tab order: back (disabled, skipped), reload, address, then the page region.
    await panelTid(page, "browser-reload").focus();
    await page.keyboard.press("Tab");
    await expect(address(page)).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(panelTid(page, "browser-page-slot")).toBeFocused();
  });

  test("where there is no browser host, the tab is not offered at all", async ({
    page,
  }) => {
    await boot(page, { fake: false });
    await expect(
      page.getByRole("button", { name: "Open browser" }),
    ).toHaveCount(0);
    await trigger(page).click();
    await expect(page.getByTestId("work-area-open-browser")).toHaveCount(0);
    await expect(page.getByTestId("work-area-empty")).toContainText(
      "Open a terminal, read a file, or see this channel's work and knowledge.",
    );
    await page.getByTestId("work-area-open-files").click();
    await page.getByTestId("work-area-add-tab").click();
    await expect(page.getByTestId("work-area-add-browser")).toHaveCount(0);
  });
});
