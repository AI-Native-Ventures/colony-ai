import { expect, test, type Page } from "@playwright/test";
import { installMockBridge } from "../helpers/bridge";
import { waitForAnimations } from "../helpers/animations";
import { installBrowserHostFake } from "./helpers/browserHostFake";
import { installBrowserBrokerFake } from "./helpers/browserBrokerFake";

/**
 * Default browser access: the owner's own AI employee opens the Colony browser
 * itself. These specs bind the app window's side of it, with the broker and the
 * native host replaced by their contract fakes. The broker's own policy
 * (tools listed from the start, the held first call, auto-approved addresses,
 * Stop respected) is proven in `electron/browser-broker/*.test.mjs`.
 */

const agentId = "a".repeat(64);
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

async function boot(page: Page, channelName: string) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await installBrowserHostFake(page);
  await installBrowserBrokerFake(page, true);
  await installMockBridge(page, {
    managedAgents: [
      {
        pubkey: agentId,
        name: "Scout",
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
const controller = (page: Page) => page.getByTestId("browser-controller");
const hostCalls = (page: Page, op: string) =>
  page.evaluate(
    (name) => window.__browserFake?.calls.filter((c) => c.op === name) ?? [],
    op,
  );

test("an agent's first browser call opens the work area browser in a channel and takes control", async ({
  page,
}, testInfo) => {
  const channelId = await boot(page, "engineering");
  // Nothing is open: the person has not touched the work area.
  await expect(page.getByTestId("work-area-panel")).toHaveCount(0);

  await page.evaluate(
    ([agent, task]) =>
      window.colonyBrowserControlFixture?.requestAccess(agent, task),
    [agentId, `conversation:${channelId}`],
  );

  await expect(page.getByTestId("work-area-panel")).toBeVisible();
  await expect(page.getByTestId("browser-agent-controls")).toBeVisible();
  await expect(controller(page)).toHaveText("Scout has control");
  await expect(page.getByTestId("browser-address")).toBeVisible();

  const [request] = await grants(page);
  expect(request.payload).toMatchObject({
    agentId,
    taskId: `conversation:${channelId}`,
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
  expect(
    await page.evaluate(
      () => window.colonyBrowserControlFixture?.grant()?.defaultAccess,
    ),
  ).toBe(true);

  // The person is told what happened and keeps Stop and Take over.
  await controls(page)
    .getByText("Approved sites and files", { exact: true })
    .click();
  await expect(controls(page)).toContainText(
    "Scout opened this browser for this channel.",
  );
  await expect(
    controls(page).getByRole("button", { name: "Stop", exact: true }),
  ).toBeVisible();
  await expect(
    controls(page).getByRole("button", { name: "Take over", exact: true }),
  ).toBeVisible();
  await waitForAnimations(page);
  await page.screenshot({
    path: testInfo.outputPath("agent-opened-browser.png"),
  });
});

test("the same call in a DM opens the browser there too, and a renewed grant keeps the page", async ({
  page,
}) => {
  const channelId = await boot(page, "alice-tyler");
  const task = `conversation:${channelId}`;
  await page.evaluate(
    ([agent, taskId]) =>
      window.colonyBrowserControlFixture?.requestAccess(agent, taskId),
    [agentId, task],
  );
  await expect(controller(page)).toHaveText("Scout has control");

  // The grant ran out; the next call asks again and the same page is reused.
  await page.evaluate(() => window.colonyBrowserControlFixture?.expire());
  await expect(controller(page)).toHaveText("You’re browsing");
  await page.evaluate(
    ([agent, taskId]) =>
      window.colonyBrowserControlFixture?.requestAccess(agent, taskId),
    [agentId, task],
  );
  await expect(controller(page)).toHaveText("Scout has control");
  const requests = await grants(page);
  expect(requests).toHaveLength(2);
  expect(requests[1].payload.tabId).toBe(requests[0].payload.tabId);
  expect(await hostCalls(page, "createTab")).toHaveLength(1);
});

test("after Stop the agent's next call shows one Allow card and nothing is granted until the person clicks", async ({
  page,
}, testInfo) => {
  const channelId = await boot(page, "engineering");
  const task = `conversation:${channelId}`;
  await page.evaluate(
    ([agent, taskId]) =>
      window.colonyBrowserControlFixture?.requestAccess(agent, taskId),
    [agentId, task],
  );
  await expect(controller(page)).toHaveText("Scout has control");

  await controls(page)
    .getByRole("button", { name: "Stop", exact: true })
    .click();
  await expect(controller(page)).toHaveText("You’re browsing");

  // Main reports the agent's next call as a resume request.
  await page.evaluate(
    ([agent, taskId]) =>
      window.colonyBrowserControlFixture?.requestAccess(agent, taskId, true),
    [agentId, task],
  );
  const card = page.getByTestId("browser-agent-resume");
  await expect(card).toContainText("Scout wants to use the browser again.");
  await expect(controller(page)).toHaveText("You’re browsing");
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
  await page.evaluate(
    ([agent, taskId]) =>
      window.colonyBrowserControlFixture?.requestAccess(agent, taskId, true),
    [agentId, `conversation:${channelId}`],
  );
  const card = page.getByTestId("browser-agent-resume");
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Not now", exact: true }).click();
  await expect(card).toHaveCount(0);
  expect(await grants(page)).toHaveLength(0);
  await expect(controller(page)).toHaveText("You’re browsing");
});

test("an Allow card goes away when the broker approves that site itself, and a held site never raises one", async ({
  page,
}) => {
  // The 25 Oct run: the agent opened a site, a redirect raised a card for it,
  // and the agent then opened that address itself. The card stayed.
  const channelId = await boot(page, "engineering");
  await page.evaluate(
    ([agent, taskId]) =>
      window.colonyBrowserControlFixture?.requestAccess(agent, taskId),
    [agentId, `conversation:${channelId}`],
  );
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
  await expect(page.getByTestId("work-area-panel")).toHaveCount(0);
});

function controls(page: Page) {
  return page.getByTestId("browser-agent-controls");
}
