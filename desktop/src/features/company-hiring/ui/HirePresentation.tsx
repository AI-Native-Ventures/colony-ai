import type { ReactNode } from "react";

import { cn } from "@/shared/lib/cn";
import { ColonySteps } from "@/shared/ui/ColonySteps";
import { InfoGlyph } from "./hireTools";
import "./hire.css";

export const hirePrimaryButtonClass =
  "bg-[#536d9c] text-white shadow hover:bg-[#4d668f] disabled:bg-[#536d9c] disabled:text-white disabled:opacity-100";

/** The scrolling page frame of every hiring board. */
export function HirePage({
  centered = false,
  children,
  testId,
}: {
  centered?: boolean;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <section className="colony-hire-page" data-testid={testId}>
      <div className="colony-hire-content" data-centered={centered}>
        {children}
      </div>
    </section>
  );
}

export function HireTitle({
  action,
  subtitle,
  title,
}: {
  action?: ReactNode;
  subtitle?: ReactNode;
  title: string;
}) {
  const copy = (
    <div className="colony-hire-title">
      <h1>{title}</h1>
      {subtitle ? <span>{subtitle}</span> : null}
    </div>
  );
  if (!action) return copy;
  return (
    <div className="colony-hire-title-row">
      {copy}
      {action}
    </div>
  );
}

const HIRE_STEPS = ["Role", "Configure", "Review", "Hired"] as const;

/** Step 1 to 4; 5 marks every step done. */
export function HireSteps({
  centered = false,
  current,
  onSelect,
}: {
  centered?: boolean;
  current: 1 | 2 | 3 | 4;
  onSelect?: (step: number) => void;
}) {
  return (
    <ColonySteps
      align={centered ? "center" : "start"}
      checkLast={current === 4}
      current={current}
      label="Hiring steps"
      onStepSelect={onSelect}
      steps={HIRE_STEPS}
    />
  );
}

export function HireBanner({
  children,
  tone = "info",
}: {
  children: ReactNode;
  tone?: "info" | "warning";
}) {
  return (
    <div className="colony-hire-banner" data-tone={tone} role="status">
      <InfoGlyph size={18} />
      <span>{children}</span>
    </div>
  );
}

type HireButtonProps = {
  block?: boolean;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  onClick?: () => void;
  size?: "sm" | "md" | "lg" | "xl";
  testId?: string;
  type?: "button" | "submit";
  variant?: "ink" | "outline";
};

/** The ink and outline buttons of the hiring boards, at the board sizes. */
export function HireButton({
  block = false,
  children,
  className,
  disabled,
  onClick,
  size = "xl",
  testId,
  type = "button",
  variant = "ink",
}: HireButtonProps) {
  return (
    <button
      className={cn("colony-hire-button", className)}
      data-block={block || undefined}
      data-size={size}
      data-testid={testId}
      data-variant={variant}
      disabled={disabled}
      onClick={onClick}
      type={type}
    >
      {children}
    </button>
  );
}

export function HireField({
  children,
  hint,
  htmlFor,
  label,
}: {
  children: ReactNode;
  hint?: ReactNode;
  htmlFor: string;
  label: string;
}) {
  return (
    <label className="colony-hire-field" htmlFor={htmlFor}>
      {label}
      {children}
      {hint}
    </label>
  );
}

export function HireRecovery({
  action,
  centered = false,
  children,
  title,
}: {
  action?: ReactNode;
  centered?: boolean;
  children: ReactNode;
  title: string;
}) {
  return (
    <section
      className="colony-hire-card colony-hire-recovery"
      data-centered={centered || undefined}
    >
      <h2>{title}</h2>
      <p>{children}</p>
      {action}
    </section>
  );
}
