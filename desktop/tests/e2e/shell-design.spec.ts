import { expect, test, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { waitForAnimations } from "../helpers/animations";
import { installMockBridge, TEST_IDENTITIES } from "../helpers/bridge";

const CAMPAIGN_MESSAGE =
  "The October campaign is ready for the team to review.";

async function openCampaign(page: Page) {
  await page.getByTestId("channel-marketing").click();
  await expect(page.getByTestId("chat-title")).toHaveText("marketing");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.__BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?.({
            channelName: "marketing",
            kind: 9,
          }) ?? false,
      ),
    )
    .toBe(true);
  await page.evaluate(
    (content) =>
      window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
        channelName: "marketing",
        content,
        createdAt: Math.floor(Date.now() / 1000),
      }),
    CAMPAIGN_MESSAGE,
  );
  await expect(page.getByTestId("message-timeline")).toContainText(
    CAMPAIGN_MESSAGE,
  );
}

async function measure(page: Page) {
  return page.evaluate(() => {
    const selectors = [
      '[data-testid="app-sidebar"]',
      '[data-sidebar="menu-button"]',
      '[data-sidebar="menu-button"] > svg',
      "[data-buzz-content-surface]",
      '[data-testid="chat-title"]',
      '[data-testid="chat-header"]',
      '[data-testid="channel-view-tabs"]',
      '[data-testid="message-timeline"]',
      '[data-testid="message-row"]',
      '[data-testid="message-body"]',
      '[data-testid="message-author"]',
      '[data-testid="channel-composer-overlay"]',
      ".composer-dock",
      '[data-testid="message-composer"]',
      '[data-testid="message-thread-panel"]',
      '[data-testid="message-thread-body"]',
      '[data-testid="thread-composer-overlay"]',
      '[data-testid="thread-composer-overlay"] .composer-dock',
      '[data-testid="thread-composer-overlay"] [data-testid="message-composer"]',
      '[data-testid="thread-composer-overlay"] [data-testid="message-input-scroll"]',
      '[data-testid="channel-composer-overlay"] [data-testid="message-input-scroll"]',
      "body",
    ];
    return Object.fromEntries(
      selectors.map((selector) => {
        const element = document.querySelector(selector);
        if (!element) return [selector, null];
        const rect = element.getBoundingClientRect(),
          style = getComputedStyle(element);
        return [
          selector,
          {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            font: style.fontFamily,
            size: style.fontSize,
            padding: style.padding,
            margin: style.margin,
            gap: style.gap,
            radius: style.borderRadius,
          },
        ];
      }),
    );
  });
}

for (const [width, height] of [
  [1728, 1117],
  [1440, 900],
  [1100, 800],
]) {
  test(`shell frame and conversation gutters at ${width}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height });
    await installMockBridge(page, {
      referenceWorkspace: true,
      referenceSidebarShell: true,
      relaySelf: TEST_IDENTITIES.tyler.pubkey,
    });
    const proofDir =
      process.env.SHELL_PROOF_DIR ?? testInfo.outputPath("shell");
    await mkdir(proofDir, { recursive: true });
    const measurements = [];
    const framePositions = [];
    for (const name of ["today", "team", "marketing", "thread"]) {
      if (name === "thread") {
        const row = page
          .getByTestId("message-row")
          .filter({ hasText: CAMPAIGN_MESSAGE })
          .first();
        await row.hover();
        await row.getByRole("button", { name: "Reply", exact: true }).click();
        await expect(page.getByTestId("message-thread-panel")).toBeVisible();
      } else if (name === "marketing") await openCampaign(page);
      else {
        await page.goto(`/#/${name}`);
        if (name === "team")
          await expect(page.getByTestId("company-team-screen")).toBeVisible({
            timeout: 15000,
          });
      }
      const sidebar = page.getByTestId("app-sidebar");
      await expect(sidebar).toBeVisible();
      await expect(sidebar).toHaveCSS("width", "260px");
      await expect(
        sidebar.locator('[data-sidebar="menu-button"]').first(),
      ).toHaveCSS("font-size", "13.9286px");
      await expect(
        sidebar.locator('[data-sidebar="menu-button"] > svg').first(),
      ).toHaveCSS("width", "18px");
      if (height >= 900) {
        const nav = sidebar.locator("[data-sidebar=content]");
        expect(
          await nav.evaluate((el) => el.scrollHeight - el.clientHeight),
        ).toBeLessThanOrEqual(1);
      }
      const frame = page
        .locator(
          "[data-buzz-content-surface]:not([data-buzz-content-unframed])",
        )
        .first();
      await expect(frame).toHaveCSS("margin", "8px");
      await expect(frame).toHaveCSS("border-radius", "11px");
      await page.evaluate(() => document.fonts.ready);
      await waitForAnimations(page);
      const box = await frame.boundingBox();
      expect(box).not.toBeNull();
      framePositions.push({ x: box?.x, y: box?.y, height: box?.height });
      if (name === "thread") {
        const thread = page.getByTestId("message-thread-panel");
        const input = thread.getByTestId("message-input-scroll");
        await expect(input).toHaveCSS("padding", "12px 12px 7px");
        await expect(input).toHaveCSS("font-size", "15px");
        await expect(thread.locator(".composer-dock")).toHaveCSS(
          "padding",
          "10px 24px 15px",
        );
        const inputTextLeft = await input.evaluate(
          (el) =>
            el.getBoundingClientRect().x +
            parseFloat(getComputedStyle(el).paddingLeft),
        );
        const checkbox = thread.getByRole("checkbox");
        if (width >= 1200) {
          const checkboxBox = await checkbox.boundingBox();
          expect(checkboxBox).not.toBeNull();
          expect(
            Math.abs((checkboxBox?.x ?? 0) - inputTextLeft),
          ).toBeLessThanOrEqual(1);
        }
        const channelComposer = page.getByTestId("channel-composer-overlay");
        const toolbarBox = await channelComposer
          .getByTestId("message-composer-toolbar")
          .boundingBox();
        const channelBox = await channelComposer
          .getByTestId("message-composer")
          .boundingBox();
        const sendBox = await channelComposer
          .getByTestId("send-message")
          .boundingBox();
        expect(toolbarBox).not.toBeNull();
        expect(channelBox).not.toBeNull();
        expect(sendBox).not.toBeNull();
        expect((sendBox?.y ?? 0) + (sendBox?.height ?? 0)).toBeLessThanOrEqual(
          (channelBox?.y ?? 0) + (channelBox?.height ?? 0),
        );
        expect(
          (toolbarBox?.y ?? 0) + (toolbarBox?.height ?? 0),
        ).toBeLessThanOrEqual((channelBox?.y ?? 0) + (channelBox?.height ?? 0));
        expect(
          await page
            .getByTestId("chat-title")
            .evaluate((el) => el.scrollWidth - el.clientWidth),
        ).toBeLessThanOrEqual(1);
        const tools = await thread
          .getByRole("button", { name: "Record voice note", exact: true })
          .boundingBox();
        const send = await thread
          .getByRole("button", {
            name: "Reference goal or sub-goal",
            exact: true,
          })
          .boundingBox();
        expect(tools).not.toBeNull();
        expect(send).not.toBeNull();
        expect(
          (tools?.x ?? 0) + (tools?.width ?? 0) <= (send?.x ?? 0) ||
            (tools?.y ?? 0) + (tools?.height ?? 0) <= (send?.y ?? 0),
        ).toBe(true);
        const channelScroll = page.getByTestId("message-timeline");
        const threadScroll = thread.getByTestId("message-thread-body");
        await expect(channelScroll).toHaveCSS("overflow-y", "auto");
        await expect(threadScroll).toHaveCSS("overflow-y", "auto");
      }
      await page.screenshot({
        path: `${proofDir}/${process.env.SHELL_PROOF_STAGE ?? "after"}-${name}-${width}.png`,
      });
      measurements.push({ name, width, height, metrics: await measure(page) });
    }
    expect(
      framePositions.every(
        (p) => JSON.stringify(p) === JSON.stringify(framePositions[0]),
      ),
    ).toBe(true);
    await writeFile(
      `${proofDir}/${process.env.SHELL_PROOF_STAGE ?? "after"}-metrics-${width}.json`,
      JSON.stringify(measurements, null, 2),
    );
  });
}

for (const [preference, px] of [
  ["smaller", 14],
  ["default", 15],
  ["larger", 16],
] as const) {
  test(`shared text ramp preserves ${preference} and keyboard zoom`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(
      (size) => localStorage.setItem("buzz.appearance.fontSize", size),
      preference,
    );
    await installMockBridge(page, {
      referenceWorkspace: true,
      referenceSidebarShell: true,
    });
    await page.goto("/");
    await openCampaign(page);
    const input = page.getByTestId("message-input-scroll").first();
    await expect(input).toHaveCSS("font-size", `${px}px`);
    const proofDir =
      process.env.SHELL_PROOF_DIR ?? testInfo.outputPath("shell");
    await mkdir(proofDir, { recursive: true });
    await waitForAnimations(page);
    await page.screenshot({ path: `${proofDir}/after-${preference}-1440.png` });
    await page.evaluate(() => {
      const mac = /mac|iphone|ipad|ipod/i.test(navigator.platform);
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          code: "Equal",
          key: "+",
          shiftKey: true,
          metaKey: mac,
          ctrlKey: !mac,
        }),
      );
    });
    await expect
      .poll(() =>
        input.evaluate((el) =>
          Number.parseFloat(getComputedStyle(el).fontSize),
        ),
      )
      .toBeCloseTo(px * 1.1, 2);
    await expect(page.getByTestId("app-sidebar")).toHaveCSS("width", "260px");
    await waitForAnimations(page);
    await page.screenshot({
      path: `${proofDir}/after-${preference}-zoom-1440.png`,
    });
  });
}

test("migrates the saved legacy sidebar default", async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem("buzz-sidebar-width", "244"),
  );
  await installMockBridge(page);
  await page.goto("/");
  await expect(page.getByTestId("app-sidebar")).toHaveCSS("width", "260px");
});
