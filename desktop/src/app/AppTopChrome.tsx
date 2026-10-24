import * as React from "react";
import { useLocation } from "@tanstack/react-router";

import { breadcrumbForPath } from "@/app/topBarBreadcrumbs";
import { useIsMobile } from "@/shared/hooks/use-mobile";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ExpandSidebarIcon,
} from "@/shared/ui/colonyIcons";
import { useOptionalSidebar } from "@/shared/ui/sidebar";

type AppTopChromeProps = {
  canGoBack: boolean;
  canGoForward: boolean;
  onGoBack: () => void;
  onGoForward: () => void;
  hasCommunityRail?: boolean;
};

function preventTopChromeWheel(event: WheelEvent) {
  event.preventDefault();
}

/**
 * The shell top bar: 64px, history buttons, then the breadcrumb for the
 * current page. Screens that know more than the route (a project, a person)
 * portal their own trail into `#app-top-chrome-content`; the default
 * breadcrumb steps aside while that slot has content.
 */
export function AppTopChrome({
  canGoBack,
  canGoForward,
  onGoBack,
  onGoForward,
}: AppTopChromeProps) {
  const topChromeRef = React.useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();
  const breadcrumb = breadcrumbForPath(pathname);
  const sidebar = useOptionalSidebar();
  // On a narrow window the sidebar is a drawer, and this is its only handle.
  const isMobile = useIsMobile();

  React.useEffect(() => {
    const topChrome = topChromeRef.current;
    if (!topChrome) {
      return;
    }

    const options = { capture: true, passive: false };
    topChrome.addEventListener("wheel", preventTopChromeWheel, options);
    return () => {
      topChrome.removeEventListener("wheel", preventTopChromeWheel, options);
    };
  }, []);

  return (
    <div
      className="colony-topbar"
      data-tauri-drag-region
      data-testid="app-top-chrome"
      ref={topChromeRef}
    >
      {isMobile ? (
        <button
          aria-label="Toggle Sidebar"
          className="colony-topbar-button"
          data-sidebar="trigger"
          disabled={!sidebar}
          onClick={() => sidebar?.toggleSidebar()}
          type="button"
        >
          <ExpandSidebarIcon size={18} />
          <span className="sr-only">Toggle Sidebar</span>
        </button>
      ) : null}
      <button
        aria-label="Go back"
        className="colony-topbar-button"
        data-testid="global-back"
        disabled={!canGoBack}
        onClick={onGoBack}
        type="button"
      >
        <ChevronLeftIcon size={17} />
      </button>
      <button
        aria-label="Go forward"
        className="colony-topbar-button"
        data-testid="global-forward"
        disabled={!canGoForward}
        onClick={onGoForward}
        type="button"
      >
        <ChevronRightIcon size={17} />
      </button>
      {breadcrumb ? (
        <nav
          aria-label="Breadcrumb"
          className="colony-breadcrumb"
          data-testid="top-bar-breadcrumb"
        >
          {breadcrumb.map((crumb, index) => {
            const isLast = index === breadcrumb.length - 1;
            return (
              <React.Fragment key={crumb.label}>
                {index > 0 ? <span aria-hidden="true">/</span> : null}
                <span
                  aria-current={isLast ? "page" : undefined}
                  data-current={isLast ? "true" : undefined}
                >
                  {crumb.label}
                </span>
              </React.Fragment>
            );
          })}
        </nav>
      ) : null}
      <div
        className="colony-topbar-content"
        data-tauri-drag-region
        id="app-top-chrome-content"
      />
    </div>
  );
}
