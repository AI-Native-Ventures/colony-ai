import { LoaderCircle, Plus, X } from "lucide-react";
import * as React from "react";

import { pageLabel } from "./browserAddress";
import type { BrowserPage } from "./browserTabsStore";

export const browserPageTabDomId = (key: string) => `browser-page-tab-${key}`;
export const BROWSER_VIEWPORT_ID = "colony-browser-viewport";

type BrowserPageTabsProps = {
  pages: readonly BrowserPage[];
  activeKey: string | null;
  onSelect: (key: string) => void;
  onClose: (key: string) => void;
  onNew: () => void;
};

/**
 * The browser's own tabs, in the same WAI-ARIA pattern as the dock's tab strip:
 * Left, Right, Home and End move focus, Enter or Space activates, Delete
 * closes. Each tab's close control is its own named button, so no label has two
 * owners. The new-tab button is the last stop in the row.
 */
export function BrowserPageTabs({
  pages,
  activeKey,
  onSelect,
  onClose,
  onNew,
}: BrowserPageTabsProps) {
  const refs = React.useRef(new Map<string, HTMLButtonElement>());

  const onKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    let target: number | null = null;
    if (event.key === "ArrowRight") target = (index + 1) % pages.length;
    else if (event.key === "ArrowLeft")
      target = (index - 1 + pages.length) % pages.length;
    else if (event.key === "Home") target = 0;
    else if (event.key === "End") target = pages.length - 1;
    if (target !== null) {
      event.preventDefault();
      refs.current.get(pages[target].key)?.focus();
      return;
    }
    if (event.key === "Delete") {
      event.preventDefault();
      const neighbour = pages[index + 1] ?? pages[index - 1];
      onClose(pages[index].key);
      if (neighbour) {
        window.requestAnimationFrame(() =>
          refs.current.get(neighbour.key)?.focus(),
        );
      }
    }
  };

  return (
    <div className="colony-browser-pagetabs">
      <div
        aria-label="Browser tabs"
        className="colony-browser-pagetablist"
        role="tablist"
      >
        {pages.map((page, index) => {
          const selected = page.key === activeKey;
          const label = pageLabel(page);
          const busy = page.loading || page.opening;
          return (
            <div
              className="colony-browser-pagetab"
              data-selected={selected ? "true" : "false"}
              key={page.key}
              role="presentation"
            >
              <button
                aria-controls={BROWSER_VIEWPORT_ID}
                aria-selected={selected}
                className="colony-browser-pagetab-select"
                data-testid="browser-page-tab"
                id={browserPageTabDomId(page.key)}
                onClick={() => onSelect(page.key)}
                onKeyDown={(event) => onKeyDown(event, index)}
                ref={(element) => {
                  if (element) refs.current.set(page.key, element);
                  else refs.current.delete(page.key);
                }}
                role="tab"
                tabIndex={selected ? 0 : -1}
                title={page.url || label}
                type="button"
              >
                {busy ? (
                  <LoaderCircle
                    aria-hidden="true"
                    className="colony-browser-spinner"
                  />
                ) : null}
                <span>{label}</span>
                {busy ? <span className="sr-only">, loading</span> : null}
              </button>
              <button
                aria-label={`Close ${label}`}
                className="colony-work-area-icon-button"
                data-testid="browser-page-tab-close"
                onClick={() => onClose(page.key)}
                tabIndex={selected ? 0 : -1}
                type="button"
              >
                <X aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
      <button
        aria-label="New browser tab"
        className="colony-work-area-icon-button"
        data-testid="browser-new-tab"
        onClick={onNew}
        title="New tab"
        type="button"
      >
        <Plus aria-hidden="true" />
      </button>
    </div>
  );
}
