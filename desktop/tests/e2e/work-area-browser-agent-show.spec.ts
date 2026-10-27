import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { installMockBridge } from "../helpers/bridge";
import { waitForAnimations } from "../helpers/animations";
import { installBrowserHostFake } from "./helpers/browserHostFake";
import { installBrowserBrokerFake } from "./helpers/browserBrokerFake";

const agentId = "a".repeat(64);
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
        channelNames: [channelName, "engineering", "random"],
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

const ask = (page: Page, taskId: string) =>
  page.evaluate(
    ([agent, task]) =>
      window.colonyBrowserControlFixture?.requestAccess(
        agent as string,
        task as string,
      ),
    [agentId, taskId],
  );

const acted = (page: Page, taskId: string) =>
  page.evaluate(
    ([agent, task]) => {
      const tabId = window.__browserFake?.tabs().at(-1)?.id;
      window.colonyBrowserControlFixture?.agentAction(
        agent as string,
        task as string,
        tabId,
      );
    },
    [agentId, taskId],
  );

const dock = (page: Page) => page.getByTestId("work-area-panel");
const tabStrip = (page: Page) =>
  page.getByRole("tablist", { name: "Work area tabs" });

async function captureLightAndDark(
  page: Page,
  testInfo: TestInfo,
  name: string,
) {
  if (testInfo.project.name !== "smoke") return;
  await waitForAnimations(page);
  await page.screenshot({ path: testInfo.outputPath(`${name}-light.png`) });
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await waitForAnimations(page);
  await page.screenshot({ path: testInfo.outputPath(`${name}-dark.png`) });
  await page.evaluate(() => document.documentElement.classList.remove("dark"));
}

test("a visible conversation opens the agent page and leaves composer focus in place", async ({
  page,
}, testInfo) => {
  const channelId = await boot(page, "engineering");
  const taskId = `conversation:${channelId}`;
  const composer = page.getByTestId("message-input");
  await composer.click();
  await composer.pressSequentially("half a sentence");
  await expect(dock(page)).toHaveCount(0);

  await ask(page, taskId);
  await expect.poll(async () => (await grants(page)).length).toBe(1);
  await expect(dock(page)).toBeVisible();
  await expect(
    tabStrip(page).locator('[role="tab"][aria-selected="true"]'),
  ).toHaveText("New tab");
  await expect(page.getByTestId("browser-controller")).toHaveText(
    "Scout has control",
  );
  await expect(composer).toBeFocused();
  await expect(composer).toContainText("half a sentence");

  await captureLightAndDark(page, testInfo, "same-conversation-browser");
});

test("a browser in another channel stays quiet until its sidebar marker is clicked", async ({
  page,
}, testInfo) => {
  await boot(page, "engineering");
  const otherChannel = page.getByTestId("channel-random");
  const otherChannelId = await otherChannel.getAttribute("data-channel-id");
  if (!otherChannelId) throw new Error("The random channel has no id");
  const taskId = `conversation:${otherChannelId}`;

  await ask(page, taskId);
  await expect.poll(async () => (await grants(page)).length).toBe(1);
  await acted(page, taskId);
  await expect(page.getByTestId("channel-browser-random")).toBeVisible();
  await expect(dock(page)).toHaveCount(0);

  await page.getByTestId("channel-browser-random").click();
  await expect(page.getByTestId("channel-random")).toHaveAttribute(
    "data-active",
    "true",
  );
  await expect(dock(page)).toBeVisible();
  await expect(
    tabStrip(page).locator('[role="tab"][aria-selected="true"]'),
  ).toHaveText("New tab");
  await expect(page.getByTestId("browser-controller")).toHaveText(
    "Scout has control",
  );

  await captureLightAndDark(page, testInfo, "other-conversation-browser");
});

test("keyboard activation of a channel with a browser marker opens its latest page", async ({
  page,
}) => {
  await boot(page, "engineering");
  const otherChannel = page.getByTestId("channel-random");
  const otherChannelId = await otherChannel.getAttribute("data-channel-id");
  if (!otherChannelId) throw new Error("The random channel has no id");
  const taskId = `conversation:${otherChannelId}`;

  await ask(page, taskId);
  await expect.poll(async () => (await grants(page)).length).toBe(1);
  await acted(page, taskId);
  await expect(page.getByTestId("channel-browser-random")).toBeVisible();
  await expect(dock(page)).toHaveCount(0);

  await otherChannel.focus();
  await otherChannel.press("Enter");
  await expect(otherChannel).toHaveAttribute("data-active", "true");
  await expect(dock(page)).toBeVisible();
  await expect(page.getByTestId("browser-controller")).toHaveText(
    "Scout has control",
  );
});
