import { expect, test, type Page } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";
import {
  installTerminalBackend,
  readTerminalBackend,
} from "./helpers/terminalBackend";

// The conversation work area dock, bound through the real App: the Work area
// button, the tab strip, the divider, the persisted per-channel layout, the
// terminal hosted as a tab, and the guarantees that opening or resizing the
// dock never costs the user a composer draft or a scroll position.

const TERM = 'section[aria-label="Colony Term"]';
const STORAGE_PREFIX = "colony-work-area.v1:";
const MAC = process.platform === "darwin";
const WRONG_PRIMARY = MAC ? "Control" : "Meta";

const dock = (page: Page) => page.getByTestId("work-area-panel");
const trigger = (page: Page) => page.getByTestId("channel-work-area-trigger");
const divider = (page: Page) =>
  page.getByRole("separator", { name: "Work area size" });

async function openChannel(page: Page, name: string) {
  await page.getByTestId(`channel-${name}`).click();
  await expect(page.getByTestId("chat-title")).toHaveText(name);
}

async function boot(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await installTerminalBackend(page);
  await installMockBridge(page);
  await page.goto("/");
  await expect(page.getByTestId("home-inbox-list")).toBeVisible();
  await openChannel(page, "general");
  await expect(trigger(page)).toBeVisible();
}

async function openFilesTab(page: Page) {
  await trigger(page).click();
  await expect(dock(page)).toBeVisible();
  await page.getByTestId("work-area-open-files").click();
  await expect(
    dock(page).getByRole("tab", { name: "Files", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
}

const widthValue = async (page: Page) =>
  Number(await divider(page).getAttribute("aria-valuenow"));

async function storedLayout(page: Page) {
  return page.evaluate((prefix) => {
    const keys = Object.keys(window.localStorage).filter((key) =>
      key.startsWith(prefix),
    );
    return keys.map((key) => ({
      key,
      value: JSON.parse(window.localStorage.getItem(key) ?? "null"),
    }));
  }, STORAGE_PREFIX);
}

test.describe("work area dock", () => {
  test("opens from the Work area button with real tab semantics and closes with focus restored", async ({
    page,
  }) => {
    await boot(page);
    await expect(trigger(page)).toHaveAttribute("aria-expanded", "false");
    await trigger(page).focus();
    await page.keyboard.press("Enter");

    await expect(dock(page)).toBeVisible();
    await expect(trigger(page)).toHaveAttribute("aria-expanded", "true");
    // Nothing open yet: the empty state offers the tab kinds, no empty tablist.
    await expect(page.getByTestId("work-area-empty")).toBeVisible();
    await expect(dock(page).getByRole("tablist")).toHaveCount(0);

    await page.getByTestId("work-area-open-files").click();
    await expect(
      dock(page).getByRole("tablist", { name: "Work area tabs" }),
    ).toBeVisible();
    const filesTab = dock(page).getByRole("tab", {
      name: "Files",
      exact: true,
    });
    await expect(filesTab).toHaveAttribute("aria-selected", "true");
    // One owner per label: the close control is its own named button.
    await expect(
      dock(page).getByRole("button", { name: "Close Files", exact: true }),
    ).toHaveCount(1);
    const panel = dock(page).getByRole("tabpanel", { name: "Files" });
    await expect(panel).toBeVisible();
    // No local agent in this mock: the honest empty state, no fake files.
    await expect(page.getByTestId("work-area-files-no-agent")).toBeVisible();
    await expect(panel).toContainText("No agent workspace here yet");

    // Escape from the header closes the dock and returns focus to the opener.
    await filesTab.focus();
    await page.keyboard.press("Escape");
    await expect(dock(page)).toHaveCount(0);
    await expect(trigger(page)).toBeFocused();
    await expect(trigger(page)).toHaveAttribute("aria-expanded", "false");

    // The tab survives the close.
    await trigger(page).click();
    await expect(
      dock(page).getByRole("tab", { name: "Files", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await dock(page).getByRole("button", { name: "Close work area" }).click();
    await expect(dock(page)).toHaveCount(0);
    await expect(trigger(page)).toBeFocused();
  });

  test("tabs: add from the menu, arrow keys move and activate, Delete and the close button close", async ({
    page,
  }) => {
    await boot(page);
    await openFilesTab(page);

    await page.getByTestId("work-area-add-tab").click();
    await page.getByTestId("work-area-add-terminal").click();
    const terminalTab = dock(page).getByRole("tab", {
      name: "Terminal",
      exact: true,
    });
    const filesTab = dock(page).getByRole("tab", {
      name: "Files",
      exact: true,
    });
    await expect(terminalTab).toHaveAttribute("aria-selected", "true");
    await expect(dock(page).locator(TERM)).toBeVisible();
    // Only the kind that is not open yet is offered.
    await page.getByTestId("work-area-add-tab").click();
    await expect(page.getByTestId("work-area-add-canvas")).toBeVisible();
    await expect(page.getByTestId("work-area-add-files")).toHaveCount(0);
    await expect(page.getByTestId("work-area-add-terminal")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("work-area-add-canvas")).toHaveCount(0);
    // Escape closed the menu, not the dock.
    await expect(dock(page)).toBeVisible();

    // Manual activation: arrows move focus, Enter or Space activates. (The
    // terminal takes focus for itself when it is shown, so activating on
    // arrow would trap keyboard users in it.)
    await terminalTab.focus();
    await page.keyboard.press("ArrowLeft");
    await expect(filesTab).toBeFocused();
    await expect(terminalTab).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowLeft");
    await expect(terminalTab).toBeFocused();
    await page.keyboard.press("Home");
    await expect(filesTab).toBeFocused();
    await page.keyboard.press("End");
    await expect(terminalTab).toBeFocused();
    await page.keyboard.press("Home");
    await expect(filesTab).toBeFocused();
    // Modified arrows belong to the platform.
    await page.keyboard.press("ControlOrMeta+ArrowRight");
    await expect(filesTab).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(filesTab).toHaveAttribute("aria-selected", "true");
    await expect(dock(page).locator(TERM)).toHaveCount(0);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Space");
    await expect(terminalTab).toHaveAttribute("aria-selected", "true");
    await expect(dock(page).locator(TERM)).toBeVisible();

    await dock(page)
      .getByRole("button", { name: "Close Terminal", exact: true })
      .click();
    await expect(terminalTab).toHaveCount(0);
    await expect(filesTab).toHaveAttribute("aria-selected", "true");

    // Deleting the last tab closes the dock and hands focus back.
    await filesTab.focus();
    await page.keyboard.press("Delete");
    await expect(dock(page)).toHaveCount(0);
    await expect(trigger(page)).toBeFocused();
  });

  test("resize by keyboard: steps, large steps, Home resets, bounds hold, modified arrows are ignored", async ({
    page,
  }) => {
    await boot(page);
    await openFilesTab(page);
    const handle = divider(page);
    await expect(handle).toHaveAttribute("aria-orientation", "vertical");
    await expect(handle).toHaveAttribute("aria-valuemin", "35");
    await expect(handle).toHaveAttribute("aria-valuemax", "75");
    expect(await widthValue(page)).toBe(64);

    await handle.focus();
    await page.keyboard.press("ArrowRight");
    expect(await widthValue(page)).toBe(62);
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    expect(await widthValue(page)).toBe(66);
    await page.keyboard.press("Shift+ArrowRight");
    expect(await widthValue(page)).toBe(56);
    for (let i = 0; i < 4; i += 1)
      await page.keyboard.press("Shift+ArrowRight");
    expect(await widthValue(page)).toBe(35);
    await page.keyboard.press("Shift+ArrowLeft");
    await page.keyboard.press("Shift+ArrowLeft");
    await page.keyboard.press("Shift+ArrowLeft");
    await page.keyboard.press("Shift+ArrowLeft");
    await page.keyboard.press("Shift+ArrowLeft");
    expect(await widthValue(page)).toBe(75);

    await page.keyboard.press("ControlOrMeta+ArrowRight");
    await page.keyboard.press("Alt+ArrowRight");
    expect(await widthValue(page)).toBe(75);

    await page.keyboard.press("Home");
    expect(await widthValue(page)).toBe(64);
    await page.keyboard.press("ArrowLeft");
    await expect(handle).toHaveAttribute("aria-valuenow", "66");
    await handle.dblclick();
    await expect(handle).toHaveAttribute("aria-valuenow", "64");

    // The painted width follows the value, not just the attribute.
    const layoutBox = await page.getByTestId("work-area-layout").boundingBox();
    const dockBox = await dock(page).boundingBox();
    expect(layoutBox).not.toBeNull();
    expect(dockBox).not.toBeNull();
    expect(
      Math.abs(((dockBox?.width ?? 0) / (layoutBox?.width ?? 1)) * 100 - 64),
    ).toBeLessThan(1.5);
  });

  test("resize by pointer drag commits once and persists", async ({ page }) => {
    await boot(page);
    await openFilesTab(page);
    const handle = divider(page);
    const box = await handle.boundingBox();
    expect(box).not.toBeNull();
    const startX = (box?.x ?? 0) + (box?.width ?? 0) / 2;
    const y = (box?.y ?? 0) + 200;
    await page.mouse.move(startX, y);
    await page.mouse.down();
    await page.mouse.move(startX + 120, y, { steps: 6 });
    await page.mouse.up();
    const after = await widthValue(page);
    expect(after).toBeLessThan(64);
    expect(after).toBeGreaterThanOrEqual(35);
    const [layout] = await storedLayout(page);
    const channels = Object.values(layout.value.channels) as {
      width: number;
    }[];
    expect(channels[0].width).toBe(after);
  });

  test("layout survives a reload and is kept per channel", async ({ page }) => {
    await boot(page);
    await openFilesTab(page);
    await divider(page).focus();
    for (let i = 0; i < 7; i += 1) await page.keyboard.press("ArrowRight");
    expect(await widthValue(page)).toBe(50);

    await openChannel(page, "random");
    await expect(dock(page)).toHaveCount(0);
    await openChannel(page, "general");
    await expect(dock(page)).toBeVisible();
    expect(await widthValue(page)).toBe(50);

    await page.reload();
    await expect(page.getByTestId("channel-general")).toBeVisible();
    await openChannel(page, "general");
    await expect(dock(page)).toBeVisible();
    await expect(
      dock(page).getByRole("tab", { name: "Files", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    expect(await widthValue(page)).toBe(50);
    await openChannel(page, "random");
    await expect(dock(page)).toHaveCount(0);

    const layouts = await storedLayout(page);
    expect(layouts).toHaveLength(1);
    expect(layouts[0].value.version).toBe(1);
    expect(Object.keys(layouts[0].value.channels)).toHaveLength(1);
  });

  test("a community switch resets the dock and each community remembers its own layout", async ({
    page,
  }) => {
    const COMMUNITY_A = {
      id: "ws-a",
      name: "Alpha",
      relayUrl: "ws://localhost:3000",
      addedAt: "2026-01-01T00:00:00.000Z",
    };
    const COMMUNITY_B = {
      id: "ws-b",
      name: "Bravo",
      relayUrl: "ws://localhost:3001",
      addedAt: "2026-01-02T00:00:00.000Z",
    };
    await page.setViewportSize({ width: 1440, height: 900 });
    await installMockBridge(page, undefined, { skipCommunitySeed: true });
    await page.addInitScript(
      ({ list, active }) => {
        if (window.localStorage.getItem("buzz-communities") === null) {
          window.localStorage.setItem("buzz-communities", JSON.stringify(list));
          window.localStorage.setItem("buzz-active-community-id", active);
        }
      },
      { list: [COMMUNITY_A, COMMUNITY_B], active: COMMUNITY_A.id },
    );
    await page.goto("/");
    await expect(page.getByTestId("home-inbox-list")).toBeVisible();
    await openChannel(page, "general");
    await openFilesTab(page);
    await expect
      .poll(async () => (await storedLayout(page)).map((entry) => entry.key))
      .toEqual([`${STORAGE_PREFIX}${COMMUNITY_A.relayUrl}`]);

    await page.getByTestId(`community-rail-button-${COMMUNITY_B.id}`).click();
    // B starts clean: nothing leaked from A. Retry until the switch has
    // remounted the app (the old tree still shows A's open dock).
    await expect(async () => {
      await openChannel(page, "general");
      await expect(trigger(page)).toHaveAttribute("aria-expanded", "false", {
        timeout: 1_000,
      });
    }).toPass();
    await expect(dock(page)).toHaveCount(0);
    await trigger(page).click();
    await expect(page.getByTestId("work-area-empty")).toBeVisible();
    await page.getByTestId("work-area-open-terminal").click();
    await expect
      .poll(async () =>
        (await storedLayout(page)).map((entry) => entry.key).sort(),
      )
      .toEqual([
        `${STORAGE_PREFIX}${COMMUNITY_A.relayUrl}`,
        `${STORAGE_PREFIX}${COMMUNITY_B.relayUrl}`,
      ]);

    await page.getByTestId(`community-rail-button-${COMMUNITY_A.id}`).click();
    await expect(async () => {
      await openChannel(page, "general");
      await expect(
        dock(page).getByRole("tab", { name: "Files", exact: true }),
      ).toHaveAttribute("aria-selected", "true", { timeout: 1_000 });
    }).toPass();
    await expect(
      dock(page).getByRole("tab", { name: "Terminal", exact: true }),
    ).toHaveCount(0);
  });

  test("the shortcut toggles the dock; Shift, Alt and the other platform's modifier do not", async ({
    page,
  }) => {
    await boot(page);
    await page.getByTestId("chat-title").click();
    await page.keyboard.press("ControlOrMeta+Shift+Backslash");
    await page.keyboard.press("ControlOrMeta+Alt+Backslash");
    await page.keyboard.press(`${WRONG_PRIMARY}+Backslash`);
    await page.keyboard.press("Backslash");
    await expect(dock(page)).toHaveCount(0);

    await page.keyboard.press("ControlOrMeta+Backslash");
    await expect(dock(page)).toBeVisible();
    await page.keyboard.press("ControlOrMeta+Backslash");
    await expect(dock(page)).toHaveCount(0);
  });

  test("opening, resizing and closing the dock keeps the composer draft and the scroll position", async ({
    page,
  }) => {
    await boot(page);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            window.__BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?.({
              channelName: "general",
            }) ?? false,
        ),
      )
      .toBe(true);
    for (let index = 0; index < 45; index += 1) {
      await page.evaluate((n) => {
        window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
          channelName: "general",
          content: `dock scroll row ${n}`,
          createdAt: Math.floor(Date.now() / 1000),
        });
      }, index);
    }
    const conversation = page.getByTestId("work-area-conversation");
    // The timeline's scroll element: the scrollable box inside the
    // conversation that holds the messages.
    const findScroller = () =>
      conversation.evaluateHandle((root) => {
        const candidates = Array.from(root.querySelectorAll<HTMLElement>("*"));
        return (
          candidates.find((element) => {
            const overflowY = getComputedStyle(element).overflowY;
            return (
              /(auto|scroll)/.test(overflowY) &&
              element.scrollHeight > element.clientHeight + 200 &&
              element.textContent?.includes("dock scroll row")
            );
          }) ?? null
        );
      });
    await expect
      .poll(async () => {
        const handle = await findScroller();
        return (await handle.evaluate((el) => el !== null)) as boolean;
      })
      .toBe(true);
    const scroller = (await findScroller()).asElement();
    if (!scroller) throw new Error("timeline scroller not found");

    const scrolled = await scroller.evaluate((element) => {
      element.scrollTop = Math.max(0, element.scrollHeight / 3);
      return element.scrollTop;
    });
    expect(scrolled).toBeGreaterThan(50);

    const composer = conversation.getByTestId("message-input").first();
    await composer.click();
    await page.keyboard.type("draft that must survive the dock");
    await expect(composer).toContainText("draft that must survive the dock");

    // Tag the live DOM nodes: a remount would drop the tags even if the draft
    // text happened to be restored from storage.
    await page.evaluate(() => {
      const root = document.querySelector(
        '[data-testid="work-area-conversation"]',
      );
      const tag = (selector: string, name: string) => {
        const element = root?.querySelector(selector);
        if (!element) throw new Error(`missing ${selector}`);
        (window as unknown as Record<string, Element>)[name] = element;
      };
      tag('[data-testid="message-input"]', "__composerNode");
      (window as unknown as Record<string, Element | null>).__conversationNode =
        root;
    });
    const sameNodes = () =>
      page.evaluate(() => {
        const w = window as unknown as Record<string, Element>;
        const root = document.querySelector(
          '[data-testid="work-area-conversation"]',
        );
        return {
          composer:
            root?.querySelector('[data-testid="message-input"]') ===
            w.__composerNode,
          scroll: w.__scrollNode?.isConnected === true,
          conversation: root === w.__conversationNode,
        };
      });
    await scroller.evaluate((element) => {
      (window as unknown as Record<string, Element>).__scrollNode = element;
    });
    const scrollTop = () => scroller.evaluate((element) => element.scrollTop);

    // Open (button), switch tab, resize, shortcut-close, reopen, close.
    await trigger(page).click();
    await expect(dock(page)).toBeVisible();
    await page.getByTestId("work-area-open-files").click();
    await divider(page).focus();
    await page.keyboard.press("Shift+ArrowLeft");
    await page.keyboard.press("Home");
    await page.keyboard.press("Escape");
    await expect(dock(page)).toHaveCount(0);
    await page.keyboard.press("ControlOrMeta+Backslash");
    await expect(dock(page)).toBeVisible();
    await page.getByRole("button", { name: "Close work area" }).click();
    await expect(dock(page)).toHaveCount(0);

    expect(await sameNodes()).toEqual({
      composer: true,
      scroll: true,
      conversation: true,
    });
    await expect(composer).toContainText("draft that must survive the dock");
    // A remount lands at the latest message, hundreds of pixels away; reflow
    // from the narrower column can only move it a few rows.
    expect(Math.abs((await scrollTop()) - scrolled)).toBeLessThanOrEqual(24);
  });

  test("a narrow window overlays the dock instead of squeezing the conversation, and it always closes", async ({
    page,
  }) => {
    await boot(page);
    await page.setViewportSize({ width: 740, height: 800 });
    const layout = page.getByTestId("work-area-layout");
    const conversation = page.getByTestId("work-area-conversation");
    await expect(layout).toHaveAttribute("data-overlay", "true");
    const before = await conversation.boundingBox();

    await trigger(page).click();
    await expect(dock(page)).toBeVisible();
    await expect(divider(page)).toHaveCount(0);
    const after = await conversation.boundingBox();
    expect(Math.round(after?.width ?? 0)).toBe(Math.round(before?.width ?? 1));
    const dockBox = await dock(page).boundingBox();
    expect(dockBox).not.toBeNull();
    expect(dockBox?.x ?? 0).toBeLessThan((after?.x ?? 0) + (after?.width ?? 0));
    expect(dockBox?.width ?? 0).toBeGreaterThan(300);

    await dock(page).getByRole("button", { name: "Close work area" }).click();
    await expect(dock(page)).toHaveCount(0);

    // Back to a wide window: side by side again, with the divider.
    await trigger(page).click();
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(layout).toHaveAttribute("data-overlay", "false");
    await expect(divider(page)).toBeVisible();
  });

  test("the terminal is a dock tab: it keeps its sessions across dock close and channel switch", async ({
    page,
  }) => {
    await boot(page);
    await page.keyboard.press("Meta+j");
    const term = dock(page).locator(TERM);
    await expect(term).toBeVisible();
    await expect(term).toHaveAttribute("data-terminal-placement", "embedded");
    await expect(term).toHaveAttribute("data-terminal-mode", "docked");
    await expect(
      dock(page).getByRole("tab", { name: "Terminal", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await expect
      .poll(async () => (await readTerminalBackend(page)).attaches)
      .toBe(1);

    // The substrate's own window controls are replaced by the dock's.
    await expect(
      page.getByRole("button", { name: "Maximize Colony Term" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Hide Colony Term" }),
    ).toHaveCount(0);

    const input = page.getByLabel("Terminal input");
    await expect(input).toBeFocused();
    await page.keyboard.type("echo dock");
    await expect
      .poll(async () => (await readTerminalBackend(page)).inputs.join(""))
      .toContain("echo dock");

    // Close and reopen: same session, no new attach, nothing closed or detached.
    await dock(page).getByRole("button", { name: "Close work area" }).click();
    await expect(page.locator(TERM)).toHaveCount(0);
    await trigger(page).click();
    await expect(dock(page).locator(TERM)).toBeVisible();
    // Another channel has its own dock (closed) and its own sessions.
    await openChannel(page, "random");
    await expect(dock(page)).toHaveCount(0);
    await expect(page.locator(TERM)).toHaveCount(0);
    await openChannel(page, "general");
    await expect(dock(page).locator(TERM)).toBeVisible();

    let state = await readTerminalBackend(page);
    expect(state).toMatchObject({ attaches: 1, detaches: 0, closes: 0 });

    // The chord toggles it from the keyboard, and the dock closes with it.
    await page.keyboard.press("Meta+j");
    await expect(dock(page)).toHaveCount(0);
    await expect(page.locator(TERM)).toHaveCount(0);
    await page.keyboard.press("Meta+j");
    await expect(dock(page).locator(TERM)).toBeVisible();
    state = await readTerminalBackend(page);
    expect(state).toMatchObject({ attaches: 1, detaches: 0, closes: 0 });
  });
});
