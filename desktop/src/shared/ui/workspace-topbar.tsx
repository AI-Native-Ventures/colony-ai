import type * as React from "react";
import { cn } from "@/shared/lib/cn";

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
      <div className="colony-workspace-topbar-title">{children}</div>
      <div className="colony-workspace-topbar-actions">{actions}</div>
    </header>
  );
}
