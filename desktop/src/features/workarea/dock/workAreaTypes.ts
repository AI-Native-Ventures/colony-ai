/**
 * Tab kinds the work area dock can host.
 *
 * Adding a kind: add it to this list, give it a definition in
 * `workAreaTabRegistry.tsx`, and decide whether it is a singleton. Nothing else
 * in the dock (strip, panels, persistence, shortcuts) needs to change;
 * persisted snapshots drop kinds they do not recognise.
 *
 * The browser is the one kind that is not a singleton: every page is its own
 * dock tab (as in the r15 reference), with the id `browser:<page key>`. What a
 * page holds (address, title, history) is remembered by the browser's own
 * store, `features/workarea/browser/browserTabsStore.ts`.
 */
export const WORK_AREA_TAB_KINDS = [
  "browser",
  "terminal",
  "files",
  "canvas",
  "knowledge",
  "file",
] as const;
export type WorkAreaTabKind = (typeof WORK_AREA_TAB_KINDS)[number];

/** Kinds that may exist at most once per channel. Their tab id is the kind. */
export const WORK_AREA_SINGLETON_KINDS: readonly WorkAreaTabKind[] = [
  "terminal",
  "files",
  "canvas",
  "knowledge",
];

/**
 * A workspace file one `file` tab reads: whose workspace it is and the path in
 * it. The relay it was resolved against is the community's own, so it is not
 * stored; the reader adds the current relay origin when it reads.
 */
export type WorkAreaFileRef = {
  agentPubkey: string;
  path: string;
};

export type WorkAreaTab = {
  id: string;
  kind: WorkAreaTabKind;
  /** Set on `file` tabs, one tab per file. */
  file?: WorkAreaFileRef;
};

/** Everything the dock remembers about one channel. */
export type WorkAreaChannelState = {
  open: boolean;
  tabs: readonly WorkAreaTab[];
  activeTabId: string | null;
  /** Dock width as a percentage of the conversation area. */
  width: number;
};

/** Bounds and defaults come from the frozen r15 work area reference. */
export const WORK_AREA_MIN_WIDTH = 35;
export const WORK_AREA_MAX_WIDTH = 75;
/**
 * 68.85 percent of the 1160px conversation area at the 1440px board is the
 * design's 799px dock (ChannelWorkArea board), so the dock opens exactly there.
 */
export const WORK_AREA_DEFAULT_WIDTH = 68.85;
export const WORK_AREA_KEY_STEP = 2;
export const WORK_AREA_KEY_STEP_LARGE = 10;
/** Below this layout width the dock overlays the conversation. */
export const WORK_AREA_OVERLAY_BREAKPOINT_PX = 760;

export const EMPTY_WORK_AREA_STATE: WorkAreaChannelState = Object.freeze({
  open: false,
  tabs: Object.freeze([]) as readonly WorkAreaTab[],
  activeTabId: null,
  width: WORK_AREA_DEFAULT_WIDTH,
});

export function isSingletonWorkAreaKind(kind: WorkAreaTabKind): boolean {
  return WORK_AREA_SINGLETON_KINDS.includes(kind);
}

export function isWorkAreaTabKind(value: unknown): value is WorkAreaTabKind {
  return (
    typeof value === "string" &&
    (WORK_AREA_TAB_KINDS as readonly string[]).includes(value)
  );
}

export function clampWorkAreaWidth(value: number): number {
  if (!Number.isFinite(value) || value === WORK_AREA_DEFAULT_WIDTH) {
    return WORK_AREA_DEFAULT_WIDTH;
  }
  return Math.max(
    WORK_AREA_MIN_WIDTH,
    Math.min(WORK_AREA_MAX_WIDTH, Math.round(value)),
  );
}
