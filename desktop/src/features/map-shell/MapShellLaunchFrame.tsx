import "@/features/cofounder/ui/companyMap/companyMap.css";

export function MapShellLaunchFrame() {
  return (
    <main
      aria-busy="true"
      className="company-map-page min-h-0 flex-1"
      data-testid="map-shell-launch-frame"
    >
      <span className="sr-only" role="status">
        Loading company map
      </span>
      <div aria-hidden="true" className="company-map-desktop min-h-0">
        <div className="company-map-scroll min-h-0" />
      </div>
    </main>
  );
}
