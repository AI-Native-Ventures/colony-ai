import { ChevronDown } from "lucide-react";

import { cn } from "@/shared/lib/cn";
import { Badge } from "@/shared/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";

import {
  HOME_LABELS,
  notCloudReadyMessage,
  workingOnLabel,
} from "./placementCopy";
import type { AgentPlacement, Home } from "./placementTypes";

export type AgentHomeSwitchProps = {
  name: string;
  placement: AgentPlacement;
  macLabel: string | null;
  cloudLabel: string;
  notCloudReady: boolean;
  /** The status badge text (`Asleep`, `Waking`, ...), or null. */
  status: string | null;
  pending: boolean;
  message: string | null;
  onChoose: (home: Home) => void;
  className?: string;
};

function statusVariant(status: AgentPlacement["status"]) {
  switch (status) {
    case "working":
      return "working" as const;
    case "failed":
      return "blocked" as const;
    case "outOfCredit":
      return "needs" as const;
    default:
      return "idle" as const;
  }
}

/**
 * The conversation header's "Working on: This Mac" menu (spec 5.5). One
 * button owns the label; the two homes are a radio group, so a screen reader
 * hears one control, then two choices with the current one checked. Opens with
 * Enter, Space or the arrow keys; Escape closes it.
 */
export function AgentHomeSwitch({
  name,
  placement,
  macLabel,
  cloudLabel,
  notCloudReady,
  status,
  pending,
  message,
  onChoose,
  className,
}: AgentHomeSwitchProps) {
  const cloudBlocked = notCloudReady && placement.home !== "cloud";
  return (
    <span
      className={cn("inline-flex min-w-0 items-center gap-2", className)}
      data-testid="agent-home-switch"
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="c3c-subtitle inline-flex items-center gap-1 rounded-md px-1 text-left hover:text-colony-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-colony-accent aria-busy:opacity-60"
            data-state-home={placement.home}
            data-testid="agent-home-trigger"
            aria-busy={pending || undefined}
            type="button"
          >
            {workingOnLabel(placement.home)}
            <ChevronDown aria-hidden="true" className="size-3.5 shrink-0" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="w-72"
          data-testid="agent-home-menu"
        >
          <DropdownMenuRadioGroup
            onValueChange={(value) => {
              if (value === "mac" || value === "cloud") onChoose(value);
            }}
            value={placement.home}
          >
            <DropdownMenuRadioItem
              data-testid="agent-home-option-mac"
              value="mac"
            >
              <span className="flex min-w-0 flex-col">
                <span className="text-sm">{HOME_LABELS.mac}</span>
                {macLabel ? (
                  <span className="text-xs text-muted-foreground">
                    {macLabel}
                  </span>
                ) : null}
              </span>
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem
              data-testid="agent-home-option-cloud"
              disabled={cloudBlocked}
              value="cloud"
            >
              <span className="flex min-w-0 flex-col">
                <span className="text-sm">{HOME_LABELS.cloud}</span>
                <span className="text-xs text-muted-foreground">
                  {cloudLabel}
                </span>
              </span>
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          {cloudBlocked ? (
            <p
              className="px-2 py-1.5 text-xs text-muted-foreground"
              data-testid="agent-home-not-ready"
            >
              {notCloudReadyMessage(name)}
            </p>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {status ? (
        <Badge
          className="h-6 px-2 text-2xs"
          data-testid="agent-home-status"
          variant={statusVariant(placement.status)}
        >
          {status}
        </Badge>
      ) : null}
      {message ? (
        <span
          className="text-xs text-colony-need"
          data-testid="agent-home-message"
          role="status"
        >
          {message}
        </span>
      ) : null}
    </span>
  );
}
