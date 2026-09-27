import * as React from "react";
import { Search } from "lucide-react";
import { createFileRoute } from "@tanstack/react-router";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { TodayTopBar } from "@/features/home/ui/TodayScreen";
import { TodayUpdatesScreen } from "@/features/pulse/ui/TodayUpdatesScreen";

export const Route = createFileRoute("/today/updates")({
  component: TodayUpdatesRoute,
});

function TodayUpdatesRoute() {
  const { goHome, goToday } = useAppNavigation();
  const openSearch = React.useCallback(() => {
    document
      .querySelector<HTMLButtonElement>('[data-testid="open-search"]')
      ?.click();
  }, []);

  return (
    <div className="colony-updates-route" data-testid="today-updates-route">
      <TodayTopBar onOpenInbox={() => void goHome()} />
      <header className="colony-updates-heading">
        <h1 className="text-xl font-semibold tracking-tight">Today</h1>
      </header>
      <nav aria-label="Today sections" className="colony-updates-tabs">
        <button onClick={() => void goToday()} type="button">
          Focus
        </button>
        <span aria-current="page">Team updates</span>
      </nav>
      <div className="colony-updates-content">
        <div className="colony-updates-layout">
          <main className="colony-updates-primary">
            <React.Suspense fallback={null}>
              <TodayUpdatesScreen />
            </React.Suspense>
          </main>
          <aside
            aria-label="Team updates information"
            className="colony-updates-info"
          >
            <h2>Team updates</h2>
            <p>
              Decisions belong with the work. Use updates for progress,
              availability and useful context.
            </p>
            <button onClick={() => void goHome()} type="button">
              Open your Inbox <span aria-hidden="true">→</span>
            </button>
            <button onClick={openSearch} type="button">
              Find a conversation <Search aria-hidden="true" />
            </button>
          </aside>
        </div>
      </div>
    </div>
  );
}
