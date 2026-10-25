import type { ReactNode } from "react";

export function ContentSurface({
  children,
  terminal,
  topChrome,
}: {
  children: ReactNode;
  terminal?: ReactNode;
  topChrome?: ReactNode;
}) {
  return (
    <div
      className="relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden bg-background"
      data-buzz-content-surface
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
