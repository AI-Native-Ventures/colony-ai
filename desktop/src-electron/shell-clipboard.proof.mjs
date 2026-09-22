/**
 * Real-Electron clipboard backend proof (hosted only).
 *
 * Runs the owned shell-clipboard adapter against the REAL Electron
 * `clipboard` module inside the packaged app's main process — never the
 * user's local clipboard, never plain-Node mocks. Executes on a hosted
 * runner with a fresh GUI session so no host clipboard state is touched.
 *
 * Proof shape (driven by the Playwright spec):
 * 1. WRITE unique token via `copyTextToClipboard({ text: TOKEN })`.
 * 2. READ it back via `readClipboardText()` and assert exact round-trip.
 * 3. WRITE html variant and read back the plain-text alternate.
 * 4. ERROR PATH: call with a missing backend and assert the
 *    `clipboard error: clipboard backend unavailable` prefix is preserved.
 *
 * Run ONLY inside the packaged Electron main process on a hosted runner.
 */

import { copyTextToClipboard, readClipboardText } from "./shell-clipboard.mjs";

export function uniqueClipboardToken(prefix = "colony-clipboard-proof") {
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 2 ** 32).toString(16)}`;
  return `${prefix}-${stamp}`;
}

/**
 * Execute the real-backend clipboard proof. Resolves a frozen report;
 * throws on any mismatch. The caller (Playwright spec via main-process
 * evaluate) serializes the report for assertions.
 */
export function runRealClipboardProof(clipboard, options = {}) {
  const token = options.token ?? uniqueClipboardToken();
  const htmlToken = `${token}-html`;
  const textAlternate = `${token}-text-alternate`;

  copyTextToClipboard({ text: token }, clipboard);
  const plain = readClipboardText(clipboard);
  if (plain.text !== token) {
    throw new Error(
      `clipboard error: real backend round-trip mismatch (plain text)`,
    );
  }

  copyTextToClipboard(
    { text: textAlternate, html: `<b>${htmlToken}</b>` },
    clipboard,
  );
  const alternate = readClipboardText(clipboard);
  if (alternate.text !== textAlternate) {
    throw new Error(
      `clipboard error: real backend round-trip mismatch (html alternate)`,
    );
  }

  let backendError = null;
  try {
    readClipboardText(null);
  } catch (error) {
    backendError = String(error?.message ?? error);
  }
  if (backendError !== "clipboard error: clipboard backend unavailable") {
    throw new Error(
      `clipboard error: backend-error vocabulary drift: ${backendError}`,
    );
  }

  return Object.freeze({
    ok: true,
    token,
    plainRoundTrip: plain.text === token,
    htmlAlternateRoundTrip: alternate.text === textAlternate,
    backendErrorVocabulary: backendError,
  });
}
