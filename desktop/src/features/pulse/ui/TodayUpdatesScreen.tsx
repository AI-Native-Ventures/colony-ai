import * as React from "react";

const PulseScreen = React.lazy(async () => {
  const module = await import("@/features/pulse/ui/PulseScreen");
  return { default: module.PulseScreen };
});

export function TodayUpdatesScreen() {
  return (
    <div className="colony-today-updates" data-testid="today-team-updates">
      <React.Suspense fallback={null}>
        <PulseScreen layout="today-updates" />
      </React.Suspense>
    </div>
  );
}
