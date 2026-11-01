import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  TEST_IDENTITIES,
  installMockBridge,
  openNewMessagePage,
} from "../helpers/bridge";
import { waitForAnimations } from "../helpers/animations";

const SCOUT_PUBKEY = "ab".repeat(32);
const PHOTO_AVATAR = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#31b6a4"/><circle cx="32" cy="25" r="12" fill="#fff"/><path d="M10 64c2-16 12-24 22-24s20 8 22 24" fill="#fff"/></svg>',
)}`;

const AVATAR_FIXTURE = {
  managedAgents: [
    {
      channelNames: ["general"],
      name: "Scout",
      pubkey: SCOUT_PUBKEY,
      status: "stopped" as const,
    },
  ],
  searchProfiles: [
    {
      avatarUrl: PHOTO_AVATAR,
      displayName: "Alice Chen",
      pubkey: TEST_IDENTITIES.alice.pubkey,
    },
    {
      displayName: "Bob",
      pubkey: TEST_IDENTITIES.bob.pubkey,
    },
  ],
};

async function expectScoutAntImage(image: Locator) {
  await expect(image).toHaveAttribute("src", /^data:image\/svg\+xml;base64,/u);
  const src = await image.getAttribute("src");
  expect(src).toBeTruthy();
  const svg = await image.evaluate((element) => {
    const source = element.getAttribute("src") ?? "";
    const prefix = "data:image/svg+xml;base64,";
    return source.startsWith(prefix) ? atob(source.slice(prefix.length)) : "";
  });
  expect(svg).toContain('viewBox="-120 -145 240 235"');
  return src ?? "";
}

async function expectScoutAnt(locator: Locator) {
  return expectScoutAntImage(locator.locator("img"));
}

type MockMessageWindow = Window & {
  __BUZZ_E2E_EMIT_MOCK_MESSAGE__?: (input: {
    channelName: string;
    content: string;
    pubkey: string;
  }) => unknown;
  __BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?: (input: {
    channelName: string;
  }) => boolean;
};

async function waitForGeneralSubscription(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        (channelName) =>
          (
            window as MockMessageWindow
          ).__BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?.({ channelName }) ?? false,
        "general",
      ),
    )
    .toBe(true);
}

async function createScoutDm(page: Page) {
  await openNewMessagePage(page);
  await page.getByTestId("new-dm-search").fill("Scout");
  const result = page.getByTestId(`new-dm-result-${SCOUT_PUBKEY}`);
  await expect(result).toBeVisible();
  await expectScoutAnt(result);
  await result.click();
  await page.getByTestId("message-input").fill("Scout recent activity avatar");
  await page.getByTestId("send-message").click();
  await expect(page.getByTestId("chat-title")).toContainText("Scout");
  const match = page.url().match(/#\/channels\/([^/?]+)/u);
  expect(match?.[1]).toBeTruthy();
  return match?.[1] ?? "";
}

async function emitScoutMessage(page: Page) {
  await waitForGeneralSubscription(page);
  const emitted = await page.evaluate((pubkey) => {
    return (window as MockMessageWindow).__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
      channelName: "general",
      content: "Scout avatar in a message row",
      pubkey,
    });
  }, SCOUT_PUBKEY);
  expect(emitted).toBeTruthy();
  await expect(page.getByTestId("message-timeline")).toContainText(
    "Scout avatar in a message row",
  );
  const row = page.getByTestId("message-row").filter({
    hasText: "Scout avatar in a message row",
  });
  await expectScoutAnt(row);
}

async function openScoutMentionPicker(page: Page) {
  const input = page.getByTestId("message-input");
  await input.fill("@sc");
  const scout = page.getByRole("button", { name: "Mention Scout" });
  await expect(scout).toBeVisible();
  await expectScoutAntImage(
    scout.getByTestId("mention-suggestion-avatar-image"),
  );
  return scout;
}

async function setTheme(page: Page, theme: "light" | "dark") {
  await page.emulateMedia({ colorScheme: theme });
  await page.addInitScript((selectedTheme) => {
    window.localStorage.setItem(
      "buzz-theme",
      selectedTheme === "dark" ? "buzz-dark" : "buzz",
    );
  }, theme);
}

async function prepareScreenshotPage(page: Page, theme: "light" | "dark") {
  await setTheme(page, theme);
  await installMockBridge(page, AVATAR_FIXTURE);
  await page.goto("/");
  const scoutDmId = await createScoutDm(page);
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.getByTestId("search-results")).toBeVisible();
  await page.getByTestId("search-dialog-input").fill("Scout");
  await expect(
    page.getByTestId(`search-result-user-${SCOUT_PUBKEY}`),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");
  return scoutDmId;
}

test("managed agent avatars use ant pictures across search and messaging, while people keep profile or initials", async ({
  page,
}) => {
  await installMockBridge(page, AVATAR_FIXTURE);
  await page.goto("/");
  const scoutDmId = await createScoutDm(page);

  await page.keyboard.press("ControlOrMeta+k");
  const searchDialog = page.getByTestId("search-results");
  await expect(searchDialog).toBeVisible();
  const recentScoutDm = page.getByTestId(`search-result-channel-${scoutDmId}`);
  await expect(recentScoutDm).toBeVisible();
  const scoutAnt = await expectScoutAnt(recentScoutDm);

  const searchInput = page.getByTestId("search-dialog-input");
  await searchInput.fill("Scout");
  const scoutResult = page.getByTestId(`search-result-user-${SCOUT_PUBKEY}`);
  await expect(scoutResult).toBeVisible();
  await expect(scoutResult.locator("img")).toHaveAttribute("src", scoutAnt);

  await page.keyboard.press("Escape");
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");
  await openScoutMentionPicker(page);
  await page.getByTestId("message-input").fill("");
  await emitScoutMessage(page);

  await page.getByTestId("channel-members-trigger").click();
  const members = page.getByTestId("members-sidebar");
  await expect(members).toBeVisible();
  const scoutMember = page.getByTestId(`sidebar-member-${SCOUT_PUBKEY}`);
  await expect(scoutMember.locator("img")).toHaveAttribute("src", scoutAnt);

  const aliceMember = page.getByTestId(
    `sidebar-member-${TEST_IDENTITIES.alice.pubkey}`,
  );
  await expect(aliceMember.locator("img")).toHaveAttribute("src", PHOTO_AVATAR);
  const bobMember = page.getByTestId(
    `sidebar-member-${TEST_IDENTITIES.bob.pubkey}`,
  );
  await expect(bobMember.locator('[data-slot="avatar-fallback"]')).toHaveText(
    "B",
  );
});

test("captures Cmd+K, mention, and member avatar surfaces in light and dark desktop and mobile", async ({
  browser,
}) => {
  const outputDir = process.env.AGENT_AVATAR_SCREENSHOTS_DIR;
  test.skip(
    !outputDir,
    "Set AGENT_AVATAR_SCREENSHOTS_DIR to capture proof shots",
  );
  if (!outputDir) return;
  mkdirSync(outputDir, { recursive: true });

  for (const theme of ["light", "dark"] as const) {
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ]) {
      const context = await browser.newContext({
        colorScheme: theme,
        viewport: { width: 1280, height: 720 },
      });
      const page = await context.newPage();
      try {
        const scoutDmId = await prepareScreenshotPage(page, theme);
        await expect(page.getByTestId("chat-title")).toHaveText("general");
        const suffix = `${theme}-${viewport.width}`;

        await openScoutMentionPicker(page);
        await page.setViewportSize(viewport);
        await waitForAnimations(page);
        await page.screenshot({
          path: join(outputDir, `${suffix}-mention-picker.png`),
        });

        await page.setViewportSize({ width: 1280, height: 720 });
        await page.getByTestId("message-input").fill("");
        await page.keyboard.press("ControlOrMeta+k");
        const recentScoutDm = page.getByTestId(
          `search-result-channel-${scoutDmId}`,
        );
        await expect(recentScoutDm).toBeVisible();
        await expectScoutAnt(recentScoutDm);
        await page.setViewportSize(viewport);
        if (viewport.width === 390) {
          await page.getByRole("button", { name: "Open navigation" }).click();
          await expect(page.getByTestId("open-search")).toBeVisible();
          await page.getByTestId("open-search").click();
          await expect(page.getByTestId("search-results")).toBeVisible();
          await expectScoutAnt(recentScoutDm);
        }
        await waitForAnimations(page);
        await page.screenshot({ path: join(outputDir, `${suffix}-cmd-k.png`) });

        await page.setViewportSize({ width: 1280, height: 720 });
        await page.keyboard.press("Escape");
        await page.getByTestId("message-input").fill("");
        await page.getByTestId("channel-members-trigger").click();
        await expect(page.getByTestId("members-sidebar")).toBeVisible();
        await page.setViewportSize(viewport);
        await waitForAnimations(page);
        await page.screenshot({
          path: join(outputDir, `${suffix}-members.png`),
        });
      } finally {
        await context.close();
      }
    }
  }
});
