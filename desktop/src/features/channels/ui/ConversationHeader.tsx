import type * as React from "react";

import { UpdateIndicator } from "@/features/settings/UpdateIndicator";
import { cn } from "@/shared/lib/cn";

type ConversationHeaderProps = {
  /** Right-aligned controls (members, work area, search, settings). */
  actions?: React.ReactNode;
  /** Ref to the chrome wrapper; the timeline measures it to clear the header. */
  chromeWrapperRef?: React.Ref<HTMLDivElement>;
  description?: string;
  /** Join board: the description sits under the title, not beside it. */
  descriptionBelow?: boolean;
  leading?: React.ReactNode;
  statusBadge?: React.ReactNode;
  /** Direct messages: the line under the name (job title, who manages them). */
  subtitle?: React.ReactNode;
  /** Channel views (Discussion, Work, Knowledge, Canvas, Files). */
  tabs?: React.ReactNode;
  title: string;
  titleAdornment?: React.ReactNode;
};

/**
 * The Colony 3.0 conversation header: one row with the title, a short
 * description and the controls, and under it the channel views. Direct
 * messages have no views, so their row is taller and carries a subtitle.
 */
export function ConversationHeader({
  actions,
  chromeWrapperRef,
  description,
  descriptionBelow = false,
  leading,
  statusBadge,
  subtitle,
  tabs,
  title,
  titleAdornment,
}: ConversationHeaderProps) {
  const trimmedDescription = description?.trim() ?? "";
  const titleBlock = (
    <div
      className={cn(
        "c3c-header-title-block flex min-w-0 flex-1 items-center",
        subtitle || descriptionBelow ? "gap-3" : "gap-2.5",
      )}
    >
      {leading ? (
        <div className="flex shrink-0 items-center text-colony-fg">
          {leading}
        </div>
      ) : null}
      {subtitle ? (
        <div className="flex min-w-0 flex-col leading-[1.25]">
          <div className="flex min-w-0 items-center gap-1">
            <h1
              className="c3c-title min-w-0 truncate"
              data-testid="chat-title"
              title={trimmedDescription || undefined}
            >
              {title}
            </h1>
            {titleAdornment}
            {statusBadge}
          </div>
          <div className="c3c-subtitle min-w-0 truncate text-colony-muted">
            {subtitle}
          </div>
        </div>
      ) : (
        <div
          className={cn(
            "flex min-w-0",
            descriptionBelow
              ? "flex-col gap-0.5"
              : "flex-1 items-baseline gap-2.5",
          )}
        >
          <div className="flex min-w-0 max-w-full shrink-0 items-center gap-2.5">
            <h1
              className="c3c-title min-w-0 truncate"
              data-testid="chat-title"
              title={trimmedDescription || undefined}
            >
              {title}
            </h1>
            {titleAdornment}
            {statusBadge}
          </div>
          {trimmedDescription ? (
            <p
              className={cn(
                "c3c-description min-w-0 truncate text-colony-muted",
                descriptionBelow && "c3c-subtitle",
              )}
              data-testid="chat-description"
            >
              {trimmedDescription}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );

  return (
    <div
      className="pointer-events-none relative z-40 -mb-(--buzz-channel-content-top-padding,5.75rem) overflow-visible"
      ref={chromeWrapperRef}
    >
      <header
        className={cn(
          "c3c-header pointer-events-auto relative z-30 flex min-w-0 shrink-0 cursor-default select-none border-b border-colony-border bg-colony-surface px-7",
          tabs
            ? "flex-col gap-3 pt-4"
            : "min-h-[calc(72*var(--colony-px))] flex-wrap items-center gap-3 py-3",
        )}
        data-testid="chat-header"
        data-tauri-drag-region
      >
        {tabs ? (
          <>
            <div className="c3c-header-primary-row flex min-w-0 items-center gap-3.5">
              {titleBlock}
              <div className="c3c-header-actions ml-auto flex items-center gap-1">
                <UpdateIndicator />
                {actions}
              </div>
            </div>
            {tabs}
          </>
        ) : (
          <>
            {titleBlock}
            <div className="c3c-header-actions ml-auto flex items-center gap-1">
              <UpdateIndicator />
              {actions}
            </div>
          </>
        )}
      </header>
    </div>
  );
}
