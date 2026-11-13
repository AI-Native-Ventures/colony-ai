import * as React from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";

import {
  companyMapWindowJobForRoute,
  type CompanyMapWindowJob,
} from "@/features/cofounder/companyMapJobRoutes";
import { FUNCTION_DETAILS } from "@/features/cofounder/functions";
import { CompanyMapScreen } from "@/features/cofounder/ui/CompanyMapScreen";
import { EmployeeAvatar } from "@/features/company-team/ui/EmployeeAvatar";

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
      <span
        aria-hidden="true"
        className="map-canvas-route-job-ring"
        data-testid="fullmap-window-job-ring"
      >
        <EmployeeAvatar
          className="map-canvas-route-job-avatar"
          name={job.jobName}
        />
      </span>
      <button
        aria-label="Close map screen"
        className="map-canvas-route-close"
        data-testid="fullmap-window-close"
        onClick={onClose}
        type="button"
      >
        <svg
          aria-hidden="true"
          fill="none"
          height="18"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="2.4"
          viewBox="0 0 24 24"
          width="18"
        >
          <path d="m6 6 12 12M18 6 6 18" />
        </svg>
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
      <div className="map-canvas-route-background">
        <CompanyMapScreen mapWindowJob={job} onMapWindowClose={closeWindow} />
      </div>
      {job ? (
        <MapCanvasWindow job={job} onClose={closeWindow}>
          {children}
        </MapCanvasWindow>
      ) : null}
    </div>
  );
}
