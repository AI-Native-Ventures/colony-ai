import * as React from "react";

import { cn } from "@/shared/lib/cn";

type SegmentOption<Value extends string> = {
  value: Value;
  label: string;
  Icon?: React.ComponentType<{ className?: string }>;
};

type SegmentedControlSize = "compact" | "default" | "wide";

const SIZE_CLASSES: Record<SegmentedControlSize, string> = {
  compact: "w-48",
  default: "w-60",
  wide: "w-72",
};

/** A mutually exclusive control with equal-width, optionally scrubbable options. */
export function SegmentedControl<Value extends string>({
  className,
  disabled = false,
  indicatorTestId,
  legend,
  onPreviewChange,
  onValueChange,
  optionTestIdPrefix,
  options,
  size = "default",
  testId,
  value,
}: {
  className?: string;
  disabled?: boolean;
  indicatorTestId?: string;
  legend: string;
  onPreviewChange?: (value: Value | null) => void;
  onValueChange: (value: Value) => void;
  optionTestIdPrefix: string;
  options: readonly SegmentOption<Value>[];
  size?: SegmentedControlSize;
  testId: string;
  value: Value;
}) {
  const [previewValue, setPreviewValue] = React.useState<Value | null>(null);
  const controlRef = React.useRef<HTMLFieldSetElement | null>(null);
  const activePointerIdRef = React.useRef<number | null>(null);
  const pointerStartXRef = React.useRef<number | null>(null);
  const pointerStartValueRef = React.useRef<Value | null>(null);
  const scrubValueRef = React.useRef<Value | null>(null);
  const skipPointerClickRef = React.useRef(false);
  const displayedValue = previewValue ?? value;
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === displayedValue),
  );

  const getValueAtPointer = React.useCallback(
    (element: HTMLFieldSetElement, clientX: number): Value => {
      const bounds = element.getBoundingClientRect();
      const position = Math.max(
        0,
        Math.min(bounds.width - 1, clientX - bounds.left),
      );
      const index = Math.min(
        options.length - 1,
        Math.floor((position / bounds.width) * options.length),
      );
      return options[index]?.value ?? value;
    },
    [options, value],
  );

  const preview = React.useCallback(
    (nextValue: Value | null) => {
      scrubValueRef.current = nextValue;
      setPreviewValue(nextValue);
      onPreviewChange?.(nextValue);
    },
    [onPreviewChange],
  );

  const cancelScrub = React.useCallback(() => {
    const control = controlRef.current;
    const pointerId = activePointerIdRef.current;
    activePointerIdRef.current = null;
    if (control && pointerId != null && control.hasPointerCapture(pointerId)) {
      control.releasePointerCapture(pointerId);
    }
    pointerStartXRef.current = null;
    pointerStartValueRef.current = null;
    skipPointerClickRef.current = false;
    preview(null);
  }, [preview]);

  React.useEffect(() => {
    const handleWindowBlur = () => cancelScrub();
    globalThis.addEventListener?.("blur", handleWindowBlur);
    return () => {
      globalThis.removeEventListener?.("blur", handleWindowBlur);
      cancelScrub();
    };
  }, [cancelScrub]);

  const handlePointerDown = (
    event: React.PointerEvent<HTMLFieldSetElement>,
  ) => {
    if (!onPreviewChange || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    activePointerIdRef.current = event.pointerId;
    pointerStartXRef.current = event.clientX;
    pointerStartValueRef.current = getValueAtPointer(
      event.currentTarget,
      event.clientX,
    );
    scrubValueRef.current = null;
    skipPointerClickRef.current = true;
    event.preventDefault();
  };

  const handlePointerMove = (
    event: React.PointerEvent<HTMLFieldSetElement>,
  ) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const nextValue = getValueAtPointer(event.currentTarget, event.clientX);
    const pointerStartX = pointerStartXRef.current;
    const pointerStartValue = pointerStartValueRef.current;
    const crossedDragThreshold =
      pointerStartX != null && Math.abs(event.clientX - pointerStartX) >= 4;
    if (
      scrubValueRef.current == null &&
      !crossedDragThreshold &&
      nextValue === pointerStartValue
    ) {
      return;
    }
    if (nextValue !== scrubValueRef.current) preview(nextValue);
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLFieldSetElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const nextValue = getValueAtPointer(event.currentTarget, event.clientX);
    activePointerIdRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
    pointerStartXRef.current = null;
    pointerStartValueRef.current = null;
    onValueChange(nextValue);
    preview(null);
    globalThis.setTimeout(() => {
      skipPointerClickRef.current = false;
    }, 0);
  };

  const handlePointerCancel = () => cancelScrub();

  const handleLostPointerCapture = () => {
    if (activePointerIdRef.current != null) cancelScrub();
  };

  return (
    <fieldset
      className={cn(
        "relative isolate h-9.5 max-w-full shrink-0 overflow-hidden rounded-colony-control-lg bg-colony-track p-[3px]",
        SIZE_CLASSES[size],
        onPreviewChange && "touch-none select-none cursor-ew-resize",
        "disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      data-slot="segmented-control"
      data-testid={testId}
      disabled={disabled}
      onLostPointerCapture={handleLostPointerCapture}
      onPointerCancel={handlePointerCancel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      ref={controlRef}
    >
      <legend className="sr-only">{legend}</legend>
      <div
        aria-hidden="true"
        className={cn(
          "absolute bottom-[3px] left-[3px] top-[3px] z-0 rounded-[9px] bg-white shadow-[0_1px_2px_rgba(60,40,80,0.12)] transition-transform duration-200 ease-in-out motion-reduce:transition-none",
          previewValue && "duration-0",
        )}
        data-testid={indicatorTestId ?? `${testId}-indicator`}
        style={{
          transform: `translateX(${selectedIndex * 100}%)`,
          width: `calc((100% - 0.375rem) / ${options.length})`,
        }}
      />
      {/* Legends escape grid/flex layout on a fieldset, so the columns live
          on an inner wrapper the legend is not part of. */}
      <div className="grid h-full auto-cols-fr grid-flow-col">
        {options.map(({ value: optionValue, label, Icon }) => (
          <button
            aria-pressed={value === optionValue}
            className={cn(
              "relative z-10 flex h-full items-center justify-center gap-1.5 rounded-[9px] bg-transparent px-3 text-xs font-semibold transition-colors duration-150 ease-out focus-visible:outline-2 focus-visible:outline-colony-accent motion-reduce:transition-none",
              displayedValue === optionValue
                ? "font-extrabold text-colony-fg"
                : "text-colony-fg-secondary hover:text-colony-fg",
            )}
            data-testid={`${optionTestIdPrefix}-${optionValue}`}
            key={optionValue}
            onClick={(event) => {
              if (event.detail > 0 && skipPointerClickRef.current) {
                skipPointerClickRef.current = false;
                return;
              }
              onValueChange(optionValue);
            }}
            type="button"
          >
            {Icon ? <Icon className="h-3.5 w-3.5" /> : null}
            {label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
