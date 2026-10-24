import * as React from "react";
import { Check, ChevronDown } from "lucide-react";

import { EmojiPicker } from "@/features/custom-emoji/ui/EmojiPicker";
import {
  CommuteIcon,
  HomeOfficeIcon,
  MeetingIcon,
  SickIcon,
  StatusFaceIcon,
  VacationIcon,
} from "@/features/profile/ui/profileIcons";
import {
  DEFAULT_USER_STATUS_EMOJI,
  StatusEmoji,
} from "@/features/user-status/ui/StatusEmoji";
import type { UserStatusInput } from "@/features/user-status/types";
import { Calendar } from "@/shared/ui/calendar";
import { CloseIcon } from "@/shared/ui/colonyIcons";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/shared/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";
import "@/features/profile/ui/ProfileMenus.css";

/** Quick statuses: each has the board's glyph in its own colour. */
const PRESETS = [
  {
    text: "In a meeting",
    emoji: "\uD83D\uDDE3\uFE0F",
    Icon: MeetingIcon,
    color: "#4A36A6",
  },
  {
    text: "Commuting",
    emoji: "\uD83D\uDE8C",
    Icon: CommuteIcon,
    color: "#2B5899",
  },
  {
    text: "Out sick",
    emoji: "\uD83E\uDD12",
    Icon: SickIcon,
    color: "#A62E4E",
  },
  {
    text: "Vacationing",
    emoji: "\uD83C\uDFD6\uFE0F",
    Icon: VacationIcon,
    color: "#8A5300",
  },
  {
    text: "Working remotely",
    emoji: "\uD83C\uDFE0",
    Icon: HomeOfficeIcon,
    color: "#2B7350",
  },
] as const;

const DURATIONS = ["Today", "This week", "Custom"] as const;

type DurationLabel = (typeof DURATIONS)[number];

const HALF_HOUR_TIMES = Array.from({ length: 48 }, (_, index) => {
  const hour = Math.floor(index / 2);
  const minute = index % 2 === 0 ? 0 : 30;
  const period = hour < 12 ? "AM" : "PM";
  const displayHour = hour % 12 || 12;
  return {
    label: `${displayHour}:${minute.toString().padStart(2, "0")} ${period}`,
    value: `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`,
  };
});

type SetStatusDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialText?: string;
  initialEmoji?: string;
  initialExpiresAt?: number;
  initialUpdatedAt?: number;
  onSave: (status: UserStatusInput) => void;
  onClear: () => void;
  hasExistingStatus: boolean;
};

function roundUpToHalfHour(value: Date) {
  const date = new Date(value);
  date.setSeconds(0, 0);
  date.setMinutes(Math.ceil(date.getMinutes() / 30) * 30);
  return date;
}

function defaultCustomDate() {
  return roundUpToHalfHour(new Date(Date.now() + 24 * 60 * 60 * 1_000));
}

function toLocalTimeValue(date: Date) {
  return `${date.getHours().toString().padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}`;
}

function formattedTime(date: Date) {
  return date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function endOfToday(from: Date) {
  const end = new Date(from);
  end.setHours(24, 0, 0, 0);
  return end;
}

function endOfWeek(from: Date) {
  const end = new Date(from);
  const daysUntilMonday = (8 - end.getDay()) % 7 || 7;
  end.setDate(end.getDate() + daysUntilMonday);
  end.setHours(0, 0, 0, 0);
  return end;
}

function inferredDuration(
  expiresAt: number | undefined,
  updatedAt: number | undefined,
): DurationLabel {
  if (!expiresAt || expiresAt * 1_000 <= Date.now()) return "Today";
  if (!updatedAt) return "Custom";

  const expiration = expiresAt * 1_000;
  const updated = updatedAt * 1_000;
  const withinTwoMinutes = (expected: number) =>
    Math.abs(expiration - expected) <= 2 * 60_000;
  if (withinTwoMinutes(endOfToday(new Date(updated)).getTime())) return "Today";
  if (withinTwoMinutes(endOfWeek(new Date(updated)).getTime())) {
    return "This week";
  }
  return "Custom";
}

function withCustomDate(current: Date, selected: Date) {
  const next = new Date(current);
  next.setFullYear(
    selected.getFullYear(),
    selected.getMonth(),
    selected.getDate(),
  );
  return next;
}

function startOfToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

function formattedDate(date: Date) {
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function withCustomTime(current: Date, value: string) {
  const [hour, minute] = value.split(":").map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return current;
  const next = new Date(current);
  next.setHours(hour, minute, 0, 0);
  return next;
}

export function SetStatusDialog({
  open,
  onOpenChange,
  initialText = "",
  initialEmoji = "",
  initialExpiresAt,
  initialUpdatedAt,
  onSave,
  onClear,
  hasExistingStatus,
}: SetStatusDialogProps) {
  const [text, setText] = React.useState(initialText);
  const [emoji, setEmoji] = React.useState(initialEmoji);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [calendarOpen, setCalendarOpen] = React.useState(false);
  const [duration, setDuration] = React.useState<DurationLabel>("Today");
  const [customUntil, setCustomUntil] = React.useState(defaultCustomDate);
  const [durationTouched, setDurationTouched] = React.useState(false);
  const [saveError, setSaveError] = React.useState("");
  const [baseline, setBaseline] = React.useState(() => ({
    text: initialText,
    emoji: initialEmoji,
    expiresAt: initialExpiresAt,
    duration: null as DurationLabel | null,
    customUntil: null as Date | null,
    hasExistingStatus,
  }));
  const initializedForOpenRef = React.useRef(false);

  React.useEffect(() => {
    if (!open) {
      initializedForOpenRef.current = false;
      return;
    }
    if (initializedForOpenRef.current) return;
    initializedForOpenRef.current = true;
    setText(initialText);
    setEmoji(initialEmoji);
    const currentExpiration = initialExpiresAt
      ? new Date(initialExpiresAt * 1_000)
      : null;
    if (currentExpiration && currentExpiration.getTime() > Date.now()) {
      const nextDuration = inferredDuration(initialExpiresAt, initialUpdatedAt);
      setDuration(nextDuration);
      setCustomUntil(currentExpiration);
      setBaseline({
        text: initialText,
        emoji: initialEmoji,
        expiresAt: initialExpiresAt,
        duration: nextDuration,
        customUntil: currentExpiration,
        hasExistingStatus,
      });
    } else {
      setDuration("Today");
      const nextCustomUntil = defaultCustomDate();
      setCustomUntil(nextCustomUntil);
      setBaseline({
        text: initialText,
        emoji: initialEmoji,
        expiresAt: undefined,
        duration: null,
        customUntil: null,
        hasExistingStatus,
      });
    }
    setDurationTouched(false);
    setSaveError("");
  }, [
    open,
    initialText,
    initialEmoji,
    initialExpiresAt,
    initialUpdatedAt,
    hasExistingStatus,
  ]);

  const hasContent = Boolean(text.trim() || emoji);
  const effectiveEmoji =
    emoji || (text.trim() ? DEFAULT_USER_STATUS_EMOJI : "");
  const initialEffectiveEmoji =
    baseline.emoji || (baseline.text.trim() ? DEFAULT_USER_STATUS_EMOJI : "");
  const isDirty =
    text.trim() !== baseline.text.trim() ||
    effectiveEmoji !== initialEffectiveEmoji ||
    durationTouched ||
    (duration === "Custom" &&
      baseline.duration === "Custom" &&
      baseline.customUntil !== null &&
      customUntil.getTime() !== baseline.customUntil.getTime());
  function expirationUnixSeconds(now = new Date()): number | undefined {
    if (
      !durationTouched &&
      baseline.hasExistingStatus &&
      baseline.expiresAt !== undefined
    ) {
      return baseline.expiresAt;
    }
    const expiresAt = (() => {
      switch (duration) {
        case "Today":
          return endOfToday(now);
        case "This week":
          return endOfWeek(now);
        case "Custom":
          return customUntil;
      }
    })();
    return Math.floor(expiresAt.getTime() / 1_000);
  }

  const displayedExpiration = expirationUnixSeconds();
  const expirationIsFuture =
    displayedExpiration === undefined ||
    displayedExpiration > Math.floor(Date.now() / 1_000);
  const canSave = hasContent && isDirty && expirationIsFuture;

  function handlePresetClick(preset: { text: string; emoji: string }) {
    setText(preset.text);
    setEmoji(preset.emoji);
  }

  function handleEmojiSelect(selectedEmoji: string) {
    setEmoji(selectedEmoji);
    setPickerOpen(false);
  }

  function handleSave() {
    if (!hasContent || !isDirty) return;
    const expiresAt = expirationUnixSeconds();
    if (
      expiresAt !== undefined &&
      expiresAt <= Math.floor(Date.now() / 1_000)
    ) {
      setSaveError("Choose a duration in the future.");
      return;
    }
    onSave({
      text: text.trim(),
      emoji: effectiveEmoji,
      expiresAt,
    });
    onOpenChange(false);
  }

  function handleClear() {
    onClear();
    onOpenChange(false);
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSave();
    }
  }

  function chooseDuration(option: DurationLabel) {
    setDuration(option);
    setDurationTouched(true);
    setSaveError("");
  }

  /** Clear status: ends an existing status, or empties the draft. */
  function handleClearStatus() {
    if (baseline.hasExistingStatus) {
      handleClear();
      return;
    }
    setText("");
    setEmoji("");
    setDurationTouched(false);
    setSaveError("");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby="set-status-description"
        className="ps-dialog"
        data-testid="set-status-dialog"
        showCloseButton={false}
        surface="none"
      >
        <form
          className="ps-form"
          onSubmit={(event) => {
            event.preventDefault();
            handleSave();
          }}
        >
          <div className="ps-head">
            <div className="ps-head-copy">
              <DialogTitle className="ps-title">Set a status</DialogTitle>
              <DialogDescription className="ps-sub" id="set-status-description">
                Let others know what you’re up to.
              </DialogDescription>
            </div>
            <DialogClose aria-label="Close" className="ps-close">
              <CloseIcon size={17} strokeWidth={2.4} />
            </DialogClose>
          </div>

          <div className="ps-input-row">
            <Popover onOpenChange={setPickerOpen} open={pickerOpen}>
              <PopoverTrigger asChild>
                <button
                  aria-label="Choose a status emoji"
                  className="ps-emoji"
                  type="button"
                >
                  {effectiveEmoji ? (
                    <StatusEmoji className="h-5 w-5" value={effectiveEmoji} />
                  ) : (
                    <StatusFaceIcon size={20} />
                  )}
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="start"
                className="w-auto overflow-hidden rounded-2xl p-0"
                sideOffset={4}
              >
                <EmojiPicker autoFocus onSelect={handleEmojiSelect} />
              </PopoverContent>
            </Popover>
            <input
              aria-label="Status"
              className="ps-input"
              data-testid="set-status-input"
              onChange={(event) => setText(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="What’s your status?"
              value={text}
            />
          </div>

          <fieldset className="ps-duration" data-testid="set-status-duration">
            <legend>Clear after</legend>
            <div className="ps-track">
              {DURATIONS.map((option) => (
                <label
                  className="ps-segment"
                  data-checked={duration === option ? "true" : undefined}
                  key={option}
                >
                  <input
                    checked={duration === option}
                    name="status-duration"
                    onChange={() => chooseDuration(option)}
                    // Choosing the option that is already selected still
                    // counts as picking a duration (it applies Today to a
                    // status saved without one), and a change event does not
                    // fire for that.
                    onClick={() => chooseDuration(option)}
                    type="radio"
                    value={option}
                  />
                  {option}
                </label>
              ))}
            </div>
          </fieldset>

          {duration === "Custom" ? (
            <div className="ps-custom">
              <span>Until</span>
              <Popover onOpenChange={setCalendarOpen} open={calendarOpen}>
                <PopoverTrigger asChild>
                  <button
                    aria-label="Status expiration date"
                    className="ps-picker"
                    type="button"
                  >
                    <span className="truncate">
                      {formattedDate(customUntil)}
                    </span>
                    <ChevronDown className="ml-auto h-4 w-4 shrink-0" />
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-auto p-0">
                  <Calendar
                    disabled={{ before: startOfToday() }}
                    mode="single"
                    onSelect={(selected) => {
                      if (!selected) return;
                      setDurationTouched(true);
                      setSaveError("");
                      setCustomUntil((current) =>
                        withCustomDate(current, selected),
                      );
                      setCalendarOpen(false);
                    }}
                    selected={customUntil}
                  />
                </PopoverContent>
              </Popover>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    aria-label="Status expiration time"
                    className="ps-picker ps-picker-time"
                    type="button"
                  >
                    <span>
                      {HALF_HOUR_TIMES.find(
                        (time) => time.value === toLocalTimeValue(customUntil),
                      )?.label ?? formattedTime(customUntil)}
                    </span>
                    <ChevronDown className="ml-auto h-4 w-4 shrink-0" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="max-h-[23rem]"
                  data-testid="status-expiration-time-menu"
                  style={{
                    minWidth: "var(--radix-dropdown-menu-trigger-width)",
                  }}
                >
                  {HALF_HOUR_TIMES.map((time) => (
                    <DropdownMenuItem
                      className="justify-between"
                      key={time.value}
                      onSelect={() => {
                        setDurationTouched(true);
                        setSaveError("");
                        setCustomUntil((current) =>
                          withCustomTime(current, time.value),
                        );
                      }}
                    >
                      {time.label}
                      {time.value === toLocalTimeValue(customUntil) ? (
                        <Check className="h-4 w-4" />
                      ) : null}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ) : null}
          {saveError || (!expirationIsFuture && isDirty) ? (
            <p className="ps-error" role="alert">
              {saveError || "Choose a duration in the future."}
            </p>
          ) : null}

          <div className="ps-quick">
            <span className="ps-eyebrow">Quick statuses</span>
            {PRESETS.map((preset) => (
              <button
                className="ps-quick-row"
                data-testid={`set-status-preset-${preset.text.toLowerCase().replace(/\s+/g, "-")}`}
                key={preset.text}
                onClick={() => handlePresetClick(preset)}
                type="button"
              >
                <preset.Icon size={18} style={{ color: preset.color }} />
                {preset.text}
              </button>
            ))}
          </div>

          <div className="ps-foot">
            <button
              className="ps-clear"
              data-testid="set-status-clear"
              onClick={handleClearStatus}
              type="button"
            >
              Clear status
            </button>
            <span className="flex-1" />
            <button
              aria-label="Save status"
              className="ps-save"
              data-testid="set-status-save"
              disabled={!canSave}
              type="submit"
            >
              Save status
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
