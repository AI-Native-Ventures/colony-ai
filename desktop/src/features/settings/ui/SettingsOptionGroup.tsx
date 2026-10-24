import type * as React from "react";

import { cn } from "@/shared/lib/cn";

/**
 * A card of settings with an optional small title above its rows. Settings
 * pages that have not moved to `SettingsKit` still compose these; they draw
 * the same card.
 */
export function SettingsOptionGroup({
  children,
  className,
  description,
  headerAction,
  surface = "framed",
  title,
  ...props
}: Omit<React.HTMLAttributes<HTMLDivElement>, "title"> & {
  description?: React.ReactNode;
  headerAction?: React.ReactNode;
  surface?: "framed" | "soft";
  title?: React.ReactNode;
}) {
  const hasHeader = Boolean(title || description || headerAction);

  return (
    <div className={cn("cs-group", className)} {...props}>
      {hasHeader ? (
        <div className="cs-group-head" data-slot="settings-section-header">
          <div className="min-w-0 flex-1">
            {title ? <h2 className="cs-eyebrow">{title}</h2> : null}
            {description ? <p className="cs-help">{description}</p> : null}
          </div>
          {headerAction ? <div className="shrink-0">{headerAction}</div> : null}
        </div>
      ) : null}
      <div
        className="cs-card cs-group-card"
        data-slot="settings-section-card"
        data-surface={surface}
      >
        {children}
      </div>
    </div>
  );
}

export function SettingsOptionGroupList({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("cs-stack", className)}
      data-slot="settings-section-list"
      {...props}
    />
  );
}

export function SettingsOptionRow({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("cs-row", className)} {...props} />;
}
