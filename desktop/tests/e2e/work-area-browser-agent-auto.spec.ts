import { expect, test, type Page } from "@playwright/test";
import { installMockBridge } from "../helpers/bridge";
import { waitForAnimations } from "../helpers/animations";
import { installBrowserHostFake } from "./helpers/browserHostFake";
import { installBrowserBrokerFake } from "./helpers/browserBrokerFake";

/**
 * Default browser access: the owner's own AI employees use the Colony browser
 * by themselves, in the background, and share the business's tabs. These specs
 * bind the app window's side of it, with the broker and the native host
 * replaced by their contract fakes. The broker's own policy (tools listed from
 * the start, auto-approved addresses, taking over the person's tabs, Stop
 * respected) is proven in `electron/browser-broker/*.test.mjs` and, against
 * real Electron, in `tests/electron/browser-broker-*.spec.ts`.
 *
 * A request for the visible conversation opens its page without moving
 * keyboard focus. Other conversations stay in the background and use a mark
 * the person can click to navigate and show the page.
 */

const agentId = "a".repeat(64);
const otherAgentId = "b".repeat(64);
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

async function boot(page: Page, channelName: string) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await installBrowserHostFake(page);
  await installBrowserBrokerFake(page, true, { defaultAccess: true });
  await installMockBridge(page, {
    managedAgents: [
      {
        pubkey: agentId,
        name: "Scout",
        status: "running",
        channelNames: [channelName],
        sessionPolicy: "channel",
      },
      {
        pubkey: otherAgentId,
        name: "Sage",
        status: "running",
        channelNames: [channelName],
        sessionPolicy: "channel",
      },
    ],
  });
  await page.goto("/");
  await expect(page.getByTestId("home-inbox-list")).toBeVisible();
  await page.getByTestId(`channel-${channelName}`).click();
  const match = new RegExp(`(${UUID})`, "iu").exec(page.url());
  if (!match) throw new Error(`No channel id in ${page.url()}`);
  return match[1].toLowerCase();
}

const grants = (page: Page) =>
  page.evaluate(
    () =>
      window.colonyBrowserControlFixture?.calls.filter(
        (call) => call.action === "agent-grant",
      ) ?? [],
  );
// Every tab's panel stays mounted; only the shown one is not [hidden].
const shown = (page: Page, id: string) =>
  page
    .getByTestId("work-area-panel")
    .locator('section[role="tabpanel"]:not([hidden])')
    .getByTestId(id);
const controller = (page: Page) => shown(page, "browser-controller");
const hostCalls = (page: Page, op: string) =>
  page.evaluate(
    (name) => window.__browserFake?.calls.filter((c) => c.op === name) ?? [],
    op,
  );
const dock = (page: Page) => page.getByTestId("work-area-panel");
const activityButton = (page: Page) =>
  page.getByTestId("channel-browser-activity");
const tabStrip = (page: Page) =>
  page.getByRole("tablist", { name: "Work area tabs" });

const ask = (page: Page, task: string, resume = false) =>
  page.evaluate(
    ([agent, taskId, again]) =>
      window.colonyBrowserControlFixture?.requestAccess(
        agent as string,
        taskId as string,
        again as boolean,
      ),
    [agentId, task, resume],
  );

/** The agent did something in its page: the app hears an `agent-action`. */
const acted = (page: Page, task: string, who = agentId) =>
  page.evaluate(
    ([agent, taskId]) => {
      const tab = window.__browserFake?.tabs().at(-1)?.id;
      window.colonyBrowserControlFixture?.agentAction(agent, taskId, tab);
    },
    [who, task],
  );

/** The person chooses to watch: the one place the dock opens for an agent. */
async function watch(page: Page) {
  await activityButton(page).click();
  await expect(dock(page)).toBeVisible();
}

test("an agent's first browser call shows its page in the visible conversation without taking focus", async ({
  page,
}, testInfo) => {
  const channelId = await boot(page, "engineering");
  const task = `conversation:${channelId}`;
  // Nothing is open: the person has not touched the work area.
  await expect(dock(page)).toHaveCount(0);
  const composer = page.getByTestId("message-input");
  await composer.click();

  await ask(page, task);
  await expect.poll(async () => (await grants(page)).length).toBe(1);
  const [request] = await grants(page);
  expect(request.payload).toMatchObject({
    agentId,
    taskId: task,
    communityOrigin: "http://localhost:3000",
    allowedOrigins: [],
    defaultAccess: true,
    ttlMs: 3_600_000,
  });
  // The grant sits on the live empty page the app just made, nothing loaded.
  expect(await hostCalls(page, "createTab")).toEqual([
    { op: "createTab", businessId: expect.any(String) },
  ]);
  expect(request.payload.tabId).toBe("fake-tab-1");

  // The visible conversation's page is shown, but focus stays in the composer.
  await expect(dock(page)).toBeVisible();
  await expect(controller(page)).toHaveText("Scout has control");
  await expect(composer).toBeFocused();

  // Once it works, a mark says so, in the header and beside the channel.
  await expect(activityButton(page)).toHaveCount(0);
  await acted(page, task);
  await expect(activityButton(page)).toBeVisible();
  await expect(activityButton(page)).toHaveAccessibleName(
    "Scout is using the browser. View",
  );
  await expect(
    page.getByTestId("channel-browser-engineering"),
  ).toHaveAccessibleName("Scout is using the browser");
  // The page is already shown and the View action keeps it available.
  await watch(page);
  await expect(page.getByTestId("browser-agent-controls")).toBeVisible();
  await expect(controller(page)).toHaveText("Scout has control");
  await expect(page.getByTestId("browser-address")).toBeVisible();
  await expect(
    page.getByTestId("browser-agent-controls").getByRole("button", {
      name: "Stop",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByTestId("browser-agent-controls").getByRole("button", {
      name: "Take over",
      exact: true,
    }),
  ).toBeVisible();
  await expect(shown(page, "browser-status-sharing")).toHaveText(
    "An AI employee is using this tab",
  );
  await waitForAnimations(page);
  await page.screenshot({
    path: testInfo.outputPath("agent-opened-browser.png"),
  });
});

test("an agent working while the person reads another tab never changes the tab, the dock or the focus", async ({
  page,
}) => {
  const channelId = await boot(page, "engineering");
  const task = `conversation:${channelId}`;
  // The person has the Files tab open and is typing in the message box.
  await page.getByTestId("channel-work-area-trigger").click();
  await page.getByTestId("work-area-open-files").click();
  await expect(dock(page)).toBeVisible();
  const composer = page.getByTestId("message-input");
  const filesTab = tabStrip(page).getByRole("tab", { name: "Files" });
  // Clicking the open dock tab is recent person activity in the work area.
  await filesTab.click();
  await expect(filesTab).toHaveAttribute("aria-selected", "true");
  await composer.click();
  await composer.pressSequentially("half a sentence");
  await expect(filesTab).toHaveAttribute("aria-selected", "true");

  await ask(page, task);
  await expect.poll(async () => (await grants(page)).length).toBe(1);
  await acted(page, task);
  await expect(activityButton(page)).toBeVisible();

  // The agent's page is in the strip, quietly: Files is still the shown tab.
  await expect(tabStrip(page).getByRole("tab")).toHaveCount(2);
  await expect(filesTab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("browser-tab-agent-mark")).toBeVisible();
  await expect(composer).toBeFocused();
  await expect(composer).toContainText("half a sentence");
  expect(await hostCalls(page, "attach")).toEqual([]);

  // A page the agent opens for itself arrives the same way.
  await page.evaluate(() => {
    const [first] = window.__browserFake?.tabs() ?? [];
    window.__browserFake?.agentOpened(first.id, "https://colony.global");
  });
  await expect(tabStrip(page).getByRole("tab")).toHaveCount(3);
  await expect(filesTab).toHaveAttribute("aria-selected", "true");
  await expect(composer).toBeFocused();
});

test("two agents at once each show, and a click on the mark opens the dock on the page", async ({
  page,
}) => {
  const channelId = await boot(page, "engineering");
  const task = `conversation:${channelId}`;
  await page.getByTestId("message-input").click();
  await ask(page, task);
  await expect.poll(async () => (await grants(page)).length).toBe(1);
  await acted(page, task);
  await acted(page, task, otherAgentId);
  await expect(activityButton(page)).toHaveAccessibleName(
    "Sage and Scout are using the browser. View",
  );
  await expect(dock(page)).toBeVisible();
  await watch(page);
  await expect(controller(page)).toHaveText("Scout has control");
});

test("the same call in a DM works there too, and a renewed grant keeps the page", async ({
  page,
}) => {
  const channelId = await boot(page, "alice-tyler");
  const task = `conversation:${channelId}`;
  // Auto-show is only appropriate while Colony is the focused, visible window.
  await page.getByTestId("message-input").click();
  expect(await page.evaluate(() => document.hasFocus())).toBe(true);
  await ask(page, task);
  await expect.poll(async () => (await grants(page)).length).toBe(1);
  await acted(page, task);
  await expect(dock(page)).toBeVisible();
  await expect(controller(page)).toHaveText("Scout has control");

  // The grant ran out; the next call asks again and the same page is reused.
  await page.evaluate(() => window.colonyBrowserControlFixture?.expire());
  await expect(controller(page)).toHaveText("AI employees can use this tab");
  await ask(page, task);
  await expect(controller(page)).toHaveText("Scout has control");
  const requests = await grants(page);
  expect(requests).toHaveLength(2);
  expect(requests[1].payload.tabId).toBe(requests[0].payload.tabId);
  expect(await hostCalls(page, "createTab")).toHaveLength(1);
});

test("after Stop the agent's next call shows one Allow card, marks the agent as waiting, and grants nothing until the person clicks", async ({
  page,
}, testInfo) => {
  const channelId = await boot(page, "engineering");
  const task = `conversation:${channelId}`;
  await ask(page, task);
  await expect.poll(async () => (await grants(page)).length).toBe(1);
  await acted(page, task);
  await watch(page);
  await expect(controller(page)).toHaveText("Scout has control");

  await controls(page)
    .getByRole("button", { name: "Stop", exact: true })
    .click();
  await expect(controller(page)).toHaveText("AI employees can use this tab");

  // Main reports the agent's next call as a resume request.
  await ask(page, task, true);
  const card = page.getByTestId("browser-agent-resume");
  await expect(card).toContainText("Scout wants to use the browser again.");
  await expect(controller(page)).toHaveText("AI employees can use this tab");
  await expect(activityButton(page)).toHaveAccessibleName(
    "Scout needs you in the browser. View",
  );
  expect(await grants(page)).toHaveLength(1);
  await waitForAnimations(page);
  await controls(page).screenshot({
    path: testInfo.outputPath("agent-resume-card.png"),
  });

  await card.getByRole("button", { name: "Allow", exact: true }).click();
  await expect(controller(page)).toHaveText("Scout has control");
  await expect(card).toHaveCount(0);
  const requests = await grants(page);
  expect(requests).toHaveLength(2);
  expect(requests[1].payload).toMatchObject({
    defaultAccess: true,
    allowedOrigins: [],
  });
});

test("Not now clears the card and leaves the agent without the browser", async ({
  page,
}) => {
  const channelId = await boot(page, "engineering");
  await ask(page, `conversation:${channelId}`, true);
  // Nothing opened by itself; the mark says the agent waits for the person.
  await expect(dock(page)).toHaveCount(0);
  await expect(activityButton(page)).toHaveAccessibleName(
    "Scout needs you in the browser. View",
  );
  await watch(page);
  const card = page.getByTestId("browser-agent-resume");
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Not now", exact: true }).click();
  await expect(card).toHaveCount(0);
  await expect(activityButton(page)).toHaveCount(0);
  expect(await grants(page)).toHaveLength(0);
  await expect(controller(page)).toHaveText("AI employees can use this tab");
});

test("an Allow card goes away when the broker approves that site itself, and a held site never raises one", async ({
  page,
}) => {
  // The 25 Oct run: the agent opened a site, a redirect raised a card for it,
  // and the agent then opened that address itself. The card stayed.
  const channelId = await boot(page, "engineering");
  const task = `conversation:${channelId}`;
  await ask(page, task);
  await expect.poll(async () => (await grants(page)).length).toBe(1);
  await acted(page, task);
  await watch(page);
  await expect(controller(page)).toHaveText("Scout has control");

  await page.evaluate(() =>
    window.colonyBrowserControlFixture?.site("https://colony.global"),
  );
  const card = controls(page).getByRole("group", { name: "Site approval" });
  await expect(card).toContainText(
    "Allow Scout to use https://colony.global for this task?",
  );

  await page.evaluate(() =>
    window.colonyBrowserControlFixture?.approveOnItsOwn(
      "https://colony.global",
    ),
  );
  await expect(card).toHaveCount(0);

  // A late notice for a site the grant already holds raises nothing.
  await page.evaluate(() =>
    window.colonyBrowserControlFixture?.site("https://colony.global"),
  );
  await page.waitForTimeout(300);
  await expect(card).toHaveCount(0);

  // A different site still asks.
  await page.evaluate(() =>
    window.colonyBrowserControlFixture?.site("https://other.example"),
  );
  await expect(card).toContainText("https://other.example");
});

test("AI employees can use the person's own tab, and one click keeps it private", async ({
  page,
}) => {
  await boot(page, "engineering");
  await page.getByTestId("channel-work-area-trigger").click();
  await page.getByTestId("work-area-open-browser").click();
  const address = shown(page, "browser-address");
  await address.fill("colony.global");
  await address.press("Enter");
  await expect(address).toHaveValue(/colony\.global/u);

  // Open to the business's AI employees by default; nothing to allow.
  await expect(controller(page)).toHaveText("AI employees can use this tab");
  await expect(shown(page, "browser-status-sharing")).toHaveText(
    "Shared with this business’s AI employees",
  );
  await expect(
    controls(page).getByRole("button", { name: "Allow an agent" }),
  ).toHaveCount(0);
  const keepPrivate = tabStrip(page).getByRole("button", {
    name: "Keep private from AI employees",
  });
  await expect(keepPrivate).toHaveAttribute("aria-pressed", "false");

  await keepPrivate.click();
  await expect(controller(page)).toHaveText(
    "Private: AI employees cannot see this tab",
  );
  await expect(shown(page, "browser-status-sharing")).toHaveText(
    "Private to you",
  );
  const calls = await hostCalls(page, "setPrivate");
  expect(calls).toEqual([
    { op: "setPrivate", tabId: "fake-tab-1", value: true },
  ]);
  const shareAgain = tabStrip(page).getByRole("button", {
    name: "Private tab. Share it with AI employees",
  });
  await expect(shareAgain).toHaveAttribute("aria-pressed", "true");
  await shareAgain.click();
  await expect(controller(page)).toHaveText("AI employees can use this tab");
  expect(await hostCalls(page, "setPrivate")).toHaveLength(2);
});

test("an agent that takes the person's tab shows 'has control' there, and Take over gives only that tab back", async ({
  page,
}) => {
  const channelId = await boot(page, "engineering");
  const task = `conversation:${channelId}`;
  // The person's own page is open and shown.
  await page.getByTestId("channel-work-area-trigger").click();
  await page.getByTestId("work-area-open-browser").click();
  const address = shown(page, "browser-address");
  await address.fill("colony.global");
  await address.press("Enter");
  await expect(address).toHaveValue(/colony\.global/u);
  const personTab = await page.evaluate(
    () => window.__browserFake?.tabs()[0].id ?? "",
  );
  await expect(controller(page)).toHaveText("AI employees can use this tab");

  // The agent has a page of its own, then takes the person's.
  await ask(page, task);
  await expect.poll(async () => (await grants(page)).length).toBe(1);
  await page.evaluate(
    (tab) => window.colonyBrowserControlFixture?.adopt(tab),
    personTab,
  );
  await expect(controller(page)).toHaveText("Scout has control");
  await expect(shown(page, "browser-status-sharing")).toHaveText(
    "An AI employee is using this tab",
  );
  // The page the person is looking at is still the one they are looking at.
  await expect(address).toHaveValue(/colony\.global/u);

  await controls(page)
    .getByRole("button", { name: "Take over", exact: true })
    .click();
  await expect(controller(page)).toHaveText("AI employees can use this tab");
  const released = await page.evaluate(() =>
    window.colonyBrowserControlFixture?.calls.filter(
      (call) => call.action === "agent-release-tab",
    ),
  );
  expect(released).toEqual([
    {
      action: "agent-release-tab",
      payload: { grantId: "fixture-grant", tabId: personTab },
    },
  ]);
  // The agent is not stopped: its grant is alive.
  expect(
    await page.evaluate(() => window.colonyBrowserControlFixture?.grant()),
  ).not.toBeNull();
});

test("a request for a different community or a malformed task changes nothing", async ({
  page,
}) => {
  const channelId = await boot(page, "engineering");
  await page.evaluate(
    ([agent, taskId]) => {
      const fixture = window.colonyBrowserControlFixture;
      fixture?.requestAccess(agent, "conversation:not-a-channel");
      fixture?.requestAccess(agent, `thread:${taskId}:nothex`);
      fixture?.requestAccess(
        agent,
        `conversation:${taskId}`,
        false,
        "https://other.example",
      );
    },
    [agentId, channelId],
  );
  await page.waitForTimeout(300);
  expect(await grants(page)).toHaveLength(0);
  await expect(dock(page)).toHaveCount(0);
});

function controls(page: Page) {
  return shown(page, "browser-agent-controls");
}
