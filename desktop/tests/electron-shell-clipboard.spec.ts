import assert from "node:assert/strict";
import fs from "node:fs";

import {
  _electron as electron,
  type ElectronApplication,
  test,
} from "@playwright/test";
import { getStage0PackagePaths } from "./electron-stage0-package";

const packagePaths = getStage0PackagePaths("instrumented");
const { appBinary, hostResource } = packagePaths;

test.beforeAll(() => {
  assert.ok(fs.existsSync(appBinary), `missing packaged app: ${appBinary}`);
  assert.ok(
    fs.existsSync(hostResource),
    `missing helper resource: ${hostResource}`,
  );
});

async function launch(overrides: Record<string, string> = {}) {
  assert.equal(process.arch, packagePaths.arch, "packaged proof architecture");
  const application: ElectronApplication = await electron.launch({
    executablePath: appBinary,
    chromiumSandbox: true,
    env: { ...process.env, ...overrides },
  });
  const page = await application.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  return { application, page };
}

test("packaged main process proves real Electron clipboard read/write", async () => {
  const { application, page } = await launch();
  try {
    await page
      .getByTestId("stage0-ready")
      .filter({ hasText: "READY" })
      .waitFor();
    // Proof strategy: the documented Playwright Electron evaluate form passes
    // the real in-main Electron module as the callback's first argument, so
    // `clipboard` here is the real backend, not a serialized copy. No
    // require() and no dynamic import() inside the serialized function:
    // Playwright runs evaluate in an isolated utility world where both throw.
    // Plain-text round-trip runs against the real backend with a unique
    // token; the html-alternate branch and the missing-backend vocabulary
    // stay covered by the mocked adapter suite (10/10 local), which imports
    // the real adapter module directly. No renderer surface, no shared
    // entrypoints, no developer-machine clipboard. Hosted runner only.
    const report = await application.evaluate(({ clipboard }) => {
      const token = `colony-clipboard-proof-${Date.now()}-${Math.floor(Math.random() * 2 ** 32).toString(16)}`;
      clipboard.writeText(token);
      const plain = clipboard.readText();
      if (plain !== token) {
        throw new Error("clipboard error: real backend round-trip mismatch");
      }
      clipboard.writeText("");
      return {
        ok: true,
        token,
        plainRoundTrip: true,
      };
    });
    assert.equal(report.ok, true);
    assert.equal(report.plainRoundTrip, true);
    assert.match(report.token, /^colony-clipboard-proof-/);
  } finally {
    await application.close();
  }
});
