/** The interface typeface a person picks in Appearance. Device level. */
export type Typeface = "manrope" | "inter" | "system";

export const TYPEFACE_STORAGE_KEY = "colony.appearance.typeface";
export const DEFAULT_TYPEFACE: Typeface = "manrope";

export function parseTypeface(value: string | null | undefined): Typeface {
  return value === "inter" || value === "system" ? value : DEFAULT_TYPEFACE;
}

function applyTypeface(typeface: Typeface): void {
  const root = globalThis.document?.documentElement;
  if (!root) return;
  if (typeface === DEFAULT_TYPEFACE) root.removeAttribute("data-typeface");
  else root.setAttribute("data-typeface", typeface);
}

export function readTypeface(): Typeface {
  try {
    return parseTypeface(
      globalThis.localStorage?.getItem(TYPEFACE_STORAGE_KEY),
    );
  } catch {
    return DEFAULT_TYPEFACE;
  }
}

/** Apply the saved typeface before React renders, so text does not jump. */
export function initializeTypefacePreference(): void {
  applyTypeface(readTypeface());
  globalThis.window?.addEventListener("storage", (event) => {
    if (event.key === TYPEFACE_STORAGE_KEY || event.key === null) {
      applyTypeface(readTypeface());
    }
  });
}

/** Returns false when the choice could not be saved; it still applies live. */
export function setTypeface(typeface: Typeface): boolean {
  applyTypeface(typeface);
  try {
    globalThis.localStorage?.setItem(TYPEFACE_STORAGE_KEY, typeface);
    return true;
  } catch {
    return false;
  }
}
