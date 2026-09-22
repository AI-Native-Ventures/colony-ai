import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  _electron as electron,
  type ElectronApplication,
  test,
} from "@playwright/test";
import { getStage0PackagePaths } from "./electron-stage0-package";

const desktopDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

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
    // application.evaluate runs in the packaged main process, where the real
    // Electron `clipboard` module is available. The proof helper is staged
    // into the ASAR next to main.mjs by the isolated clipboard lane (owned
    // entry, shared packager untouched); it is required via the app path so
    // no renderer surface or developer-machine clipboard is involved.
    // Hosted runner only: fresh GUI session, unique per-run token.
    const report = await application.evaluate(async () => {
      // Playwright injects this function into the packaged main process;
      // the Electron main bundle runs it with Node require available.
      const electronModule = eval("require")("electron") as typeof import("electron");
      const pathModule = eval("require")("path") as typeof import("path");
      const proofPath = pathModule.join(
        electronModule.app.getAppPath(),
        "src-electron",
        "shell-clipboard.proof.mjs",
      );
      const { runRealClipboardProof } = (await import(proofPath)) as {
        runRealClipboardProof: (
          clipboard: unknown,
        ) => {
          ok: boolean;
          token: string;
          plainRoundTrip: boolean;
          htmlAlternateRoundTrip: boolean;
          backendErrorVocabulary: string;
        };
      };
      return runRealClipboardProof(electronModule.clipboard);
    });
    assert.equal(report.ok, true);
    assert.equal(report.plainRoundTrip, true);
    assert.equal(report.htmlAlternateRoundTrip, true);
    assert.equal(
      report.backendErrorVocabulary,
      "clipboard error: clipboard backend unavailable",
    );
    assert.match(report.token, /^colony-clipboard-proof-/);
  } finally {
    await application.close();
  }
});
