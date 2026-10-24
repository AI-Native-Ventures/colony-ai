/**
 * Test-only showcase of the Business records board: the empty, loading, error
 * and unavailable states, built from the app's real state components. It is
 * mounted instead of the app when the E2E bridge asks for
 * `showcase: "colony3-business-states"`, so the board can be compared with the
 * components themselves. It is never part of a production build.
 */
import * as React from "react";
import ReactDOM from "react-dom/client";

import {
  RetryIcon,
  StateAlert,
  StateButton,
  StateCard,
  StateGroup,
  StateIcons,
  StateLoading,
  StateNote,
} from "@/features/clients/ui/BusinessStates";
import { ThemeProvider } from "@/shared/theme/ThemeProvider";
import { TooltipProvider } from "@/shared/ui/tooltip";

import "@/features/clients/ui/colony3-business.css";

function Retry() {
  return (
    <StateButton>
      <RetryIcon />
      Retry
    </StateButton>
  );
}

function Column({
  children,
  title,
}: {
  children: React.ReactNode;
  title: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <h2 className="b3-eyebrow m-0">{title}</h2>
      {children}
    </div>
  );
}

function BusinessStatesBoard() {
  return (
    <div
      className="b3-page"
      data-testid="colony3-business-states"
      style={{
        height: "calc(895 * var(--b3u))",
        width: "calc(1160 * var(--b3u))",
      }}
    >
      <div
        className="flex flex-col"
        style={{
          gap: "calc(18 * var(--b3u))",
          padding:
            "calc(24 * var(--b3u)) calc(32 * var(--b3u)) calc(28 * var(--b3u))",
        }}
      >
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
          <h1 className="b3-title m-0">Business records</h1>
          <span className="b3-subtitle">
            Empty, loading and unavailable states
          </span>
        </div>
        <div
          className="grid items-start"
          style={{
            gap: "calc(20 * var(--b3u))",
            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          }}
        >
          <Column title="Empty">
            <StateCard
              actions={
                <StateButton variant="primary">Explore Discovery</StateButton>
              }
              body="Find a business that could benefit from your service, or add a lead yourself."
              eyebrow="Leads"
              icon={StateIcons.addPerson}
              title="No leads yet"
              tone="accent"
            />
            <StateCard
              actions={<StateButton>Clear filters</StateButton>}
              body="Try a different name, location or stage."
              eyebrow="Leads · filtered"
              icon={StateIcons.filter}
              title="No leads match these filters."
            />
            <StateGroup eyebrow="Clients" label="Clients, empty">
              <StateNote>
                No client records are available in this business.
              </StateNote>
            </StateGroup>
          </Column>
          <Column title="Loading and errors">
            <StateGroup
              eyebrow="Sales · Clients · Money"
              gap={8}
              label="Loading"
            >
              <StateLoading>Loading business records</StateLoading>
              <StateLoading>Loading clients</StateLoading>
              <StateLoading>Loading money records</StateLoading>
            </StateGroup>
            <StateCard
              actions={<Retry />}
              body="Business records could not be loaded. Retry when the connection is available."
              eyebrow="Sales · Clients · Money"
              icon={StateIcons.offline}
              role="alert"
              title="Connection unavailable"
              tone="bad"
            />
            <StateCard
              actions={<Retry />}
              body="A private Sales stream is not available for business records."
              eyebrow="Sales · Clients · Money"
              icon={StateIcons.lock}
              role="alert"
              title="Business records unavailable"
              tone="bad"
            />
            <StateGroup eyebrow="Clients" gap={8} label="Clients, errors">
              <StateAlert>Client channels could not be loaded.</StateAlert>
              <StateAlert>Live client updates could not be started.</StateAlert>
              <StateAlert>Client records could not be loaded.</StateAlert>
            </StateGroup>
          </Column>
          <Column title="Unavailable">
            <StateCard
              actions={<Retry />}
              body="Return to the business routes and choose a record."
              eyebrow="Any business route"
              icon={StateIcons.missing}
              role="alert"
              title="Record unavailable"
            />
            <StateCard
              actions={<StateButton>All leads</StateButton>}
              body="Return to the result list and try another profile."
              eyebrow="Lead"
              icon={StateIcons.blocked}
              title="This prospect is unavailable."
            />
            <StateGroup eyebrow="Client" label="Client, unavailable">
              <StateAlert size="lg">
                This client is unavailable to the current identity in this
                business.
              </StateAlert>
              <div className="flex">
                <StateButton>All clients</StateButton>
              </div>
            </StateGroup>
          </Column>
        </div>
      </div>
    </div>
  );
}

export function renderBusinessStatesShowcase() {
  const root = document.getElementById("root");
  if (!root) return;
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <ThemeProvider defaultTheme="buzz">
        <TooltipProvider>
          <BusinessStatesBoard />
        </TooltipProvider>
      </ThemeProvider>
    </React.StrictMode>,
  );
}
