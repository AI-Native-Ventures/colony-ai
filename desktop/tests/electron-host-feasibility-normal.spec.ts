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
const packagePaths = getStage0PackagePaths("normal");
const { appRoot: appBundle, appBinary, hostResource } = packagePaths;

const hostileEnvironment = {
  COLONY_STAGE0_TEST_MODE: "1",
  COLONY_STAGE0_TEST_SUBFRAME: "1",
  COLONY_STAGE0_TEST_MUTATION: "allow-untrusted-ipc",
  COLONY_STAGE0_FAULT: "malformed-frame",
  COLONY_STAGE0_HOST_MODE: "missing",
  COLONY_STAGE0_HOST_PATH: path.join(desktopDirectory, "not-a-helper"),
  COLONY_STAGE0_TEST_DEADLINE_MS: "1",
};

async function launchNormal() {
  assert.equal(process.arch, packagePaths.arch, "packaged proof architecture");
  assert.ok(fs.existsSync(appBinary), `missing packaged app: ${appBinary}`);
  assert.ok(
    fs.existsSync(hostResource),
    `missing helper resource: ${hostResource}`,
  );
  const application = await electron.launch({
    executablePath: appBinary,
    env: { ...process.env, ...hostileEnvironment },
  });
  const page = await application.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  return { application, page };
}

async function close(application: ElectronApplication) {
  await application.close();
}

async function assertNormalReady(page: Page) {
  await page.getByTestId("stage0-ready").filter({ hasText: "READY" }).waitFor();
  await page
    .getByTestId("stage0-result")
    .filter({ hasText: "ws://localhost:3000" })
    .waitFor();
  assert.match(
    (await page.getByTestId("stage0-event").textContent()) ?? "",
    /ready \/ generation 1/,
  );
  assert.equal(await page.getByTestId("stage0-error").textContent(), "None");
}

test.beforeAll(() => {
  assert.ok(
    fs.existsSync(appBundle),
    `missing normal app bundle: ${appBundle}`,
  );
});

test("normal relocated candidate ignores every ambient harness switch", async () => {
  const { application, page } = await launchNormal();
  try {
    await assertNormalReady(page);
    await assertActiveLinuxSandbox(application);
    const rendererSurface = await page.evaluate(() => ({
      stage0Keys: Object.keys(window.stage0 ?? {}).sort(),
      testState: typeof globalThis.__COLONY_STAGE0_TEST_STATE__,
      testKill: typeof globalThis.__COLONY_STAGE0_TEST_KILL__,
    }));
    assert.deepEqual(rendererSurface, {
      stage0Keys: ["bindingState", "health", "onLifecycle"],
      testState: "undefined",
      testKill: "undefined",
    });
    const mainSurface = await application.evaluate(
      ({ app, BrowserWindow }) => ({
        appName: app.getName(),
        userDataPath: app.getPath("userData"),
        windowCount: BrowserWindow.getAllWindows().filter(
          (window) => !window.isDestroyed() && window.isVisible(),
        ).length,
      }),
    );
    assert.equal(mainSurface.appName, "Buzz Stage0 Normal");
    assert.match(
      mainSurface.userDataPath,
      /Colony[\\/]dev[\\/]0000000000000001[\\/]normal$/,
    );
    if (process.platform === "linux" && process.env.XDG_CONFIG_HOME) {
      assert.ok(
        mainSurface.userDataPath.startsWith(process.env.XDG_CONFIG_HOME),
        `Linux user-data escaped the fresh XDG namespace: ${mainSurface.userDataPath}`,
      );
    }
    assert.equal(mainSurface.windowCount, 1);
  } finally {
    await close(application);
  }
});

test("normal relocated candidate rebinds core and denies foreign effects", async () => {
  const { application, page } = await launchNormal();
  try {
    await assertNormalReady(page);
    await assertActiveLinuxSandbox(application);
    await page.reload();
    await expect
      .poll(async () => page.evaluate(() => window.stage0?.bindingState?.()), {
        timeout: 10_000,
      })
      .toMatchObject({ state: "bound", generationId: 2 });
    assert.match(
      (await page.getByTestId("stage0-event").textContent()) ?? "",
      /rebound \/ generation 2/,
    );
    await page
      .getByTestId("stage0-result")
      .filter({ hasText: "generation 2" })
      .waitFor();
    assert.equal(await page.getByTestId("stage0-error").textContent(), "None");

    const mainNavigationUrls: string[] = [];
    const originalUrl = page.url();
    const mainFrame = page.mainFrame();
    page.on("framenavigated", (frame) => {
      if (frame === mainFrame) mainNavigationUrls.push(frame.url());
    });
    await page.evaluate((url) => {
      window.location.href = `${url}?foreign-navigation=1`;
    }, originalUrl);
    await expect.poll(() => page.url()).toBe(originalUrl);
    assert.deepEqual(mainNavigationUrls, []);

    const popup = await page.evaluate(() =>
      window.open("https://example.invalid/"),
    );
    assert.equal(popup, null);
    const notificationPermission = await page.evaluate(async () => {
      if (typeof Notification !== "function") return "unsupported";
      return Notification.requestPermission();
    });
    assert.equal(notificationPermission, "denied");
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
    // The normal package deliberately does not enable a synthetic device. A
    // NotFoundError is therefore only device-availability evidence here, never
    // permission-handler evidence; the instrumented derivative proves that
    // callback seam separately.
    assert.ok(
      ["NotAllowedError", "NotFoundError"].includes(permissionResult.name),
      `normal media must be denied (NotFoundError means no device, not handler proof): ${permissionResult.name}`,
    );

    await page.evaluate((url) => {
      const frame = document.createElement("iframe");
      frame.src = `${url}#stage0-test-subframe`;
      frame.setAttribute("data-testid", "normal-subframe");
      document.body.append(frame);
    }, originalUrl);
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              document.querySelector('[data-testid="normal-subframe"]') !==
              null,
          ),
        { timeout: 5_000 },
      )
      .toBe(true);
    for (const frame of page
      .frames()
      .filter((candidate) => candidate !== page.mainFrame())) {
      assert.equal(
        await frame.evaluate(() => typeof window.stage0),
        "undefined",
      );
    }
  } finally {
    await close(application);
  }
});
