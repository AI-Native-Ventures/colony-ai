import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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
    // Electron `clipboard` module is available. Playwright serializes the
    // function into an isolated utility world with no require(), so the spec
    // passes the proof-file path as a plain argument and the evaluated code
    // uses dynamic import only. The proof helper is staged into the ASAR next
    // to main.mjs by the isolated clipboard lane (shared packager untouched)
    // and resolved via the app path, so no renderer surface or
    // developer-machine clipboard is involved. Hosted runner only: fresh GUI
    // session, unique per-run token.
    const appPath = await application.evaluate(async () => {
      const electronModule = (await import("electron")) as typeof import("electron");
      return electronModule.app.getAppPath();
    });
    const proofFileUrl = pathToFileURL(
      path.join(appPath, "src-electron", "shell-clipboard.proof.mjs"),
    ).toString();
    const report = await application.evaluate(async (fileUrl: string) => {
      const { runRealClipboardProof } = (await import(fileUrl)) as {
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
      const electronModule = (await import("electron")) as typeof import("electron");
      return runRealClipboardProof(electronModule.clipboard);
    }, proofFileUrl);
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
