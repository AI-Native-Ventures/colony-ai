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
import { createRequire } from "node:module";

// FIRST-LINE PROBE (diagnostic): unconditional synchronous stdout write
// before anything Electron-related loads. If this line never appears in the
// hosted log, the child never reaches our code and the problem is spawn or
// app boot, not exit handling. Uses only node:fs to avoid loader issues.
try {
  writeFileSync(1, "shell-clipboard-proof: probe-entry\n");
} catch {
  // If even fd 1 is unwritable, there is nothing more to observe.
}

const require = createRequire(import.meta.url);
const { app, clipboard } = require("electron");
writeFileSync(1, "shell-clipboard-proof: probe-after-electron-require\n");

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

writeFileSync(1, "shell-clipboard-proof: probe-before-whenReady\n");
await app.whenReady();
writeFileSync(1, "shell-clipboard-proof: probe-whenReady-resolved\n");
try {
  await main();
} catch (error) {
  process.stderr.write(
    `shell-clipboard-proof: unexpected failure: ${String(error?.stack ?? error)}\n`,
  );
  process.exitCode = 1;
} finally {
  // No windows are ever created; quit the app explicitly. app.quit() alone
  // can leave the process alive when nothing else drives the loop, so force
  // a synchronous exit after flushing stdio. The report file is already
  // written by main(), so no evidence is lost.
  writeFileSync(1, "shell-clipboard-proof: probe-before-quit\n");
  app.quit();
  await new Promise((resolve) => setTimeout(resolve, 500));
}
process.stdout.write("", () => process.exit(process.exitCode ?? 0));
setTimeout(() => process.exit(process.exitCode ?? 0), 2000).unref();
