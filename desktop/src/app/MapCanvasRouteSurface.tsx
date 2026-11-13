import * as React from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";

import {
  companyMapWindowJobForRoute,
  type CompanyMapWindowJob,
} from "@/features/cofounder/companyMapJobRoutes";
import { FUNCTION_DETAILS } from "@/features/cofounder/functions";
import { CompanyMapScreen } from "@/features/cofounder/ui/CompanyMapScreen";

import "./MapCanvasRouteSurface.css";

type MapCanvasRouteSurfaceProps = {
  children: React.ReactNode;
  enabled: boolean;
};

function isMapHome(pathname: string): boolean {
  return pathname === "/" || pathname === "/company/map";
}

function MapCanvasWindow({
  children,
  job,
  onClose,
}: {
  children: React.ReactNode;
  job: CompanyMapWindowJob;
  onClose: () => void;
}) {
  const partName = FUNCTION_DETAILS[job.functionId].name;
  return (
    <section
      aria-label={`${partName}, ${job.jobName}`}
      className="map-canvas-route-window"
      data-function={job.functionId}
      data-testid="fullmap-window"
    >
      <span aria-hidden="true" className="map-canvas-route-connector" />
      <button
        aria-label="Close map screen"
        className="map-canvas-route-close"
        data-testid="fullmap-window-close"
        onClick={onClose}
        type="button"
      >
        <span aria-hidden="true">×</span>
      </button>
      <div className="map-canvas-route-window-content">{children}</div>
    </section>
  );
}

/** Keeps the map mounted while one supported existing job screen is open. */
export function MapCanvasRouteSurface({
  children,
  enabled,
}: MapCanvasRouteSurfaceProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const search = location.search as Record<string, unknown>;
  const job = enabled
    ? companyMapWindowJobForRoute(location.pathname, search)
    : null;
  const active = enabled && (isMapHome(location.pathname) || job !== null);
  const closeWindow = React.useCallback(() => {
    void navigate({ to: "/", replace: true });
  }, [navigate]);

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
      closeWindow();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeWindow, job]);

  if (!active) return <>{children}</>;

  return (
    <div
      className="map-canvas-route-surface"
      data-window-open={job ? "true" : undefined}
      data-testid="fullmap-canvas-route-surface"
    >
      <div
        aria-hidden={job ? true : undefined}
        className="map-canvas-route-background"
        inert={job ? true : undefined}
      >
        <CompanyMapScreen mapWindowJob={job} onMapWindowClose={closeWindow} />
      </div>
      {job ? (
        <>
          <button
            aria-label="Fit the whole company"
            className="map-canvas-route-fit"
            data-testid="fullmap-window-fit"
            onClick={closeWindow}
            type="button"
          >
            Fit
          </button>
          <MapCanvasWindow job={job} onClose={closeWindow}>
            {children}
          </MapCanvasWindow>
        </>
      ) : null}
    </div>
  );
}
