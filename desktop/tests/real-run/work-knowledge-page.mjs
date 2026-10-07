// Playwright implementation of the `ctx` that work-knowledge-rows.mjs drives. Every selector here
// is a test id or accessible name that the mock-bridge specs (work-area-work, work-area-knowledge,
// work-area-pins) already bind to the production components, so a selector that stops matching
// shows up there first. Nothing is seeded and no IPC is replaced: this clicks the real app.

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Poll `read` until it returns a truthy value or the time is up. Returns the last value. */
async function until(read, timeoutMs, stepMs = 400) {
  const end = Date.now() + timeoutMs;
  let value = await read().catch(() => undefined);
  while (!value && Date.now() < end) {
    await sleep(stepMs);
    value = await read().catch(() => undefined);
  }
  return value;
}

const TAB_NAME = { work: "Work", knowledge: "Knowledge" };

/**
 * @param {import("@playwright/test").Page} page the app window (a proxy that follows the live window is fine)
 * @param {{shot: (name: string) => Promise<string | null>}} options
 */
export function pageContext(page, { shot }) {
  const dock = () => page.getByTestId("work-area-panel");
  const welcome = () =>
    page.locator('[data-testid="channel-welcome" i]').first();

  async function ensureChannel() {
    const tabs = page.getByTestId("channel-view-tabs");
    if (await tabs.isVisible().catch(() => false)) return true;
    await welcome().click({ timeout: 15000 });
    await tabs.waitFor({ timeout: 20000 });
    return true;
  }

  const settledDockText = async () => {
    let text = "";
    await until(async () => {
      text = await dock().innerText();
      return !/\bLoading\b/u.test(text);
    }, 20000);
    return text;
  };

  const messageRow = (text) =>
    page.getByTestId("message-row").filter({ hasText: text }).last();

  async function openMessageMenu(text) {
    const row = messageRow(text);
    await row.waitFor({ state: "visible", timeout: 30000 });
    await row.hover();
    const more = row.locator('[data-testid^="more-actions-"]').first();
    await more
      .click({ timeout: 8000 })
      .catch(() => more.evaluate((el) => el.click()));
    const item = page.locator('[data-testid^="pin-message-"]').first();
    await item.waitFor({ state: "visible", timeout: 10000 });
    return item;
  }

  return {
    shot,

    async channelState() {
      await ensureChannel().catch(() => false);
      return {
        inChannel: await page
          .getByTestId("message-timeline")
          .isVisible()
          .catch(() => false),
        headerTabs: await page
          .getByTestId("channel-view-tabs")
          .isVisible()
          .catch(() => false),
        composer: await page
          .getByTestId("message-composer")
          .isVisible()
          .catch(() => false),
      };
    },

    async openDockTab(tab) {
      await ensureChannel();
      await page
        .getByTestId(`channel-view-tab-${tab}`)
        .click({ timeout: 10000 });
      await dock().waitFor({ state: "visible", timeout: 15000 });
      const selected = await until(
        async () =>
          (await dock()
            .getByRole("tab", { name: TAB_NAME[tab], exact: true })
            .getAttribute("aria-selected")) === "true",
        10000,
      );
      return { selected: Boolean(selected) };
    },

    dockText: settledDockText,

    async dockHas(testId) {
      return (await dock().getByTestId(testId).count()) > 0;
    },

    async sectionText(testId) {
      const section = dock().getByTestId(testId);
      if ((await section.count()) === 0) return null;
      return section.first().innerText();
    },

    async createCanvasNote(markdown) {
      await ensureChannel();
      await page
        .getByTestId("channel-view-tab-canvas")
        .click({ timeout: 10000 });
      await page.getByTestId("work-area-canvas").waitFor({ timeout: 15000 });
      const edit = page.getByTestId("channel-canvas-edit");
      if (!(await until(() => edit.isVisible(), 15000)))
        return { saved: false, shown: "" };
      await edit.click();
      const editor = page.getByTestId("channel-canvas-editor");
      await editor.waitFor({ timeout: 10000 });
      await editor.fill(markdown);
      await page.getByTestId("channel-canvas-save").click();
      const saved = await until(async () => !(await editor.isVisible()), 25000);
      if (!saved) return { saved: false, shown: "" };
      const content = page.getByTestId("channel-canvas-content");
      await content.waitFor({ timeout: 15000 }).catch(() => undefined);
      return {
        saved: true,
        shown: (await content.innerText().catch(() => "")) || "",
      };
    },

    async sendMessage(text) {
      await ensureChannel();
      const box = page
        .getByTestId("message-composer")
        .locator('[contenteditable="true"]')
        .first();
      await box.click();
      await box.pressSequentially(text);
      await box.press("Enter");
      // Seen once in the earlier gates: Enter left the text in the composer. Retry with the send shortcut.
      await sleep(1200);
      if ((await box.innerText().catch(() => "")).trim().length > 20)
        await box.press("Meta+Enter");
      const shown = await until(() => messageRow(text).isVisible(), 30000);
      return { sent: Boolean(shown) };
    },

    async pinMessage(text) {
      const item = await openMessageMenu(text);
      // The item stays disabled until the channel's pins have loaded, so a pin is never made on a guess.
      const ready = await until(
        async () => (await item.getAttribute("data-disabled")) === null,
        15000,
      );
      if (!ready)
        return {
          toastSeen: false,
          errorToast: null,
          menuAfter: await item.innerText(),
        };
      await item.click();
      const toastSeen = Boolean(
        await until(
          () => page.getByText("Pinned to the channel").first().isVisible(),
          8000,
        ),
      );
      const errorLocator = page.getByText("Couldn't pin the message").first();
      const errorToast = (await errorLocator.isVisible().catch(() => false))
        ? "Couldn't pin the message. Try again."
        : null;
      if (errorToast) return { toastSeen, errorToast, menuAfter: null };
      await sleep(1500);
      // Reopen the menu: it reads the pins again, so "Unpin from channel" proves the reader saw our pin.
      await page.keyboard.press("Escape").catch(() => undefined);
      let menuAfter = null;
      await until(
        async () => {
          const again = await openMessageMenu(text);
          menuAfter = (await again.innerText()).trim();
          await page.keyboard.press("Escape").catch(() => undefined);
          return menuAfter === "Unpin from channel";
        },
        15000,
        1500,
      );
      return { toastSeen, errorToast: null, menuAfter };
    },

    async openPinsScreen() {
      await ensureChannel();
      await page.getByTestId("channel-pins-trigger").click({ timeout: 10000 });
      const screen = page.getByTestId("channel-pins-screen");
      await screen.waitFor({ timeout: 15000 });
      let text = "";
      await until(async () => {
        text = await screen.innerText();
        return !/Loading pinned messages/u.test(text);
      }, 15000);
      return text;
    },

    async reload() {
      await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
      const sidebar = Boolean(
        await until(
          () => page.getByTestId("app-sidebar").isVisible(),
          90000,
          1000,
        ),
      );
      if (!sidebar) return { sidebar: false, channel: false };
      const channel = await ensureChannel().catch(() => false);
      return { sidebar: true, channel };
    },

    async unpinFromKnowledge(text) {
      await this.openDockTab("knowledge");
      await settledDockText();
      const pins = dock().getByTestId("work-area-knowledge-pins");
      const row = pins.locator("li").filter({ hasText: text }).first();
      await row.waitFor({ timeout: 15000 });
      await row
        .locator('[data-testid^="pinned-messages-unpin-"]')
        .first()
        .click();
      const toastSeen = Boolean(
        await until(() => page.getByText("Unpinned").first().isVisible(), 8000),
      );
      const gone = Boolean(
        await until(
          async () =>
            (await pins.locator("li").filter({ hasText: text }).count()) === 0,
          15000,
        ),
      );
      return { gone, toastSeen };
    },
  };
}
