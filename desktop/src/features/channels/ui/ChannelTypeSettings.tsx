import { ChevronDown, ClockFading, Hash } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import {
  channelLifecycle,
  channelLifecycleLabel,
} from "@/features/channels/lib/channelLifecycle";
import {
  DEFAULT_EPHEMERAL_TTL_SECONDS,
  formatTtlDuration,
} from "@/features/channels/lib/ephemeralChannel";
import type { Channel } from "@/shared/api/types";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { SegmentedControl } from "@/shared/ui/segmented-control";
import { CHANNEL_FORM_LABEL_CLASS } from "./channelFormStyles";
import { ChannelFormSegmented } from "./ChannelFormSegmented";
import { ChevronDownGlyph, ClockDashedGlyph } from "./dialogIcons";
import { HashIcon } from "@/shared/ui/colonyIcons";
import { EditableInfoFieldRow } from "./ChannelManagementSheetRows";
import { ChannelTypePicker } from "./ChannelTypePicker";

const CHANNEL_TYPE_OPTIONS = [
  { value: "temporary", label: "Temporary", Icon: ClockFading },
  { value: "ongoing", label: "Ongoing", Icon: Hash },
] as const;

const CARD_TYPE_OPTIONS = [
  { value: "temporary", label: "Temporary", Icon: ClockDashedGlyph },
  { value: "ongoing", label: "Ongoing", Icon: HashIcon },
] as const;

const EPHEMERAL_TIMEOUT_OPTIONS = [
  { label: "30 minutes", seconds: 30 * 60 },
  { label: "1 hour", seconds: 60 * 60 },
  { label: "6 hours", seconds: 6 * 60 * 60 },
  { label: "12 hours", seconds: 12 * 60 * 60 },
  { label: "1 day", seconds: 24 * 60 * 60 },
  { label: "3 days", seconds: 3 * 24 * 60 * 60 },
  { label: "7 days", seconds: DEFAULT_EPHEMERAL_TTL_SECONDS },
  { label: "14 days", seconds: 14 * 24 * 60 * 60 },
  { label: "30 days", seconds: 30 * 24 * 60 * 60 },
] as const;

const CHANNEL_TYPE_RESIZE_TRANSITION = {
  duration: 0.22,
  ease: [0.23, 1, 0.32, 1],
} as const;

export function ChannelTypeDetailRow({
  canEdit,
  channel,
  onEdit,
}: {
  canEdit: boolean;
  channel: Channel;
  onEdit?: () => void;
}) {
  const lifecycle = channelLifecycle({
    temporary: channel.ttlSeconds !== null,
  });

  return (
    <EditableInfoFieldRow
      editTestId="channel-management-edit-channel-type"
      label="Channel type"
      onEdit={canEdit ? onEdit : undefined}
      testId="channel-management-type"
      value={channelLifecycleLabel(lifecycle, channel.ttlSeconds)}
    />
  );
}

export function ChannelTypeSettings({
  disabled,
  label = "Channel type",
  onOpenChange,
  onTemporaryChange,
  onTtlSecondsChange,
  open,
  temporary,
  testIdPrefix,
  ttlSeconds,
  variant = "dropdown",
}: {
  disabled?: boolean;
  label?: string;
  onOpenChange?: (open: boolean) => void;
  onTemporaryChange: (temporary: boolean) => void;
  onTtlSecondsChange: (ttlSeconds: number) => void;
  open?: boolean;
  temporary: boolean;
  testIdPrefix: string;
  ttlSeconds: number;
  variant?: "dropdown" | "segmented" | "form" | "card";
}) {
  const lifecycle = channelLifecycle({ temporary });
  const shouldReduceMotion = useReducedMotion();
  const channelTypeResizeTransition = shouldReduceMotion
    ? { duration: 0 }
    : CHANNEL_TYPE_RESIZE_TRANSITION;
  const selectedTimeoutOption = EPHEMERAL_TIMEOUT_OPTIONS.find(
    (option) => option.seconds === ttlSeconds,
  );
  const timeoutOptions = selectedTimeoutOption
    ? EPHEMERAL_TIMEOUT_OPTIONS
    : [
        {
          label: `Current (${formatTtlDuration(ttlSeconds)})`,
          seconds: ttlSeconds,
        },
        ...EPHEMERAL_TIMEOUT_OPTIONS,
      ];

  if (variant === "card") {
    return (
      <div
        className="rounded-colony-chip bg-colony-pop shadow-[0_0_0_1px_hsl(var(--colony-border-strong))]"
        data-testid={`${testIdPrefix}-channel-type-container`}
      >
        <div
          className="flex items-center justify-between gap-3 py-2.5 pl-3.5 pr-2.5"
          data-testid={`${testIdPrefix}-channel-type-row`}
        >
          <span
            className={cn("text-menu font-bold", disabled && "opacity-50")}
            id={`${testIdPrefix}-channel-type-label`}
          >
            {label}
          </span>
          <ChannelFormSegmented
            disabled={disabled}
            legend={label}
            onValueChange={(next) => onTemporaryChange(next === "temporary")}
            optionTestIdPrefix={`${testIdPrefix}-channel-type-option`}
            options={CARD_TYPE_OPTIONS}
            testId={`${testIdPrefix}-channel-type`}
            value={temporary ? "temporary" : "ongoing"}
          />
        </div>
        {temporary ? (
          <>
            <div className="mx-3.5 h-px bg-colony-border" />
            <div
              className="flex items-center justify-between gap-3 py-2 pl-3.5 pr-2"
              data-testid={`${testIdPrefix}-ephemeral-settings`}
            >
              <label
                className={cn("text-menu font-bold", disabled && "opacity-50")}
                htmlFor={`${testIdPrefix}-ttl`}
              >
                Expires after
              </label>
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                  <button
                    aria-label="Expires after"
                    className="inline-flex h-[2.375rem] items-center gap-2 rounded-[0.625rem] px-3 text-menu font-bold text-colony-fg transition-colors hover:bg-colony-track focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-colony-accent/40 disabled:opacity-50"
                    data-testid={`${testIdPrefix}-ttl`}
                    disabled={disabled}
                    id={`${testIdPrefix}-ttl`}
                    type="button"
                  >
                    {selectedTimeoutOption?.label ??
                      `Current (${formatTtlDuration(ttlSeconds)})`}
                    <ChevronDownGlyph
                      className="text-colony-muted"
                      size={15}
                      strokeWidth={2.4}
                    />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  onCloseAutoFocus={(event) => event.preventDefault()}
                  style={{
                    minWidth: "var(--radix-dropdown-menu-trigger-width)",
                  }}
                >
                  <DropdownMenuRadioGroup
                    onValueChange={(value) => onTtlSecondsChange(Number(value))}
                    value={String(ttlSeconds)}
                  >
                    {timeoutOptions.map((option) => (
                      <DropdownMenuRadioItem
                        data-testid={`${testIdPrefix}-ttl-option-${option.seconds}`}
                        key={option.seconds}
                        value={String(option.seconds)}
                      >
                        {option.label}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </>
        ) : null}
      </div>
    );
  }

  if (variant === "form") {
    return (
      <div
        className="flex flex-wrap gap-4"
        data-testid={`${testIdPrefix}-channel-type-container`}
      >
        <fieldset
          className="m-0 flex min-w-0 flex-[1_1_13.75rem] flex-col gap-[7px] border-0 p-0"
          data-testid={`${testIdPrefix}-channel-type`}
          disabled={disabled}
        >
          <legend className={cn("mb-[7px] p-0", CHANNEL_FORM_LABEL_CLASS)}>
            {label}
          </legend>
          <div className="grid grid-cols-2 gap-1 rounded-[0.8125rem] bg-colony-track p-1">
            {CHANNEL_TYPE_OPTIONS.map((option) => {
              const selected =
                (temporary ? "temporary" : "ongoing") === option.value;
              return (
                <label
                  className={cn(
                    "flex h-[2.375rem] cursor-pointer items-center justify-center gap-2 rounded-[0.625rem] text-menu",
                    selected
                      ? "bg-colony-pop font-extrabold text-colony-fg shadow-[0_1px_3px_rgba(60,40,80,0.12)]"
                      : "font-semibold text-colony-fg-secondary",
                  )}
                  data-testid={`${testIdPrefix}-channel-type-option-${option.value}`}
                  key={option.value}
                >
                  <input
                    checked={selected}
                    className="m-0 accent-colony-accent"
                    name={`${testIdPrefix}-channel-type`}
                    onChange={() =>
                      onTemporaryChange(option.value === "temporary")
                    }
                    type="radio"
                  />
                  {option.label}
                </label>
              );
            })}
          </div>
        </fieldset>
        {temporary ? (
          <div
            className="flex min-w-0 flex-[1_1_11.25rem] flex-col gap-[7px]"
            data-testid={`${testIdPrefix}-ephemeral-settings`}
          >
            <label
              className={CHANNEL_FORM_LABEL_CLASS}
              htmlFor={`${testIdPrefix}-ttl`}
            >
              Expires after
            </label>
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <button
                  aria-label="Expires after"
                  className="flex h-11.5 items-center justify-between gap-2 rounded-colony-control-lg border border-colony-border-strong bg-colony-pop px-3 text-left text-sm font-semibold text-colony-fg transition-colors focus-visible:border-colony-accent focus-visible:outline-hidden disabled:opacity-50"
                  data-testid={`${testIdPrefix}-ttl`}
                  disabled={disabled}
                  id={`${testIdPrefix}-ttl`}
                  type="button"
                >
                  <span className="truncate">
                    {selectedTimeoutOption?.label ??
                      `Current (${formatTtlDuration(ttlSeconds)})`}
                  </span>
                  <ChevronDownGlyph
                    className="shrink-0 text-colony-fg-secondary"
                    size={15}
                    strokeWidth={2.4}
                  />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                onCloseAutoFocus={(event) => event.preventDefault()}
                style={{
                  minWidth: "var(--radix-dropdown-menu-trigger-width)",
                }}
              >
                <DropdownMenuRadioGroup
                  onValueChange={(value) => onTtlSecondsChange(Number(value))}
                  value={String(ttlSeconds)}
                >
                  {timeoutOptions.map((option) => (
                    <DropdownMenuRadioItem
                      data-testid={`${testIdPrefix}-ttl-option-${option.seconds}`}
                      key={option.seconds}
                      value={String(option.seconds)}
                    >
                      {option.label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className="overflow-hidden rounded-xl border border-input bg-background"
      data-testid={`${testIdPrefix}-channel-type-container`}
    >
      <div
        className="flex items-center justify-between gap-3 px-3 py-3"
        data-testid={`${testIdPrefix}-channel-type-row`}
      >
        <span
          className={cn(
            "text-sm font-medium text-foreground",
            disabled && variant === "segmented" && "opacity-50",
          )}
        >
          {label}
        </span>
        {variant === "segmented" ? (
          <SegmentedControl
            disabled={disabled}
            legend="Channel type"
            onValueChange={(value) => onTemporaryChange(value === "temporary")}
            optionTestIdPrefix={`${testIdPrefix}-channel-type-option`}
            options={CHANNEL_TYPE_OPTIONS}
            testId={`${testIdPrefix}-channel-type`}
            value={temporary ? "temporary" : "ongoing"}
          />
        ) : (
          <ChannelTypePicker
            align="end"
            className="-mr-2.5"
            disabled={disabled}
            lifecycle={lifecycle}
            onLifecycleChange={(next) =>
              onTemporaryChange(next === "temporary")
            }
            onOpenChange={onOpenChange}
            open={open}
            testId={`${testIdPrefix}-channel-type`}
          />
        )}
      </div>
      <AnimatePresence initial={false}>
        {temporary ? (
          <motion.div
            animate={{ height: "auto", opacity: 1 }}
            className="overflow-hidden"
            exit={{ height: 0, opacity: 0 }}
            initial={{ height: 0, opacity: 0 }}
            key={`${testIdPrefix}-ephemeral-settings`}
            transition={channelTypeResizeTransition}
          >
            <div
              className="relative flex items-center justify-between gap-3 px-3 py-3 before:absolute before:inset-x-3 before:top-0 before:border-t before:border-border/70"
              data-testid={`${testIdPrefix}-ephemeral-settings`}
            >
              <label
                className={cn(
                  "text-sm font-medium",
                  disabled && variant === "segmented" && "opacity-50",
                )}
                htmlFor={`${testIdPrefix}-ttl`}
              >
                Expires after
              </label>
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                  <Button
                    aria-label="Expires after"
                    className="-mr-2.5 ml-auto h-9 w-fit justify-end px-2.5 text-right text-sm font-medium text-foreground hover:bg-muted/50"
                    data-testid={`${testIdPrefix}-ttl`}
                    disabled={disabled}
                    id={`${testIdPrefix}-ttl`}
                    type="button"
                    variant="ghost"
                  >
                    <span className="text-right">
                      {selectedTimeoutOption?.label ??
                        `Current (${formatTtlDuration(ttlSeconds)})`}
                    </span>
                    <ChevronDown className="size-4 shrink-0 text-muted-foreground/70" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  onCloseAutoFocus={(event) => event.preventDefault()}
                  style={{
                    minWidth: "var(--radix-dropdown-menu-trigger-width)",
                  }}
                >
                  <DropdownMenuRadioGroup
                    onValueChange={(value) => onTtlSecondsChange(Number(value))}
                    value={String(ttlSeconds)}
                  >
                    {timeoutOptions.map((option) => (
                      <DropdownMenuRadioItem
                        data-testid={`${testIdPrefix}-ttl-option-${option.seconds}`}
                        key={option.seconds}
                        value={String(option.seconds)}
                      >
                        {option.label}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
