import { getFontSize, setFontSize, type FontSize } from "./fontSizePreference";

export const ACCESSIBILITY_STORAGE_KEY = "colony.accessibility.v1";
export type AccessibilityPreference = {
  version: 1;
  textSize: FontSize;
  motion: "system" | "reduce";
  keyboardHints: boolean;
};

/** Read device accessibility preferences, falling back to the current text size. */
export function readAccessibilityPreference(): AccessibilityPreference {
  const fallback: AccessibilityPreference = {
    version: 1,
    textSize: getFontSize(),
    motion: "system",
    keyboardHints: true,
  };
  try {
    const value = JSON.parse(
      globalThis.localStorage?.getItem(ACCESSIBILITY_STORAGE_KEY) ?? "null",
    );
    if (value?.version !== 1) return fallback;
    return {
      ...fallback,
      textSize:
        value.textSize === "larger" || value.textSize === "smaller"
          ? value.textSize
          : "default",
      motion: value.motion === "reduce" ? "reduce" : "system",
      keyboardHints: value.keyboardHints !== false,
    };
  } catch {
    return fallback;
  }
}

function applyAccessibilityPreference(value: AccessibilityPreference): void {
  const root = globalThis.document?.documentElement;
  root?.setAttribute("data-reduced-motion", String(value.motion === "reduce"));
  root?.setAttribute("data-keyboard-hints", String(value.keyboardHints));
  setFontSize(value.textSize);
}

/** Save all controls atomically before applying any live changes. */
export function saveAccessibilityPreference(
  value: AccessibilityPreference,
): boolean {
  try {
    globalThis.localStorage.setItem(
      ACCESSIBILITY_STORAGE_KEY,
      JSON.stringify(value),
    );
  } catch {
    return false;
  }
  applyAccessibilityPreference(value);
  return true;
}

/** Apply the durable accessibility record before the first render. */
export function initializeAccessibilityPreference(): void {
  applyAccessibilityPreference(readAccessibilityPreference());
  globalThis.window?.addEventListener("storage", (event) => {
    if (event.key === ACCESSIBILITY_STORAGE_KEY || event.key === null)
      applyAccessibilityPreference(readAccessibilityPreference());
  });
}
