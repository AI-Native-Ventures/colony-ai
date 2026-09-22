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
 * Electron mapping: the trusted main process calls Electron 44's `clipboard`
 * module directly. Electron 44 models this module on the W3C async clipboard
 * API (`desktop/node_modules/electron/electron.d.ts:6978-7012`):
 * `readText(): Promise<string>`, `writeText(text): Promise<void>`,
 * `write(data: ClipboardItem[]): Promise<void>` — there is NO `writeHTML`,
 * NO `readHTML`, and NO `write({ text, html })` overload. The main process
 * IS the UI thread, so Tauri's `run_on_main_thread` dispatch and one-shot
 * result channel have no Electron equivalent; those two failure modes
 * collapse into the direct-call mapping below, which keeps the upstream
 * `clipboard error: ` prefix verbatim.
 *
 * ASYNC ADAPTER (decision recorded, not workaround): the platform API is
 * asynchronous and there is no honest synchronous wrapper — only blocking
 * hacks or a cached last-value, and a cached clipboard read is a correctness
 * bug waiting for a user. Upstream arboard being synchronous is a fact about
 * arboard, not a constraint on us. So `copyTextToClipboard` and
 * `readClipboardText` are async and await the backend; the future main.mjs
 * wiring awaits them in turn. Do NOT "fix" this back to sync.
 *
 * HTML BRANCH: upstream arboard `set_html(html, Some(text))` maps onto a
 * single ClipboardItem carrying both MIME types, committed atomically by one
 * `write()` call (the point of the single-call form per the electron docs):
 * `write([new ClipboardItem({ "text/plain": text, "text/html": html })])`.
 * `ClipboardItem` is constructed in the trusted main process (it is part of
 * the Electron module, not the injected backend surface), so the adapter
 * takes a `clipboardItem` factory alongside the backend — injected for the
 * same testability reason as the backend itself. Constructor reference:
 * `electron.d.ts:7045`.
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
 * atomic single-ClipboardItem write carrying both MIME types, otherwise the
 * plain-text write. Async: awaits the Electron backend. Returns frozen
 * `{ ok: true }`.
 */
export async function copyTextToClipboard(args, clipboard, clipboardItem) {
  const { text, html } = validateCopyTextArgs(args);
  try {
    if (html !== null) {
      const write = requireBackend(clipboard, "write");
      if (
        !clipboardItem ||
        typeof clipboardItem !== "object" ||
        typeof clipboardItem.create !== "function"
      ) {
        throw new Error(BACKEND_UNAVAILABLE);
      }
      await write([
        clipboardItem.create({ "text/plain": text, "text/html": html }),
      ]);
    } else {
      const writeText = requireBackend(clipboard, "writeText");
      await writeText(text);
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
 * Async: awaits the Electron backend. Returns frozen `{ ok: true, text }`.
 */
export async function readClipboardText(clipboard) {
  let text;
  try {
    const readText = requireBackend(clipboard, "readText");
    text = await readText();
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
 * method names, and bound async handlers closing over the injected
 * main-process `clipboard` object AND the injected `clipboardItem` factory
 * (`{ create: (record) => new ClipboardItem(record) }` in production), so
 * the future `main.mjs`/preload diff is mechanical. Handlers are async —
 * the wiring must await them.
 */
export function createShellClipboardIpc({ clipboard, clipboardItem }) {
  if (!clipboard || typeof clipboard !== "object") {
    throw invalidPayload();
  }
  return Object.freeze({
    capability: SHELL_CLIPBOARD_CAPABILITY,
    methods: Object.freeze({
      [SHELL_CLIPBOARD_METHODS.COPY_TEXT]: (args) =>
        copyTextToClipboard(args, clipboard, clipboardItem),
      [SHELL_CLIPBOARD_METHODS.READ_TEXT]: () => readClipboardText(clipboard),
    }),
  });
}
