import { expect, test, type Page } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";
import { MOCK_CHANNEL_IDS } from "../helpers/companyWork";

// The channel's Knowledge tab in the work area dock, bound through the real
// App: the header Knowledge control, the channel notes (topic, purpose and
// canvas), the pinned messages list, and the denied state for a channel you
// have not joined. Pin behaviour itself is covered in work-area-pins.spec.ts.

const OUT =
  process.env.COLONY_KNOWLEDGE_TAB_SHOTS ?? "test-results/work-area-knowledge";

const dock = (page: Page) => page.getByTestId("work-area-panel");
const knowledgeState = (page: Page) =>
  page.getByTestId("work-area-knowledge-state");
const headerKnowledge = (page: Page) =>
  page.getByTestId("channel-view-tab-knowledge");

const GENERAL_CANVAS =
  "# Spring launch plan\n\nStockists first, then the online shop.";

async function boot(
  page: Page,
  options: {
    canvasReadError?: string;
    viewport?: { width: number; height: number };
  } = {},
) {
  await page.setViewportSize(options.viewport ?? { width: 1440, height: 900 });
  await installMockBridge(page, {
    canvasContentByChannelId: { [MOCK_CHANNEL_IDS.general]: GENERAL_CANVAS },
    canvasReadError: options.canvasReadError,
  });
  await page.goto("/");
  await expect(page.getByTestId("home-inbox-list")).toBeVisible();
}

async function openChannel(page: Page, name: string) {
  await page.getByTestId(`channel-${name}`).click();
  await expect(page.getByTestId("chat-title")).toHaveText(name);
  await expect(headerKnowledge(page)).toBeVisible();
}

/** Opens "design" from the channel browser: an open channel this person has not joined. */
async function openUnjoinedChannel(page: Page) {
  await page.getByTestId("section-actions-channels").click();
  await page.getByRole("menuitem", { name: /^Browse channels/ }).click();
  await expect(page.getByTestId("channel-browser-dialog")).toBeVisible();
  await page.getByTestId("browse-channel-design").click();
  await expect(page.getByTestId("chat-title")).toHaveText("design");
  await expect(headerKnowledge(page)).toBeVisible();
}

async function openKnowledgeTab(page: Page) {
  await headerKnowledge(page).click();
  await expect(dock(page)).toBeVisible();
  await expect(
    dock(page).getByRole("tab", { name: "Knowledge", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
}

test.describe("work area Knowledge tab", () => {
  test("the channel's Knowledge control opens a tab with the channel notes and pins", async ({
    page,
  }) => {
    await boot(page);
    await openChannel(page, "general");
    await expect(headerKnowledge(page)).toHaveRole("button");
    await openKnowledgeTab(page);

    await expect(dock(page).getByTestId("work-area-knowledge")).toBeVisible();
    await expect(
      dock(page).getByTestId("work-area-knowledge-notes"),
    ).toBeVisible();
    await expect(
      dock(page).getByTestId("work-area-knowledge-pins"),
    ).toBeVisible();
    await expect(knowledgeState(page)).toHaveCount(0);
  });

  test("channel notes list topic, purpose and canvas, and the canvas row opens the Canvas tab", async ({
    page,
  }) => {
    await boot(page);
    await openChannel(page, "general");
    await openKnowledgeTab(page);

    const notes = dock(page).getByTestId("work-area-knowledge-notes");
    await expect(
      notes.getByRole("heading", { name: "Channel notes" }),
    ).toBeVisible();
    // The mock "general" has a topic, a purpose and (seeded here) a canvas.
    await expect(
      notes.getByTestId("work-area-knowledge-notes-topic"),
    ).toContainText("Company-wide updates");
    await expect(
      notes.getByTestId("work-area-knowledge-notes-purpose"),
    ).toContainText("Coordinate day-to-day work and unblock the team.");
    const canvasRow = notes.getByTestId("work-area-knowledge-notes-canvas");
    await expect(canvasRow).toContainText("Spring launch plan");
    await expect(
      dock(page).getByTestId("work-area-knowledge-notes-empty"),
    ).toHaveCount(0);

    // Keyboard: Enter on the canvas row opens the Canvas tab.
    await canvasRow.focus();
    await page.keyboard.press("Enter");
    await expect(
      dock(page).getByRole("tab", { name: "Canvas", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(dock(page).getByTestId("work-area-canvas")).toContainText(
      "Spring launch plan",
    );

    // Pointer: back on Knowledge, the same row does the same thing.
    await dock(page)
      .getByRole("tab", { name: "Knowledge", exact: true })
      .click();
    await canvasRow.click();
    await expect(
      dock(page).getByRole("tab", { name: "Canvas", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
  });

  test("topic and purpose show together, and a channel with no notes says so", async ({
    page,
  }) => {
    await boot(page);
    await openChannel(page, "engineering");
    await openKnowledgeTab(page);
    const notes = dock(page).getByTestId("work-area-knowledge-notes");
    await expect(
      notes.getByTestId("work-area-knowledge-notes-topic"),
    ).toContainText("Desktop release train");
    await expect(
      notes.getByTestId("work-area-knowledge-notes-purpose"),
    ).toContainText("Track implementation details and release readiness.");
    // No canvas was set for this channel: no canvas row, no invented text.
    await expect(
      notes.getByTestId("work-area-knowledge-notes-canvas"),
    ).toHaveCount(0);

    // "random" has no topic, purpose or canvas.
    await openChannel(page, "random");
    await openKnowledgeTab(page);
    await expect(
      dock(page).getByTestId("work-area-knowledge-notes-empty"),
    ).toContainText("No channel notes yet");
    await expect(
      dock(page).getByTestId("work-area-knowledge-notes").getByRole("listitem"),
    ).toHaveCount(0);
  });

  test("a canvas that cannot be read says so in plain words, keeps the other notes, and Retry recovers", async ({
    page,
  }) => {
    await boot(page, {
      canvasReadError: "relay returned 500: canvas exploded",
    });
    await openChannel(page, "general");
    await openKnowledgeTab(page);

    const failed = dock(page).getByTestId("work-area-knowledge-notes-failed");
    await expect(failed).toBeVisible({ timeout: 20_000 });
    await expect(failed).toContainText("The canvas could not be loaded.");
    await expect(dock(page)).not.toContainText(
      /canvas exploded|relay returned/i,
    );
    // Topic still shows, and so does the rest of the tab.
    await expect(
      dock(page).getByTestId("work-area-knowledge-notes-topic"),
    ).toContainText("Company-wide updates");
    await expect(
      dock(page).getByTestId("work-area-knowledge-pins"),
    ).toBeVisible();

    // The relay recovers; Retry (keyboard) brings the canvas row in.
    await page.evaluate(() => {
      const mock = (
        window as Window & {
          __BUZZ_E2E__?: { mock?: { canvasReadError?: string } };
        }
      ).__BUZZ_E2E__?.mock;
      if (mock) delete mock.canvasReadError;
    });
    const retry = failed.getByRole("button", { name: "Retry" });
    await retry.focus();
    await page.keyboard.press("Enter");
    await expect(
      dock(page).getByTestId("work-area-knowledge-notes-canvas"),
    ).toContainText("Spring launch plan");
    await expect(failed).toHaveCount(0);
  });

  test("a channel you have not joined is denied with a way to retry", async ({
    page,
  }) => {
    await boot(page);
    await openUnjoinedChannel(page);
    await openKnowledgeTab(page);

    await expect(knowledgeState(page)).toHaveAttribute("data-state", "denied");
    await expect(knowledgeState(page)).toContainText(
      "You are not in this channel",
    );
    await expect(
      page.getByTestId("work-area-knowledge-state-retry"),
    ).toBeVisible();
  });

  test("Knowledge is a dock tab: addable from the menu, one only, kept per channel", async ({
    page,
  }) => {
    await boot(page);
    await openChannel(page, "general");
    await page.getByTestId("channel-work-area-trigger").click();
    await page.getByTestId("work-area-open-knowledge").click();
    await expect(
      dock(page).getByRole("tab", { name: "Knowledge", exact: true }),
    ).toHaveCount(1);
    await dock(page).getByRole("button", { name: "Add work area tab" }).click();
    await expect(
      page.getByRole("menuitem", { name: "Knowledge", exact: true }),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(dock(page).getByRole("tab")).toHaveText([/Knowledge/]);

    // Another channel does not inherit it.
    await openChannel(page, "engineering");
    await expect(dock(page).getByRole("tab")).toHaveCount(0);
  });
});

// Review screenshots at the two reference viewports. The frozen r15 channel has
// no Knowledge tab; the list rows borrow the r15 `cx-row` language, and every
// state here had no reference.
for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1728, height: 1117 },
]) {
  test(`knowledge tab screenshots at ${viewport.width}`, async ({ page }) => {
    await boot(page, { viewport });
    await openChannel(page, "general");
    await openKnowledgeTab(page);

    const shot = async (name: string) => {
      await waitForAnimations(page);
      await page.screenshot({
        path: `${OUT}/knowledge-${name}-${viewport.width}.png`,
      });
    };

    await expect(
      dock(page).getByTestId("work-area-knowledge-notes-canvas"),
    ).toContainText("Spring launch plan");
    await shot("ready");

    await openUnjoinedChannel(page);
    await openKnowledgeTab(page);
    await expect(knowledgeState(page)).toHaveAttribute("data-state", "denied");
    await shot("denied");
  });
}
