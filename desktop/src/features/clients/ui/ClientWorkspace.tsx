import type { ReactNode } from "react";

import {
  StateAlert,
  StateLoading,
  StateNote,
} from "@/features/clients/ui/BusinessStates";

import "./colony3-business.css";

/**
 * The page frame shared by Clients, Client and Work: the scrolling area, the
 * centred (or full width) column and the title block. `header` replaces the
 * default title block for pages that carry their own (a client or work item).
 */
export function ClientWorkspace({
  action,
  children,
  gap = 22,
  header,
  subtitle,
  title,
  variant,
  wide = false,
}: {
  action?: ReactNode;
  children: ReactNode;
  gap?: 22 | 24;
  header?: ReactNode;
  subtitle?: ReactNode;
  title: ReactNode;
  variant?: "work-detail";
  wide?: boolean;
}) {
  return (
    <div className="b3-page">
      <div
        className="b3-frame"
        data-gap={gap}
        data-variant={variant}
        data-wide={wide}
      >
        {header ?? (
          <div className="b3-head">
            <div className="b3-head-copy">
              <h1 className="b3-title">{title}</h1>
              {subtitle ? (
                <span className="b3-subtitle">{subtitle}</span>
              ) : null}
            </div>
            {action ? <div className="b3-head-actions">{action}</div> : null}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

export function RecordMessage({
  children,
  kind = "quiet",
}: {
  children: ReactNode;
  kind?: "quiet" | "error" | "loading";
}) {
  if (kind === "error") return <StateAlert>{children}</StateAlert>;
  if (kind === "loading") return <StateLoading>{children}</StateLoading>;
  return <StateNote>{children}</StateNote>;
}
