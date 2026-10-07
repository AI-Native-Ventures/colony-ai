import { setLocalStorageItemWithRecovery } from "@/shared/lib/localStorageQuota";

import {
  clampWorkAreaWidth,
  EMPTY_WORK_AREA_STATE,
  isWorkAreaTabKind,
  WORK_AREA_DEFAULT_WIDTH,
  type WorkAreaChannelState,
  type WorkAreaTab,
  type WorkAreaTabKind,
} from "./workAreaTypes";

/**
 * Community-scoped work area state: per channel, which tabs are open, which is
 * active, whether the dock is open and how wide it is.
 *
 * Persistence is one snapshot per community. Every user action is a single
 * `commit`, so a single `setItem` call, and the stored value is always a
 * complete, self-consistent snapshot (AGENTS.md rule 5). A failed write keeps
 * the in-memory state, marks the store dirty, and the next commit rewrites the
 * whole snapshot (rule 1: nothing is abandoned silently).
 *
 * This is a community-scoped module singleton: `resetWorkAreaStore` is wired
 * into `resetCommunityState()` and `initWorkAreaStore` re-hydrates it for the
 * next community.
 */

type StoredChannel = WorkAreaChannelState & { touchedAt: number };
type Snapshot = Readonly<Record<string, StoredChannel>>;

const STORAGE_PREFIX = "colony-work-area.v1:";
const SNAPSHOT_VERSION = 1;
/** Bound the snapshot: the least recently touched channels are dropped. */
const MAX_REMEMBERED_CHANNELS = 200;
/** Most tabs one channel's dock can hold; the browser's host allows as many. */
export const MAX_TABS_PER_CHANNEL = 12;

let scope: string | null = null;
let snapshot: Snapshot = Object.freeze({});
let persistDirty = false;
let now: () => number = () => Date.now();
const listeners = new Set<() => void>();

export function workAreaStorageKey(communityScope: string): string {
  return `${STORAGE_PREFIX}${communityScope}`;
}

function publish(next: Snapshot) {
  snapshot = next;
  for (const listener of listeners) listener();
}

function parseTab(value: unknown): WorkAreaTab | null {
  if (typeof value !== "object" || value === null) return null;
  const { id, kind } = value as Record<string, unknown>;
  if (typeof id !== "string" || id.length === 0 || id.length > 128) return null;
  if (!isWorkAreaTabKind(kind)) return null;
  return { id, kind };
}

function parseChannel(value: unknown): StoredChannel | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const tabs: WorkAreaTab[] = [];
  if (Array.isArray(record.tabs)) {
    for (const entry of record.tabs) {
      const tab = parseTab(entry);
      if (tab && !tabs.some((existing) => existing.id === tab.id)) {
        tabs.push(tab);
      }
      if (tabs.length >= MAX_TABS_PER_CHANNEL) break;
    }
  }
  const activeTabId =
    typeof record.activeTabId === "string" &&
    tabs.some((tab) => tab.id === record.activeTabId)
      ? record.activeTabId
      : (tabs[0]?.id ?? null);
  return {
    open: record.open === true,
    tabs,
    activeTabId,
    width:
      typeof record.width === "number"
        ? clampWorkAreaWidth(record.width)
        : WORK_AREA_DEFAULT_WIDTH,
    touchedAt: typeof record.touchedAt === "number" ? record.touchedAt : 0,
  };
}

/** Exported for tests: the only path that turns stored text back into state. */
export function parseWorkAreaSnapshot(raw: string | null): Snapshot {
  if (!raw) return Object.freeze({});
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      (parsed as Record<string, unknown>).version !== SNAPSHOT_VERSION
    ) {
      return Object.freeze({});
    }
    const channels = (parsed as Record<string, unknown>).channels;
    if (typeof channels !== "object" || channels === null) {
      return Object.freeze({});
    }
    const next: Record<string, StoredChannel> = {};
    for (const [channelId, value] of Object.entries(channels)) {
      const channel = parseChannel(value);
      if (channel) next[channelId] = channel;
    }
    return Object.freeze(next);
  } catch {
    return Object.freeze({});
  }
}

function serialize(next: Snapshot): string {
  return JSON.stringify({ version: SNAPSHOT_VERSION, channels: next });
}

function persist(next: Snapshot) {
  if (scope === null) return;
  const ok = setLocalStorageItemWithRecovery(
    workAreaStorageKey(scope),
    serialize(next),
  );
  persistDirty = !ok;
  if (!ok) {
    console.warn(
      "[work-area] could not save the dock layout; it will retry on the next change",
    );
  }
}

function prune(
  next: Record<string, StoredChannel>,
): Record<string, StoredChannel> {
  const ids = Object.keys(next);
  if (ids.length <= MAX_REMEMBERED_CHANNELS) return next;
  ids.sort((a, b) => next[b].touchedAt - next[a].touchedAt);
  const kept: Record<string, StoredChannel> = {};
  for (const id of ids.slice(0, MAX_REMEMBERED_CHANNELS)) kept[id] = next[id];
  return kept;
}

function sameChannel(a: WorkAreaChannelState, b: WorkAreaChannelState) {
  return (
    a.open === b.open &&
    a.activeTabId === b.activeTabId &&
    a.width === b.width &&
    a.tabs.length === b.tabs.length &&
    a.tabs.every(
      (tab, index) =>
        tab.id === b.tabs[index]?.id && tab.kind === b.tabs[index]?.kind,
    )
  );
}

/**
 * The single write path. `mutate` receives the channel's current state and
 * returns its next state; if nothing changed no notification happens, and no
 * write happens unless an earlier write failed and is still owed. In-flight
 * drags do not touch the store: they commit once, on release.
 */
function commit(
  channelId: string,
  mutate: (current: WorkAreaChannelState) => WorkAreaChannelState,
) {
  const current = snapshot[channelId] ?? EMPTY_WORK_AREA_STATE;
  const next = mutate(current);
  if (sameChannel(current, next) && !persistDirty) return;
  const changed = !sameChannel(current, next);
  const merged: Record<string, StoredChannel> = changed
    ? {
        ...snapshot,
        [channelId]: { ...next, touchedAt: now() },
      }
    : { ...snapshot };
  const bounded = Object.freeze(prune(merged));
  persist(bounded);
  if (changed) publish(bounded);
}

export function getWorkAreaState(channelId: string): WorkAreaChannelState {
  return snapshot[channelId] ?? EMPTY_WORK_AREA_STATE;
}

export function subscribeWorkArea(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Load this community's snapshot. Call once per community, after reset. */
export function initWorkAreaStore(communityScope: string) {
  scope = communityScope;
  persistDirty = false;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(workAreaStorageKey(communityScope));
  } catch {
    raw = null;
  }
  publish(parseWorkAreaSnapshot(raw));
}

/**
 * Drop everything held for the current community. Persisted data stays on
 * disk under its own community key; only the in-memory copy goes.
 */
export function resetWorkAreaStore() {
  scope = null;
  persistDirty = false;
  publish(Object.freeze({}));
}

function withTab(
  current: WorkAreaChannelState,
  kind: WorkAreaTabKind,
  id: string,
): WorkAreaChannelState {
  if (current.tabs.some((tab) => tab.id === id)) {
    return { ...current, open: true, activeTabId: id };
  }
  if (current.tabs.length >= MAX_TABS_PER_CHANNEL) return current;
  return {
    ...current,
    open: true,
    tabs: [...current.tabs, { id, kind }],
    activeTabId: id,
  };
}

/**
 * Open the dock. With a kind, also add (or focus) that tab: a singleton kind's
 * id is the kind; a kind that can be open several times passes the tab's id.
 */
export function openWorkArea(
  channelId: string,
  kind?: WorkAreaTabKind,
  tabId?: string,
) {
  commit(channelId, (current) =>
    kind
      ? withTab(current, kind, tabId ?? kind)
      : {
          ...current,
          open: true,
          activeTabId: current.activeTabId ?? current.tabs[0]?.id ?? null,
        },
  );
}

export function closeWorkArea(channelId: string) {
  commit(channelId, (current) =>
    current.open ? { ...current, open: false } : current,
  );
}

export function toggleWorkArea(channelId: string) {
  commit(channelId, (current) => ({
    ...current,
    open: !current.open,
    activeTabId: current.activeTabId ?? current.tabs[0]?.id ?? null,
  }));
}

export function selectWorkAreaTab(channelId: string, tabId: string) {
  commit(channelId, (current) =>
    current.tabs.some((tab) => tab.id === tabId)
      ? { ...current, activeTabId: tabId }
      : current,
  );
}

/** Closing the last tab closes the dock, as in the reference. */
export function closeWorkAreaTab(channelId: string, tabId: string) {
  commit(channelId, (current) => {
    const index = current.tabs.findIndex((tab) => tab.id === tabId);
    if (index < 0) return current;
    const tabs = current.tabs.filter((tab) => tab.id !== tabId);
    if (tabs.length === 0) {
      return { ...current, tabs, activeTabId: null, open: false };
    }
    const activeTabId =
      current.activeTabId === tabId
        ? tabs[Math.max(0, index - 1)].id
        : current.activeTabId;
    return { ...current, tabs, activeTabId };
  });
}

export function setWorkAreaWidth(channelId: string, width: number) {
  commit(channelId, (current) => ({
    ...current,
    width: clampWorkAreaWidth(width),
  }));
}

export function resetWorkAreaWidth(channelId: string) {
  setWorkAreaWidth(channelId, WORK_AREA_DEFAULT_WIDTH);
}

export function getWorkAreaPersistDirtyForTests() {
  return persistDirty;
}

export function setWorkAreaClockForTests(clock: () => number) {
  now = clock;
}
