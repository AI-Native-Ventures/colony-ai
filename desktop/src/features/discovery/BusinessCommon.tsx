import type * as React from "react";
import { LoaderCircle, RefreshCw } from "lucide-react";

export function W10Page({
  children,
  wide = false,
  testId,
}: {
  children: React.ReactNode;
  wide?: boolean;
  testId?: string;
}) {
  return (
    <main className="w10-root" data-testid={testId}>
      <div
        className={`w10-page w10-records-page${wide ? " w10-page-wide" : ""}`}
      >
        {children}
      </div>
    </main>
  );
}

export function BusinessTabs({
  active,
}: {
  active: "leads" | "pipeline" | "proposals" | "service";
}) {
  const tabs = [
    ["leads", "Leads", "/leads"],
    ["pipeline", "Pipeline", "/pipeline"],
    ["proposals", "Proposals", "/sales/proposals"],
    ["service", "Services", "/sales/service"],
  ] as const;
  return (
    <nav aria-label="Business" className="w10-tabs">
      {tabs.map(([id, label, path]) => (
        <a
          aria-current={active === id ? "page" : undefined}
          className={active === id ? "is-active" : ""}
          href={`#${path}`}
          key={id}
        >
          {label}
        </a>
      ))}
    </nav>
  );
}

export function W10Heading({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="w10-page-heading">
      <div>
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="w10-heading-actions">{actions}</div> : null}
    </header>
  );
}

export function W10Button({
  children,
  onClick,
  type = "button",
  variant = "secondary",
  disabled = false,
  testId,
  "aria-label": ariaLabel,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  variant?: "primary" | "secondary" | "quiet";
  disabled?: boolean;
  testId?: string;
  "aria-label"?: string;
}) {
  return (
    <button
      aria-label={ariaLabel}
      className={`w10-button w10-button-${variant}`}
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
      type={type}
    >
      {children}
    </button>
  );
}

export function W10Pill({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "green" | "blue" | "red" | "amber";
}) {
  return <span className={`w10-pill w10-pill-${tone}`}>{children}</span>;
}

export function W10Loading({
  label = "Loading business records",
}: {
  label?: string;
}) {
  return (
    <div aria-label={label} className="w10-root w10-loading" role="status">
      <LoaderCircle aria-hidden="true" className="w10-spinner" />
      <span>{label}</span>
    </div>
  );
}

export function W10Error({
  title = "Connection unavailable",
  message,
  onRetry,
  retrying = false,
}: {
  title?: string;
  message: string;
  onRetry: () => void;
  retrying?: boolean;
}) {
  return (
    <section
      aria-labelledby="w10-error-title"
      className="w10-root w10-error"
      role="alert"
    >
      <div>
        <h2 id="w10-error-title">{title}</h2>
        <p>{message}</p>
      </div>
      <W10Button disabled={retrying} onClick={onRetry} variant="secondary">
        <RefreshCw aria-hidden="true" />
        Retry
      </W10Button>
    </section>
  );
}

export function Field({
  id,
  label,
  value,
  onChange,
  type = "text",
  required = false,
  min,
  max,
  step,
  placeholder,
  rows,
  help,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "email" | "number" | "date" | "url" | "tel";
  required?: boolean;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  rows?: number;
  help?: string;
}) {
  const helpId = help ? `${id}-help` : undefined;
  return (
    <div className="w10-field">
      <label htmlFor={id}>{label}</label>
      {rows ? (
        <textarea
          aria-describedby={helpId}
          id={id}
          onChange={(event) => onChange(event.currentTarget.value)}
          placeholder={placeholder}
          required={required}
          rows={rows}
          value={value}
        />
      ) : (
        <input
          aria-describedby={helpId}
          id={id}
          max={max}
          min={min}
          onChange={(event) => onChange(event.currentTarget.value)}
          placeholder={placeholder}
          required={required}
          step={step}
          type={type}
          value={value}
        />
      )}
      {help ? <small id={helpId}>{help}</small> : null}
    </div>
  );
}

export function formatZar(minorUnits: number | null | undefined): string {
  if (minorUnits === null || minorUnits === undefined) return "Not set";
  return new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: "ZAR",
    maximumFractionDigits: 0,
  }).format(minorUnits / 100);
}

export function formatDate(timestamp: number | null | undefined): string {
  if (!timestamp) return "Not checked";
  return new Intl.DateTimeFormat("en-ZA", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(timestamp * 1_000));
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return "The update could not be saved. Retry when the connection is available.";
}
