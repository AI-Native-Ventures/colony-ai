/**
 * Isolated Electron shell clipboard text adapter.
 *
 * Upstream parity oracle (origin/develop):
 * - `desktop/src-tauri/src/commands/clipboard.rs`: `read_clipboard_text`
 *   returns `Result<String, String>`; every failure is a plain string, either
 *   `clipboard error: {e}` (arboard/backend failure), `clipboard state lock
 *   poisoned`, `main thread dispatch failed: {e}`, or
 *   `clipboard result channel closed unexpectedly`.
 * - `desktop/src-tauri/src/commands/media_download.rs`: `copy_text_to_clipboard`
 *   takes `(text: String, html: Option<String>)`, returns `Result<(), String>`
 *   with the same error vocabulary; when `html` is present it calls
 *   `set_html(html, Some(text))`, otherwise `set_text(text)`.
 * - `desktop/src/shared/api/tauriMedia.ts`: the renderer invokes
 *   `read_clipboard_text` with no arguments and `copy_text_to_clipboard` with
 *   `{ html, text }`.
 *
 * Electron mapping: the trusted main process calls Electron's `clipboard`
 * module directly (`writeText` / `write({ text, html })` / `readText`). The
 * main process IS the UI thread, so Tauri's `run_on_main_thread` dispatch and
 * one-shot result channel have no Electron equivalent; those two failure modes
 * collapse into the direct-call mapping below, which keeps the upstream
 * `clipboard error: ` prefix verbatim.
 *
 * Trust boundary: this module runs in trusted main only and takes the Electron
 * `clipboard` object as an injected dependency so it stays testable under
 * plain Node. It exposes no renderer surface itself; renderer access must go
 * through the existing preload typed `request` transport after the root
 * sequences the integration patch (see the shell-parity ticket artifact).
 * Text and html are untrusted renderer data: validated by type only, never
 * executed. Image clipboard (`copy_image_to_clipboard`) is out of scope.
 */

export const SHELL_CLIPBOARD_CAPABILITY = "shell.clipboard";

export const SHELL_CLIPBOARD_METHODS = Object.freeze({
  COPY_TEXT: "copy_text_to_clipboard",
  READ_TEXT: "read_clipboard_text",
});

const INVALID_PAYLOAD = "invalid_payload";
const BACKEND_UNAVAILABLE = "clipboard error: clipboard backend unavailable";

function invalidPayload() {
  return new Error(INVALID_PAYLOAD);
}

function toClipboardError(error) {
  const message =
    error instanceof Error ? error.message : String(error ?? "unknown error");
  if (message.startsWith("clipboard error: ")) return new Error(message);
  return new Error(`clipboard error: ${message}`);
}

/**
 * Validate the upstream `{ text: String, html: Option<String> }` shape.
 * Returns a frozen `{ text, html }` record with `html` normalised to null.
 * Throws `Error("invalid_payload")` on any shape violation.
 */
export function validateCopyTextArgs(args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw invalidPayload();
  }
  const keys = Object.keys(args);
  if (
    keys.length === 0 ||
    keys.length > 2 ||
    !keys.includes("text") ||
    !keys.every((key) => key === "text" || key === "html")
  ) {
    throw invalidPayload();
  }
  const { text, html = null } = args;
  if (typeof text !== "string") throw invalidPayload();
  if (html !== null && html !== undefined && typeof html !== "string") {
    throw invalidPayload();
  }
  return Object.freeze({ text, html: html ?? null });
}

function requireBackend(clipboard, method) {
  if (
    !clipboard ||
    typeof clipboard !== "object" ||
    typeof clipboard[method] !== "function"
  ) {
    throw new Error(BACKEND_UNAVAILABLE);
  }
  return clipboard[method].bind(clipboard);
}

/**
 * Write text (with optional html alternate) to the system clipboard.
 * Mirrors upstream `copy_text_to_clipboard`: html present selects the
 * html+text write, otherwise the plain-text write. Returns frozen `{ ok: true }`.
 */
export function copyTextToClipboard(args, clipboard) {
  const { text, html } = validateCopyTextArgs(args);
  try {
    if (html !== null) {
      const write = requireBackend(clipboard, "write");
      write({ text, html });
    } else {
      const writeText = requireBackend(clipboard, "writeText");
      writeText(text);
    }
  } catch (error) {
    if (error instanceof Error && error.message === INVALID_PAYLOAD)
      throw error;
    if (error instanceof Error && error.message === BACKEND_UNAVAILABLE) {
      throw error;
    }
    throw toClipboardError(error);
  }
  return Object.freeze({ ok: true });
}

/**
 * Read plain text from the system clipboard.
 * Mirrors upstream `read_clipboard_text`, including the empty-string success.
 * Returns frozen `{ ok: true, text }`.
 */
export function readClipboardText(clipboard) {
  let text;
  try {
    const readText = requireBackend(clipboard, "readText");
    text = readText();
  } catch (error) {
    if (error instanceof Error && error.message === BACKEND_UNAVAILABLE) {
      throw error;
    }
    throw toClipboardError(error);
  }
  if (typeof text !== "string") {
    throw toClipboardError("clipboard backend returned non-string text");
  }
  return Object.freeze({ ok: true, text });
}

/**
 * Describe the exact integration patch the root must sequence. This function
 * wires nothing; it returns the capability name, the upstream-compatible
 * method names, and bound handlers closing over the injected main-process
 * `clipboard` object, so the future `main.mjs`/preload diff is mechanical.
 */
export function createShellClipboardIpc({ clipboard }) {
  if (!clipboard || typeof clipboard !== "object") {
    throw invalidPayload();
  }
  return Object.freeze({
    capability: SHELL_CLIPBOARD_CAPABILITY,
    methods: Object.freeze({
      [SHELL_CLIPBOARD_METHODS.COPY_TEXT]: (args) =>
        copyTextToClipboard(args, clipboard),
      [SHELL_CLIPBOARD_METHODS.READ_TEXT]: () => readClipboardText(clipboard),
    }),
  });
}
