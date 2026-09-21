import assert from "node:assert/strict";
import fs from "node:fs";

import {
  _electron as electron,
  type ElectronApplication,
  type Page,
  test,
} from "@playwright/test";
import { getStage0PackagePaths } from "./electron-stage0-package";

const packagePaths = getStage0PackagePaths("normal");
const expectedRegistryDigest =
  "452990462a124746a15d6ba7cdd0353e0183e7a3aa300e5b8b596e0439692204";

test.skip(
  process.platform !== "darwin" || process.arch !== "arm64",
  "production identity custody is macOS arm64-only in this slice",
);

async function launchIdentity({ requireHelper = true } = {}) {
  assert.ok(fs.existsSync(packagePaths.appBinary));
  if (requireHelper) {
    assert.ok(fs.existsSync(packagePaths.hostResource));
  }
  const application = await electron.launch({
    executablePath: packagePaths.appBinary,
    env: { ...process.env },
  });
  const page = await application.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  return { application, page };
}

async function runtimeDiagnostics(
  application: ElectronApplication,
  page: Page,
) {
  const binding = await page.evaluate(() => window.stage0.bindingState());
  const main = await application.evaluate(({ app }) => ({
    home: process.env.HOME ?? null,
    appDataPath: app.getPath("appData"),
    userDataPath: app.getPath("userData"),
  }));
  return { binding, main };
}

async function readIdentity(
  page: Page,
  application: ElectronApplication,
) {
  const surface = await page.evaluate(() => ({
    stage0: Object.keys(window.stage0 ?? {}).sort(),
    identity: Object.keys(window.stage0?.identity ?? {}).sort(),
  }));
  const binding = await page.evaluate(() => window.stage0.bindingState());
  let shared;
  try {
    shared = await page.evaluate(() =>
      window.stage0.identity.isSharedIdentity(),
    );
  } catch (error) {
    const diagnostics = await runtimeDiagnostics(application, page);
    throw new Error(
      `isSharedIdentity failed: ${error instanceof Error ? error.message : String(error)} diagnostics=${JSON.stringify(diagnostics)}`,
    );
  }
  let identity;
  try {
    identity = await page.evaluate(() => window.stage0.identity.getIdentity());
  } catch (error) {
    const diagnostics = await runtimeDiagnostics(application, page);
    throw new Error(
      `getIdentity failed: ${error instanceof Error ? error.message : String(error)} diagnostics=${JSON.stringify(diagnostics)}`,
    );
  }
  return { surface, binding, shared, identity };
}

async function close(application: ElectronApplication) {
  await application.close();
}

test("packaged normal macOS bridge serves production identity and survives reload/restart", async () => {
  const first = await launchIdentity();
  let firstIdentity;
  try {
    firstIdentity = await readIdentity(first.page, first.application);
    assert.deepEqual(firstIdentity.surface.identity, [
      "getIdentity",
      "isSharedIdentity",
    ]);
    assert.equal(firstIdentity.binding.state, "bound");
    assert.equal(firstIdentity.binding.generationId, 1);
    assert.equal(firstIdentity.binding.registryDigest, expectedRegistryDigest);
    assert.deepEqual(firstIdentity.shared, { value: false });
    assert.equal(firstIdentity.identity.storage, "system-keyring");
    assert.equal(firstIdentity.identity.reset_failed, false);
    const firstMain = await first.application.evaluate(({ app }) => ({
      appName: app.getName(),
      userDataPath: app.getPath("userData"),
    }));
    assert.equal(firstMain.appName, "Buzz Stage0 Normal");
    assert.match(
      firstMain.userDataPath,
      /Colony[\\/]dev[\\/]0000000000000001[\\/]normal$/,
    );
  } finally {
    await close(first.application);
  }

  const second = await launchIdentity();
  try {
    const restarted = await readIdentity(second.page, second.application);
    assert.equal(restarted.identity.storage, "system-keyring");
    assert.equal(restarted.identity.pubkey, firstIdentity.identity.pubkey);
    assert.equal(restarted.binding.generationId, 1);
    assert.equal(restarted.binding.sessionId !== firstIdentity.binding.sessionId, true);

    const beforeReload = restarted.binding;
    await second.page.reload();
    const afterReload = await readIdentity(second.page);
    assert.equal(afterReload.binding.state, "bound");
    assert.equal(afterReload.binding.sessionId, beforeReload.sessionId);
    assert.equal(afterReload.binding.generationId, 2);
    assert.equal(afterReload.binding.registryDigest, expectedRegistryDigest);
    assert.equal(afterReload.identity.pubkey, firstIdentity.identity.pubkey);
    assert.deepEqual(afterReload.shared, { value: false });
  } finally {
    await close(second.application);
  }
});

test("packaged identity helper failure stays pre-READY and exposes only a bounded error", async () => {
  const backup = `${packagePaths.hostResource}.identity-test-disabled`;
  fs.renameSync(packagePaths.hostResource, backup);
  try {
    const { application, page } = await launchIdentity({ requireHelper: false });
    try {
      await page.waitForLoadState("domcontentloaded");
      let error: { message?: string; name?: string } | null = null;
      try {
        await page.evaluate(() => window.stage0.identity.getIdentity());
      } catch (caught) {
        error = caught as { message?: string; name?: string };
      }
      const binding = await page.evaluate(() => window.stage0.bindingState());
      assert.equal(
        error?.message?.endsWith("host_unavailable"),
        true,
        `identity helper failure error=${JSON.stringify(error)} binding=${JSON.stringify(binding)}`,
      );
      assert.equal(binding.state, "unavailable");
    } finally {
      await close(application);
    }
  } finally {
    fs.renameSync(backup, packagePaths.hostResource);
  }
});
