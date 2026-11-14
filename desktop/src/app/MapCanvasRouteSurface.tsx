import * as React from "react";
import { useLocation, useRouter } from "@tanstack/react-router";

import {
  companyMapWindowJobForRoute,
  type CompanyMapWindowJob,
} from "@/features/cofounder/companyMapJobRoutes";
import { FUNCTION_DETAILS } from "@/features/cofounder/functions";
import { CompanyMapScreen } from "@/features/cofounder/ui/CompanyMapScreen";
import { EmployeeAvatar } from "@/features/company-team/ui/EmployeeAvatar";
import { useCommunities } from "@/features/communities/useCommunities";

import {
  MAP_CANVAS_TRAIL_STATE_KEY,
  MAX_MAP_CANVAS_TRAIL_ENTRIES,
  MAX_MAP_CANVAS_SNAPSHOT_CHARS,
  captureMapCanvasTrailLatest,
  createMapCanvasTrail,
  mapCanvasHistoryIndex,
  mapCanvasTrailForHref,
  planMapCanvasTrailNavigation,
  setMapCanvasTrailLatestHistoryIndex,
  truncateMapCanvasTrail,
  type MapCanvasScrollPosition,
  type MapCanvasSnapshot,
  type MapCanvasTrail,
  type MapCanvasTrailEntry,
} from "./mapCanvasTrail";

import "./MapCanvasRouteSurface.css";

type MapCanvasRouteSurfaceProps = {
  children: React.ReactNode;
  enabled: boolean;
};

type PendingEmbeddedNavigation = {
  historyIndex: number | null;
  observedAt: number;
  samePathNavigation: "append" | "replace" | "swap";
  sourceHref: string;
  trail: MapCanvasTrail;
};

type PendingSameDeskNavigation = Pick<
  PendingEmbeddedNavigation,
  "observedAt" | "samePathNavigation" | "sourceHref"
>;

const EMBEDDED_NAVIGATION_WINDOW_MS = 2_000;

function isMapHome(pathname: string): boolean {
  return pathname === "/" || pathname === "/company/map";
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function withTrailState(state: unknown, trail: MapCanvasTrail) {
  return { ...record(state), [MAP_CANVAS_TRAIL_STATE_KEY]: trail };
}

function withoutTrailState(state: unknown) {
  const next = { ...record(state) };
  delete next[MAP_CANVAS_TRAIL_STATE_KEY];
  return next;
}

function scrollableElements(root: HTMLElement): HTMLElement[] {
  return [root, ...root.querySelectorAll<HTMLElement>("*")];
}

function captureScrollPositions(
  root: HTMLElement | null,
): readonly MapCanvasScrollPosition[] {
  if (!root) return [];
  return scrollableElements(root)
    .map((element, index) => ({ element, index }))
    .filter(
      ({ element }) =>
        element.scrollTop > 0 ||
        element.scrollLeft > 0 ||
        element.scrollHeight > element.clientHeight ||
        element.scrollWidth > element.clientWidth,
    )
    .filter(({ element }) => element.scrollTop > 0 || element.scrollLeft > 0)
    .slice(0, 32)
    .map(({ element, index }) => ({
      index,
      left: Math.max(0, Math.round(element.scrollLeft)),
      top: Math.max(0, Math.round(element.scrollTop)),
    }));
}

function restoreScrollPositions(
  root: HTMLElement,
  positions: readonly MapCanvasScrollPosition[],
) {
  const elements = scrollableElements(root);
  for (const position of positions) {
    const element = elements[position.index];
    if (!element) continue;
    element.scrollLeft = position.left;
    element.scrollTop = position.top;
  }
}

function sanitizeSnapshotNodes(root: ParentNode) {
  root
    .querySelectorAll(
      "audio, base, canvas, embed, iframe, link, meta, object, script, template, video",
    )
    .forEach((element) => {
      element.remove();
    });
  root.querySelectorAll("[autofocus], [id]").forEach((element) => {
    element.removeAttribute("autofocus");
    element.removeAttribute("id");
  });
  root.querySelectorAll("*").forEach((element) => {
    for (const attribute of element.getAttributeNames()) {
      const attributeName = attribute.toLowerCase();
      const attributeValue = element.getAttribute(attribute) ?? "";
      if (
        attributeName.startsWith("on") ||
        (attributeName === "style" &&
          /(?:^|;)\s*position\s*:\s*fixed(?:\s*!important)?\s*(?:;|$)/iu.test(
            attributeValue,
          ))
      ) {
        element.removeAttribute(attribute);
      }
    }
  });
}

function sanitizedSnapshotHtml(html: string): string {
  if (typeof document === "undefined") return "";
  const template = document.createElement("template");
  template.innerHTML = html;
  sanitizeSnapshotNodes(template.content);
  return template.innerHTML;
}

function captureSnapshot(root: HTMLElement | null): MapCanvasSnapshot | null {
  if (!root) return null;
  const clone = root.cloneNode(true) as HTMLElement;
  sanitizeSnapshotNodes(clone);
  const html = clone.innerHTML;
  if (!html) return null;
  const bounds = root.getBoundingClientRect();
  return {
    height: Math.max(1, Math.round(bounds.height)),
    html,
    width: Math.max(1, Math.round(bounds.width)),
  };
}

function snapshotForHistory(
  snapshot: MapCanvasSnapshot | null,
): MapCanvasSnapshot | null {
  return snapshot && snapshot.html.length <= MAX_MAP_CANVAS_SNAPSHOT_CHARS
    ? snapshot
    : null;
}

function snapshotCacheKey(entry: MapCanvasTrailEntry): string {
  return `${entry.historyIndex ?? "none"}:${entry.href}`;
}

function rememberLiveSnapshot(
  cache: Map<string, MapCanvasSnapshot>,
  entry: MapCanvasTrailEntry,
  snapshot: MapCanvasSnapshot,
) {
  cache.set(snapshotCacheKey(entry), snapshot);
  while (cache.size > MAX_MAP_CANVAS_TRAIL_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (typeof oldestKey !== "string") return;
    cache.delete(oldestKey);
  }
}

function trailEntryLabel(
  entry: MapCanvasTrailEntry,
  root: CompanyMapWindowJob,
): string {
  const destination = new URL(entry.href, "https://map-canvas.invalid");
  const search = Object.fromEntries(destination.searchParams.entries());
  return (
    companyMapWindowJobForRoute(destination.pathname, search)?.jobName ??
    root.jobName
  );
}

function anchorForEventTarget(
  target: EventTarget | null,
): HTMLAnchorElement | null {
  return target instanceof Element ? target.closest("a[href]") : null;
}

function routerHrefForAnchor(anchor: HTMLAnchorElement): string | null {
  if (anchor.target || anchor.hasAttribute("download")) return null;
  const destination = new URL(anchor.href, window.location.href);
  if (destination.origin !== window.location.origin) return null;
  return destination.hash.startsWith("#/") ? destination.hash.slice(1) : null;
}

function isSameDeskNavigationTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest("[data-map-canvas-same-desk]") !== null
  );
}

function routerHrefForEmbeddedDeskTab(
  target: EventTarget | null,
  sourceHref: string,
): string | null {
  const testId =
    target instanceof Element
      ? target.closest<HTMLElement>("[data-testid]")?.dataset.testid
      : undefined;
  const tab = testId?.match(
    /^channel-view-tab-(needs-you|pipeline|chats|discussion)$/u,
  )?.[1];
  if (!tab) return null;
  const destination = new URL(sourceHref, window.location.href);
  // The tab's real route determines its fresh-load default. The current map
  // root remains in persisted history state instead of leaking into this URL.
  destination.searchParams.delete("mapJob");
  destination.searchParams.set("whatsappDeskTab", tab);
  return `${destination.pathname}${destination.search}${destination.hash}`;
}

function routerHrefForEmbeddedDeskAction(
  target: EventTarget | null,
  sourceHref: string,
): string | null {
  if (!(target instanceof Element)) return null;
  const action = target.closest(".c3wa-pipeline-open-chat");
  if (action?.textContent?.trim() !== "Open chat") return null;
  const cardTestId = action?.closest<HTMLElement>(
    "[data-testid^='outreach-pipeline-card-']",
  )?.dataset.testid;
  if (!cardTestId) return null;
  const contactWaId = cardTestId.slice("outreach-pipeline-card-".length);
  if (!contactWaId) return null;
  const destination = new URL(sourceHref, window.location.href);
  destination.searchParams.delete("mapJob");
  destination.searchParams.set("whatsappContactWaId", contactWaId);
  destination.searchParams.set("whatsappDeskTab", "chats");
  return `${destination.pathname}${destination.search}${destination.hash}`;
}

function MapCanvasTrailPeek({
  entry,
  fallbackLabel,
  liveSnapshot,
  onBack,
}: {
  entry: MapCanvasTrailEntry;
  fallbackLabel: string;
  liveSnapshot: MapCanvasSnapshot | null;
  onBack: () => void;
}) {
  const snapshot = liveSnapshot ?? entry.snapshot;
  const snapshotHtml = React.useMemo(
    () => (snapshot ? sanitizedSnapshotHtml(snapshot.html) : null),
    [snapshot],
  );
  const width = snapshot?.width ?? 1204;
  const height = snapshot?.height ?? 699;
  return (
    <section
      aria-label="Previous map screen"
      className="map-canvas-route-peek"
      data-testid="fullmap-window-peek"
    >
      <div className="map-canvas-route-peek-shell">
        <div aria-hidden="true" className="map-canvas-route-peek-clip" inert>
          {snapshotHtml ? (
            <div
              className="map-canvas-route-peek-snapshot"
              // biome-ignore lint/security/noDangerouslySetInnerHtml: a sanitized clone of the current same-origin route is inert in the peek.
              dangerouslySetInnerHTML={{ __html: snapshotHtml }}
              style={{
                height,
                transform: `translateX(-${Math.max(0, width - 144)}px)`,
                width,
              }}
            />
          ) : (
            <div className="map-canvas-route-peek-fallback">
              <span>{fallbackLabel}</span>
            </div>
          )}
        </div>
      </div>
      <button
        aria-label="Back to previous map screen"
        className="map-canvas-route-peek-back"
        onClick={onBack}
        type="button"
      />
    </section>
  );
}

function MapCanvasWindow({
  children,
  depth,
  job,
  onClose,
  onContentClickCapture,
  onContentKeyDownCapture,
  contentRef,
}: {
  children: React.ReactNode;
  contentRef: React.RefObject<HTMLDivElement | null>;
  depth: number;
  job: CompanyMapWindowJob;
  onClose: () => void;
  onContentClickCapture: (event: React.MouseEvent<HTMLDivElement>) => void;
  onContentKeyDownCapture: (event: React.KeyboardEvent<HTMLDivElement>) => void;
}) {
  const partName = FUNCTION_DETAILS[job.functionId].name;
  return (
    <section
      aria-label={`${partName}, ${job.jobName}`}
      className="map-canvas-route-window"
      data-function={job.functionId}
      data-testid="fullmap-window"
      data-trail-depth={depth}
    >
      {depth === 0 ? (
        <>
          <span aria-hidden="true" className="map-canvas-route-connector" />
          <span
            aria-hidden="true"
            className="map-canvas-route-job-ring"
            data-testid="fullmap-window-job-ring"
          >
            <EmployeeAvatar
              className="map-canvas-route-job-avatar"
              name={job.jobName}
            />
          </span>
        </>
      ) : (
        <>
          <span
            aria-hidden="true"
            className="map-canvas-route-trail-connector"
            data-testid="fullmap-trail-connector"
          />
          <span aria-hidden="true" className="map-canvas-route-trail-port" />
        </>
      )}
      <button
        aria-label="Close map screen"
        className="map-canvas-route-close"
        data-testid="fullmap-window-close"
        onClick={onClose}
        type="button"
      >
        <svg
          aria-hidden="true"
          fill="none"
          height="18"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="2.4"
          viewBox="0 0 24 24"
          width="18"
        >
          <path d="m6 6 12 12M18 6 6 18" />
        </svg>
      </button>
      <div
        className="map-canvas-route-window-content"
        onClickCapture={onContentClickCapture}
        onKeyDownCapture={onContentKeyDownCapture}
        ref={contentRef}
      >
        {children}
      </div>
    </section>
  );
}

/** Keeps the map mounted while a supported route trail is open on the canvas. */
export function MapCanvasRouteSurface({
  children,
  enabled,
}: MapCanvasRouteSurfaceProps) {
  const { activeCommunity } = useCommunities();
  const location = useLocation();
  const router = useRouter();
  const communityId = activeCommunity?.id ?? "no-active-community";
  const search = location.search as Record<string, unknown>;
  const directJob = enabled
    ? companyMapWindowJobForRoute(location.pathname, search)
    : null;
  const persistedTrail = enabled
    ? mapCanvasTrailForHref(location.state, location.href, communityId)
    : null;
  const trail =
    persistedTrail ??
    (directJob
      ? createMapCanvasTrail(
          directJob,
          location.href,
          mapCanvasHistoryIndex(location.state),
          communityId,
        )
      : null);
  const job = trail?.root ?? directJob;
  const active = enabled && (isMapHome(location.pathname) || trail !== null);
  const contentRef = React.useRef<HTMLDivElement>(null);
  const locationRef = React.useRef(location);
  const trailRef = React.useRef(trail);
  const pendingNavigationRef = React.useRef<PendingEmbeddedNavigation | null>(
    null,
  );
  const pendingSameDeskNavigationRef =
    React.useRef<PendingSameDeskNavigation | null>(null);
  const handledNavigationRef = React.useRef<{
    observedAt: number;
    sourceHref: string;
  } | null>(null);
  const liveSnapshotsRef = React.useRef(new Map<string, MapCanvasSnapshot>());
  const snapshotCommunityRef = React.useRef(communityId);
  const previousHrefRef = React.useRef(location.href);
  const restoredScrollKeyRef = React.useRef<string | null>(null);
  locationRef.current = location;
  trailRef.current = trail;
  if (snapshotCommunityRef.current !== communityId) {
    liveSnapshotsRef.current.clear();
    snapshotCommunityRef.current = communityId;
  }

  const markNavigationCaptureHandled = React.useCallback(
    (sourceHref: string) => {
      handledNavigationRef.current = { observedAt: Date.now(), sourceHref };
    },
    [],
  );

  const rememberSameDeskNavigation = React.useCallback((sourceHref: string) => {
    pendingSameDeskNavigationRef.current = {
      observedAt: Date.now(),
      samePathNavigation: "swap",
      sourceHref,
    };
  }, []);

  const closeWholeTrail = React.useCallback(() => {
    router.history.replace("/", withoutTrailState(locationRef.current.state));
  }, [router.history]);

  const goToTrailEntry = React.useCallback(
    (targetIndex: number) => {
      const currentTrail = trailRef.current;
      if (!currentTrail || targetIndex < 0) return;
      const target = currentTrail.entries[targetIndex];
      const currentIndex = mapCanvasHistoryIndex(locationRef.current.state);
      if (!target) return;
      if (
        target.historyIndex !== null &&
        currentIndex !== null &&
        target.historyIndex < currentIndex
      ) {
        router.history.go(target.historyIndex - currentIndex);
        return;
      }
      markNavigationCaptureHandled(locationRef.current.href);
      router.history.replace(
        target.href,
        withTrailState(
          locationRef.current.state,
          truncateMapCanvasTrail(currentTrail, targetIndex),
        ),
      );
    },
    [markNavigationCaptureHandled, router.history],
  );

  const closeLatestWindow = React.useCallback(() => {
    const currentTrail = trailRef.current;
    if (currentTrail && currentTrail.entries.length > 1) {
      goToTrailEntry(currentTrail.entries.length - 2);
      return;
    }
    closeWholeTrail();
  }, [closeWholeTrail, goToTrailEntry]);

  const captureCurrentTrail = React.useCallback(
    (
      samePathNavigation: PendingEmbeddedNavigation["samePathNavigation"] = "replace",
    ): PendingEmbeddedNavigation | null => {
      const currentTrail = trailRef.current;
      if (!currentTrail) return null;
      const currentLocation = locationRef.current;
      const historyIndex = mapCanvasHistoryIndex(currentLocation.state);
      const liveSnapshot = captureSnapshot(contentRef.current);
      const capturedTrail = captureMapCanvasTrailLatest(currentTrail, {
        historyIndex,
        scroll: captureScrollPositions(contentRef.current),
        snapshot: snapshotForHistory(liveSnapshot),
      });
      const capturedEntry = capturedTrail.entries.at(-1);
      if (liveSnapshot && capturedEntry) {
        rememberLiveSnapshot(
          liveSnapshotsRef.current,
          capturedEntry,
          liveSnapshot,
        );
      }
      // This is an update to the current browser slot, not a router
      // navigation. Using RouterHistory.replace here would re-enter its
      // asynchronous blocker and make this capture look like another leave.
      window.history.replaceState(
        withTrailState(currentLocation.state, capturedTrail),
        "",
        router.history.createHref(currentLocation.href),
      );
      const pending = {
        historyIndex,
        observedAt: Date.now(),
        samePathNavigation,
        sourceHref: currentLocation.href,
        trail: capturedTrail,
      };
      pendingNavigationRef.current = pending;
      return pending;
    },
    [router.history],
  );

  const commitAnchorNavigation = React.useCallback(
    (href: string, pending: PendingEmbeddedNavigation) => {
      const departingEntry = pending.trail.entries.at(-1);
      const navigation = planMapCanvasTrailNavigation({
        historyIndex: pending.historyIndex,
        href,
        samePathNavigation: pending.samePathNavigation,
        scroll: departingEntry?.scroll ?? [],
        snapshot: departingEntry?.snapshot ?? null,
        trail: pending.trail,
      });
      pendingNavigationRef.current = null;
      if (navigation.kind === "none") return;
      if (navigation.kind === "return") {
        goToTrailEntry(navigation.targetIndex);
        return;
      }
      markNavigationCaptureHandled(pending.sourceHref);
      if (navigation.kind === "replace") {
        router.history.replace(
          href,
          withTrailState(locationRef.current.state, navigation.trail),
        );
        return;
      }
      if (navigation.kind === "swap") {
        router.history.push(
          href,
          withTrailState(locationRef.current.state, navigation.trail),
        );
        return;
      }
      const previousTrail = truncateMapCanvasTrail(
        navigation.trail,
        navigation.trail.entries.length - 2,
      );
      router.history.replace(
        pending.sourceHref,
        withTrailState(locationRef.current.state, previousTrail),
      );
      router.history.flush();
      router.history.push(
        href,
        withTrailState(locationRef.current.state, navigation.trail),
      );
    },
    [goToTrailEntry, markNavigationCaptureHandled, router.history],
  );

  const handleContentKeyDownCapture = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const sourceHref = locationRef.current.href;
      const anchor = anchorForEventTarget(event.target);
      const tabHref = routerHrefForEmbeddedDeskTab(event.target, sourceHref);
      const actionHref = routerHrefForEmbeddedDeskAction(
        event.target,
        sourceHref,
      );
      const href = anchor
        ? routerHrefForAnchor(anchor)
        : (tabHref ?? actionHref);
      if (!href || href === sourceHref) {
        if (isSameDeskNavigationTarget(event.target)) {
          rememberSameDeskNavigation(sourceHref);
        }
        return;
      }
      const pending = captureCurrentTrail(
        actionHref
          ? "append"
          : tabHref || isSameDeskNavigationTarget(event.target)
            ? "swap"
            : "replace",
      );
      if (!pending) return;
      markNavigationCaptureHandled(pending.sourceHref);
      if (anchor || tabHref || actionHref) {
        event.preventDefault();
        event.stopPropagation();
      }
      commitAnchorNavigation(href, pending);
    },
    [
      captureCurrentTrail,
      commitAnchorNavigation,
      markNavigationCaptureHandled,
      rememberSameDeskNavigation,
    ],
  );

  const handleContentClickCapture = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (
        event.button !== 0 ||
        event.metaKey ||
        event.altKey ||
        event.ctrlKey ||
        event.shiftKey
      ) {
        return;
      }
      const anchor = anchorForEventTarget(event.target);
      const sourceHref = locationRef.current.href;
      const tabHref = routerHrefForEmbeddedDeskTab(event.target, sourceHref);
      const actionHref = routerHrefForEmbeddedDeskAction(
        event.target,
        sourceHref,
      );
      const href = anchor
        ? routerHrefForAnchor(anchor)
        : (tabHref ?? actionHref);
      if (!href || href === sourceHref) {
        if (isSameDeskNavigationTarget(event.target)) {
          rememberSameDeskNavigation(sourceHref);
        }
        return;
      }
      const pending = captureCurrentTrail(
        actionHref
          ? "append"
          : tabHref || isSameDeskNavigationTarget(event.target)
            ? "swap"
            : "replace",
      );
      if (!pending) return;
      markNavigationCaptureHandled(pending.sourceHref);
      if (anchor || tabHref || actionHref) {
        event.preventDefault();
        event.stopPropagation();
      }
      commitAnchorNavigation(href, pending);
    },
    [
      captureCurrentTrail,
      commitAnchorNavigation,
      markNavigationCaptureHandled,
      rememberSameDeskNavigation,
    ],
  );

  React.useEffect(() => {
    if (!job) return;
    return router.history.block({
      enableBeforeUnload: false,
      blockerFn: ({ action, currentLocation, nextLocation }) => {
        if (action !== "PUSH" && action !== "REPLACE") {
          return false;
        }
        if (
          currentLocation.href === nextLocation.href ||
          isMapHome(nextLocation.pathname)
        ) {
          return false;
        }
        const handled = handledNavigationRef.current;
        if (
          handled &&
          handled.sourceHref === currentLocation.href &&
          Date.now() - handled.observedAt <= EMBEDDED_NAVIGATION_WINDOW_MS
        ) {
          handledNavigationRef.current = null;
          return false;
        }
        const currentTrail = trailRef.current;
        if (currentTrail?.entries.at(-1)?.href !== currentLocation.href) {
          return false;
        }
        const sameDeskNavigation = pendingSameDeskNavigationRef.current;
        const samePathNavigation =
          sameDeskNavigation &&
          sameDeskNavigation.sourceHref === currentLocation.href &&
          Date.now() - sameDeskNavigation.observedAt <=
            EMBEDDED_NAVIGATION_WINDOW_MS
            ? sameDeskNavigation.samePathNavigation
            : "replace";
        pendingSameDeskNavigationRef.current = null;
        captureCurrentTrail(samePathNavigation);
        return false;
      },
    });
  }, [captureCurrentTrail, job, router.history]);

  React.useEffect(() => {
    const previousHref = previousHrefRef.current;
    previousHrefRef.current = location.href;
    if (previousHref === location.href) return;
    const pending = pendingNavigationRef.current;
    pendingNavigationRef.current = null;
    if (
      !pending ||
      Date.now() - pending.observedAt > EMBEDDED_NAVIGATION_WINDOW_MS ||
      isMapHome(location.pathname) ||
      mapCanvasTrailForHref(location.state, location.href, communityId)
    ) {
      return;
    }
    const navigation = planMapCanvasTrailNavigation({
      historyIndex: pending.historyIndex,
      href: location.href,
      samePathNavigation: pending.samePathNavigation,
      scroll: [],
      snapshot: null,
      trail: pending.trail,
    });
    if (navigation.kind === "none") return;
    if (navigation.kind === "return") {
      router.history.replace(
        location.href,
        withTrailState(
          location.state,
          truncateMapCanvasTrail(navigation.trail, navigation.targetIndex),
        ),
      );
      return;
    }
    const alignedTrail = setMapCanvasTrailLatestHistoryIndex(
      navigation.trail,
      mapCanvasHistoryIndex(location.state),
    );
    router.history.replace(
      location.href,
      withTrailState(location.state, alignedTrail),
    );
  }, [
    communityId,
    location.href,
    location.pathname,
    location.state,
    router.history,
  ]);

  React.useEffect(() => {
    const currentEntry = trail?.entries.at(-1);
    const restoreKey = `${location.href}:${currentEntry?.historyIndex ?? ""}`;
    if (
      !currentEntry ||
      currentEntry.scroll.length === 0 ||
      restoredScrollKeyRef.current === restoreKey
    ) {
      return;
    }
    restoredScrollKeyRef.current = restoreKey;
    const frame = window.requestAnimationFrame(() => {
      if (contentRef.current) {
        restoreScrollPositions(contentRef.current, currentEntry.scroll);
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [location.href, trail]);

  React.useEffect(() => {
    if (!job) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        event.defaultPrevented ||
        document.querySelector('[role="dialog"][data-state="open"]')
      ) {
        return;
      }
      event.preventDefault();
      closeLatestWindow();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeLatestWindow, job]);

  if (!active) return <>{children}</>;

  const depth = Math.max(0, (trail?.entries.length ?? 1) - 1);
  const previousEntry = depth > 0 ? trail?.entries.at(-2) : null;

  return (
    <div
      className="map-canvas-route-surface"
      data-testid="fullmap-canvas-route-surface"
      data-trail-depth={depth}
      data-window-open={job ? "true" : undefined}
    >
      <div className="map-canvas-route-background">
        <CompanyMapScreen
          mapWindowDepth={depth}
          mapWindowJob={job}
          onMapWindowClose={closeLatestWindow}
          onMapWindowFit={closeWholeTrail}
        />
      </div>
      {job ? (
        <>
          {previousEntry ? (
            <MapCanvasTrailPeek
              entry={previousEntry}
              fallbackLabel={trailEntryLabel(previousEntry, job)}
              liveSnapshot={
                liveSnapshotsRef.current.get(snapshotCacheKey(previousEntry)) ??
                null
              }
              onBack={closeLatestWindow}
            />
          ) : null}
          <MapCanvasWindow
            contentRef={contentRef}
            depth={depth}
            job={job}
            onClose={closeLatestWindow}
            onContentClickCapture={handleContentClickCapture}
            onContentKeyDownCapture={handleContentKeyDownCapture}
          >
            {children}
          </MapCanvasWindow>
        </>
      ) : null}
    </div>
  );
}
