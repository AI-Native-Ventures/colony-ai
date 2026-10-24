import type * as React from "react";

import { cn } from "@/shared/lib/cn";
import { Switch } from "@/shared/ui/switch";

/**
 * The few building blocks Settings pages compose: a white card with an eyebrow
 * title, rows with a label and a control, segmented choices and switch rows.
 * Their looks live in `SettingsShell.css`.
 */
type CardProps = React.HTMLAttributes<HTMLElement> & {
  /** The small uppercase title at the top of the card. */
  title?: string;
  titleId?: string;
};

export function SettingsCard({
  children,
  className,
  title,
  titleId,
  ...props
}: CardProps) {
  return (
    <section
      aria-labelledby={title ? titleId : undefined}
      className={cn("cs-card", className)}
      {...props}
    >
      {title ? (
        <h2 className="cs-eyebrow" id={titleId}>
          {title}
        </h2>
      ) : null}
      {children}
    </section>
  );
}

type RowProps = {
  label: string;
  help?: React.ReactNode;
  children?: React.ReactNode;
  /** Id of the control the label names, when it is a single control. */
  htmlFor?: string;
  className?: string;
  "data-testid"?: string;
};

/** A row: label and help on the left, the control on the right. */
export function SettingsRow({
  label,
  help,
  children,
  htmlFor,
  className,
  "data-testid": testId,
}: RowProps) {
  const copy = (
    <>
      <span className="cs-row-label">{label}</span>
      {help ? <span className="cs-row-help">{help}</span> : null}
    </>
  );
  return (
    <div className={cn("cs-row", className)} data-testid={testId}>
      {htmlFor ? (
        <label className="cs-row-copy" htmlFor={htmlFor}>
          {copy}
        </label>
      ) : (
        <div className="cs-row-copy">{copy}</div>
      )}
      {children}
    </div>
  );
}

type SwitchRowProps = {
  label: string;
  help?: React.ReactNode;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
  id: string;
  testId?: string;
  className?: string;
};

/** A row with a switch on the right; the label is the switch's name. */
export function SettingsSwitchRow({
  label,
  help,
  checked,
  disabled,
  onCheckedChange,
  id,
  testId,
  className,
}: SwitchRowProps) {
  return (
    <div className={cn("cs-row", className)} data-switch="true">
      <label className="cs-row-copy" htmlFor={id}>
        <span className="cs-row-label">{label}</span>
        {help ? <span className="cs-row-help">{help}</span> : null}
      </label>
      <Switch
        checked={checked}
        data-testid={testId}
        disabled={disabled}
        id={id}
        onCheckedChange={onCheckedChange}
      />
    </div>
  );
}

type ChoiceProps<T extends string> = {
  label: string;
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (next: T) => void;
  testId: string;
};

/** A small segmented control: one button pressed at a time. */
export function SettingsChoice<T extends string>({
  label,
  value,
  options,
  onChange,
  testId,
}: ChoiceProps<T>) {
  return (
    <fieldset className="cs-choice">
      <legend className="sr-only">{label}</legend>
      {options.map(([option, optionLabel]) => (
        <button
          aria-pressed={option === value}
          data-testid={`${testId}-${option}`}
          key={option}
          onClick={() => onChange(option)}
          type="button"
        >
          {optionLabel}
        </button>
      ))}
    </fieldset>
  );
}
