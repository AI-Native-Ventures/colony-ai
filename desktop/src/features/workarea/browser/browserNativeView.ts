import type {
  BrowserHostApi,
  BrowserTabBounds,
} from "@/shared/api/browserHost";

/**
 * Keeps the Electron page view on top of a slot in the dock.
 *
 * The page is a native view stacked above the whole renderer, so three things
 * follow. It has to be moved whenever the slot moves or resizes (the layout is
 * the source of truth, nothing is cached). It has to be taken away while
 * anything the renderer draws could be hidden behind it: an open menu or
 * dialog, or the dock divider being dragged. And its host calls are
 * asynchronous, so they are sent one at a time with the latest wish winning,
 * and a persistent failure stops after a few tries instead of looping.
 */

/** Overlays the renderer draws that a native view would otherwise cover. */
const COVERING_OVERLAYS = [
  '[role="menu"]',
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[role="listbox"]',
  '[data-testid="work-area-divider"][data-dragging="true"]',
].join(",");

/** The slot's own regions are never an overlay that should hide the page. */
export function isNativeViewCovered(root: Document = document): boolean {
  return root.querySelector(COVERING_OVERLAYS) !== null;
}

export type NativeViewHost = Pick<BrowserHostApi, "attach" | "detach">;

export type BindNativeViewOptions = {
  host: NativeViewHost;
  /** The element whose box the page fills. */
  element: Element;
  /** False hides the page without losing it (inactive dock tab, closed dock). */
  visible: boolean;
  /** Called once if the host keeps refusing; the page cannot be shown. */
  onFailure?: (message: string) => void;
  covered?: () => boolean;
  schedule?: (callback: () => void) => number;
  cancel?: (handle: number) => void;
  clock?: () => number;
};

const MAX_FAILURES = 5;
const RETRY_BASE_MS = 250;
const RETRY_CAP_MS = 4_000;

export function bindNativeView(
  hostId: string,
  options: BindNativeViewOptions,
): () => void {
  const {
    host,
    element,
    visible: wantVisible,
    onFailure,
    covered = isNativeViewCovered,
    schedule = (callback) => window.requestAnimationFrame(callback),
    cancel = (handle) => window.cancelAnimationFrame(handle),
    clock = () => Date.now(),
  } = options;
  let stopped = false;
  let handle = 0;
  let inFlight = false;
  let sentKey: string | null = null;
  let desired: { key: string; bounds: BrowserTabBounds | null } | null = null;
  let failures = 0;
  let retryAt = 0;

  const pump = () => {
    if (stopped || inFlight || !desired || desired.key === sentKey) return;
    if (clock() < retryAt) return;
    const job = desired;
    inFlight = true;
    const call = Promise.resolve().then(() =>
      job.bounds ? host.attach(hostId, job.bounds, true) : host.detach(hostId),
    );
    call
      .then(
        () => {
          failures = 0;
          sentKey = job.key;
        },
        (error: unknown) => {
          failures += 1;
          retryAt =
            clock() +
            Math.min(RETRY_CAP_MS, RETRY_BASE_MS * 2 ** (failures - 1));
          if (failures >= MAX_FAILURES && !stopped) {
            stopped = true;
            cancel(handle);
            onFailure?.(error instanceof Error ? error.message : String(error));
          }
        },
      )
      .finally(() => {
        inFlight = false;
        pump();
      });
  };

  const tick = () => {
    if (stopped) return;
    const rect = element.getBoundingClientRect();
    const bounds: BrowserTabBounds = {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
    const show =
      wantVisible && bounds.width >= 1 && bounds.height >= 1 && !covered();
    const key = show
      ? `${bounds.x},${bounds.y},${bounds.width},${bounds.height}`
      : "hidden";
    if (desired?.key !== key) desired = { key, bounds: show ? bounds : null };
    pump();
    handle = schedule(tick);
  };

  tick();
  return () => {
    stopped = true;
    cancel(handle);
    // Always leave the page detached: whatever was last sent, the slot is gone.
    void Promise.resolve()
      .then(() => host.detach(hostId))
      .catch(() => undefined);
  };
}
