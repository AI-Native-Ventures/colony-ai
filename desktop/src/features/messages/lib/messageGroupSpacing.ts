/** Shared 24px gap between distinct messages in the channel timeline and threads. */
export const MESSAGE_GROUP_SPACING_PX = 24;

/** ThreadFocus's 6/16/14px values are overridden by owner direction: every separate reply uses the shared 24px channel gap. */
export function getThreadReplySpacingPx(isContinuation: boolean): number {
  return isContinuation ? 0 : MESSAGE_GROUP_SPACING_PX;
}
