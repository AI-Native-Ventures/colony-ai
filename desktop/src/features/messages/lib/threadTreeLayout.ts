const THREAD_REPLY_MAX_VISIBLE_DEPTH = 6;

const THREAD_REPLY_AVATAR_SIZE_REM = 2.5; // 40px, the design's reply avatar
export const THREAD_REPLY_ROW_MARGIN_INLINE_REM = 0;
const THREAD_REPLY_ROW_CONTENT_INSET_REM = 0;
const THREAD_REPLY_ROW_CONTENT_GAP_REM = 0.875; // 14px
const THREAD_REPLY_ROW_PADDING_TOP_REM = 0;
const THREAD_REPLY_DEPTH_STEP_REM = 3.25; // 52px between nested avatars
const THREAD_REPLY_AVATAR_RADIUS_REM = THREAD_REPLY_AVATAR_SIZE_REM / 2;
const THREAD_REPLY_AVATAR_LINE_GAP_REM = 0.375; // 6px

export const THREAD_REPLY_BODY_OFFSET_REM =
  THREAD_REPLY_ROW_MARGIN_INLINE_REM +
  THREAD_REPLY_ROW_CONTENT_INSET_REM +
  THREAD_REPLY_AVATAR_SIZE_REM +
  THREAD_REPLY_ROW_CONTENT_GAP_REM;
export const THREAD_REPLY_ROOT_INDENT_REM = THREAD_REPLY_DEPTH_STEP_REM;
export const THREAD_REPLY_NESTED_INDENT_REM = THREAD_REPLY_ROOT_INDENT_REM;
export const THREAD_REPLY_LINE_WIDTH_REM = 0.125; // 2px rails

const THREAD_REPLY_AVATAR_CENTER_OFFSET_REM =
  THREAD_REPLY_ROW_MARGIN_INLINE_REM +
  THREAD_REPLY_ROW_CONTENT_INSET_REM +
  THREAD_REPLY_AVATAR_SIZE_REM / 2;
const THREAD_REPLY_AVATAR_CENTER_Y_REM =
  THREAD_REPLY_ROW_PADDING_TOP_REM + THREAD_REPLY_AVATAR_SIZE_REM / 2;

export function threadReplyLength(valueRem: number) {
  if (valueRem === 0) return "0";
  return `${Number(valueRem.toFixed(5))}rem`;
}

function clampVisibleDepth(depth: number) {
  return Math.min(Math.max(depth, 0), THREAD_REPLY_MAX_VISIBLE_DEPTH);
}

function getThreadReplyVisualDepth(depth: number) {
  return clampVisibleDepth(Math.max(0, depth - 1));
}

function getThreadReplyIndentForVisibleDepthRem(visibleDepth: number) {
  return visibleDepth > 0
    ? THREAD_REPLY_ROOT_INDENT_REM +
        (visibleDepth - 1) * THREAD_REPLY_NESTED_INDENT_REM
    : 0;
}

export function getThreadReplyIndentRem(depth: number) {
  return getThreadReplyIndentForVisibleDepthRem(
    getThreadReplyVisualDepth(depth),
  );
}

export function getThreadReplyAvatarCenterRem(depth: number) {
  return getThreadReplyIndentRem(depth) + THREAD_REPLY_AVATAR_CENTER_OFFSET_REM;
}

function getThreadReplyAvatarCenterForVisibleDepthRem(visibleDepth: number) {
  return (
    getThreadReplyIndentForVisibleDepthRem(visibleDepth) +
    THREAD_REPLY_AVATAR_CENTER_OFFSET_REM
  );
}

export function getThreadReplyAvatarCenterYRem() {
  return THREAD_REPLY_AVATAR_CENTER_Y_REM;
}

export function getThreadReplyDescendantRailStartYRem() {
  return (
    THREAD_REPLY_AVATAR_CENTER_Y_REM +
    THREAD_REPLY_AVATAR_RADIUS_REM +
    THREAD_REPLY_AVATAR_LINE_GAP_REM
  );
}

export function getThreadReplyConnectorLayout(depth: number) {
  const visibleDepth = getThreadReplyVisualDepth(depth);
  if (visibleDepth === 0) {
    return null;
  }

  const parentOffsetRem = getThreadReplyAvatarCenterForVisibleDepthRem(
    visibleDepth - 1,
  );
  const childOffsetRem =
    getThreadReplyAvatarCenterForVisibleDepthRem(visibleDepth);
  const childEdgeOffsetRem =
    childOffsetRem -
    THREAD_REPLY_AVATAR_RADIUS_REM -
    THREAD_REPLY_AVATAR_LINE_GAP_REM;

  return {
    childOffsetRem,
    heightRem: THREAD_REPLY_AVATAR_CENTER_Y_REM,
    parentOffsetRem,
    widthRem: Math.max(0, childEdgeOffsetRem - parentOffsetRem),
  };
}
