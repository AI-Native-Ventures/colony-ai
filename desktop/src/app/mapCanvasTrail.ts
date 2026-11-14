import type { CompanyMapWindowJob } from "@/features/cofounder/companyMapJobRoutes";

export const MAP_CANVAS_TRAIL_STATE_KEY = "mapCanvasTrail";

const MAP_CANVAS_TRAIL_VERSION = 2;
export const MAX_MAP_CANVAS_TRAIL_ENTRIES = 12;
export const MAX_MAP_CANVAS_SNAPSHOT_CHARS = 256 * 1024;
const MAX_MAP_CANVAS_SCROLL_POSITIONS = 32;
const MAX_MAP_CANVAS_COMMUNITY_ID_CHARS = 512;

export type MapCanvasScrollPosition = {
  index: number;
  left: number;
  top: number;
};

export type MapCanvasSnapshot = {
  height: number;
  html: string;
  width: number;
};

export type MapCanvasTrailEntry = {
  historyIndex: number | null;
  href: string;
  scroll: readonly MapCanvasScrollPosition[];
  snapshot: MapCanvasSnapshot | null;
};

export type MapCanvasTrail = {
  communityId: string;
  entries: readonly MapCanvasTrailEntry[];
  root: CompanyMapWindowJob;
  version: typeof MAP_CANVAS_TRAIL_VERSION;
};

export type MapCanvasTrailNavigation =
  | { kind: "append"; trail: MapCanvasTrail }
  | { kind: "none"; trail: MapCanvasTrail }
  | { kind: "replace"; trail: MapCanvasTrail }
  | { kind: "return"; targetIndex: number; trail: MapCanvasTrail };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFiniteNonNegativeInteger(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= 0
  );
}

function isDimension(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 100_000
  );
}

function isMapCanvasRoot(value: unknown): value is CompanyMapWindowJob {
  return (
    isRecord(value) &&
    (value.functionId === "sales" || value.functionId === "finance") &&
    typeof value.jobName === "string" &&
    value.jobName.length > 0 &&
    value.jobName.length <= 160
  );
}

function isCommunityId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_MAP_CANVAS_COMMUNITY_ID_CHARS
  );
}

function parseScrollPositions(
  value: unknown,
): readonly MapCanvasScrollPosition[] | null {
  if (!Array.isArray(value) || value.length > MAX_MAP_CANVAS_SCROLL_POSITIONS) {
    return null;
  }
  const positions: MapCanvasScrollPosition[] = [];
  for (const position of value) {
    if (
      !isRecord(position) ||
      !isFiniteNonNegativeInteger(position.index) ||
      !isDimension(position.left) ||
      !isDimension(position.top)
    ) {
      return null;
    }
    positions.push({
      index: position.index,
      left: position.left,
      top: position.top,
    });
  }
  return positions;
}

function parseSnapshot(value: unknown): MapCanvasSnapshot | null {
  if (value === null) return null;
  if (
    !isRecord(value) ||
    typeof value.html !== "string" ||
    value.html.length > MAX_MAP_CANVAS_SNAPSHOT_CHARS ||
    !isDimension(value.width) ||
    !isDimension(value.height)
  ) {
    return null;
  }
  return { height: value.height, html: value.html, width: value.width };
}

function parseEntry(value: unknown): MapCanvasTrailEntry | null {
  if (
    !isRecord(value) ||
    typeof value.href !== "string" ||
    !value.href.startsWith("/") ||
    value.href.length > 4096 ||
    !(
      value.historyIndex === null ||
      isFiniteNonNegativeInteger(value.historyIndex)
    )
  ) {
    return null;
  }
  const scroll = parseScrollPositions(value.scroll);
  const snapshot = parseSnapshot(value.snapshot);
  if (scroll === null) return null;
  return {
    historyIndex: value.historyIndex,
    href: value.href,
    scroll,
    snapshot,
  };
}

/** Reads the bounded trail payload persisted in a TanStack history state. */
export function mapCanvasTrailFromState(state: unknown): MapCanvasTrail | null {
  if (!isRecord(state)) return null;
  const candidate = state[MAP_CANVAS_TRAIL_STATE_KEY];
  if (
    !isRecord(candidate) ||
    candidate.version !== MAP_CANVAS_TRAIL_VERSION ||
    !isCommunityId(candidate.communityId) ||
    !isMapCanvasRoot(candidate.root) ||
    !Array.isArray(candidate.entries) ||
    candidate.entries.length === 0 ||
    candidate.entries.length > MAX_MAP_CANVAS_TRAIL_ENTRIES
  ) {
    return null;
  }
  const entries = candidate.entries.map(parseEntry);
  if (entries.some((entry) => entry === null)) return null;
  return {
    communityId: candidate.communityId,
    entries: entries as MapCanvasTrailEntry[],
    root: candidate.root,
    version: MAP_CANVAS_TRAIL_VERSION,
  };
}

/** Returns a state trail only when its newest entry describes this route. */
export function mapCanvasTrailForHref(
  state: unknown,
  href: string,
  communityId: string,
): MapCanvasTrail | null {
  const trail = mapCanvasTrailFromState(state);
  return trail?.communityId === communityId &&
    trail.entries.at(-1)?.href === href
    ? trail
    : null;
}

export function mapCanvasHistoryIndex(state: unknown): number | null {
  if (!isRecord(state)) return null;
  return isFiniteNonNegativeInteger(state.__TSR_index)
    ? state.__TSR_index
    : null;
}

export function createMapCanvasTrail(
  root: CompanyMapWindowJob,
  href: string,
  historyIndex: number | null,
  communityId: string,
): MapCanvasTrail {
  return {
    communityId,
    entries: [{ historyIndex, href, scroll: [], snapshot: null }],
    root,
    version: MAP_CANVAS_TRAIL_VERSION,
  };
}

export function mapCanvasPathname(href: string): string {
  const pathEnd = href.search(/[?#]/);
  return pathEnd === -1 ? href : href.slice(0, pathEnd);
}

/** Removes canvas-only route metadata before comparing real screen targets. */
export function mapCanvasRouteIdentity(href: string): string {
  const destination = new URL(href, "https://map-canvas.invalid");
  destination.searchParams.delete("mapJob");
  return `${destination.pathname}${destination.search}${destination.hash}`;
}

function withLatestEntry(
  trail: MapCanvasTrail,
  entry: MapCanvasTrailEntry,
): MapCanvasTrail {
  return { ...trail, entries: [...trail.entries.slice(0, -1), entry] };
}

/** Stores the last rendered state of the newest route before it is left. */
export function captureMapCanvasTrailLatest(
  trail: MapCanvasTrail,
  {
    historyIndex,
    scroll,
    snapshot,
  }: Pick<MapCanvasTrailEntry, "historyIndex" | "scroll" | "snapshot">,
): MapCanvasTrail {
  const latest = trail.entries.at(-1);
  return latest
    ? withLatestEntry(trail, { ...latest, historyIndex, scroll, snapshot })
    : trail;
}

/** Aligns the newest entry with the browser history slot that owns it. */
export function setMapCanvasTrailLatestHistoryIndex(
  trail: MapCanvasTrail,
  historyIndex: number | null,
): MapCanvasTrail {
  const latest = trail.entries.at(-1);
  return latest ? withLatestEntry(trail, { ...latest, historyIndex }) : trail;
}

/** Builds the next bounded trail state for navigation from a live window. */
export function planMapCanvasTrailNavigation({
  href,
  historyIndex,
  samePathNavigation = "replace",
  snapshot,
  scroll,
  trail,
}: {
  href: string;
  historyIndex: number | null;
  samePathNavigation?: "append" | "replace";
  snapshot: MapCanvasSnapshot | null;
  scroll: readonly MapCanvasScrollPosition[];
  trail: MapCanvasTrail;
}): MapCanvasTrailNavigation {
  const latest = trail.entries.at(-1);
  if (!latest || latest.href === href) return { kind: "none", trail };

  const destinationIdentity = mapCanvasRouteIdentity(href);
  const knownIndex = trail.entries.findIndex(
    (entry) => mapCanvasRouteIdentity(entry.href) === destinationIdentity,
  );
  if (knownIndex >= 0) {
    return { kind: "return", targetIndex: knownIndex, trail };
  }

  const departingTrail = captureMapCanvasTrailLatest(trail, {
    historyIndex,
    scroll,
    snapshot,
  });
  const nextEntry: MapCanvasTrailEntry = {
    historyIndex: historyIndex === null ? null : historyIndex + 1,
    href,
    scroll: [],
    snapshot: null,
  };

  if (
    samePathNavigation === "replace" &&
    mapCanvasPathname(latest.href) === mapCanvasPathname(href)
  ) {
    return {
      kind: "replace",
      trail: withLatestEntry(trail, {
        ...nextEntry,
        historyIndex,
      }),
    };
  }

  if (departingTrail.entries.length >= MAX_MAP_CANVAS_TRAIL_ENTRIES) {
    return {
      kind: "replace",
      trail: withLatestEntry(departingTrail, nextEntry),
    };
  }

  return {
    kind: "append",
    trail: {
      ...departingTrail,
      entries: [...departingTrail.entries, nextEntry],
    },
  };
}

export function truncateMapCanvasTrail(
  trail: MapCanvasTrail,
  targetIndex: number,
): MapCanvasTrail {
  return { ...trail, entries: trail.entries.slice(0, targetIndex + 1) };
}
