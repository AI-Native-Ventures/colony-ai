import {
  ArrowLeft,
  ArrowRight,
  Globe,
  Lock,
  LockOpen,
  RotateCw,
  X,
} from "lucide-react";
import * as React from "react";

import { addressBarText, addressProtocol } from "./browserAddress";
import {
  goBackBrowserPage,
  goForwardBrowserPage,
  navigateBrowserPage,
  reloadBrowserPage,
  stopBrowserPage,
  type BrowserPage,
} from "./browserTabsStore";

export type BrowserToolbarHandle = {
  /** Put the caret in the address bar with its text selected. */
  focusAddress: () => void;
};

type BrowserToolbarProps = {
  channelId: string;
  page: BrowserPage;
};

const ADDRESS_ERROR_ID = "colony-browser-address-error";

/**
 * Back, forward, reload or stop, and the address bar. The bar always shows the
 * page's real address (after redirects and in-page navigation), never what was
 * typed once the page has loaded; typing is a draft that Escape or leaving the
 * field throws away. An address the browser will not open stays in the field
 * with the reason beside it.
 */
export const BrowserToolbar = React.forwardRef<
  BrowserToolbarHandle,
  BrowserToolbarProps
>(function BrowserToolbar({ channelId, page }, handleRef) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [draft, setDraft] = React.useState<string | null>(null);
  const [problem, setProblem] = React.useState<string | null>(null);

  React.useImperativeHandle(
    handleRef,
    () => ({
      focusAddress: () => {
        inputRef.current?.focus();
        inputRef.current?.select();
      },
    }),
    [],
  );

  // A different page is a different address: drop the old draft and refusal.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only when the active page changes.
  React.useEffect(() => {
    setDraft(null);
    setProblem(null);
  }, [page.key]);

  const protocol = addressProtocol(page.url);
  const value = draft ?? addressBarText(page.url);
  const busy = page.loading || page.opening;
  const canReload = Boolean(page.url) || page.hostId !== null;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const result = navigateBrowserPage(channelId, page.key, value);
    if (!result.ok) {
      setProblem(result.message);
      return;
    }
    setProblem(null);
    setDraft(null);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Escape" || event.metaKey || event.ctrlKey) return;
    // Escape is the address bar's own: undo the draft first, then stop loading.
    event.preventDefault();
    event.stopPropagation();
    if (draft !== null || problem !== null) {
      setDraft(null);
      setProblem(null);
    } else if (page.loading) {
      stopBrowserPage(channelId, page.key);
    }
  };

  const Security =
    protocol === "https" ? Lock : protocol === "http" ? LockOpen : Globe;
  const securityLabel =
    protocol === "https"
      ? "Secure connection"
      : protocol === "http"
        ? "Not secure: this page does not use https"
        : "No page open";

  return (
    <>
      <div
        aria-label="Browser controls"
        className="colony-browser-toolbar"
        role="toolbar"
      >
        <button
          aria-label="Back"
          className="colony-work-area-icon-button"
          data-testid="browser-back"
          disabled={!page.canGoBack}
          onClick={() => goBackBrowserPage(channelId, page.key)}
          title="Back"
          type="button"
        >
          <ArrowLeft aria-hidden="true" />
        </button>
        <button
          aria-label="Forward"
          className="colony-work-area-icon-button"
          data-testid="browser-forward"
          disabled={!page.canGoForward}
          onClick={() => goForwardBrowserPage(channelId, page.key)}
          title="Forward"
          type="button"
        >
          <ArrowRight aria-hidden="true" />
        </button>
        <button
          aria-label={busy ? "Stop loading" : "Reload"}
          className="colony-work-area-icon-button"
          data-testid="browser-reload"
          disabled={!canReload}
          onClick={() =>
            busy
              ? stopBrowserPage(channelId, page.key)
              : reloadBrowserPage(channelId, page.key)
          }
          title={busy ? "Stop loading" : "Reload"}
          type="button"
        >
          {busy ? <X aria-hidden="true" /> : <RotateCw aria-hidden="true" />}
        </button>
        <form className="colony-browser-address" onSubmit={submit}>
          <span
            className="colony-browser-security"
            data-protocol={protocol ?? "none"}
            role="img"
            aria-label={securityLabel}
            title={securityLabel}
          >
            <Security aria-hidden="true" />
          </span>
          <input
            aria-describedby={problem ? ADDRESS_ERROR_ID : undefined}
            aria-invalid={problem ? true : undefined}
            aria-label="Web address"
            autoComplete="off"
            autoCorrect="off"
            className="colony-browser-address-input"
            data-testid="browser-address"
            onBlur={() => {
              setDraft(null);
              setProblem(null);
            }}
            onChange={(event) => {
              setDraft(event.target.value);
              setProblem(null);
            }}
            onFocus={(event) => event.currentTarget.select()}
            onKeyDown={onKeyDown}
            placeholder="Enter a website address"
            ref={inputRef}
            spellCheck={false}
            type="text"
            value={value}
          />
        </form>
      </div>
      {problem ? (
        <p
          className="colony-browser-address-error"
          data-testid="browser-address-error"
          id={ADDRESS_ERROR_ID}
          role="alert"
        >
          {problem}
        </p>
      ) : null}
    </>
  );
});
