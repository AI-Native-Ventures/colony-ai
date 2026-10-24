import type * as React from "react";

/**
 * The full-height frame the app shell renders inside. The class names and
 * data attributes are the hooks the shell stylesheets (glass background,
 * sidebar field, chrome) already select on, so they stay as they are.
 */
export function AppShellFrame({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div
      className="buzz-huddle-shell relative h-dvh overflow-hidden overscroll-none"
      data-huddle-open={false}
      data-huddle-window={false}
    >
      <div className="buzz-huddle-app-surface z-10 flex min-h-0 flex-row overflow-hidden bg-background">
        {children}
      </div>
    </div>
  );
}
