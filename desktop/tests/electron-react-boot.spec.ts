import assert from "node:assert/strict";
import fs from "node:fs";

import {
  _electron as electron,
  expect,
  type ElectronApplication,
  type Page,
  test,
} from "@playwright/test";
import { getStage0PackagePaths } from "./electron-stage0-package";

const packagePaths = getStage0PackagePaths("normal");

test.skip(
  process.platform !== "darwin" || process.arch !== "arm64",
  "real React Electron boot proof is macOS arm64-only in this slice",
);

async function launchReact() {
  assert.ok(fs.existsSync(packagePaths.appBinary));
  assert.ok(fs.existsSync(packagePaths.hostResource));
  const application = await electron.launch({
    executablePath: packagePaths.appBinary,
    env: { ...process.env },
  });
  const page = await application.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  return { application, page };
}

async function readIdentity(page: Page) {
  return page.evaluate(async () => {
    const identity = await window.stage0.identity.getIdentity();
    const binding = await window.stage0.bindingState();
    return { binding, identity };
  });
}

async function close(application: ElectronApplication) {
  await application.close();
}

test("packaged macOS app loads real React identity landing and intro", async ({
  browserName: _browserName,
}, testInfo) => {
  let application: ElectronApplication | null = null;
  try {
    const first = await launchReact();
    application = first.application;
    const { page } = first;
    assert.match(page.url(), /\/renderer\/index\.html$/);
    await expect(page.getByTestId("machine-onboarding-gate")).toBeVisible();
    await expect(
      page.getByText("Your people, your agents, your projects —", {
        exact: false,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Create a new identity key" }),
    ).toBeVisible();

    const firstIdentity = await readIdentity(page);
    assert.equal(firstIdentity.identity.storage, "system-keyring");
    assert.equal(firstIdentity.identity.reset_failed, false);
    assert.equal(firstIdentity.binding.state, "bound");
    await page.screenshot({ path: testInfo.outputPath("react-landing.png") });

    await page.reload();
    await expect(page.getByTestId("machine-onboarding-gate")).toBeVisible();
    const reloadedIdentity = await readIdentity(page);
    assert.equal(reloadedIdentity.identity.storage, "system-keyring");
    assert.equal(
      reloadedIdentity.identity.pubkey,
      firstIdentity.identity.pubkey,
    );
    assert.equal(
      reloadedIdentity.binding.sessionId,
      firstIdentity.binding.sessionId,
    );
    assert.equal(reloadedIdentity.binding.generationId, 2);

    await close(application);
    application = null;
    const restarted = await launchReact();
    application = restarted.application;
    const restartedIdentity = await readIdentity(restarted.page);
    assert.equal(restartedIdentity.identity.storage, "system-keyring");
    assert.equal(
      restartedIdentity.identity.pubkey,
      firstIdentity.identity.pubkey,
    );

    await expect(
      restarted.page.getByRole("button", { name: "Create a new identity key" }),
    ).toBeVisible();
    await restarted.page
      .getByRole("button", { name: "Create a new identity key" })
      .click();
    await expect(
      restarted.page.getByTestId("onboarding-page-key-intro"),
    ).toBeVisible();
    await expect(
      restarted.page.getByRole("heading", {
        name: "Create a private identity key",
      }),
    ).toBeVisible();
    await restarted.page.screenshot({
      path: testInfo.outputPath("react-identity-intro.png"),
    });

    await restarted.page.getByTestId("onboarding-create-private-key").click();
    await expect(
      restarted.page.getByTestId("machine-onboarding-native-unavailable"),
    ).toBeVisible();
    await expect(
      restarted.page.getByText(
        "Identity backup and private-key export are not available",
        { exact: false },
      ),
    ).toBeVisible();

    const exposedBridge = await restarted.page.evaluate(() => ({
      stage0Keys: Object.keys(window.stage0 ?? {}).sort(),
      identityKeys: Object.keys(window.stage0?.identity ?? {}).sort(),
      hasTauriInternals: Object.hasOwn(window, "__TAURI_INTERNALS__"),
      hasGetNsec: "getNsec" in (window.stage0 ?? {}),
    }));
    assert.deepEqual(exposedBridge, {
      stage0Keys: ["bindingState", "health", "identity", "onLifecycle"],
      identityKeys: ["getIdentity", "isSharedIdentity"],
      hasTauriInternals: false,
      hasGetNsec: false,
    });
    assert.equal(
      await restarted.page.getByTestId("machine-onboarding-gate").count(),
      0,
    );
  } finally {
    if (application) await close(application);
  }
});
