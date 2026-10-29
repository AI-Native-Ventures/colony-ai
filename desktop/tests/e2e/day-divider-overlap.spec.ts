import { mkdirSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge, openCreateChannelDialog } from "../helpers/bridge";
import { colony3At } from "../helpers/colony3Conversations";
import { COLONY3_NOW } from "../helpers/colony3Fixture";

const SHOTS = "test-results/day-divider-overlap";
const SINGLE_DIVIDER_SHOTS = "test-results/reference-day-divider";
const THEMES = [
  { name: "light", storageValue: "buzz" },
  { name: "dark", storageValue: "buzz-dark" },
] as const;

async function waitForMockLiveSubscription(
  page: import("@playwright/test").Page,
  channelName: string,
) {
  await expect
    .poll(() =>
      page.evaluate(
        ({ name }) =>
          (
            window as Window & {
              __BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?: (input: {
                channelName: string;
              }) => boolean;
            }
          ).__BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?.({ channelName: name }) ??
          false,
        { name: channelName },
      ),
    )
    .toBe(true);
}

async function assertNoVisibleMessageRowIntersectsStickyBand(page: Page) {
  const intersectingRows = await page.evaluate(() => {
    const scroller = document.querySelector<HTMLElement>(
      ".c3c-timeline-scroller",
    );
    const band = document.querySelector<HTMLElement>(
      '[data-testid="message-timeline-sticky-day-divider"]',
    );
    if (!scroller || !band) throw new Error("missing channel timeline band");

    const scrollerRect = scroller.getBoundingClientRect();
    const bandRect = band.getBoundingClientRect();
    const clipPath = getComputedStyle(scroller).clipPath;
    const insetTop = clipPath.match(/^inset\(\s*(-?[\d.]+)px/)?.[1];
    const visibleTop = scrollerRect.top + (insetTop ? Number(insetTop) : 0);
    const visibleBottom = scrollerRect.bottom;

    return [
      ...scroller.querySelectorAll<HTMLElement>('[data-testid="message-row"]'),
    ].flatMap((row) => {
      const rect = row.getBoundingClientRect();
      const rowTop = Math.max(rect.top, visibleTop);
      const rowBottom = Math.min(rect.bottom, visibleBottom);
      const overlapsBand =
        rect.right > bandRect.left &&
        rect.left < bandRect.right &&
        rowBottom > bandRect.top &&
        rowTop < bandRect.bottom;
      return overlapsBand
        ? [{ text: row.innerText.slice(0, 80), top: rowTop, bottom: rowBottom }]
        : [];
    });
  });

  expect(intersectingRows).toEqual([]);
}

async function assertOneCenteredTopDayLabel(page: Page, expectedLabel: string) {
  const position = await page.evaluate(() => {
    const header = document.querySelector<HTMLElement>(
      '[data-testid="chat-header"]',
    );
    const scroller = document.querySelector<HTMLElement>(
      ".c3c-timeline-scroller",
    );
    const messageColumn = scroller?.querySelector<HTMLElement>(
      ".c3c-timeline-column",
    );
    const sticky = document.querySelector<HTMLElement>(
      '[data-testid="message-timeline-sticky-day-divider"]',
    );
    if (!header || !scroller || !messageColumn || !sticky) {
      throw new Error("missing channel timeline");
    }
    const headerBottom = header.getBoundingClientRect().bottom;
    const scrollerBox = scroller.getBoundingClientRect();
    const messageColumnBox = messageColumn.getBoundingClientRect();
    const clipPath = getComputedStyle(scroller).clipPath;
    const insetTop = clipPath.match(/^inset\(\s*(-?[\d.]+)px/)?.[1];
    const clippedScrollerTop =
      scrollerBox.top + (insetTop ? Number(insetTop) : 0);
    const labels = [
      ...document.querySelectorAll<HTMLElement>("section[data-day-label] p"),
    ].flatMap((element) => {
      const rect = element.getBoundingClientRect();
      let ancestor: Element | null = element;
      let opacity = 1;
      while (ancestor) {
        const style = getComputedStyle(ancestor);
        if (style.display === "none" || style.visibility === "hidden") {
          return [];
        }
        opacity *= Number.parseFloat(style.opacity || "1");
        ancestor = ancestor.parentElement;
      }
      const label = element.textContent?.trim() ?? "";
      const inScroller = element.closest(".c3c-timeline-scroller") !== null;
      if (
        !label ||
        opacity === 0 ||
        rect.width === 0 ||
        rect.height === 0 ||
        rect.bottom <= headerBottom ||
        rect.top >= headerBottom + 120 ||
        (inScroller && rect.bottom <= clippedScrollerTop)
      ) {
        return [];
      }
      return [
        {
          centerX: rect.left + rect.width / 2,
          text: label,
        },
      ];
    });
    return {
      labels,
      messageColumnBox: {
        left: messageColumnBox.left,
        width: messageColumnBox.width,
      },
      scrollerBox: { left: scrollerBox.left, width: scrollerBox.width },
      scrollTop: scroller.scrollTop,
    };
  });

  expect(position.scrollTop).toBeGreaterThan(0);
  expect(position.labels).toHaveLength(1);
  const [label] = position.labels;
  if (!label) throw new Error("the scrolled channel has no visible day label");
  expect(label.text).toBe(expectedLabel);
  expect(
    Math.abs(
      label.centerX -
        (position.messageColumnBox.left + position.messageColumnBox.width / 2),
    ),
    JSON.stringify({ label, position }),
  ).toBeLessThanOrEqual(2);
  await assertNoVisibleMessageRowIntersectsStickyBand(page);
}

test.describe.configure({ timeout: 120_000 });

for (const theme of THEMES) {
  test(`sticky day divider clears message rows in ${theme.name} mode`, async ({
    page,
  }, testInfo) => {
    const channelName = `divider-overlap-${theme.name}`;
    const messageMarker = "divider overlap line 01";
    const longMessage = Array.from(
      { length: 40 },
      (_, index) =>
        `divider overlap line ${String(index + 1).padStart(2, "0")}: the browser should keep this message readable beneath the current day marker.`,
    ).join("\n");

    await page.setViewportSize({ width: 1280, height: 720 });
    await page.clock.setFixedTime(new Date(COLONY3_NOW));
    await page.emulateMedia({
      colorScheme: theme.name === "dark" ? "dark" : "light",
    });
    await page.addInitScript((themeValue) => {
      window.localStorage.setItem("buzz-theme", themeValue);
      window.localStorage.setItem("buzz-follow-system", "false");
      window.localStorage.setItem("buzz.channels.threadViewMode", "split");
    }, theme.storageValue);
    await installMockBridge(page);
    await page.goto("/");

    await openCreateChannelDialog(page);
    await page.getByTestId("create-channel-name").fill(channelName);
    await page.getByTestId("create-channel-submit").click();
    await expect(page.getByTestId("chat-title")).toHaveText(channelName);
    await waitForMockLiveSubscription(page, channelName);

    const threadRootId = await page.evaluate(
      ({ channelName: name, content, pubkey, yesterday, today }) => {
        const emit = (
          window as Window & {
            __BUZZ_E2E_EMIT_MOCK_MESSAGE__?: (input: {
              channelName: string;
              content: string;
              createdAt: number;
              parentEventId?: string | null;
              pubkey: string;
            }) => { id: string };
          }
        ).__BUZZ_E2E_EMIT_MOCK_MESSAGE__;
        if (!emit) throw new Error("mock message emitter is unavailable");

        const root = emit({
          channelName: name,
          content: "A short message from the previous day.",
          createdAt: yesterday,
          pubkey,
        });
        emit({ channelName: name, content, createdAt: today, pubkey });
        emit({
          channelName: name,
          content: "A reply from today in the adjacent thread panel.",
          createdAt: today + 30,
          parentEventId: root.id,
          pubkey,
        });
        return root.id;
      },
      {
        channelName,
        content: longMessage,
        pubkey: "deadbeef".repeat(8),
        yesterday: colony3At(9, 30, 1),
        today: colony3At(9, 45),
      },
    );

    const messageRow = page
      .getByTestId("message-row")
      .filter({ hasText: messageMarker });
    await expect(messageRow).toBeVisible();
    const scroller = page.locator(".c3c-timeline-scroller");
    await scroller.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
      element.dispatchEvent(new Event("scroll", { bubbles: true }));
    });

    const stickyDivider = page.getByTestId(
      "message-timeline-sticky-day-divider",
    );
    await expect(stickyDivider).toHaveCSS("opacity", "1");
    expect(await stickyDivider.getAttribute("data-day-label")).toBeTruthy();
    const stickyRow = page
      .getByTestId("message-timeline-sticky-day-divider-content")
      .locator(":scope > section")
      .first();
    const stickyPill = stickyRow.locator("p");
    const [paint, headerBox, pillBox, stickyBandBox, scrollerBox] =
      await Promise.all([
        stickyRow.evaluate((element) => {
          const probe = document.createElement("div");
          probe.className = "bg-colony-surface";
          document.body.append(probe);
          const expected = getComputedStyle(probe).backgroundColor;
          probe.remove();
          const actual = getComputedStyle(element).backgroundColor;
          const alpha =
            actual.match(/^rgba\([^)]*,\s*([\d.]+)\s*\)$/i)?.[1] ??
            actual.match(/\/\s*([\d.]+)\s*\)$/)?.[1] ??
            "1";
          return {
            actual,
            alpha: Number(alpha),
            expected,
          };
        }),
        page.getByTestId("chat-header").boundingBox(),
        stickyPill.boundingBox(),
        stickyDivider.boundingBox(),
        scroller.boundingBox(),
      ]);
    expect(paint.actual).toBe(paint.expected);
    expect(paint.alpha).toBe(1);
    if (!headerBox || !pillBox || !stickyBandBox || !scrollerBox) {
      throw new Error("the pinned divider or long message is not rendered");
    }
    // The scroller extends under the channel chrome; its visible top begins
    // where the header ends.
    const visibleScrollTop = Math.max(
      scrollerBox.y,
      headerBox.y + headerBox.height,
    );
    expect(stickyBandBox.y).toBeCloseTo(visibleScrollTop, 1);
    expect(Math.abs(pillBox.y - stickyBandBox.y)).toBeLessThanOrEqual(1);
    await assertOneCenteredTopDayLabel(page, "Today");

    const workAreaTrigger = page.getByTestId("channel-work-area-trigger");
    await workAreaTrigger.click();
    await expect(page.getByTestId("work-area-panel")).toBeVisible();
    await scroller.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
      element.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    await assertOneCenteredTopDayLabel(page, "Today");
    await workAreaTrigger.click();
    await expect(page.getByTestId("work-area-panel")).toBeHidden();
    await scroller.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
      element.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    await assertOneCenteredTopDayLabel(page, "Today");

    await waitForAnimations(page);
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({
      path: `${SHOTS}/${testInfo.project.name}-${theme.name}-channel.png`,
    });

    const threadSummary = page.locator(
      `[data-testid="message-thread-summary"][data-thread-head-id="${threadRootId}"]`,
    );
    await expect(threadSummary).toBeVisible();
    await threadSummary.click();
    const threadPanel = page.getByTestId("message-thread-panel");
    await expect(threadPanel).toBeVisible();
    await scroller.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
      element.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    await expect(stickyDivider).toHaveCSS("opacity", "1");
    await waitForAnimations(page);

    const [threadBandBox, threadScrollerBox, threadHeaderBox] =
      await Promise.all([
        stickyDivider.boundingBox(),
        scroller.boundingBox(),
        page.getByTestId("chat-header").boundingBox(),
      ]);
    if (!threadBandBox || !threadScrollerBox || !threadHeaderBox) {
      throw new Error("the channel divider is not rendered beside the thread");
    }
    const threadVisibleScrollTop = Math.max(
      threadScrollerBox.y,
      threadHeaderBox.y + threadHeaderBox.height,
    );
    expect(threadBandBox.y).toBeCloseTo(threadVisibleScrollTop, 1);

    await page.screenshot({
      path: `${SHOTS}/${testInfo.project.name}-${theme.name}-thread.png`,
    });
  });
}

for (const theme of THEMES) {
  test(
    "shows one centered Yesterday label beside open panes in " +
      theme.name +
      " mode",
    async ({ page }, testInfo) => {
      const channelName = `single-divider-${theme.name}`;
      const longMessage = Array.from(
        { length: 32 },
        (_, index) =>
          "single divider line " +
          String(index + 1).padStart(2, "0") +
          ": the date label stays centered over the message column.",
      ).join("\n");

      await page.setViewportSize({ width: 1440, height: 960 });
      await page.clock.setFixedTime(new Date(COLONY3_NOW));
      await page.emulateMedia({
        colorScheme: theme.name === "dark" ? "dark" : "light",
      });
      await page.addInitScript((themeValue) => {
        window.localStorage.setItem("buzz-theme", themeValue);
        window.localStorage.setItem("buzz-follow-system", "false");
        window.localStorage.setItem("buzz.channels.threadViewMode", "split");
      }, theme.storageValue);
      await installMockBridge(page);
      await page.goto("/");

      await openCreateChannelDialog(page);
      await page.getByTestId("create-channel-name").fill(channelName);
      await page.getByTestId("create-channel-submit").click();
      await expect(page.getByTestId("chat-title")).toHaveText(channelName);
      await waitForMockLiveSubscription(page, channelName);

      const threadRootId = await page.evaluate(
        ({ channelName: name, content, pubkey, yesterday, today }) => {
          const emit = (
            window as Window & {
              __BUZZ_E2E_EMIT_MOCK_MESSAGE__?: (input: {
                channelName: string;
                content: string;
                createdAt: number;
                parentEventId?: string | null;
                pubkey: string;
              }) => { id: string };
            }
          ).__BUZZ_E2E_EMIT_MOCK_MESSAGE__;
          if (!emit) throw new Error("mock message emitter is unavailable");
          const root = emit({
            channelName: name,
            content: "Yesterday's follow-up has a thread.",
            createdAt: yesterday,
            pubkey,
          });
          emit({
            channelName: name,
            content: "A reply in yesterday's thread.",
            createdAt: yesterday + 30,
            parentEventId: root.id,
            pubkey,
          });
          emit({ channelName: name, content, createdAt: today, pubkey });
          return root.id;
        },
        {
          channelName,
          content: longMessage,
          pubkey: "deadbeef".repeat(8),
          yesterday: colony3At(9, 30, 1),
          today: colony3At(9, 45),
        },
      );

      const scroller = page.locator(".c3c-timeline-scroller");
      const threadSummary = page.locator(
        '[data-testid="message-thread-summary"][data-thread-head-id="' +
          threadRootId +
          '"]',
      );
      const workAreaTrigger = page.getByTestId("channel-work-area-trigger");
      await expect(workAreaTrigger).toBeVisible();
      await scroller.evaluate((element) => {
        element.scrollTop = 5;
        element.dispatchEvent(new Event("scroll", { bubbles: true }));
      });
      await assertOneCenteredTopDayLabel(page, "Yesterday");
      await scroller.evaluate((element) => {
        element.scrollTop = 40;
        element.dispatchEvent(new Event("scroll", { bubbles: true }));
      });
      await assertOneCenteredTopDayLabel(page, "Yesterday");
      await workAreaTrigger.click();
      await expect(page.getByTestId("work-area-panel")).toBeVisible();
      await waitForAnimations(page);
      await scroller.evaluate((element) => {
        element.scrollTop = 5;
        element.dispatchEvent(new Event("scroll", { bubbles: true }));
      });
      await assertOneCenteredTopDayLabel(page, "Yesterday");
      await scroller.evaluate((element) => {
        element.scrollTop = 40;
        element.dispatchEvent(new Event("scroll", { bubbles: true }));
      });
      await assertOneCenteredTopDayLabel(page, "Yesterday");
      await waitForAnimations(page);
      mkdirSync(SINGLE_DIVIDER_SHOTS, { recursive: true });
      if (testInfo.project.name === "smoke") {
        await page.screenshot({
          path: `${SINGLE_DIVIDER_SHOTS}/1440-${theme.name}-work-area.png`,
        });
      }

      await workAreaTrigger.click();
      await expect(page.getByTestId("work-area-panel")).toBeHidden();
      await waitForAnimations(page);
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(scroller).toBeVisible();
      await waitForAnimations(page);
      await scroller.evaluate((element) => {
        element.scrollTop = 5;
        element.dispatchEvent(new Event("scroll", { bubbles: true }));
      });
      await assertOneCenteredTopDayLabel(page, "Yesterday");
      await scroller.evaluate((element) => {
        element.scrollTop = 40;
        element.dispatchEvent(new Event("scroll", { bubbles: true }));
      });
      await assertOneCenteredTopDayLabel(page, "Yesterday");
      await waitForAnimations(page);
      if (testInfo.project.name === "smoke") {
        await page.screenshot({
          path: `${SINGLE_DIVIDER_SHOTS}/390-${theme.name}-channel.png`,
        });
      }

      await workAreaTrigger.click();
      await expect(page.getByTestId("work-area-panel")).toBeVisible();
      await waitForAnimations(page);
      await scroller.evaluate((element) => {
        element.scrollTop = 5;
        element.dispatchEvent(new Event("scroll", { bubbles: true }));
      });
      await assertOneCenteredTopDayLabel(page, "Yesterday");
      await scroller.evaluate((element) => {
        element.scrollTop = 40;
        element.dispatchEvent(new Event("scroll", { bubbles: true }));
      });
      await assertOneCenteredTopDayLabel(page, "Yesterday");
      await page.getByTestId("work-area-close").click();
      await expect(page.getByTestId("work-area-panel")).toBeHidden();

      await page.setViewportSize({ width: 1440, height: 960 });
      await threadSummary.scrollIntoViewIfNeeded();
      await threadSummary.click();
      await expect(page.getByTestId("message-thread-panel")).toBeVisible();
      await waitForAnimations(page);
      await scroller.evaluate((element) => {
        element.scrollTop = 5;
        element.dispatchEvent(new Event("scroll", { bubbles: true }));
      });
      await assertOneCenteredTopDayLabel(page, "Yesterday");
      await scroller.evaluate((element) => {
        element.scrollTop = 40;
        element.dispatchEvent(new Event("scroll", { bubbles: true }));
      });
      await assertOneCenteredTopDayLabel(page, "Yesterday");
    },
  );
}
