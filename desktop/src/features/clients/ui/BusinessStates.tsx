import type { ReactNode } from "react";

import { WarningIcon } from "@/features/clients/ui/BusinessBits";

import "./colony3-business.css";

type IconTone = "neutral" | "accent" | "bad";

function Icon({
  children,
  strokeWidth = 2.2,
}: {
  children: ReactNode;
  strokeWidth?: number;
}) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="18"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={strokeWidth}
      viewBox="0 0 24 24"
      width="18"
    >
      {children}
    </svg>
  );
}

/** The icons the Business records board gives each state. */
export const StateIcons = {
  addPerson: (
    <Icon>
      <circle cx="10" cy="8.5" r="3.5" />
      <path d="M3.5 19.5c.8-3.3 3.3-5 6.5-5 1.2 0 2.3.2 3.2.7" />
      <path d="M18 14v6M15 17h6" />
    </Icon>
  ),
  filter: (
    <Icon>
      <path d="M4 5.5h16l-6.2 7.2v5.6l-3.6 1.7v-7.3z" />
    </Icon>
  ),
  document: (
    <Icon>
      <path d="M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-10z" />
      <path d="M14 3.5v5h5M9 13h6M9 16.5h4" />
    </Icon>
  ),
  offline: (
    <Icon>
      <path d="M7 18.5h9.5a4 4 0 0 0 .7-7.9 5.5 5.5 0 0 0-10.4-1.4A4.6 4.6 0 0 0 7 18.5z" />
      <path d="M4 4l16 16" />
    </Icon>
  ),
  lock: (
    <Icon>
      <rect height="10" rx="2.5" width="14" x="5" y="10.5" />
      <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
    </Icon>
  ),
  missing: (
    <Icon>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4-4M8.8 8.8l4.4 4.4M13.2 8.8l-4.4 4.4" />
    </Icon>
  ),
  blocked: (
    <Icon>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M6 6l12 12" />
    </Icon>
  ),
};

export function RetryIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="16"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2.4"
      viewBox="0 0 24 24"
      width="16"
    >
      <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" />
      <path d="M19.5 4.5v4.5H15" />
    </svg>
  );
}

export function SpinnerIcon() {
  return (
    <svg
      aria-hidden="true"
      className="b3-spin"
      fill="none"
      height="18"
      stroke="currentColor"
      strokeLinecap="round"
      strokeWidth="2.6"
      viewBox="0 0 24 24"
      width="18"
    >
      <path d="M12 3.5a8.5 8.5 0 1 1-8.5 8.5" />
    </svg>
  );
}

export function StateButton({
  children,
  disabled,
  href,
  onClick,
  variant = "secondary",
}: {
  children: ReactNode;
  disabled?: boolean;
  href?: string;
  onClick?: () => void;
  variant?: "primary" | "secondary";
}) {
  const dataVariant = variant === "primary" ? "primary" : undefined;
  if (href) {
    return (
      <a className="b3-btn" data-variant={dataVariant} href={href}>
        {children}
      </a>
    );
  }
  return (
    <button
      className="b3-btn"
      data-variant={dataVariant}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

/** A titled state card: label, icon, title, one line of help and an action. */
export function StateCard({
  actions,
  body,
  eyebrow,
  icon,
  role,
  testId,
  title,
  tone = "neutral",
}: {
  actions?: ReactNode;
  body: ReactNode;
  eyebrow: string;
  icon: ReactNode;
  role?: "alert";
  testId?: string;
  title: string;
  tone?: IconTone;
}) {
  return (
    <section className="b3-state" data-testid={testId} role={role}>
      <span className="b3-state-eyebrow">{eyebrow}</span>
      <div className="b3-state-head">
        <span className="b3-state-icon" data-tone={tone}>
          {icon}
        </span>
        <h3 className="b3-state-title">{title}</h3>
      </div>
      <p className="b3-state-body">{body}</p>
      {actions ? <div className="b3-state-actions">{actions}</div> : null}
    </section>
  );
}

/** One loading line (a status the screen reader announces). */
export function StateLoading({ children }: { children: ReactNode }) {
  return (
    <div className="b3-state-loading" role="status">
      <SpinnerIcon />
      {children}
    </div>
  );
}

/** A red inline line for a failed load. */
export function StateAlert({
  children,
  size,
}: {
  children: ReactNode;
  size?: "lg";
}) {
  return (
    <div className="b3-state-alert" data-size={size} role="alert">
      {size === "lg" ? null : <WarningIcon size={16} />}
      <span>{children}</span>
    </div>
  );
}

/** A quiet note for an empty list. */
export function StateNote({ children }: { children: ReactNode }) {
  return <div className="b3-state-note">{children}</div>;
}

/** A compact card of several lines under one label (loading, errors, empty). */
export function StateGroup({
  children,
  eyebrow,
  gap = 10,
  label,
}: {
  children: ReactNode;
  eyebrow: string;
  gap?: 8 | 10;
  label: string;
}) {
  return (
    <section
      aria-label={label}
      className="b3-state"
      data-compact="true"
      data-gap={gap}
    >
      <span className="b3-state-eyebrow">{eyebrow}</span>
      {children}
    </section>
  );
}
