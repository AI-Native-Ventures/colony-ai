import type * as React from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { useAppShell } from "@/app/AppShellContext";
import { cn } from "@/shared/lib/cn";

function NavigationHistoryControls() {
  const { navigationHistory } = useAppShell();

  return (
    <nav aria-label="Navigation history" className="colony-workspace-history">
      <button
        aria-label="Go back"
        data-testid="global-back"
        disabled={!navigationHistory.canGoBack}
        onClick={navigationHistory.goBack}
        title="Back"
        type="button"
      >
        <ArrowLeft aria-hidden="true" />
      </button>
      <button
        aria-label="Go forward"
        data-testid="global-forward"
        disabled={!navigationHistory.canGoForward}
        onClick={navigationHistory.goForward}
        title="Forward"
        type="button"
      >
        <ArrowRight aria-hidden="true" />
      </button>
    </nav>
  );
}

/** Shared title and action frame for the redesigned workspace routes. */
export function WorkspaceTopBar({
  actions,
  children,
  className,
}: {
  actions: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("colony-workspace-topbar", className)}>
      <div className="colony-workspace-topbar-title">
        <NavigationHistoryControls />
        {children}
      </div>
      <div className="colony-workspace-topbar-actions">{actions}</div>
    </header>
  );
}
