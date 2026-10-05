import * as React from "react";

import { cn } from "@/shared/lib/cn";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";

export type BotActivityDetailEntry = {
  label: string;
  detail: string;
};

type BotActivityDetailsProps = {
  entries: BotActivityDetailEntry[];
};

/**
 * Opt-in disclosure for the raw commands behind the plain activity label.
 * Collapsed by default and never persisted. The raw text only exists in the
 * DOM while it is open, and never in a title or aria-label.
 */
export function BotActivityDetails({ entries }: BotActivityDetailsProps) {
  const [open, setOpen] = React.useState(false);

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "ml-2 shrink-0 rounded-sm text-xs text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring data-[state=open]:text-foreground",
          )}
          data-testid="bot-activity-details-trigger"
          type="button"
        >
          {open ? "Hide details" : "Show details"}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        aria-label="Activity details"
        className="w-[min(32rem,calc(100vw-2rem))] p-2"
        data-testid="bot-activity-details"
        side="top"
        sideOffset={8}
      >
        <ul className="flex max-h-60 flex-col gap-2 overflow-y-auto">
          {entries.map((entry) => (
            <li className="flex flex-col gap-1" key={entry.detail}>
              <span className="text-xs font-medium text-muted-foreground">
                {entry.label}
              </span>
              <code className="whitespace-pre-wrap break-all rounded-md bg-muted px-2 py-1 font-mono text-xs text-foreground">
                {entry.detail}
              </code>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
