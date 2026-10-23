import type { ReactNode } from "react";

export function ContentSurface({
  children,
  unframed = false,
  terminal,
  topChrome,
}: {
  children: ReactNode;
  terminal?: ReactNode;
  topChrome?: ReactNode;
  /** Used by dedicated huddle windows, which should not resemble app cards. */
  unframed?: boolean;
}) {
  return (
    <div
      className={
        unframed
          ? "relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden bg-background"
          : "relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden bg-background"
      }
      data-buzz-content-surface
      data-buzz-content-unframed={unframed ? true : undefined}
    >
      {topChrome}
      <div className="buzz-content-primary flex min-h-0 flex-1 flex-col overflow-hidden">
        {children}
      </div>
      <div className="buzz-terminal-dock-host" data-terminal-dock>
        {terminal}
      </div>
    </div>
  );
}
