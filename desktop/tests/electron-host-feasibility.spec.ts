import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  _electron as electron,
  expect,
  type ElectronApplication,
  type Page,
  test,
} from "@playwright/test";
import {
  assertActiveLinuxSandbox,
  getStage0PackagePaths,
} from "./electron-stage0-package";

const desktopDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const packagePaths = getStage0PackagePaths("instrumented");
const { appRoot: appBundle, appBinary, hostResource } = packagePaths;
const mutationName = process.env.COLONY_STAGE0_TEST_MUTATION ?? null;

function throwExpectedMutationFailure(
  mutation: string,
  seam: string,
  preconditions: Record<string, unknown>,
): never {
  throw new Error(
    `STAGE0_EXPECTED_MUTATION_FAILURE ${JSON.stringify({
      version: 1,
      mutation,
      seam,
      expectedOutcome: "production-seam-failed",
      preconditions,
    })}`,
  );
}

function launchEnvironment(overrides: Record<string, string> = {}) {
  const environment = {
    ...process.env,
    ...overrides,
  };
  return environment;
}

async function launch(overrides: Record<string, string> = {}) {
  assert.equal(process.arch, packagePaths.arch, "packaged proof architecture");
  assert.ok(fs.existsSync(appBinary), `missing packaged app: ${appBinary}`);
  assert.ok(
    fs.existsSync(hostResource),
    `missing helper resource: ${hostResource}`,
  );
  const application = await electron.launch({
    executablePath: appBinary,
    chromiumSandbox: true,
    env: launchEnvironment(overrides),
    // This is an instrumented-only synthetic device. It does not grant
    // permission (the installed main-process handler must still deny it), and
    // it keeps the proof independent of real microphones/cameras.
    args: ["--use-fake-device-for-media-stream"],
  });
  const page = await application.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  return { application, page };
}

async function close(application: ElectronApplication) {
  await application.close();
}

async function testState(application: ElectronApplication) {
  return application.evaluate(() => globalThis.__COLONY_STAGE0_TEST_STATE__);
}

async function visibleWindowCount(application: ElectronApplication) {
  return application.evaluate(
    ({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().filter(
        (window) => !window.isDestroyed() && window.isVisible(),
      ).length,
  );
}

function isProcessAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function assertReady(page: Page) {
  await page.getByTestId("stage0-ready").filter({ hasText: "READY" }).waitFor();
  await page
    .getByTestId("stage0-result")
    .filter({ hasText: "ws://localhost:3000" })
    .waitFor();
  const event = await page.getByTestId("stage0-event").textContent();
  const result = await page.getByTestId("stage0-result").textContent();
  assert.match(event ?? "", /ready|rebound/);
  assert.match(result ?? "", /generation 1|generation 2/);
}

test.beforeAll(() => {
  assert.ok(
    fs.existsSync(appBundle),
    `missing packaged app bundle: ${appBundle}`,
  );
});

test("packaged app starts one visible Electron window and one Rust helper", async () => {
  const { application, page } = await launch();
  const networkRequests: string[] = [];
  page.on("request", (request) => {
    if (/^https?:/i.test(request.url())) networkRequests.push(request.url());
  });
  try {
    await assertReady(page);
    await assertActiveLinuxSandbox(application);
    assert.equal(await visibleWindowCount(application), 1);
    const state = await testState(application);
    assert.equal(state.windowCount, 1);
    assert.equal(state.visibleWindowCount, 1);
    assert.equal(state.hostStartCount, 1);
    assert.ok(Number.isInteger(state.hostPid) && state.hostPid > 0);
    assert.match(
      state.userDataPath,
      /Colony[\\/]dev[\\/]0000000000000001[\\/]instrumented$/,
    );
    if (process.platform === "linux" && process.env.XDG_CONFIG_HOME) {
      assert.ok(
        state.userDataPath.startsWith(process.env.XDG_CONFIG_HOME),
        `Linux user-data escaped the fresh XDG namespace: ${state.userDataPath}`,
      );
    }
    assert.doesNotMatch(state.userDataPath, /xyz\.block\.buzz/);
    assert.deepEqual(networkRequests, []);
    const exposedKeys = await page.evaluate(() => Object.keys(window.stage0));
    assert.deepEqual(exposedKeys.sort(), [
      "bindingState",
      "health",
      "onLifecycle",
    ]);
  } finally {
    await close(application);
  }
});

test("instrumented package ignores arbitrary helper path controls", async () => {
  const { application, page } = await launch({
    COLONY_STAGE0_HOST_PATH: path.join(desktopDirectory, "not-a-helper"),
  });
  try {
    await assertReady(page);
    assert.equal(await page.getByTestId("stage0-error").textContent(), "None");
  } finally {
    await close(application);
  }
});

test("host-unavailable is bounded with no fallback process", async () => {
  const { application, page } = await launch({
    COLONY_STAGE0_HOST_MODE: "missing",
  });
  try {
    await page
      .getByTestId("stage0-error")
      .filter({ hasText: "host_unavailable" })
      .waitFor();
    const state = await testState(application);
    assert.equal(state.hostStartCount, 1);
    assert.equal(state.hostPid, null);
    assert.equal(state.windowCount, 1);
  } finally {
    await close(application);
  }
});

test("early exit and malformed startup fail closed without retry", async () => {
  for (const fault of ["exit-before-ready", "malformed-frame"]) {
    const { application, page } = await launch({ COLONY_STAGE0_FAULT: fault });
    try {
      await page
        .getByTestId("stage0-error")
        .filter({ hasText: /host_unavailable|invalid_json/ })
        .waitFor();
      const state = await testState(application);
      assert.equal(state.hostStartCount, 1);
      assert.equal(state.windowCount, 1);
      assert.equal(
        await page.getByTestId("stage0-ready").textContent(),
        "Waiting…",
      );
    } finally {
      await close(application);
    }
  }
});

test("reload rebinds the same helper and fences the delayed old request", async () => {
  const { application, page } = await launch({
    COLONY_STAGE0_FAULT: "delay-response",
  });
  try {
    await page
      .getByTestId("stage0-ready")
      .filter({ hasText: "READY" })
      .waitFor();
    await expect
      .poll(async () => (await testState(application)).pendingCount)
      .toBeGreaterThan(0);
    const before = await testState(application);
    const pid = before.hostPid;
    const sessionId = before.bindingState.sessionId;
    assert.ok(Number.isInteger(pid) && pid > 0);
    assert.equal(before.bindingState.generationId, 1);
    assert.deepEqual(
      before.healthRequests.filter((request) => request.generationId === 1),
      [
        {
          generationId: 1,
          status: "pending",
          outcome: null,
          terminalCount: 0,
        },
      ],
    );
    await page.reload();
    if (mutationName === "disable-rebind-fence") {
      try {
        await page
          .getByTestId("stage0-event")
          .filter({ hasText: "rebound" })
          .waitFor({ timeout: 10_000 });
      } catch {
        const afterMutation = await testState(application);
        assert.equal(afterMutation.hostStartCount, 1);
        assert.equal(afterMutation.windowCount, 1);
        assert.equal(afterMutation.visibleWindowCount, 1);
        assert.equal(afterMutation.bindingState.state, "bound");
        assert.equal(afterMutation.bindingState.generationId, 1);
        assert.ok(Number.isSafeInteger(afterMutation.hostPid));
        throwExpectedMutationFailure(
          "disable-rebind-fence",
          "renderer rebind generation fence",
          {
            hostReady: true,
            hostStartCount: before.hostStartCount,
            visibleWindowCount: before.visibleWindowCount,
            hostPid: before.hostPid,
            generationId: before.bindingState.generationId,
            oldRequestPending: before.pendingCount > 0,
          },
        );
      }
      throw new Error("STAGE0_UNEXPECTED_MUTATION_PASS disable-rebind-fence");
    }
    await page
      .getByTestId("stage0-event")
      .filter({ hasText: "rebound" })
      .waitFor();
    await page
      .getByTestId("stage0-result")
      .filter({ hasText: "generation 2" })
      .waitFor();
    await expect
      .poll(async () => {
        const state = await testState(application);
        return state.healthRequests.find(
          (request) => request.generationId === 1,
        );
      })
      .toMatchObject({
        status: "rejected",
        terminalCount: 1,
      });
    const after = await testState(application);
    assert.equal(after.hostStartCount, 1);
    assert.equal(after.hostPid, pid);
    assert.equal(after.bindingState.sessionId, sessionId);
    assert.equal(after.bindingState.generationId, 2);
    assert.deepEqual(after.rebindGenerations, [2]);
    assert.equal(after.pendingCount, 0);
    assert.equal(after.windowCount, 1);
    const oldRequest = after.healthRequests.find(
      (request) => request.generationId === 1,
    );
    assert.deepEqual(oldRequest, {
      generationId: 1,
      status: "rejected",
      outcome: "renderer_rebound",
      terminalCount: 1,
    });
    const freshRequest = after.healthRequests.find(
      (request) => request.generationId === 2,
    );
    assert.deepEqual(freshRequest, {
      generationId: 2,
      status: "fulfilled",
      outcome: "ok",
      terminalCount: 1,
    });
    assert.doesNotMatch(
      (await page.getByTestId("stage0-result").textContent()) ?? "",
      /generation 1/,
    );
    assert.match(
      (await page.getByTestId("stage0-event").textContent()) ?? "",
      /rebound \/ generation 2/,
    );
    assert.equal(await page.getByTestId("stage0-error").textContent(), "None");
  } finally {
    await close(application);
  }
});

test("idle helper death becomes visibly unavailable without a respawn", async () => {
  const { application, page } = await launch();
  try {
    await assertReady(page);
    const beforeDeath = await testState(application);
    const pid = beforeDeath.hostPid;
    assert.ok(Number.isInteger(pid) && pid > 0);
    await application.evaluate(() => globalThis.__COLONY_STAGE0_TEST_KILL__());
    await page
      .getByTestId("stage0-error")
      .filter({ hasText: "host_unavailable" })
      .waitFor();
    const state = await testState(application);
    assert.equal(state.hostStartCount, 1);
    assert.equal(state.hostPid, pid);
    assert.equal(state.bindingState.state, "unavailable");
    await expect.poll(() => isProcessAlive(pid)).toBe(false);
  } finally {
    await close(application);
  }
});

test("packaged IPC, navigation, window, and permission guards deny", async () => {
  const { application, page } = await launch();
  try {
    await assertReady(page);
    const originalUrl = page.url();
    const beforeSubframe = await testState(application);
    await page.evaluate(() => {
      const frame = document.createElement("iframe");
      frame.src = `${window.location.href}#stage0-test-subframe`;
      frame.setAttribute("data-testid", "remote-frame");
      document.body.append(frame);
    });
    await page.locator('[data-testid="remote-frame"]').waitFor();
    await expect
      .poll(() =>
        page
          .frames()
          .some((frame) => frame !== page.mainFrame() && frame.url() !== ""),
      )
      .toBe(true);
    const subframe = page
      .frames()
      .find((frame) => frame !== page.mainFrame() && frame.url() !== "");
    assert.ok(subframe, "expected a real packaged subframe fixture");
    const denied = await subframe.evaluate(async () => {
      if (!window.__colonyStage0Test) {
        return { code: "missing-test-bridge" };
      }
      try {
        await window.__colonyStage0Test.health();
        return { code: "unexpected-success" };
      } catch (error) {
        return { code: error?.code ?? error?.message ?? "unknown" };
      }
    });
    if (mutationName === "allow-untrusted-ipc") {
      const afterMutation = await testState(application);
      assert.equal(denied.code, "unexpected-success");
      assert.equal(afterMutation.hostStartCount, 1);
      assert.equal(afterMutation.windowCount, 1);
      assert.equal(afterMutation.visibleWindowCount, 1);
      assert.equal(
        afterMutation.ipcDeniedCount,
        beforeSubframe.ipcDeniedCount + 1,
      );
      throwExpectedMutationFailure(
        "allow-untrusted-ipc",
        "trusted IPC sender guard",
        {
          hostReady: true,
          hostStartCount: afterMutation.hostStartCount,
          visibleWindowCount: afterMutation.visibleWindowCount,
          hostPid: afterMutation.hostPid,
          generationId: afterMutation.bindingState.generationId,
          subframeLoaded: true,
          ipcDeniedIncremented:
            afterMutation.ipcDeniedCount === beforeSubframe.ipcDeniedCount + 1,
        },
      );
    }
    assert.deepEqual(denied, { code: "untrusted_sender" });
    const afterSubframe = await testState(application);
    assert.equal(
      afterSubframe.healthRequestCount,
      beforeSubframe.healthRequestCount,
    );
    assert.equal(
      afterSubframe.ipcDeniedCount,
      beforeSubframe.ipcDeniedCount + 1,
    );

    const trustedHealth = await page.evaluate(() =>
      window.stage0.health.getDefaultRelayUrl(),
    );
    assert.deepEqual(trustedHealth, {
      relayUrl: "ws://localhost:3000",
      generationId: 1,
    });
    const afterTrustedHealth = await testState(application);
    assert.equal(
      afterTrustedHealth.healthRequestCount,
      beforeSubframe.healthRequestCount + 1,
    );

    const beforeNavigation = await testState(application);
    await page.evaluate((url) => {
      window.location.href = `${url}?foreign-navigation=1`;
    }, originalUrl);
    await expect
      .poll(async () => (await testState(application)).navigationDeniedCount)
      .toBeGreaterThan(beforeNavigation.navigationDeniedCount);
    assert.equal(await page.url(), originalUrl);
    assert.equal(await page.getByTestId("stage0-ready").textContent(), "READY");

    const beforeWindowOpen = await testState(application);
    const popup = await page.evaluate(() =>
      window.open("https://example.invalid/"),
    );
    assert.equal(popup, null);
    await expect
      .poll(async () => (await testState(application)).windowOpenDeniedCount)
      .toBeGreaterThan(beforeWindowOpen.windowOpenDeniedCount);

    const beforeNotification = await testState(application);
    const notificationPermission = await page.evaluate(async () => {
      if (typeof Notification !== "function") return "unsupported";
      return Notification.requestPermission();
    });
    assert.equal(notificationPermission, "denied");
    await expect
      .poll(async () => (await testState(application)).permissionDeniedCount)
      .toBeGreaterThan(beforeNotification.permissionDeniedCount);
    const afterNotification = await testState(application);
    assert.equal(afterNotification.lastSecurityDenial, "notifications");

    assert.equal(
      await page.evaluate(() => Boolean(navigator.mediaDevices?.getUserMedia)),
      true,
    );
    const permissionResult = await page.evaluate(async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: false,
        });
        for (const track of stream.getTracks()) track.stop();
        return { granted: true, name: null };
      } catch (error) {
        return { granted: false, name: error?.name ?? "unknown" };
      }
    });
    assert.equal(permissionResult.granted, false);
    assert.equal(
      permissionResult.name,
      "NotAllowedError",
      `synthetic media must reach the installed permission handler; got ${permissionResult.name}`,
    );
    const afterPermission = await testState(application);
    assert.equal(
      afterPermission.permissionDeniedCount,
      afterNotification.permissionDeniedCount + 1,
    );
    assert.equal(
      afterPermission.lastSecurityDenial,
      "media",
      "media denial must be observed through the installed permission handler",
    );
  } finally {
    await close(application);
  }
});
