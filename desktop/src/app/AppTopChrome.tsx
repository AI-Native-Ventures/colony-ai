import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/shared/ui/button";
import { DrawerPanelIcon } from "@/shared/ui/DrawerPanelIcon";
import { cn } from "@/shared/lib/cn";
import { topChromeBackdrop } from "@/shared/layout/chromeLayout";
import { useOptionalSidebar } from "@/shared/ui/sidebar";

type AppTopChromeProps = {
  canGoBack: boolean;
  canGoForward: boolean;
  onGoBack: () => void;
  onGoForward: () => void;
  hasCommunityRail?: boolean;
};

// Fixed px on purpose (button box + glyph): these controls sit beside the
// native macOS traffic lights, which ignore the app's Cmd +/- text zoom, so
// the row must not grow or shrink with the rem scale. Deliberate exception
// to the rem-first rule.
const TOP_CHROME_ICON_BUTTON_CLASS =
  "h-[28px] w-[28px] rounded-[4px] text-sidebar-foreground/65 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground";
const HISTORY_ICON_BUTTON_CLASS =
  "h-[28px] w-[24px] rounded-[4px] text-sidebar-foreground/65 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground [&_svg]:size-[16px]";

function preventTopChromeWheel(event: WheelEvent) {
  event.preventDefault();
}

function TopChromeSidebarTrigger() {
  const sidebar = useOptionalSidebar();

  return (
    <Button
      aria-label="Toggle Sidebar"
      className={TOP_CHROME_ICON_BUTTON_CLASS}
      data-sidebar="trigger"
      disabled={!sidebar}
      onClick={() => {
        sidebar?.toggleSidebar();
      }}
      size="icon"
      type="button"
      variant="ghost"
    >
      <DrawerPanelIcon side={sidebar?.open ? "left" : "right"} />
      <span className="sr-only">Toggle Sidebar</span>
    </Button>
  );
}

export function AppTopChrome({
  canGoBack,
  canGoForward,
  onGoBack,
  onGoForward,
}: AppTopChromeProps) {
  const topChromeRef = React.useRef<HTMLDivElement>(null);
  const navRowPaddingClass = "pl-3";

  React.useLayoutEffect(() => {
    const topChrome = topChromeRef.current;
    const portalTarget = topChrome?.querySelector<HTMLElement>(
      "#app-top-chrome-content",
    );
    if (!topChrome || !portalTarget) return;

    const updateCenterOffset = () => {
      const portalBounds = portalTarget.getBoundingClientRect();
      const portalCenter = portalBounds.left + portalBounds.width / 2;
      topChrome.style.setProperty(
        "--app-top-chrome-center-offset",
        `${window.innerWidth / 2 - portalCenter}px`,
      );
    };

    updateCenterOffset();
    const observer = new ResizeObserver(updateCenterOffset);
    observer.observe(topChrome);
    observer.observe(portalTarget);
    return () => observer.disconnect();
  }, []);

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
      ref={topChromeRef}
      className={cn(
        "relative z-45 flex shrink-0 cursor-default select-none items-center bg-sidebar pr-3 text-sidebar-foreground",
        topChromeBackdrop.height,
        navRowPaddingClass,
      )}
      data-tauri-drag-region
      data-testid="app-top-chrome"
      style={
        {
          "--app-top-chrome-center-offset": "0px",
        } as React.CSSProperties
      }
    >
      <div className="flex items-center gap-0.5">
        <TopChromeSidebarTrigger />
        <Button
          aria-label="Go back"
          className={HISTORY_ICON_BUTTON_CLASS}
          data-testid="global-back"
          disabled={!canGoBack}
          onClick={onGoBack}
          size="icon"
          variant="ghost"
        >
          <ChevronLeft />
        </Button>
        <Button
          aria-label="Go forward"
          className={HISTORY_ICON_BUTTON_CLASS}
          data-testid="global-forward"
          disabled={!canGoForward}
          onClick={onGoForward}
          size="icon"
          variant="ghost"
        >
          <ChevronRight />
        </Button>
      </div>
      <div
        className="flex min-w-0 flex-1 items-center"
        data-tauri-drag-region
        id="app-top-chrome-content"
      />
    </div>
  );
}
