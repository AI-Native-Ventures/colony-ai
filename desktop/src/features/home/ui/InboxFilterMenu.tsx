import { ChevronDown } from "lucide-react";

import type { InboxFilter } from "@/features/home/lib/inbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";

/** The filters Activity offers, in the order the design lists them. */
export const INBOX_FILTER_OPTIONS: Array<{
  label: string;
  value: InboxFilter;
}> = [
  { value: "all", label: "All" },
  { value: "mention", label: "Mentions" },
  { value: "needs_action", label: "Needs action" },
  { value: "thread", label: "Threads" },
  { value: "agent_activity", label: "Agents" },
  { value: "drafts", label: "Drafts" },
];

type InboxFilterMenuProps = {
  activeDraftCount: number;
  filter: InboxFilter;
  onFilterChange: (value: InboxFilter) => void;
};

/** The "All activity" button: the same filters as the chips, as a menu. */
export function InboxFilterMenu({
  activeDraftCount,
  filter,
  onFilterChange,
}: InboxFilterMenuProps) {
  const activeFilter = INBOX_FILTER_OPTIONS.find(
    (option) => option.value === filter,
  );
  const statusLabel =
    activeDraftCount > 0
      ? `${activeDraftCount} active draft${activeDraftCount === 1 ? "" : "s"}`
      : null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label={`Filter inbox: ${activeFilter?.label ?? "All"}${statusLabel ? `. ${statusLabel}` : ""}`}
          className="ca-filter-button"
          data-testid="inbox-filter-trigger"
          type="button"
        >
          <span>
            {filter === "all" ? "All activity" : (activeFilter?.label ?? "All")}
          </span>
          <ChevronDown aria-hidden="true" size={14} strokeWidth={2.4} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuRadioGroup
          onValueChange={(value) => onFilterChange(value as InboxFilter)}
          value={filter}
        >
          {INBOX_FILTER_OPTIONS.map((option) => (
            <div key={option.value}>
              {option.value === "drafts" ? (
                <DropdownMenuSeparator className="my-2 bg-border/60" />
              ) : null}
              <DropdownMenuRadioItem value={option.value}>
                <span className="flex flex-1 items-center gap-2">
                  <span>
                    {option.value === "all" ? "All activity" : option.label}
                  </span>
                  <span className="ml-auto flex items-center gap-1.5">
                    {option.value === "drafts" && activeDraftCount > 0 ? (
                      <span
                        className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-2xs font-semibold leading-none text-primary-foreground"
                        data-testid="inbox-draft-badge-option"
                      >
                        {activeDraftCount}
                      </span>
                    ) : null}
                  </span>
                </span>
              </DropdownMenuRadioItem>
            </div>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type InboxFilterChipsProps = {
  activeDraftCount: number;
  filter: InboxFilter;
  onFilterChange: (value: InboxFilter) => void;
};

/** The chip row under the title: one tap to a filter. */
export function InboxFilterChips({
  activeDraftCount,
  filter,
  onFilterChange,
}: InboxFilterChipsProps) {
  return (
    <div aria-label="Filter activity" className="ca-chips" role="tablist">
      {INBOX_FILTER_OPTIONS.map((option) => (
        <button
          aria-selected={filter === option.value}
          className="ca-chip"
          data-testid={`inbox-chip-${option.value}`}
          key={option.value}
          onClick={() => onFilterChange(option.value)}
          role="tab"
          type="button"
        >
          {option.label}
          {option.value === "drafts" && activeDraftCount > 0 ? (
            <span
              className="ca-chip-count"
              data-testid="inbox-draft-chip-count"
            >
              {activeDraftCount}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}
