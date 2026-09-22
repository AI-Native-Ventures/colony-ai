import assert from "node:assert/strict";
import fs from "node:fs";

import {
  _electron as electron,
  type ElectronApplication,
  type Page,
  test,
} from "@playwright/test";
import { getStage0PackagePaths } from "./electron-stage0-package";
import {
  copyTextToClipboard,
  readClipboardText,
} from "../src-electron/shell-clipboard.mjs";

const packagePaths = getStage0PackagePaths("instrumented");
const { appBinary, hostResource } = packagePaths;

test.beforeAll(() => {
  assert.ok(fs.existsSync(appBinary), `missing packaged app: ${appBinary}`);
  assert.ok(
    fs.existsSync(hostResource),
    `missing helper resource: ${hostResource}`,
  );
});

async function launch(): Promise<{
  application: ElectronApplication;
  page: Page;
}> {
  assert.equal(process.arch, packagePaths.arch, "packaged proof architecture");
  const application = await electron.launch({
    executablePath: appBinary,
    chromiumSandbox: true,
    env: { ...process.env },
  });
  const page = await application.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  return { application, page };
}

async function close(application: ElectronApplication) {
  await application.close();
}

// Proof strategy (hosted only), split honestly in two halves because the
// evaluate utility world supports neither require() nor import(), and raw
// spawnSync(electron <dir>) hangs on app.whenReady() with no window
// headless (bisection at 35ecae86):
//
// HALF 1 — real backend is live in the packaged main process: the spec
// launches the packaged app via electron.launch (the path the feasibility
// specs use on these runners), waits for the real window + READY, then uses
// the documented Electron-module evaluate callback ({ clipboard }) to
// write a unique token and read it back. This proves the REAL backend
// round-trips. No imports inside the callback.
//
// HALF 2 — real adapter maps the upstream contract: the spec statically
// imports the REAL adapter module (full Node context, works fine) and
// exercises copyTextToClipboard/readClipboardText against a recording shim
// that replays the EXACT call sequence the live backend accepted in half 1
// (writeText for plain, write({ text, html }) for html, readText for read).
// This proves the adapter emits the exact backend calls the live backend
// already honored, plus validation, frozen semantics, and error vocabulary.
//
// Claimed: (1) real backend round-trips in the packaged main process;
// (2) real adapter maps the upstream contract onto the calls the live
// backend honored. NOT claimed: installed-app parity, production wiring
// (transport-owned, explicitly open).
test("real backend round-trips and real adapter maps the contract", async () => {
  const { application, page } = await launch();
  try {
    await page
      .getByTestId("stage0-ready")
      .filter({ hasText: "READY" })
      .waitFor();

    // HALF 1: live backend round-trip inside the packaged main process.
    // Mismatch errors carry both values with lengths and name the leg, so
    // one hosted run diagnoses the cause (this cannot be reproduced locally:
    // a dev Mac has a real window server, the runner does not).
    const live = await application.evaluate(({ clipboard }) => {
      const describe = (label: string, value: unknown) =>
        `${label} typeof=${typeof value} tag=${Object.prototype.toString.call(value)} json=${JSON.stringify(value)} len=${typeof value === "string" ? value.length : -1}`;
      const token = `colony-clipboard-proof-${Date.now()}-${Math.floor(Math.random() * 2 ** 32).toString(16)}`;
      clipboard.writeText(token);
      const plain: unknown = clipboard.readText();
      if (plain !== token) {
        throw new Error(
          `clipboard error: real backend plain leg mismatch: wrote ${describe("wrote", token)}, read ${describe("read", plain)}`,
        );
      }
      const textAlternate = `${token}-text-alternate`;
      const htmlAlternate = `<b>${token}-html</b>`;
      clipboard.write({ text: textAlternate, html: htmlAlternate });
      const alternate: unknown = clipboard.readText();
      if (alternate !== textAlternate) {
        throw new Error(
          `clipboard error: real backend html leg mismatch: wrote ${describe("wrote", textAlternate)}, read ${describe("read", alternate)}`,
        );
      }
      clipboard.writeText("");
      return { token, textAlternate, htmlAlternate };
    });
    assert.match(live.token, /^colony-clipboard-proof-/);

    // HALF 2: real adapter against a shim replaying the live call sequence.
    const calls: Array<[string, unknown?]> = [];
    const shim = {
      writeText(value: string) {
        calls.push(["writeText", value]);
      },
      write(value: { text: string; html: string }) {
        calls.push(["write", value]);
      },
      readText() {
        const last = calls[calls.length - 1];
        if (last?.[0] === "write") {
          return (last[1] as { text: string }).text;
        }
        return live.token;
      },
    };
    const plainResult = copyTextToClipboard({ text: live.token }, shim);
    assert.deepEqual(plainResult, { ok: true });
    assert.deepEqual(calls[0], ["writeText", live.token]);
    const htmlResult = copyTextToClipboard(
      { text: live.textAlternate, html: live.htmlAlternate },
      shim,
    );
    assert.deepEqual(htmlResult, { ok: true });
    assert.deepEqual(calls[1], [
      "write",
      { text: live.textAlternate, html: live.htmlAlternate },
    ]);
    const readResult = readClipboardText({
      readText: () => live.textAlternate,
    });
    assert.deepEqual(readResult, { ok: true, text: live.textAlternate });
    assert.throws(
      () => readClipboardText(null),
      /^Error: clipboard error: clipboard backend unavailable$/,
    );
  } finally {
    await close(application);
  }
});
