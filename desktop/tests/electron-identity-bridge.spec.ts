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

async function launchIdentity() {
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
  return page.evaluate(async () => ({
    surface: {
      stage0: Object.keys(window.stage0 ?? {}).sort(),
      identity: Object.keys(window.stage0?.identity ?? {}).sort(),
    },
    binding: await window.stage0.bindingState(),
    shared: await window.stage0.identity.isSharedIdentity(),
    identity: await window.stage0.identity.getIdentity(),
  }));
}

async function close(application: ElectronApplication) {
  await application.close();
}

test("packaged normal macOS bridge serves production identity and survives reload/restart", async () => {
  const first = await launchIdentity();
  let firstIdentity;
  try {
    firstIdentity = await readIdentity(first.page);
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
    const restarted = await readIdentity(second.page);
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
    const { application, page } = await launchIdentity();
    try {
      await page.waitForLoadState("domcontentloaded");
      await assert.rejects(
        page.evaluate(() => window.stage0.identity.getIdentity()),
        (error: { message?: string; name?: string }) =>
          error.message === "host_unavailable" && error.name === "Stage0Error",
      );
      const binding = await page.evaluate(() => window.stage0.bindingState());
      assert.equal(binding.state, "unavailable");
    } finally {
      await close(application);
    }
  } finally {
    fs.renameSync(backup, packagePaths.hostResource);
  }
});
