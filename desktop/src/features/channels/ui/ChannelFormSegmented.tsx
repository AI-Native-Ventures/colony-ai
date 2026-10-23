import type * as React from "react";

import { cn } from "@/shared/lib/cn";

type SegmentOption<Value extends string> = {
  Icon?: React.ComponentType<{ className?: string; size?: number }>;
  label: string;
  value: Value;
};

/**
 * The compact two-way switch in the Edit channel card: a #F3EFF4 track with a
 * white selected tab, each tab carrying a 15px glyph. One tab per option.
 */
export function ChannelFormSegmented<Value extends string>({
  disabled,
  legend,
  onValueChange,
  optionTestIdPrefix,
  options,
  testId,
  value,
}: {
  disabled?: boolean;
  legend: string;
  onValueChange: (value: Value) => void;
  optionTestIdPrefix: string;
  options: readonly SegmentOption<Value>[];
  testId: string;
  value: Value;
}) {
  return (
    <fieldset
      className="m-0 flex min-w-0 shrink-0 gap-0.5 rounded-[0.6875rem] border-0 bg-colony-track p-[3px]"
      data-testid={testId}
      disabled={disabled}
    >
      <legend className="sr-only">{legend}</legend>
      {options.map(({ Icon, label, value: optionValue }) => {
        const selected = optionValue === value;
        return (
          <button
            aria-pressed={selected}
            className={cn(
              "inline-flex h-[2.125rem] items-center gap-1.5 rounded-[0.5625rem] px-3 text-chip transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-colony-accent/40 disabled:cursor-not-allowed disabled:opacity-50",
              selected
                ? "bg-colony-pop font-extrabold text-colony-fg shadow-[0_1px_3px_rgba(40,20,60,0.12)]"
                : "font-bold text-colony-fg-secondary hover:text-colony-fg",
            )}
            data-testid={`${optionTestIdPrefix}-${optionValue}`}
            disabled={disabled}
            key={optionValue}
            onClick={() => onValueChange(optionValue)}
            type="button"
          >
            {Icon ? <Icon size={15} /> : null}
            {label}
          </button>
        );
      })}
    </fieldset>
  );
}
