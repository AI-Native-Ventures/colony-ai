import * as React from "react";
import { useLocation, useRouter } from "@tanstack/react-router";

import {
  companyMapWindowJobForRoute,
  type CompanyMapWindowJob,
} from "@/features/cofounder/companyMapJobRoutes";
import { FUNCTION_DETAILS } from "@/features/cofounder/functions";
import { CompanyMapScreen } from "@/features/cofounder/ui/CompanyMapScreen";
import { EmployeeAvatar } from "@/features/company-team/ui/EmployeeAvatar";

import {
  MAP_CANVAS_TRAIL_STATE_KEY,
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
  sourceHref: string;
  trail: MapCanvasTrail;
};

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
    .querySelectorAll("audio, canvas, iframe, script, template, video")
    .forEach((element) => {
      element.remove();
    });
  root.querySelectorAll("[autofocus], [id]").forEach((element) => {
    element.removeAttribute("autofocus");
    element.removeAttribute("id");
  });
  root.querySelectorAll("*").forEach((element) => {
    for (const attribute of element.getAttributeNames()) {
      if (attribute.toLowerCase().startsWith("on")) {
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
  if (!html || html.length > MAX_MAP_CANVAS_SNAPSHOT_CHARS) return null;
  const bounds = root.getBoundingClientRect();
  return {
    height: Math.max(1, Math.round(bounds.height)),
    html,
    width: Math.max(1, Math.round(bounds.width)),
  };
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
  destination.searchParams.set("whatsappDeskTab", tab);
  return `${destination.pathname}${destination.search}${destination.hash}`;
}

function MapCanvasTrailPeek({
  entry,
  onBack,
}: {
  entry: MapCanvasTrailEntry;
  onBack: () => void;
}) {
  const snapshot = entry.snapshot;
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
      <div aria-hidden="true" className="map-canvas-route-peek-clip" inert>
        {snapshotHtml ? (
          <div
            className="map-canvas-route-peek-snapshot"
            // biome-ignore lint/security/noDangerouslySetInnerHtml: a bounded, sanitized clone of the current same-origin route is inert in the peek.
            dangerouslySetInnerHTML={{ __html: snapshotHtml }}
            style={{
              height,
              transform: `translateX(-${Math.max(0, width - 124)}px)`,
              width,
            }}
          />
        ) : (
          <div className="map-canvas-route-peek-fallback" />
        )}
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
  const location = useLocation();
  const router = useRouter();
  const search = location.search as Record<string, unknown>;
  const directJob = enabled
    ? companyMapWindowJobForRoute(location.pathname, search)
    : null;
  const persistedTrail = enabled
    ? mapCanvasTrailForHref(location.state, location.href)
    : null;
  const trail =
    persistedTrail ??
    (directJob
      ? createMapCanvasTrail(
          directJob,
          location.href,
          mapCanvasHistoryIndex(location.state),
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
  const previousHrefRef = React.useRef(location.href);
  const restoredScrollKeyRef = React.useRef<string | null>(null);
  locationRef.current = location;
  trailRef.current = trail;

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
      router.history.replace(
        target.href,
        withTrailState(
          locationRef.current.state,
          truncateMapCanvasTrail(currentTrail, targetIndex),
        ),
      );
    },
    [router.history],
  );

  const closeLatestWindow = React.useCallback(() => {
    const currentTrail = trailRef.current;
    if (currentTrail && currentTrail.entries.length > 1) {
      goToTrailEntry(currentTrail.entries.length - 2);
      return;
    }
    closeWholeTrail();
  }, [closeWholeTrail, goToTrailEntry]);

  const captureCurrentTrail =
    React.useCallback((): PendingEmbeddedNavigation | null => {
      const currentTrail = trailRef.current;
      if (!currentTrail) return null;
      const currentLocation = locationRef.current;
      const historyIndex = mapCanvasHistoryIndex(currentLocation.state);
      const capturedTrail = captureMapCanvasTrailLatest(currentTrail, {
        historyIndex,
        scroll: captureScrollPositions(contentRef.current),
        snapshot: captureSnapshot(contentRef.current),
      });
      router.history.replace(
        currentLocation.href,
        withTrailState(currentLocation.state, capturedTrail),
      );
      router.history.flush();
      const pending = {
        historyIndex,
        observedAt: Date.now(),
        sourceHref: currentLocation.href,
        trail: capturedTrail,
      };
      pendingNavigationRef.current = pending;
      return pending;
    }, [router.history]);

  const commitAnchorNavigation = React.useCallback(
    (href: string, pending: PendingEmbeddedNavigation) => {
      const navigation = planMapCanvasTrailNavigation({
        historyIndex: pending.historyIndex,
        href,
        scroll: [],
        snapshot: null,
        trail: pending.trail,
      });
      pendingNavigationRef.current = null;
      if (navigation.kind === "none") return;
      if (navigation.kind === "return") {
        goToTrailEntry(navigation.targetIndex);
        return;
      }
      if (navigation.kind === "replace") {
        router.history.replace(
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
    [goToTrailEntry, router.history],
  );

  const markEmbeddedNavigation = React.useCallback(() => {
    captureCurrentTrail();
  }, [captureCurrentTrail]);

  const handleContentKeyDownCapture = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Enter" || event.key === " ") {
        markEmbeddedNavigation();
      }
    },
    [markEmbeddedNavigation],
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
      const pending = captureCurrentTrail();
      const anchor = anchorForEventTarget(event.target);
      const href = anchor
        ? routerHrefForAnchor(anchor)
        : pending
          ? routerHrefForEmbeddedDeskTab(event.target, pending.sourceHref)
          : null;
      if (!pending || !href || href === pending.sourceHref) return;
      if (anchor) {
        event.preventDefault();
        event.stopPropagation();
      }
      commitAnchorNavigation(href, pending);
    },
    [captureCurrentTrail, commitAnchorNavigation],
  );

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
      mapCanvasTrailForHref(location.state, location.href)
    ) {
      return;
    }
    const navigation = planMapCanvasTrailNavigation({
      historyIndex: pending.historyIndex,
      href: location.href,
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
  }, [location.href, location.pathname, location.state, router.history]);

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
