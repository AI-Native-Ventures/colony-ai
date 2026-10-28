import { mkdirSync } from "node:fs";

import { expect, test } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge, openCreateChannelDialog } from "../helpers/bridge";
import { colony3At } from "../helpers/colony3Conversations";
import { COLONY3_NOW } from "../helpers/colony3Fixture";

const SHOTS = "test-results/day-divider-overlap";
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

test.describe.configure({ timeout: 120_000 });

for (const theme of THEMES) {
  test(`sticky day divider covers a long message in ${theme.name} mode`, async ({
    page,
  }, testInfo) => {
    const channelName = `divider-overlap-${theme.name}`;
    const messageMarker = "divider overlap line 01";
    const longMessage = Array.from(
      { length: 40 },
      (_, index) =>
        `divider overlap line ${String(index + 1).padStart(2, "0")}: the browser should keep this message readable beneath the current day marker.`,
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
    const messageBody = messageRow.getByTestId("message-body");
    const [
      paint,
      headerBox,
      pillBox,
      dividerBox,
      messageBox,
      stickyBandBox,
      scrollerBox,
    ] = await Promise.all([
      stickyRow.evaluate((element) => {
        const probe = document.createElement("div");
        probe.className = "bg-colony-surface";
        document.body.append(probe);
        const expected = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return {
          actual: getComputedStyle(element).backgroundColor,
          expected,
        };
      }),
      page.getByTestId("chat-header").boundingBox(),
      stickyPill.boundingBox(),
      stickyRow.boundingBox(),
      messageBody.boundingBox(),
      stickyDivider.boundingBox(),
      scroller.boundingBox(),
    ]);
    expect(paint.actual).toBe(paint.expected);
    if (
      !headerBox ||
      !pillBox ||
      !dividerBox ||
      !messageBox ||
      !stickyBandBox ||
      !scrollerBox
    ) {
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
    const overlapHeight =
      Math.min(
        dividerBox.y + dividerBox.height,
        messageBox.y + messageBox.height,
      ) - Math.max(dividerBox.y, messageBox.y);
    expect(overlapHeight).toBeGreaterThan(0);

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
