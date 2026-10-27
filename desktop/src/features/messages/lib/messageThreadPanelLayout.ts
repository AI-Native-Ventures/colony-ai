/**
 * Shared inline-gutter classes for the thread panel, so the real panel and its
 * loading skeleton stay pixel-aligned as content swaps in.
 */

/** Inline gutter around thread message rows. */
export const THREAD_PANEL_MESSAGE_GUTTER_CLASS = "px-2";

/**
 * ThreadFocus spacing before a reply, in design pixels. Direct replies after
 * the first use 6px, depth two uses 16px, and depth three uses 14px. Deeper
 * replies fall back to the channel timeline's 24px message separation.
 * Continuations stay tight under the shared message-grouping rule.
 */
export function getThreadReplySpacingClass({
  depth,
  index,
  isContinuation,
}: {
  depth: number;
  index: number;
  isContinuation: boolean;
}): string {
  if (isContinuation) {
    return "";
  }

  if (depth <= 1) {
    return index === 0 ? "" : "mt-1.5";
  }

  if (depth === 2) {
    return "mt-4";
  }

  if (depth === 3) {
    return "mt-3.5";
  }

  return "mt-6";
}

/** Inline gutter around the thread composer and its activity row. */
export const THREAD_PANEL_COMPOSER_GUTTER_CLASS = "px-5";

/**
 * Centers the reading column when a `columnMaxWidthPx` is supplied (focus-mode
 * drawer). `px-10` (40px) is the inline gutter between the column and the drawer
 * edges; the max-width itself is applied inline since it is a caller-provided
 * pixel value.
 */
export const THREAD_PANEL_COLUMN_CLASS = "mx-auto w-full px-10";
