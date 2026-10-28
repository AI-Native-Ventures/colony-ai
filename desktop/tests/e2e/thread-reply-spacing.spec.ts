import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type Locator, type Page } from "@playwright/test";

import type { Colony3Extras } from "../../src/testing/e2eBridge";
import {
  REFERENCE_AGENTS,
  REFERENCE_CHANNEL_IDS,
} from "../../src/testing/e2eReferenceWorkspace";
import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";
import {
  COLONY3_SELF,
  colony3At,
  colony3Extras,
  colony3PositionOptions,
} from "../helpers/colony3Conversations";
import { COLONY3_NOW } from "../helpers/colony3Fixture";
import { AYA_DM_CHANNEL, eid } from "../helpers/colony3TimelineFixture";
import { installBrowserHostFake } from "./helpers/browserHostFake";

type MockMessage = NonNullable<Colony3Extras["messages"]>[number];
type PanelMode = "focus" | "split";
type Theme = "dark" | "light";

const MINA_PUBKEY = REFERENCE_AGENTS.mina.pubkey;
const SCOUT_PUBKEY = REFERENCE_AGENTS.scout.pubkey;
const BROWSER_HUMAN_PUBKEY = eid("thread-spacing-browser-human");
const OLIVE_CHANNEL_ID = REFERENCE_CHANNEL_IDS.oliveHouse;
const PROOF_DIR = process.env.THREAD_SPACING_PROOF_DIR;
const PROOF_PREFIX = process.env.THREAD_SPACING_PROOF_PREFIX ?? "proof";

test.use({
  launchOptions: {
    args: ["--use-mock-keychain", "--password-store=basic"],
  },
});
test.describe.configure({ timeout: 120_000 });

function createSpacingThread(
  channelId: string,
  label: string,
  agentPubkey = MINA_PUBKEY,
  humanPubkey = COLONY3_SELF,
) {
  const rootId = eid(`${label}-root`);
  const replyIds = [1, 2, 3, 4, 5, 6, 7, 8].map((number) =>
    eid(`${label}-reply-${number}`),
  );
  const timelineGapIds = [
    eid(`${label}-timeline-gap-previous`),
    eid(`${label}-timeline-gap-next`),
  ];
  const tagsFor = (parentId = rootId) => [
    ["e", rootId, "", "root"],
    ["e", parentId, "", "reply"],
  ];
  const reply = (
    number: number,
    pubkey: string,
    parentId: string,
    content: string,
  ): MockMessage => ({
    channelId,
    id: replyIds[number - 1],
    pubkey,
    createdAt: colony3At(18, 28 + number),
    tags: tagsFor(parentId),
    content,
  });

  const messages: MockMessage[] = [
    {
      channelId,
      id: rootId,
      pubkey: humanPubkey,
      createdAt: colony3At(18, 20),
      content: "A thread for planning the week with Mina.",
    },
    reply(
      1,
      agentPubkey,
      rootId,
      "Short version: I keep the work moving.\n\nI keep the work clear so the next person can pick it up.\n\n1. Plan: turn goals into tasks and track who does what.\n2. Find customers: research and track leads from Discovery.\n3. Create content: draft posts for your approval.",
    ),
    reply(2, humanPubkey, rootId, "Keep the plan and customer notes together."),
    reply(
      3,
      agentPubkey,
      replyIds[1],
      "1. Plan: put the owner and next step beside each goal.\n2. Find customers: keep the source with every lead.",
    ),
    reply(4, humanPubkey, replyIds[2], "That makes the handoff clear."),
    reply(5, agentPubkey, replyIds[3], "I will update the shared plan now."),
    reply(6, humanPubkey, rootId, "Please keep the review in this thread."),
    reply(7, agentPubkey, rootId, "Done. The plan is ready for review."),
    reply(8, agentPubkey, rootId, "I will add the source notes next."),
    {
      channelId,
      id: timelineGapIds[0],
      pubkey: humanPubkey,
      createdAt: colony3At(18, 38),
      content: "A separate channel timeline message.",
    },
    {
      channelId,
      id: timelineGapIds[1],
      pubkey: agentPubkey,
      createdAt: colony3At(18, 39),
      content: "The next separate channel timeline message.",
    },
  ];

  return { messages, replyIds, rootId, timelineGapIds };
}

async function openSpacingThread(
  page: Page,
  options: {
    channelId: string;
    channelName: string;
    isDm?: boolean;
    label: string;
    mode: PanelMode;
    theme: Theme;
    browserWorkArea?: boolean;
    viewportWidth?: number;
    viewportHeight?: number;
  },
) {
  const requestedWidth =
    options.viewportWidth ?? (options.browserWorkArea ? 2000 : 1440);
  const viewport =
    requestedWidth < 768
      ? { width: 1440, height: 960 }
      : {
          width: requestedWidth,
          height:
            options.viewportHeight ?? (options.browserWorkArea ? 1260 : 960),
        };
  await page.setViewportSize(viewport);
  await page.clock.setFixedTime(new Date(COLONY3_NOW));
  await page.emulateMedia({
    colorScheme: options.theme === "dark" ? "dark" : "light",
  });
  await page.addInitScript(
    ({ mode, theme, relayUrl }) => {
      const themeName = theme === "dark" ? "buzz-dark" : "buzz";
      localStorage.setItem("buzz.channels.threadViewMode", mode);
      localStorage.setItem("buzz-theme", themeName);
      localStorage.setItem("buzz-follow-system", "false");
      localStorage.setItem("buzz-accent-color", "#5B45BE");
      localStorage.setItem(
        `buzz-community-theme.v1:${"deadbeef".repeat(8)}:${encodeURIComponent(relayUrl)}`,
        JSON.stringify({
          version: 1,
          theme: themeName,
          accent: "#5B45BE",
          followSystem: false,
        }),
      );
    },
    {
      mode: options.mode,
      theme: options.theme,
      relayUrl: "ws://localhost:3000",
    },
  );

  if (options.browserWorkArea) {
    await installBrowserHostFake(page, { contentSize: viewport });
  }
  const fixture = createSpacingThread(
    options.channelId,
    options.label,
    options.browserWorkArea ? SCOUT_PUBKEY : MINA_PUBKEY,
    options.browserWorkArea ? BROWSER_HUMAN_PUBKEY : COLONY3_SELF,
  );
  const managedAgents = [
    {
      pubkey: MINA_PUBKEY,
      name: "Mina",
      channelNames: ["The Olive House", "Aya"],
      status: "running" as const,
    },
    {
      pubkey: SCOUT_PUBKEY,
      name: "Scout",
      channelNames: ["The Olive House", "Aya", "Welcome"],
      status: "running" as const,
    },
  ];
  await installMockBridge(page, {
    referenceWorkspace: true,
    colony3Sidebar: true,
    windowFullscreen: true,
    relayRole: "owner",
    managedAgents,
    ...colony3PositionOptions(),
    colony3Extras: colony3Extras({
      channels: options.isDm ? [AYA_DM_CHANNEL] : [],
      patchChannels: options.isDm
        ? []
        : [
            {
              id: OLIVE_CHANNEL_ID,
              description: "Client channel · spring content campaign",
            },
          ],
      clearMessagesIn: [options.channelId],
      readChannelIds: [options.channelId],
      messages: fixture.messages,
      profiles: [
        {
          pubkey: MINA_PUBKEY,
          displayName: "Mina",
          isAgent: true,
          ownerPubkey: COLONY3_SELF,
          presence: "online" as const,
        },
        ...(options.browserWorkArea
          ? [
              {
                pubkey: BROWSER_HUMAN_PUBKEY,
                displayName: "basheerphiri",
                isAgent: false,
                presence: "online" as const,
              },
            ]
          : []),
      ],
    }),
  });

  await page.goto("/#/today");
  await expect(page.getByTestId("app-sidebar")).toBeVisible();
  await page.getByTestId(`channel-${options.channelName}`).click();
  await expect(page.getByTestId("chat-title")).toHaveText(options.channelName);
  for (const messageId of fixture.timelineGapIds) {
    await expect(
      page.locator(
        `[data-testid="message-row"][data-message-id="${messageId}"]`,
      ),
    ).toBeVisible();
  }
  const channelTimelineGap = await measureChannelTimelineGap(
    page,
    fixture.timelineGapIds,
  );

  if (options.browserWorkArea) {
    await page.getByTestId("channel-work-area-trigger").click();
    await expect(page.getByTestId("work-area-empty")).toBeVisible();
    await page.getByTestId("work-area-open-browser").click();
    const browser = page.getByTestId("work-area-panel");
    const browserTabPanel = browser.locator(
      'section[role="tabpanel"]:not([hidden])',
    );
    const address = browserTabPanel.getByTestId("browser-address");
    await expect(browserTabPanel.getByTestId("browser-start")).toBeVisible();
    await address.fill("instagram.com/accounts/login/");
    await address.press("Enter");
    await expect(address).toHaveValue("https://instagram.com/accounts/login/");
    await expect(
      browserTabPanel.getByTestId("browser-page-slot"),
    ).toBeVisible();
    await page.evaluate(() => {
      const fill = document.querySelector<HTMLElement>(
        'section[role="tabpanel"]:not([hidden]) .colony-browser-slot-fill',
      );
      if (!fill) throw new Error("Browser page stand-in has no host slot");
      const rect = fill.getBoundingClientRect();
      const standIn = document.createElement("div");
      standIn.setAttribute("data-testid", "browser-page-stand-in");
      standIn.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;box-sizing:border-box;padding:5vh 6vw;background:#fff;color:#222;font-family:Arial,sans-serif;z-index:2147483000;pointer-events:none`;
      standIn.innerHTML = `<div style="max-width:420px;margin:8vh auto;text-align:center"><div style="font-size:34px;font-weight:700;letter-spacing:-2px;margin-bottom:54px">Instagram</div><div style="border:1px solid #ddd;border-radius:4px;padding:36px 28px"><div style="font-size:20px;font-weight:600;margin-bottom:28px">Log into Instagram</div><div style="border:1px solid #ddd;border-radius:4px;padding:16px;color:#777;text-align:left;margin-bottom:12px">Mobile number, username or email</div><div style="border:1px solid #ddd;border-radius:4px;padding:16px;color:#777;text-align:left;margin-bottom:18px">Password</div><div style="border-radius:8px;background:#9ec1f7;color:white;padding:14px">Log in</div></div></div>`;
      document.body.appendChild(standIn);
    });
  }

  const summary = page.locator(
    `[data-testid="message-thread-summary"][data-thread-head-id="${fixture.rootId}"]`,
  );
  await expect(summary).toBeVisible();
  await summary.click();

  const panel = page.getByTestId("message-thread-panel");
  await expect(panel).toBeVisible();
  const [secondReply, thirdReply, fourthReply] = fixture.replyIds.slice(1, 4);
  for (const [parentReply, childReply] of [
    [secondReply, thirdReply],
    [thirdReply, fourthReply],
    [fourthReply, fixture.replyIds[4]],
  ]) {
    const nestedSummary = panel.locator(
      `[data-testid="message-thread-summary"][data-thread-head-id="${parentReply}"]`,
    );
    await expect(nestedSummary).toBeVisible();
    await nestedSummary.click();
    await expect(
      panel.locator(`[data-thread-reply-id="${childReply}"]`),
    ).toBeVisible();
    if (childReply === thirdReply) {
      const [nestedSummaryGap] = await measureReplyGaps(panel, [
        parentReply,
        childReply,
      ]);
      expect(
        nestedSummaryGap.authorGap,
        "a collapsed depth-two branch keeps its design spacing",
      ).toBeGreaterThanOrEqual(15.5);
    }
  }

  for (const replyId of fixture.replyIds) {
    await expect(
      panel.locator(`[data-thread-reply-id="${replyId}"]`),
    ).toBeVisible();
  }
  await expect(
    panel
      .locator(`[data-thread-reply-id="${fixture.replyIds[0]}"]`)
      .locator("ol"),
  ).toBeVisible();

  if (requestedWidth < 768) {
    await page.setViewportSize({
      width: requestedWidth,
      height: options.viewportHeight ?? 844,
    });
    await expect(panel).toBeVisible();
    await waitForAnimations(page);
  }

  const body = page.getByTestId("message-thread-body");
  await body.evaluate((element) => {
    element.scrollTop = 0;
  });
  if (!options.browserWorkArea) {
    await seedComposerWorkingIndicators(
      page,
      options.channelName,
      fixture.rootId,
      requestedWidth >= 768,
    );
  }
  await waitForAnimations(page);

  return {
    panel,
    replyIds: fixture.replyIds,
    timelineGap: channelTimelineGap,
  };
}

async function seedComposerWorkingIndicators(
  page: Page,
  channelName: string,
  threadHeadId: string,
  expectChannelIndicator = true,
) {
  await page.waitForFunction(
    ({ name, kind }) =>
      window.__BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?.({
        channelName: name,
        kind,
      }) ?? false,
    { name: channelName, kind: 20002 },
  );
  await page.evaluate(
    ({ name, pubkey, headId }) => {
      const emit = window.__BUZZ_E2E_EMIT_MOCK_TYPING__;
      if (!emit) throw new Error("Mock typing event helper is unavailable");
      emit({ channelName: name, pubkey });
      emit({ channelName: name, pubkey, threadHeadId: headId });
    },
    { name: channelName, pubkey: SCOUT_PUBKEY, headId: threadHeadId },
  );

  if (expectChannelIndicator) {
    await expect(
      page.getByTestId("channel-agent-working-indicator"),
    ).toBeVisible();
    await expect(
      page
        .getByTestId("channel-agent-working-indicator")
        .getByTestId("agent-working-indicator-label"),
    ).toContainText("Scout is working…");
  }
  await expect(
    page.getByTestId("thread-agent-working-indicator"),
  ).toBeVisible();
  await expect(
    page
      .getByTestId("thread-agent-working-indicator")
      .getByTestId("agent-working-indicator-label"),
  ).toContainText("Scout is working…");
}

async function captureProof(page: Page, name: string, cursor = { x: 4, y: 4 }) {
  if (!PROOF_DIR) return;
  mkdirSync(PROOF_DIR, { recursive: true });
  await page.mouse.move(cursor.x, cursor.y);
  await waitForAnimations(page);
  await page.screenshot({
    animations: "disabled",
    path: join(PROOF_DIR, `${PROOF_PREFIX}-${name}.png`),
  });
}

async function measureReplyGaps(panel: Locator, replyIds: string[]) {
  return panel.evaluate((element, ids) => {
    return ids.slice(1).map((replyId, index) => {
      const previous = element.querySelector<HTMLElement>(
        `[data-thread-reply-id="${ids[index]}"]`,
      );
      const current = element.querySelector<HTMLElement>(
        `[data-thread-reply-id="${replyId}"]`,
      );
      const currentHeader = current?.querySelector<HTMLElement>(
        '[data-testid="message-header"]',
      );
      if (!previous || !current || !currentHeader) {
        throw new Error(`Thread reply row is missing for ${replyId}`);
      }
      return {
        messageId: replyId,
        rowGap:
          current.getBoundingClientRect().top -
          previous.getBoundingClientRect().bottom,
        authorGap:
          currentHeader.getBoundingClientRect().top -
          previous.getBoundingClientRect().bottom,
      };
    });
  }, replyIds);
}

async function measureThreadReplyTextGap(
  panel: Locator,
  previousReplyId: string,
  nextReplyId: string,
) {
  return panel.evaluate(
    (element, ids) => {
      const [previousId, nextId] = ids;
      const previous = element.querySelector<HTMLElement>(
        `[data-thread-reply-id="${previousId}"]`,
      );
      const next = element.querySelector<HTMLElement>(
        `[data-thread-reply-id="${nextId}"]`,
      );
      const markdown = previous?.querySelector<HTMLElement>(
        '[data-testid="message-body"] .message-markdown',
      );
      const header = next?.querySelector<HTMLElement>(
        '[data-testid="message-header"]',
      );
      if (!previous || !next || !markdown || !header) {
        throw new Error(
          "Rendered thread reply text or author header is missing",
        );
      }
      const range = document.createRange();
      range.selectNodeContents(markdown);
      const rects = Array.from(range.getClientRects()).filter(
        (rect) => rect.width > 0 && rect.height > 0,
      );
      const lastLine = rects.at(-1);
      if (!lastLine) throw new Error("Previous reply has no visible text line");
      return header.getBoundingClientRect().top - lastLine.bottom;
    },
    [previousReplyId, nextReplyId],
  );
}

async function measureChannelTimelineGap(page: Page, messageIds: string[]) {
  return page.evaluate((ids) => {
    const [previousId, nextId] = ids;
    const previous = document.querySelector<HTMLElement>(
      `[data-testid="message-row"][data-message-id="${previousId}"]`,
    );
    const next = document.querySelector<HTMLElement>(
      `[data-testid="message-row"][data-message-id="${nextId}"]`,
    );
    const markdown = previous?.querySelector<HTMLElement>(".message-markdown");
    const header = next?.querySelector<HTMLElement>(
      '[data-testid="message-header"]',
    );
    if (!previous || !next || !markdown || !header) {
      throw new Error(
        "Rendered channel message text or author header is missing",
      );
    }
    const range = document.createRange();
    range.selectNodeContents(markdown);
    const rects = Array.from(range.getClientRects()).filter(
      (rect) => rect.width > 0 && rect.height > 0,
    );
    const lastLine = rects.at(-1);
    if (!lastLine) throw new Error("Previous channel message has no text line");
    return header.getBoundingClientRect().top - lastLine.bottom;
  }, messageIds);
}

async function measureParagraphGap(panel: Locator, replyId: string) {
  return panel
    .locator(`[data-thread-reply-id="${replyId}"]`)
    .evaluate((row) => {
      const markdown = row.querySelector<HTMLElement>(
        '[data-testid="message-body"] .message-markdown',
      );
      const paragraphs = markdown?.querySelectorAll<HTMLElement>(":scope > p");
      if (!paragraphs || paragraphs.length < 2) {
        throw new Error("Thread reply needs two rendered Markdown paragraphs");
      }
      const range = document.createRange();
      range.selectNodeContents(paragraphs[0]);
      const rects = Array.from(range.getClientRects()).filter(
        (rect) => rect.width > 0 && rect.height > 0,
      );
      const lastLine = rects.at(-1);
      if (!lastLine) throw new Error("First paragraph has no visible text");
      return paragraphs[1].getBoundingClientRect().top - lastLine.bottom;
    });
}

async function expectThreadReplySpacing(
  panel: Locator,
  replyIds: string[],
  timelineGap: number,
) {
  const measuredThreadGap = await measureThreadReplyTextGap(
    panel,
    replyIds[0],
    replyIds[1],
  );
  expect(
    Math.abs(measuredThreadGap - timelineGap),
    `separate thread replies should match the ${timelineGap.toFixed(1)}px channel timeline gap; received ${measuredThreadGap.toFixed(1)}px`,
  ).toBeLessThanOrEqual(1);

  const paragraphGap = await measureParagraphGap(panel, replyIds[0]);
  expect(
    measuredThreadGap,
    "separate replies should have more breathing room than paragraphs in one message",
  ).toBeGreaterThan(paragraphGap);

  const replyMargins = await panel
    .locator("[data-thread-reply-id]")
    .evaluateAll((rows) =>
      rows.map((row) => ({
        id: row.getAttribute("data-thread-reply-id"),
        marginTop: Number.parseFloat(getComputedStyle(row).marginTop),
      })),
    );
  for (const [index, reply] of replyMargins.entries()) {
    const isContinuation = index === replyMargins.length - 1;
    const expected = isContinuation ? 0 : 24;
    expect(
      Math.abs(reply.marginTop - expected),
      `reply ${reply.id} should use ${expected}px top spacing`,
    ).toBeLessThanOrEqual(1);
  }
}

async function expectThreadRepliesDividerGutter(
  panel: Locator,
  firstReplyId: string,
) {
  await expect(
    panel.locator('[data-testid="message-thread-head-divider"] .c3c-eyebrow'),
  ).toBeVisible();
  await expect(
    panel.locator(
      `[data-thread-reply-id="${firstReplyId}"] [data-testid="message-avatar"]`,
    ),
  ).toBeVisible();

  const geometry = await panel.evaluate((element, replyId) => {
    const divider = element.querySelector<HTMLElement>(
      '[data-testid="message-thread-head-divider"]',
    );
    const label = divider?.querySelector<HTMLElement>(".c3c-eyebrow");
    const rule = divider?.querySelector<HTMLElement>(
      'span[aria-hidden="true"]',
    );
    const avatar = element
      .querySelector<HTMLElement>(`[data-thread-reply-id="${replyId}"]`)
      ?.querySelector<HTMLElement>('[data-testid="message-avatar"]');
    if (!label || !rule || !avatar) {
      throw new Error(
        "Thread replies divider or first reply avatar is missing",
      );
    }
    return {
      labelLeft: label.getBoundingClientRect().left,
      avatarLeft: avatar.getBoundingClientRect().left,
      ruleWidth: rule.getBoundingClientRect().width,
      ruleHeight: rule.getBoundingClientRect().height,
    };
  }, firstReplyId);

  expect(
    Math.abs(geometry.labelLeft - geometry.avatarLeft),
    "the replies divider label should align with the message avatar gutter",
  ).toBeLessThanOrEqual(1);
  expect(
    geometry.ruleWidth,
    "the replies divider rule should remain visible",
  ).toBeGreaterThan(0);
  expect(
    geometry.ruleHeight,
    "the replies divider rule should remain visible",
  ).toBeGreaterThan(0);
}

async function expectThreadComposerLayout(page: Page) {
  const overlay = page.getByTestId("thread-composer-overlay");
  const jumpToLatest = page.getByTestId("thread-scroll-to-latest");
  await expect(jumpToLatest).toBeVisible();
  const clearance = await overlay.evaluate((element) => {
    const pill = element.querySelector<HTMLElement>(
      '[data-testid="thread-scroll-to-latest"]',
    );
    const composer = element.querySelector<HTMLElement>(
      '[data-testid="message-composer"]',
    );
    const crosspost = element.querySelector<HTMLElement>(
      '[data-testid="thread-broadcast-reply"]',
    );
    const backdrop = element.querySelector<HTMLElement>(
      '[data-testid="thread-broadcast-reply-backdrop"]',
    );
    if (!pill || !composer || !crosspost || !backdrop) {
      throw new Error("Thread composer overlap elements are missing");
    }
    return {
      clearance:
        composer.getBoundingClientRect().top -
        pill.getBoundingClientRect().bottom,
      backdrop: getComputedStyle(backdrop).backgroundColor,
      backdropWidth: backdrop.getBoundingClientRect().width,
      composerWidth: composer.getBoundingClientRect().width,
    };
  });
  expect(
    clearance.clearance,
    "Jump to latest should sit above the thread composer",
  ).toBeGreaterThanOrEqual(8);
  expect(clearance.backdrop).not.toMatch(/rgba?\([^)]*,\s*0(?:\.0+)?\s*\)$/);
  expect(clearance.backdropWidth).toBeGreaterThanOrEqual(
    clearance.composerWidth,
  );
}

async function measureComposerActivityGap(
  overlay: Locator,
  indicatorTestId: string,
) {
  return overlay.evaluate((element, testId) => {
    const indicator = element.querySelector<HTMLElement>(
      `[data-testid="${testId}"]`,
    );
    const composer = element.querySelector<HTMLElement>(
      '[data-testid="message-composer"]',
    );
    const broadcast = element.querySelector<HTMLElement>(
      '[data-testid="thread-broadcast-reply"]',
    );
    const boundary = broadcast?.closest<HTMLElement>("label") ?? composer;
    if (!indicator || !boundary) {
      throw new Error(`Composer activity geometry is missing for ${testId}`);
    }
    return (
      indicator.getBoundingClientRect().top -
      boundary.getBoundingClientRect().bottom
    );
  }, indicatorTestId);
}

async function expectThreadComposerActivitySpacing(page: Page) {
  const gap = await measureComposerActivityGap(
    page.getByTestId("thread-composer-overlay"),
    "thread-agent-working-indicator",
  );
  expect(
    gap,
    `thread working status should have the timeline's 24px breathing room; received ${gap.toFixed(1)}px`,
  ).toBeGreaterThanOrEqual(23.5);
}

async function expectChannelComposerActivitySpacing(page: Page) {
  const gap = await measureComposerActivityGap(
    page.getByTestId("channel-composer-overlay"),
    "channel-agent-working-indicator",
  );
  expect(
    gap,
    `channel working status should have the timeline's 24px breathing room; received ${gap.toFixed(1)}px`,
  ).toBeGreaterThanOrEqual(23.5);
}

const captures: Array<{
  browserWorkArea: boolean;
  mode: PanelMode;
  name: string;
  theme: Theme;
  viewportHeight: number;
  viewportWidth: number;
}> = [
  {
    browserWorkArea: false,
    mode: "split",
    name: "width-390-light",
    theme: "light",
    viewportHeight: 844,
    viewportWidth: 390,
  },
  {
    browserWorkArea: false,
    mode: "split",
    name: "width-390-dark",
    theme: "dark",
    viewportHeight: 844,
    viewportWidth: 390,
  },
  {
    browserWorkArea: true,
    mode: "split",
    name: "width-1440-light",
    theme: "light",
    viewportHeight: 960,
    viewportWidth: 1440,
  },
  {
    browserWorkArea: true,
    mode: "split",
    name: "width-1440-dark",
    theme: "dark",
    viewportHeight: 960,
    viewportWidth: 1440,
  },
];

for (const capture of captures) {
  test(`thread replies have design spacing in ${capture.name}`, async ({
    page,
  }) => {
    const { panel, replyIds, timelineGap } = await openSpacingThread(page, {
      browserWorkArea: capture.browserWorkArea,
      channelId: capture.browserWorkArea
        ? REFERENCE_CHANNEL_IDS.welcome
        : OLIVE_CHANNEL_ID,
      channelName: capture.browserWorkArea ? "Welcome" : "The Olive House",
      label: `thread-spacing-${capture.name}`,
      mode: capture.mode,
      theme: capture.theme,
      viewportHeight: capture.viewportHeight,
      viewportWidth: capture.viewportWidth,
    });

    await expectThreadRepliesDividerGutter(panel, replyIds[0]);
    if (capture.viewportWidth < 768) {
      await panel
        .locator('[data-testid="message-thread-head-divider"]')
        .scrollIntoViewIfNeeded();
    }
    await captureProof(page, capture.name);
    if (
      capture.mode === "split" &&
      !capture.browserWorkArea &&
      capture.viewportWidth > 800
    ) {
      await expectChannelComposerActivitySpacing(page);
    }
    if (capture.browserWorkArea) {
      await expectThreadComposerLayout(page);
    }
    if (!capture.browserWorkArea) {
      await expectThreadComposerActivitySpacing(page);
    }
    await expectThreadReplySpacing(panel, replyIds, timelineGap);
  });
}

test("DM threads use the same reply spacing", async ({ page }) => {
  const { panel, replyIds, timelineGap } = await openSpacingThread(page, {
    channelId: AYA_DM_CHANNEL.id,
    channelName: "Aya",
    isDm: true,
    label: "thread-spacing-dm",
    mode: "split",
    theme: "light",
  });

  await expectThreadRepliesDividerGutter(panel, replyIds[0]);
  await expectThreadComposerActivitySpacing(page);
  await expectChannelComposerActivitySpacing(page);
  await expectThreadReplySpacing(panel, replyIds, timelineGap);
});

test("focus thread drawer aligns the replies divider with avatars", async ({
  page,
}) => {
  const { panel, replyIds } = await openSpacingThread(page, {
    channelId: OLIVE_CHANNEL_ID,
    channelName: "The Olive House",
    label: "thread-replies-divider-focus",
    mode: "focus",
    theme: "light",
    viewportHeight: 960,
    viewportWidth: 1440,
  });

  await expectThreadRepliesDividerGutter(panel, replyIds[0]);
});

test("narrow thread beside the Browser work area keeps reply spacing", async ({
  page,
}) => {
  const { panel, replyIds, timelineGap } = await openSpacingThread(page, {
    channelId: REFERENCE_CHANNEL_IDS.welcome,
    channelName: "Welcome",
    label: "thread-spacing-browser-work-area",
    mode: "split",
    theme: "light",
    browserWorkArea: true,
    viewportHeight: 960,
    viewportWidth: 1440,
  });
  await expectThreadRepliesDividerGutter(panel, replyIds[0]);
  await expect(page.getByTestId("work-area-browser")).toBeVisible();
  const panelBounds = await panel.boundingBox();
  expect(
    panelBounds?.width,
    "thread remains in the narrow side column beside the browser",
  ).toBeLessThan(600);
  await expectThreadComposerLayout(page);
  await expectThreadReplySpacing(panel, replyIds, timelineGap);
  await captureProof(page, "browser-light", { x: 4, y: 4 });
});
