import { expect, test, type Page } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import {
  installMockBridge,
  type MockAgentMemoryListing,
} from "../helpers/bridge";

// The channel's Knowledge tab in the work area dock, bound through the real
// App: the header Knowledge control, the memory documents of the AI employees
// you manage that are in this channel (read through the production
// get_agent_memory command), the read-only reader, and the states with no
// list: loading, empty, denied and failed with Retry. Pins have no data source
// yet, so the tab says so; a spec pins that wording so it cannot quietly drift
// into a fake list.

const OUT =
  process.env.COLONY_KNOWLEDGE_TAB_SHOTS ?? "test-results/work-area-knowledge";
const RAW_TEXT =
  /mock memory exploded|get_agent_memory|\b500\b|relay returned/i;
const PLAIN_FAILURE = "Colony could not reach this community. Try again.";
const MEMORY_ERROR = "mock memory exploded: 500 upstream";

const SCOUT = "a1".repeat(32);
const MINA = "b2".repeat(32);
const QUIET = "c3".repeat(32);

const dock = (page: Page) => page.getByTestId("work-area-panel");
const knowledgeState = (page: Page) =>
  page.getByTestId("work-area-knowledge-state");
const headerKnowledge = (page: Page) =>
  page.getByTestId("channel-view-tab-knowledge");

function entry(slug: string, body: string, createdAt: number) {
  return {
    slug,
    body,
    eventId: `event-${slug}`,
    createdAt,
    outgoingRefs: [] as string[],
  };
}

function listing(
  core: ReturnType<typeof entry> | null,
  memories: ReturnType<typeof entry>[],
): MockAgentMemoryListing {
  return { core, memories, truncated: false, fetchedAt: 1_800_000_000 };
}

const SCOUT_CORE = entry(
  "core",
  "I research prospects for the team.\n\nI keep notes short and sourced.",
  1_790_000_000,
);
const SCOUT_BRIEF = entry(
  "mem/projects/launch-brief",
  "Launch brief\n\nThe spring launch targets independent stockists first.",
  1_795_000_000,
);
const SCOUT_STYLE = entry(
  "mem/preferences/writing-style",
  "Short sentences. No jargon.",
  1_794_000_000,
);
const MINA_NOTE = entry(
  "mem/clients/olive-house",
  "The Olive House prefers email over calls.",
  1_796_000_000,
);

async function boot(
  page: Page,
  options: {
    errors?: string[];
    delaysMs?: number[];
    viewport?: { width: number; height: number };
  } = {},
) {
  await page.setViewportSize(options.viewport ?? { width: 1440, height: 900 });
  await installMockBridge(page, {
    managedAgents: [
      {
        pubkey: SCOUT,
        name: "Scout",
        status: "running",
        channelNames: ["general"],
      },
      {
        pubkey: MINA,
        name: "Mina",
        status: "running",
        channelNames: ["general"],
      },
      {
        pubkey: QUIET,
        name: "Quiet one",
        status: "running",
        channelNames: ["engineering"],
      },
    ],
    agentMemory: {
      [SCOUT]: listing(SCOUT_CORE, [SCOUT_STYLE, SCOUT_BRIEF]),
      [MINA]: listing(null, [MINA_NOTE]),
      [QUIET]: listing(null, []),
    },
    agentMemoryErrors: options.errors,
    agentMemoryDelaysMs: options.delaysMs,
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

const doc = (agent: string, slug: string) =>
  `work-area-knowledge-doc-${agent}:${slug}`;

test.describe("work area Knowledge tab", () => {
  test("the channel's Knowledge control opens a tab with the memory of the employees in this channel", async ({
    page,
  }) => {
    await boot(page);
    await openChannel(page, "general");
    await expect(headerKnowledge(page)).toHaveRole("button");
    await openKnowledgeTab(page);

    // One group per employee you manage who is in this channel; nobody else's.
    const memory = dock(page).getByTestId("work-area-knowledge-memory");
    await expect(memory.getByRole("heading", { name: /^Scout/ })).toContainText(
      "3 notes",
    );
    await expect(memory.getByRole("heading", { name: /^Mina/ })).toContainText(
      "1 note",
    );
    await expect(memory.getByText("Quiet one")).toHaveCount(0);

    // Core profile first, then the most recently written.
    const scoutRows = memory
      .getByRole("list", { name: /^Scout/ })
      .getByRole("button");
    await expect(scoutRows).toHaveText([
      /Core profile/,
      /Launch brief/,
      /Writing style/,
    ]);
    await expect(scoutRows.first()).toContainText(
      "I research prospects for the team.",
    );

    // Pins have no data source: the tab says so rather than listing anything.
    await expect(
      dock(page).getByTestId("work-area-knowledge-pins"),
    ).toContainText("No pinned messages");
    await expect(
      dock(page).getByTestId("work-area-knowledge-pins").getByRole("listitem"),
    ).toHaveCount(0);
    await expect(knowledgeState(page)).toHaveCount(0);
  });

  test("a document opens in a read-only reader; keyboard and pointer both get in and back out", async ({
    page,
  }) => {
    await boot(page);
    await openChannel(page, "general");

    // Keyboard: open the tab, then a document, with Enter.
    await headerKnowledge(page).focus();
    await page.keyboard.press("Enter");
    const row = dock(page).getByTestId(doc(SCOUT, "mem/projects/launch-brief"));
    await expect(row).toBeVisible();
    await row.focus();
    await page.keyboard.press("Enter");

    const reader = dock(page).getByTestId("work-area-knowledge-reader");
    await expect(reader).toBeVisible();
    await expect(
      reader.getByRole("heading", { name: "Launch brief" }),
    ).toBeVisible();
    await expect(reader).toContainText("Memory of Scout");
    await expect(
      dock(page).getByTestId("work-area-knowledge-body"),
    ).toContainText("independent stockists first");
    // Focus moves into the reader, and it offers no way to edit.
    await expect(
      dock(page).getByTestId("work-area-knowledge-back"),
    ).toBeFocused();
    await expect(reader.getByRole("textbox")).toHaveCount(0);
    await expect(reader.getByRole("button")).toHaveCount(1);

    // Keyboard: Escape closes the reader and returns focus to the row.
    await page.keyboard.press("Escape");
    await expect(reader).toHaveCount(0);
    await expect(dock(page)).toBeVisible();
    await expect(row).toBeFocused();

    // Pointer: the same document opens, and Back returns to the list.
    await row.click();
    await expect(reader).toBeVisible();
    await dock(page).getByTestId("work-area-knowledge-back").click();
    await expect(reader).toHaveCount(0);
    await expect(row).toBeFocused();

    // Keyboard: Back is a button too.
    await row.focus();
    await page.keyboard.press("Space");
    await expect(reader).toBeVisible();
    await dock(page).getByTestId("work-area-knowledge-back").focus();
    await page.keyboard.press("Enter");
    await expect(reader).toHaveCount(0);
  });

  test("employees in the channel with nothing written down get an honest empty state", async ({
    page,
  }) => {
    await boot(page);
    await openChannel(page, "engineering");
    await openKnowledgeTab(page);

    await expect(knowledgeState(page)).toHaveAttribute("data-state", "empty");
    await expect(knowledgeState(page)).toContainText("Nothing remembered yet");
    await expect(
      dock(page).getByTestId("work-area-knowledge-memory"),
    ).toHaveCount(0);
    // Mina is only in general: her memory never leaks into this channel.
    await expect(dock(page).getByText("Mina")).toHaveCount(0);
    await expect(
      page.getByTestId("work-area-knowledge-state-retry"),
    ).toHaveCount(0);
  });

  test("a channel with none of your employees says so instead of showing anyone else's memory", async ({
    page,
  }) => {
    await boot(page);
    await openChannel(page, "random");
    await openKnowledgeTab(page);

    await expect(knowledgeState(page)).toHaveAttribute("data-state", "empty");
    await expect(knowledgeState(page)).toContainText("No memory to show yet");
    await expect(dock(page).getByText("Scout")).toHaveCount(0);
  });

  test("a failed read says so in plain words, hides the raw text, and Retry recovers", async ({
    page,
  }) => {
    // Two employees, each read once plus the query's own single retry.
    await boot(page, { errors: Array(4).fill(MEMORY_ERROR) });
    await openChannel(page, "general");
    await openKnowledgeTab(page);

    await expect(knowledgeState(page)).toHaveAttribute("data-state", "failed", {
      timeout: 20_000,
    });
    await expect(knowledgeState(page)).toHaveRole("alert");
    await expect(knowledgeState(page)).toContainText(
      "Knowledge could not be loaded",
    );
    await expect(knowledgeState(page)).toContainText(PLAIN_FAILURE);
    await expect(dock(page)).not.toContainText(RAW_TEXT);

    const retry = page.getByTestId("work-area-knowledge-state-retry");
    await retry.focus();
    await page.keyboard.press("Enter");
    await expect(
      dock(page).getByTestId(doc(SCOUT, "mem/projects/launch-brief")),
    ).toBeVisible();
    await expect(knowledgeState(page)).toHaveCount(0);
  });

  test("one employee's memory failing does not hide the others, and says which", async ({
    page,
  }) => {
    // Three failures across two employees leave exactly one unreadable.
    await boot(page, { errors: Array(3).fill(MEMORY_ERROR) });
    await openChannel(page, "general");
    await openKnowledgeTab(page);

    const notice = dock(page).getByTestId("work-area-knowledge-unavailable");
    await expect(notice).toBeVisible({ timeout: 20_000 });
    await expect(notice).toContainText(
      /Memory could not be read for (Scout|Mina)\./,
    );
    await expect(dock(page)).not.toContainText(RAW_TEXT);
    await expect(
      dock(page).getByTestId("work-area-knowledge-memory").getByRole("heading"),
    ).toHaveCount(1);

    await notice.getByRole("button", { name: "Retry" }).click();
    await expect(
      dock(page).getByTestId("work-area-knowledge-memory").getByRole("heading"),
    ).toHaveCount(2);
    await expect(notice).toHaveCount(0);
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
    await expect(dock(page).getByText("Scout")).toHaveCount(0);
  });

  test("the first read shows a loading state before any documents", async ({
    page,
  }) => {
    await boot(page, { delaysMs: [2_500] });
    await openChannel(page, "general");
    await openKnowledgeTab(page);

    await expect(knowledgeState(page)).toHaveAttribute("data-state", "loading");
    await expect(knowledgeState(page)).toHaveRole("status");
    await expect(knowledgeState(page)).toContainText("Loading knowledge");
    await expect(
      dock(page).getByTestId(doc(SCOUT, "mem/projects/launch-brief")),
    ).toBeVisible({ timeout: 15_000 });
    await expect(knowledgeState(page)).toHaveCount(0);
  });

  test("Work and Knowledge are both dock tabs: addable from the menu, one each, kept per channel", async ({
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
    await page.getByRole("menuitem", { name: "Work", exact: true }).click();
    await expect(dock(page).getByRole("tab")).toHaveText([/Knowledge/, /Work/]);

    // Another channel does not inherit either.
    await openChannel(page, "engineering");
    await expect(dock(page).getByRole("tab")).toHaveCount(0);
  });
});

// Review screenshots at the two reference viewports. The frozen r15 channel has
// no Knowledge tab; the list rows borrow the r15 `cx-row` and the Work tab's
// row language, and every state here had no reference.
for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1728, height: 1117 },
]) {
  test(`knowledge tab screenshots at ${viewport.width}`, async ({ page }) => {
    await boot(page, {
      viewport,
      delaysMs: [3_000],
      errors: Array(4).fill(MEMORY_ERROR),
    });
    await openChannel(page, "general");
    await openKnowledgeTab(page);

    const shot = async (name: string) => {
      await waitForAnimations(page);
      await page.screenshot({
        path: `${OUT}/knowledge-${name}-${viewport.width}.png`,
      });
    };

    await expect(knowledgeState(page)).toHaveAttribute("data-state", "loading");
    await shot("loading");

    await expect(knowledgeState(page)).toHaveAttribute("data-state", "failed", {
      timeout: 25_000,
    });
    await shot("failed");

    await page.getByTestId("work-area-knowledge-state-retry").click();
    await expect(
      dock(page).getByTestId(doc(SCOUT, "mem/projects/launch-brief")),
    ).toBeVisible();
    await shot("ready");

    await dock(page).getByTestId(doc(SCOUT, "core")).click();
    await expect(
      dock(page).getByTestId("work-area-knowledge-reader"),
    ).toBeVisible();
    await shot("reader");

    await openChannel(page, "engineering");
    await openKnowledgeTab(page);
    await expect(knowledgeState(page)).toHaveAttribute("data-state", "empty");
    await shot("empty");

    await openChannel(page, "random");
    await openKnowledgeTab(page);
    await expect(knowledgeState(page)).toContainText("No memory to show yet");
    await shot("no-agents");

    await openUnjoinedChannel(page);
    await openKnowledgeTab(page);
    await expect(knowledgeState(page)).toHaveAttribute("data-state", "denied");
    await shot("denied");
  });
}
