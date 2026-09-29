import * as React from "react";

import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";

export type CompanyWorkFilterOption = {
  id: string;
  label: string;
  group?: string;
  description?: string;
  searchTerms?: string;
};

type CompanyWorkFilterPopoverProps = {
  label: "Owner" | "Goal";
  value: string | null;
  emptyLabel: string;
  options: CompanyWorkFilterOption[];
  onChange: (value: string | null) => void;
  disabled?: boolean;
  unavailableMessage?: string;
  testId: string;
};

export function CompanyWorkFilterPopover({
  label,
  value,
  emptyLabel,
  options,
  onChange,
  disabled = false,
  unavailableMessage,
  testId,
}: CompanyWorkFilterPopoverProps) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const optionRefs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const selected = options.find((option) => option.id === value);
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const visibleOptions = options.filter((option) =>
    `${option.label} ${option.searchTerms ?? ""} ${option.group ?? ""}`
      .toLocaleLowerCase()
      .includes(normalizedSearch),
  );

  React.useEffect(() => {
    if (open) setSearch("");
  }, [open]);

  const closeAndRestoreFocus = () => {
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const focusOption = (index: number) => {
    if (visibleOptions.length === 0) return;
    const nextIndex = (index + visibleOptions.length) % visibleOptions.length;
    optionRefs.current[nextIndex]?.focus();
  };

  const renderOptions = () => {
    let previousGroup: string | undefined;
    return visibleOptions.map((option, index) => {
      const showGroup = option.group !== previousGroup;
      previousGroup = option.group;
      return (
        <React.Fragment key={option.id}>
          {showGroup && option.group ? (
            <p
              className="px-2 pb-1 pt-2 text-2xs font-medium text-muted-foreground"
              role="presentation"
            >
              {option.group}
            </p>
          ) : null}
          <button
            aria-selected={option.id === value}
            className="flex min-h-9 w-full flex-col items-start justify-center rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-muted focus-visible:bg-muted focus-visible:ring-1 focus-visible:ring-ring"
            data-testid={`${testId}-option-${option.id || "all"}`}
            onClick={() => {
              onChange(option.id || null);
              closeAndRestoreFocus();
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                focusOption(index + 1);
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                focusOption(index - 1);
              } else if (event.key === "Home") {
                event.preventDefault();
                focusOption(0);
              } else if (event.key === "End") {
                event.preventDefault();
                focusOption(visibleOptions.length - 1);
              } else if (event.key === "Escape") {
                event.preventDefault();
                closeAndRestoreFocus();
              }
            }}
            ref={(element) => {
              optionRefs.current[index] = element;
            }}
            role="option"
            type="button"
          >
            <span>{option.label}</span>
            {option.description ? (
              <span className="text-xs text-muted-foreground">
                {option.description}
              </span>
            ) : null}
          </button>
        </React.Fragment>
      );
    });
  };

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <Button
          aria-expanded={open}
          aria-haspopup="listbox"
          className="h-11 justify-start gap-3 rounded-lg border border-input/40 bg-background px-4 text-sm font-normal"
          data-testid={testId}
          disabled={disabled}
          ref={triggerRef}
          variant="outline"
        >
          <span className="text-muted-foreground">{label}</span>
          <span className="max-w-[22rem] truncate font-medium text-foreground">
            {selected?.label ?? emptyLabel}
          </span>
          <span aria-hidden="true" className="ml-auto text-muted-foreground">
            ⌄
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[min(24rem,calc(100vw-2rem))] p-2"
        onEscapeKeyDown={closeAndRestoreFocus}
      >
        <Input
          aria-label={`Search ${label.toLocaleLowerCase()}s`}
          autoFocus
          className="mb-2"
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              focusOption(0);
            } else if (event.key === "Escape") {
              event.preventDefault();
              closeAndRestoreFocus();
            }
          }}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={`Search ${label.toLocaleLowerCase()}s`}
          value={search}
        />
        {unavailableMessage ? (
          <div
            className="px-2 py-3 text-sm text-muted-foreground"
            role="status"
          >
            {unavailableMessage}
          </div>
        ) : visibleOptions.length > 0 ? (
          <div
            aria-label={`${label} options`}
            className="max-h-72 overflow-y-auto"
            data-testid={`${testId}-options`}
            role="listbox"
          >
            {renderOptions()}
          </div>
        ) : (
          <p className="px-2 py-3 text-sm text-muted-foreground" role="status">
            No {label.toLocaleLowerCase()}s found.
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
