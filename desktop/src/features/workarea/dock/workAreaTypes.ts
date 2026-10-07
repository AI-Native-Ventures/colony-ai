/**
 * Tab kinds the work area dock can host.
 *
 * EXTENSION POINT (phase 3, browser tab): add `"browser"` to this list, give it
 * a definition in `workAreaTabRegistry.tsx`, and decide whether it is a
 * singleton. Nothing else in the dock (strip, panels, persistence, shortcuts)
 * needs to change; persisted snapshots drop kinds they do not recognise.
 */
export const WORK_AREA_TAB_KINDS = [
  "terminal",
  "files",
  "canvas",
  "work",
  "knowledge",
] as const;
export type WorkAreaTabKind = (typeof WORK_AREA_TAB_KINDS)[number];

/** Kinds that may exist at most once per channel. Their tab id is the kind. */
export const WORK_AREA_SINGLETON_KINDS: readonly WorkAreaTabKind[] = [
  "terminal",
  "files",
  "canvas",
  "work",
  "knowledge",
];

export type WorkAreaTab = {
  id: string;
  kind: WorkAreaTabKind;
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
export const WORK_AREA_DEFAULT_WIDTH = 64;
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

export function isWorkAreaTabKind(value: unknown): value is WorkAreaTabKind {
  return (
    typeof value === "string" &&
    (WORK_AREA_TAB_KINDS as readonly string[]).includes(value)
  );
}

export function clampWorkAreaWidth(value: number): number {
  if (!Number.isFinite(value)) return WORK_AREA_DEFAULT_WIDTH;
  return Math.max(
    WORK_AREA_MIN_WIDTH,
    Math.min(WORK_AREA_MAX_WIDTH, Math.round(value)),
  );
}
