/**
 * Lane-owned clipboard proof entrypoint (hosted only).
 *
 * This is an ORDINARY Electron main-process module: it runs with the full
 * main-world module loader, so static `import` of the real adapter module
 * and of Electron's `clipboard` both work here. Nothing is serialized
 * through Playwright's evaluate utility world.
 *
 * Wiring (lane-local, no shared files touched):
 * - The clipboard lane stages this file plus `shell-clipboard.mjs` and the
 *   proof-vocabulary module plus a lane-local `package.json` (whose `main`
 *   names THIS file) into a scratch directory, then runs the pinned
 *   `electron` binary against that directory (`electron <staged-dir>`).
 * - `main.mjs`, the stage/pack scripts, and the stage-0 package guard stay
 *   untouched: everything happens in the lane's own step and scratch dir.
 * - The proof process imports the REAL adapter module with a static import,
 *   instantiates it with the REAL `clipboard`, exercises the full adapter
 *   API (plain write/read, html alternate, missing-backend error
 *   vocabulary), writes a JSON report to `COLONY_SHELL_CLIPBOARD_REPORT`,
 *   and exits 0 (1 on mismatch).
 * - The spec spawns it with `spawnSync(electronPath, [stagedDir])`, reads
 *   the report file, and asserts it. No evaluate imports, no
 *   adapter-logic copies, no renderer surface, no shared entrypoints.
 *
 * Run ONLY on a hosted runner with a fresh GUI session. The unique per-run
 * token keeps the runner's clipboard isolated; nothing on any developer
 * machine is touched.
 */

import { writeFileSync } from "node:fs";

import { app, clipboard } from "electron";

import { copyTextToClipboard, readClipboardText } from "./shell-clipboard.mjs";
import { CLIPBOARD_PROOF_TOKEN_PREFIX } from "./shell-clipboard.proof.mjs";

function fail(message) {
  process.stderr.write(`shell-clipboard-proof: ${message}\n`);
  process.exitCode = 1;
}

function uniqueToken() {
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 2 ** 32).toString(16)}`;
  return `${CLIPBOARD_PROOF_TOKEN_PREFIX}-${stamp}`;
}

async function main() {
  const reportPath = process.env.COLONY_SHELL_CLIPBOARD_REPORT;
  if (!reportPath) {
    fail("COLONY_SHELL_CLIPBOARD_REPORT is not set");
    return;
  }
  const token = uniqueToken();

  copyTextToClipboard({ text: token }, clipboard);
  const plain = readClipboardText(clipboard);
  if (plain.text !== token) {
    fail("plain-text round-trip mismatch against the real backend");
    return;
  }

  const textAlternate = `${token}-text-alternate`;
  copyTextToClipboard(
    { text: textAlternate, html: `<b>${token}-html</b>` },
    clipboard,
  );
  const alternate = readClipboardText(clipboard);
  if (alternate.text !== textAlternate) {
    fail("html-alternate round-trip mismatch against the real backend");
    return;
  }

  let backendError = null;
  try {
    readClipboardText(null);
  } catch (error) {
    backendError = String(error?.message ?? error);
  }

  clipboard.writeText("");

  const report = {
    ok: true,
    token,
    plainRoundTrip: plain.text === token,
    htmlAlternateRoundTrip: alternate.text === textAlternate,
    backendErrorVocabulary: backendError,
  };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  // Flush stdout/stderr before quitting so the report and any diagnostics
  // are not truncated when the app exits.
  await new Promise((resolve) => setTimeout(resolve, 100));
}

await app.whenReady();
try {
  await main();
} catch (error) {
  process.stderr.write(
    `shell-clipboard-proof: unexpected failure: ${String(error?.stack ?? error)}\n`,
  );
  process.exitCode = 1;
} finally {
  app.quit();
  await new Promise((resolve) => setTimeout(resolve, 500));
}
process.exit(process.exitCode ?? 0);
