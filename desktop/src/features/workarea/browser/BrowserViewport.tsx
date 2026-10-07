import { Globe, LoaderCircle, TriangleAlert } from "lucide-react";
import * as React from "react";

import { BrowserNativeSlot } from "./BrowserNativeSlot";
import { BROWSER_VIEWPORT_ID, browserPageTabDomId } from "./BrowserPageTabs";
import { describePageError } from "./browserPageError";
import {
  focusBrowserPage,
  goBackBrowserPage,
  reloadBrowserPage,
  type BrowserPage,
} from "./browserTabsStore";

type BrowserViewportProps = {
  channelId: string;
  page: BrowserPage;
  /** True while the Browser dock tab is the one on screen. */
  active: boolean;
};

/**
 * What fills the browser tab's body: the page itself (a native view the slot
 * keeps in place), or, when there is no page to show, the renderer's own
 * start, opening and error states. The native view is only attached while the
 * page is loadable and on screen, so an error never hides behind a blank view.
 */
export function BrowserViewport({
  channelId,
  page,
  active,
}: BrowserViewportProps) {
  const hintId = React.useId();
  const [viewFailure, setViewFailure] = React.useState<{
    hostId: string;
    message: string;
  } | null>(null);
  const failedHere = viewFailure !== null && viewFailure.hostId === page.hostId;

  const showStart = !page.url && !page.hostId && !page.opening && !page.error;
  const showOpening = page.opening && !page.hostId;
  const error =
    page.error ?? (failedHere ? "The page could not be shown" : null);
  const showPage = Boolean(page.hostId) && !error;

  return (
    <div
      aria-labelledby={browserPageTabDomId(page.key)}
      className="colony-browser-viewport"
      id={BROWSER_VIEWPORT_ID}
      role="tabpanel"
    >
      {showPage ? (
        <>
          <BrowserNativeSlot
            hintId={hintId}
            hostId={page.hostId}
            onEnterPage={() => focusBrowserPage(channelId, page.key)}
            onFailure={(message) =>
              page.hostId && setViewFailure({ hostId: page.hostId, message })
            }
            visible={active}
          />
          <p className="sr-only" id={hintId}>
            The page is drawn by the browser. Press Enter to move the keyboard
            into it. Press Control or Command plus L to return to the address
            bar.
          </p>
        </>
      ) : null}
      {showStart ? (
        <div className="colony-browser-state" data-testid="browser-start">
          <span className="colony-browser-state-mark">
            <Globe aria-hidden="true" />
          </span>
          <h2>Where are we working?</h2>
          <p>Open a website or a local app. Type its address above.</p>
          <p className="colony-browser-state-note">
            You sign in to sites yourself here. This browser is kept separate
            for this business and is not shared with agents.
          </p>
        </div>
      ) : null}
      {showOpening ? (
        <div
          aria-live="polite"
          className="colony-browser-state"
          data-testid="browser-opening"
          role="status"
        >
          <LoaderCircle
            aria-hidden="true"
            className="colony-browser-spinner colony-browser-spinner-large"
          />
          <p>Opening the page</p>
        </div>
      ) : null}
      {error ? (
        <PageError
          canGoBack={page.canGoBack}
          error={error}
          onBack={() => goBackBrowserPage(channelId, page.key)}
          onRetry={() => {
            setViewFailure(null);
            reloadBrowserPage(channelId, page.key);
          }}
          url={page.url}
        />
      ) : null}
    </div>
  );
}

function PageError({
  error,
  url,
  canGoBack,
  onRetry,
  onBack,
}: {
  error: string;
  url: string;
  canGoBack: boolean;
  onRetry: () => void;
  onBack: () => void;
}) {
  const described = describePageError(error);
  return (
    <div
      className="colony-browser-state"
      data-testid="browser-error"
      role="alert"
    >
      <span className="colony-browser-state-mark" data-tone="warning">
        <TriangleAlert aria-hidden="true" />
      </span>
      <h2>{described.title}</h2>
      <p>{described.hint}</p>
      {url ? <p className="colony-browser-state-url">{url}</p> : null}
      {described.detail ? (
        <p className="colony-browser-state-note">Details: {described.detail}</p>
      ) : null}
      <div className="colony-work-area-choices">
        <button
          className="colony-work-area-choice"
          data-testid="browser-error-retry"
          onClick={onRetry}
          type="button"
        >
          Try again
        </button>
        {canGoBack ? (
          <button
            className="colony-work-area-choice"
            data-testid="browser-error-back"
            onClick={onBack}
            type="button"
          >
            Go back
          </button>
        ) : null}
      </div>
    </div>
  );
}
