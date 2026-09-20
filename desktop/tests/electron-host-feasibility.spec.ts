import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  _electron as electron,
  type ElectronApplication,
  type Page,
  test,
} from "@playwright/test";

const desktopDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function findAppBundle() {
  const outputDirectory = path.join(desktopDirectory, "dist-electron");
  const candidates: string[] = [];
  const visit = (directory: string) => {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory)) {
      const absolute = path.join(directory, entry);
      const info = fs.statSync(absolute);
      if (entry.endsWith(".app") && info.isDirectory()) {
        candidates.push(absolute);
      } else if (info.isDirectory()) {
        visit(absolute);
      }
    }
  };
  visit(outputDirectory);
  assert.equal(
    candidates.length,
    1,
    `expected one packaged app, found ${candidates.length}`,
  );
  return candidates[0];
}

const appBundle = findAppBundle();
const appBinary = path.join(appBundle, "Contents", "MacOS", "Buzz Stage0");
const hostResource = path.join(
  appBundle,
  "Contents",
  "Resources",
  "colony-native-host",
);

function launchEnvironment(overrides: Record<string, string> = {}) {
  return {
    ...process.env,
    COLONY_STAGE0_TEST_MODE: "1",
    ...overrides,
  };
}

async function launch(overrides: Record<string, string> = {}) {
  assert.equal(process.arch, "arm64", "packaged proof must run on macOS arm64");
  assert.ok(fs.existsSync(appBinary), `missing packaged app: ${appBinary}`);
  assert.ok(
    fs.existsSync(hostResource),
    `missing helper resource: ${hostResource}`,
  );
  const application = await electron.launch({
    executablePath: appBinary,
    env: launchEnvironment(overrides),
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
    assert.equal(await visibleWindowCount(application), 1);
    const state = await testState(application);
    assert.equal(state.windowCount, 1);
    assert.equal(state.visibleWindowCount, 1);
    assert.equal(state.hostStartCount, 1);
    assert.ok(Number.isInteger(state.hostPid) && state.hostPid > 0);
    assert.match(state.userDataPath, /Colony[\\/]dev[\\/]0000000000000001$/);
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

test("host-unavailable is bounded with no fallback process", async () => {
  const { application, page } = await launch({
    COLONY_STAGE0_HOST_PATH: path.join(
      desktopDirectory,
      "missing-stage0-helper",
    ),
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
    const before = await testState(application);
    const pid = before.hostPid;
    assert.ok(Number.isInteger(pid) && pid > 0);
    await page.reload();
    await page
      .getByTestId("stage0-event")
      .filter({ hasText: "rebound" })
      .waitFor();
    await page
      .getByTestId("stage0-result")
      .filter({ hasText: "generation 2" })
      .waitFor();
    const after = await testState(application);
    assert.equal(after.hostStartCount, 1);
    assert.equal(after.hostPid, pid);
    assert.deepEqual(after.rebindGenerations, [2]);
    assert.equal(after.pendingCount, 0);
    assert.equal(after.windowCount, 1);
    assert.equal(await page.getByTestId("stage0-error").textContent(), "None");
  } finally {
    await close(application);
  }
});

test("idle helper death becomes visibly unavailable without a respawn", async () => {
  const { application, page } = await launch();
  try {
    await assertReady(page);
    await application.evaluate(() => globalThis.__COLONY_STAGE0_TEST_KILL__());
    await page
      .getByTestId("stage0-error")
      .filter({ hasText: "host_unavailable" })
      .waitFor();
    const state = await testState(application);
    assert.equal(state.hostStartCount, 1);
    assert.equal(state.hostPid > 0, true);
    assert.equal(state.bindingState.state, "unavailable");
  } finally {
    await close(application);
  }
});

test("subframes, foreign navigation, and new windows cannot reach the bridge", async () => {
  const { application, page } = await launch();
  try {
    await assertReady(page);
    const originalUrl = page.url();
    await page.evaluate(() => {
      const frame = document.createElement("iframe");
      frame.src = "https://example.invalid/";
      frame.setAttribute("data-testid", "remote-frame");
      document.body.append(frame);
    });
    await page.waitForTimeout(100);
    assert.equal(await page.url(), originalUrl);
    const popup = await page.evaluate(() =>
      window.open("https://example.invalid/"),
    );
    assert.equal(popup, null);
    await page.evaluate(() => {
      window.location.href = "https://example.invalid/";
    });
    await page.waitForTimeout(100);
    assert.equal(await page.url(), originalUrl);
  } finally {
    await close(application);
  }
});
