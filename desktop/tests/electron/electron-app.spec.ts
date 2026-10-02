import { randomUUID } from "node:crypto";
import path from "node:path";

import { expect, test } from "@playwright/test";
import { finalizeEvent } from "nostr-tools";

import { KIND_ASK_ACTION } from "../../src/shared/constants/kinds";

import {
  DEFAULT_RELAY_URL,
  PROXY_RELAY_URL,
  closeElectron,
  createUserDataDir,
  ensureFixtureAccount,
  FIXTURE_ACCOUNT_PASSWORD,
  fixtureIdentity,
  finishElectronTest,
  launchElectron,
  readDiagnosticTail,
  publishChannelMessage,
  startTcpRelayProxy,
  waitForRelayMessage,
  type RunningElectron,
  type TcpRelayProxy,
  type TestIdentity,
} from "./helpers";

async function assertLanding(page: RunningElectron["page"]) {
  await expect(page).toHaveURL(/^colony:\/\/app\//u);
  await expect(page.getByTestId("google-account-scene")).toBeVisible({
    timeout: 60_000,
  });
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
  await expect(page.getByTestId("native-startup-error")).toHaveCount(0);
  await expect(page.getByLabel("Email address")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();
}

async function onboardToCommunity(
  running: RunningElectron,
  identity: TestIdentity,
  displayName: string,
): Promise<string> {
  const { page } = running;
  await assertLanding(page);
  const email = await ensureFixtureAccount(identity, running.relayUrl);
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(FIXTURE_ACCOUNT_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const communityChoices = page
    .getByTestId("onboarding-business-list")
    .getByRole("button");
  await expect(communityChoices).toHaveCount(1, { timeout: 60_000 });
  await communityChoices.first().click();

  const profileHeading = page.getByRole("heading", {
    name: "Build your profile",
  });
  const teamIntro = page.getByTestId("community-team-intro-enter");
  await expect
    .poll(
      async () => {
        if (await profileHeading.isVisible()) return "profile";
        if (await teamIntro.isVisible()) return "team-intro";
        if (await page.getByTestId("channel-general").isVisible())
          return "main";
        return "pending";
      },
      { timeout: 60_000 },
    )
    .not.toBe("pending");
  if (await profileHeading.isVisible()) {
    await page.getByTestId("community-profile-name-key").fill(displayName);
    await page.getByTestId("community-profile-next").click();
    await expect(teamIntro).toBeVisible({ timeout: 30_000 });
  }
  if (await teamIntro.isVisible()) {
    await teamIntro.click();
    await expect(page.getByTestId("community-onboarding-flow")).toHaveCount(0, {
      timeout: 30_000,
    });
  }
  await expect(page.getByTestId("channel-general")).toBeVisible({
    timeout: 60_000,
  });
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general", {
    timeout: 20_000,
  });
  await expect(page.getByTestId("message-input")).toBeVisible();
  const channelId = await page
    .getByTestId("channel-general")
    .getAttribute("data-channel-id");
  if (!channelId) throw new Error("The visible #general channel has no id.");
  return channelId;
}

async function enterMessage(
  running: RunningElectron,
  content: string,
  timeoutMs = 15_000,
) {
  await running.page.getByTestId("message-input").fill(content);
  await expect(running.page.getByTestId("send-message")).toBeEnabled();
  await running.page.getByTestId("send-message").click();
  await expect(running.page.getByTestId("message-timeline")).toContainText(
    content,
    { timeout: timeoutMs },
  );
}

function messageText(prefix: string) {
  return `${prefix} ${Date.now()} ${randomUUID()}`;
}

function hasChannelTag(tags: string[][], channelId: string) {
  return tags.some((tag) => tag[0] === "h" && tag[1] === channelId);
}

test("real Electron reaches the onboarding landing without a native startup error", async ({
  browserName: _browserName,
}, testInfo) => {
  const userDataDir = createUserDataDir(testInfo);
  const applications: RunningElectron[] = [];
  try {
    const running = await launchElectron(userDataDir);
    applications.push(running);
    await assertLanding(running.page);
  } finally {
    await finishElectronTest(testInfo, userDataDir, applications);
  }
});

test("packaged first run signs in, opens workspace surfaces, and recovers from offline update checks", async ({
  browserName: _browserName,
}, testInfo) => {
  test.setTimeout(180_000);
  const userDataDir = createUserDataDir(testInfo);
  const applications: RunningElectron[] = [];
  try {
    const identity = fixtureIdentity("onboarding-member");
    const running = await launchElectron(userDataDir);
    applications.push(running);
    const generalChannelId = await onboardToCommunity(
      running,
      identity,
      "Electron E2E Member",
    );

    const content = messageText("Packaged Electron first run");
    await enterMessage(running, content, 40_000);
    const sentEvent = await waitForRelayMessage(
      DEFAULT_RELAY_URL,
      identity.publicKey,
      content,
      40_000,
      generalChannelId,
    );
    expect(sentEvent?.kind).toBe(9);
    expect(sentEvent?.pubkey).toBe(identity.publicKey);

    if (!sentEvent?.id) throw new Error("The relay event has no message id.");
    const askPublisher = fixtureIdentity("ask-publisher");
    const askId = randomUUID();
    const askTitle = messageText("Packaged Electron ask");
    const askEvent = finalizeEvent(
      {
        kind: KIND_ASK_ACTION,
        created_at: Math.floor(Date.now() / 1000),
        content: JSON.stringify({
          schemaVersion: 1,
          askId,
          action: "create",
          ask: {
            schemaVersion: 1,
            askId,
            type: "approval",
            category: "general",
            title: askTitle,
            body: "Confirm the first-run relay journey.",
            threadRootEventId: sentEvent.id,
            addresseePubkey: identity.publicKey,
          },
        }),
        tags: [
          ["h", generalChannelId],
          ["d", `channel:${generalChannelId}:ask:${askId}`],
          ["e", sentEvent.id, "", "root"],
          ["e", sentEvent.id, "", "reply"],
        ],
      },
      askPublisher.secretKey,
    );
    const askResponse = await fetch("http://localhost:3000/events", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Pubkey": askEvent.pubkey,
      },
      body: JSON.stringify(askEvent),
    });
    if (!askResponse.ok) {
      throw new Error(
        `The isolated relay rejected the ask with HTTP ${askResponse.status}.`,
      );
    }

    const { page } = running;
    await page
      .getByTestId("sidebar-primary-menu")
      .getByRole("button", { name: "Today" })
      .click();
    await expect(
      page.getByRole("heading", { name: "Needs me", exact: true }),
    ).toBeVisible();
    const todayAsk = page.getByTestId(`today-ask-${askId}`);
    await expect(todayAsk).toBeVisible({ timeout: 30_000 });
    await todayAsk.click();
    await expect(page.getByTestId("ask-detail-screen")).toBeVisible();
    await expect(page.getByTestId("ask-card")).toContainText(askTitle);

    await page.getByTestId("sidebar-company-team").click();
    await expect(page.getByTestId("company-team-screen")).toBeVisible();

    await running.application.evaluate(({ app }, url) => {
      app.emit("open-url", { preventDefault: () => {} }, url);
    }, `buzz://message?channel=${generalChannelId}&id=${sentEvent.id}`);
    await expect(page.getByTestId("chat-title")).toHaveText("general", {
      timeout: 30_000,
    });
    await expect(
      page.getByTestId("message-timeline").getByText(content, { exact: true }),
    ).toBeVisible();

    const updaterStatus = await page.evaluate(async () => {
      const desktop = (
        window as Window & {
          colonyDesktop?: {
            updater?: {
              check: () => Promise<{ state: string; message?: string }>;
            };
          };
        }
      ).colonyDesktop;
      if (!desktop?.updater)
        throw new Error("Electron updater bridge missing.");
      return desktop.updater.check();
    });
    expect(updaterStatus.state).toBe("error");
    expect(updaterStatus.message).toBeTruthy();
    await expect(page.getByTestId("native-startup-error")).toHaveCount(0);
    await expect(page.getByTestId("channel-general")).toBeVisible();
  } finally {
    await finishElectronTest(testInfo, userDataDir, applications);
  }
});

test("a typed channel message appears in Electron and is readable by an independent Nostr client", async ({
  browserName: _browserName,
}, testInfo) => {
  test.setTimeout(120_000);
  const userDataDir = createUserDataDir(testInfo);
  const applications: RunningElectron[] = [];
  let proxy: TcpRelayProxy | undefined;
  try {
    const identity = fixtureIdentity("send-member");
    proxy = await startTcpRelayProxy({
      timelinePath: path.join(userDataDir, "send-relay-proxy.timeline.log"),
    });
    const running = await launchElectron(userDataDir, PROXY_RELAY_URL);
    applications.push(running);
    const generalChannelId = await onboardToCommunity(
      running,
      identity,
      "Electron Sender",
    );

    const content = messageText("Electron relay send");
    await enterMessage(running, content, 40_000);

    const saved = await waitForRelayMessage(
      DEFAULT_RELAY_URL,
      identity.publicKey,
      content,
      40_000,
      generalChannelId,
    );
    expect(saved).toBeDefined();
    expect(saved?.kind).toBe(9);
    expect(saved?.pubkey).toBe(identity.publicKey);
    expect(hasChannelTag(saved?.tags ?? [], generalChannelId)).toBe(true);
  } finally {
    await finishElectronTest(testInfo, userDataDir, applications, proxy);
  }
});

test("an independent Nostr client message reaches the open Electron channel within ten seconds", async ({
  browserName: _browserName,
}, testInfo) => {
  const userDataDir = createUserDataDir(testInfo);
  const applications: RunningElectron[] = [];
  try {
    const identity = fixtureIdentity("receive-member");
    const running = await launchElectron(userDataDir);
    applications.push(running);
    const generalChannelId = await onboardToCommunity(
      running,
      identity,
      "Electron Receiver",
    );

    const externalIdentity = fixtureIdentity("receive-publisher");
    const content = messageText("Independent Nostr client");
    const startedAt = Date.now();
    const event = await publishChannelMessage(
      DEFAULT_RELAY_URL,
      externalIdentity,
      content,
      generalChannelId,
    );
    await running.page
      .getByTestId("message-timeline")
      .getByText(content, { exact: true })
      .waitFor({ timeout: 10_000 });
    const receivedInMs = Date.now() - startedAt;
    console.log(
      `External event ${event.id} reached Electron in ${receivedInMs}ms`,
    );
    expect(receivedInMs).toBeLessThanOrEqual(10_000);
  } finally {
    await finishElectronTest(testInfo, userDataDir, applications);
  }
});

test("relaunching the same Electron user data restores general history without onboarding", async ({
  browserName: _browserName,
}, testInfo) => {
  const userDataDir = createUserDataDir(testInfo);
  const applications: RunningElectron[] = [];
  try {
    const identity = fixtureIdentity("restart-member");
    let running = await launchElectron(userDataDir);
    applications.push(running);
    const generalChannelId = await onboardToCommunity(
      running,
      identity,
      "Electron Restart Member",
    );

    const externalIdentity = fixtureIdentity("restart-publisher");
    const previousMessages = [
      messageText("External before Electron restart"),
      messageText("Another external message before Electron restart"),
    ];
    for (const content of previousMessages) {
      await publishChannelMessage(
        DEFAULT_RELAY_URL,
        externalIdentity,
        content,
        generalChannelId,
      );
      await expect(running.page.getByTestId("message-timeline")).toContainText(
        content,
        { timeout: 10_000 },
      );
    }

    const exitCode = await closeElectron(running);
    expect(exitCode).toBe(0);
    running = await launchElectron(userDataDir);
    applications.push(running);
    await expect(running.page.getByTestId("native-startup-error")).toHaveCount(
      0,
    );
    await expect(running.page.getByTestId("google-account-scene")).toHaveCount(
      0,
    );
    await expect(running.page.getByTestId("welcome-setup")).toHaveCount(0);
    await expect(running.page.getByTestId("channel-general")).toBeVisible({
      timeout: 60_000,
    });
    await running.page.getByTestId("channel-general").click();
    await expect(running.page.getByTestId("chat-title")).toHaveText("general");
    for (const content of previousMessages) {
      await expect(running.page.getByTestId("message-timeline")).toContainText(
        content,
        { timeout: 20_000 },
      );
    }
  } finally {
    await finishElectronTest(testInfo, userDataDir, applications);
  }
});

test("real TCP relay outage reconnects Electron for inbound and outbound messages", async ({
  browserName: _browserName,
}, testInfo) => {
  test.setTimeout(150_000);
  const userDataDir = createUserDataDir(testInfo);
  const applications: RunningElectron[] = [];
  let proxy: TcpRelayProxy | undefined;
  try {
    const identity = fixtureIdentity("reconnect-member");
    let generalChannelId = "";
    proxy = await startTcpRelayProxy({
      timelinePath:
        process.env.COLONY_ELECTRON_PROXY_LOG ??
        path.join(userDataDir, "relay-proxy.timeline.log"),
    });
    const running = await launchElectron(userDataDir, PROXY_RELAY_URL);
    applications.push(running);
    generalChannelId = await onboardToCommunity(
      running,
      identity,
      "Electron Reconnect Member",
    );
    await expect
      .poll(() => proxy?.snapshot().activeConnections ?? 0, { timeout: 15_000 })
      .toBeGreaterThan(0);
    const beforeDrop = proxy.snapshot();
    const electronWindowCount = running.application.windows().length;
    console.log(`TCP proxy before outage: ${JSON.stringify(beforeDrop)}`);

    const outage = await proxy.dropAndBlock(3_000);
    expect(outage.droppedConnections).toBeGreaterThan(0);
    expect(proxy.snapshot().acceptingConnections).toBe(true);

    const inboundContent = messageText(
      "After real TCP outage from external client",
    );
    const externalIdentity = fixtureIdentity("reconnect-publisher");
    const inboundEvent = await publishChannelMessage(
      PROXY_RELAY_URL,
      externalIdentity,
      inboundContent,
      generalChannelId,
    );
    let inboundError: string | null = null;
    try {
      await running.page
        .getByTestId("message-timeline")
        .getByText(inboundContent, { exact: true })
        .waitFor({ timeout: 10_000 });
    } catch (error) {
      inboundError = error instanceof Error ? error.message : String(error);
    }

    const outboundContent = messageText("After real TCP outage from Electron");
    let outboundError: string | null = null;
    try {
      await running.page.getByTestId("message-input").fill(outboundContent, {
        timeout: 15_000,
      });
      await running.page.getByTestId("send-message").click({ timeout: 15_000 });
      await running.page
        .getByTestId("message-timeline")
        .getByText(outboundContent, { exact: true })
        .waitFor({ timeout: 15_000 });
    } catch (error) {
      outboundError = error instanceof Error ? error.message : String(error);
    }

    let outboundEvent: Awaited<ReturnType<typeof waitForRelayMessage>>;
    let relayReadError: string | null = null;
    try {
      outboundEvent = await waitForRelayMessage(
        PROXY_RELAY_URL,
        identity.publicKey,
        outboundContent,
        15_000,
        generalChannelId,
      );
    } catch (error) {
      relayReadError = error instanceof Error ? error.message : String(error);
    }
    const proxyAfterRecovery = proxy.snapshot();
    const reconnectFailures = [
      inboundError ? `inbound not rendered: ${inboundError}` : null,
      outboundError ? `outbound UI action failed: ${outboundError}` : null,
      !outboundEvent
        ? `outbound event missing from relay; read error=${relayReadError ?? "none"}`
        : null,
      outboundEvent && !hasChannelTag(outboundEvent.tags, generalChannelId)
        ? "outbound event did not retain the general h tag"
        : null,
    ].filter((failure): failure is string => failure !== null);

    if (reconnectFailures.length > 0) {
      const observation = {
        failures: reconnectFailures,
        inboundEventId: inboundEvent.id,
        proxyBeforeDrop: beforeDrop,
        proxyAfterRecovery,
        electronWindowCount,
        electronLogs: running.logs.slice(-180),
        nativeHostStderr: readDiagnosticTail(running.nativeHostLogPath)
          .toString("utf8")
          .slice(-12_000),
        relayLogTail: process.env.COLONY_ELECTRON_RELAY_LOG
          ? readDiagnosticTail(process.env.COLONY_ELECTRON_RELAY_LOG)
              .toString("utf8")
              .slice(-12_000)
          : "not configured",
        proxyLogs: proxy.logs.slice(-40),
      };
      console.error(
        `[electron-reconnect-observation] ${JSON.stringify(observation, null, 2)}`,
      );
    }

    expect(inboundError).toBeNull();
    expect(outboundError).toBeNull();
    expect(outboundEvent?.kind).toBe(9);
    expect(outboundEvent?.pubkey).toBe(identity.publicKey);
    expect(hasChannelTag(outboundEvent?.tags ?? [], generalChannelId)).toBe(
      true,
    );
    expect(proxyAfterRecovery.acceptingConnections).toBe(true);
    console.log(
      `TCP proxy after outage: ${JSON.stringify(proxyAfterRecovery)}`,
    );
    console.log(
      `Reconnect events accepted inbound=${inboundEvent.id} outbound=${outboundEvent?.id ?? "missing"}`,
    );
  } finally {
    await finishElectronTest(testInfo, userDataDir, applications, proxy);
  }
});
