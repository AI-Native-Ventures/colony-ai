/**
 * Real-Electron clipboard backend proof contract (hosted only).
 *
 * The Playwright spec drives the REAL Electron `clipboard` module inside the
 * packaged app's main process via the documented Electron-module evaluate
 * callback - never the user's local clipboard, never plain-Node mocks.
 * Playwright runs evaluate in an isolated utility world where require() and
 * dynamic import() both throw, so the proof body lives in the serialized
 * spec callback and this module keeps the shared vocabulary: the unique
 * token prefix the spec asserts on and the missing-backend error string the
 * mocked adapter suite asserts on. The full adapter round-trip (plain text,
 * html alternate, error prefix) stays covered by the mocked focused suite,
 * which imports the real adapter module directly under plain Node.
 *
 * Nothing in this module executes on its own; it is documentation plus the
 * two constants below, kept so the contract has one owned home.
 */

export const CLIPBOARD_PROOF_TOKEN_PREFIX = "colony-clipboard-proof";

export const CLIPBOARD_BACKEND_UNAVAILABLE =
  "clipboard error: clipboard backend unavailable";
