import * as React from "react";

import { cn } from "@/shared/lib/cn";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/shared/ui/dialog";
import { IdentityKeyHelpBody } from "./IdentityKeyHelpDialog";
import { InfoIcon, PlusIcon, ShieldCheckIcon } from "./firstRunIcons";

/** Black "primary" or white "secondary" button, as the boards draw them. */
export function FirstRunButton({
  kind = "secondary",
  size,
  fit,
  className,
  type = "button",
  ...props
}: React.ComponentProps<"button"> & {
  kind?: "primary" | "secondary" | "accent-soft";
  size?: "small";
  fit?: "content";
}) {
  return (
    <button
      className={cn("c3fr-button", className)}
      data-fit={fit}
      data-kind={kind}
      data-size={size}
      type={type}
      {...props}
    />
  );
}

/** A text link that behaves like a button (it changes the screen, not the page). */
export function FirstRunLink({
  className,
  type = "button",
  ...props
}: React.ComponentProps<"button">) {
  return (
    <button className={cn("c3fr-link", className)} type={type} {...props} />
  );
}

export function FirstRunError({
  children,
  id,
  role = "alert",
}: {
  children: React.ReactNode;
  id?: string;
  role?: "alert" | "status";
}) {
  return (
    <p className="c3fr-error" id={id} role={role}>
      <InfoIcon size={15} strokeWidth={2.4} />
      <span>{children}</span>
    </p>
  );
}

export function FirstRunDivider({ children }: { children: React.ReactNode }) {
  return (
    <div aria-hidden="true" className="c3fr-divider">
      {children}
    </div>
  );
}

export function FirstRunSectionDivider({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <p className="c3fr-divider" data-kind="section">
      {children}
    </p>
  );
}

/** Password input with the "Show" chip inside the box. */
export function FirstRunPasswordField({
  id,
  label,
  labelAside,
  onChange,
  value,
  defaultValue,
  placeholder,
  autoComplete,
  minLength,
  required = true,
  describedBy,
  invalid,
  ariaLabelName,
}: {
  id: string;
  label: string;
  /** Link on the right of the label row ("Forgot password?"). */
  labelAside?: React.ReactNode;
  onChange?: React.ChangeEventHandler<HTMLInputElement>;
  value?: string;
  defaultValue?: string;
  placeholder?: string;
  autoComplete?: string;
  minLength?: number;
  required?: boolean;
  describedBy?: string;
  invalid?: boolean;
  /** Replaces the label in the Show button's name ("new password"). */
  ariaLabelName?: string;
}) {
  const [visible, setVisible] = React.useState(false);
  return (
    <div className="c3fr-field-group">
      <div className="c3fr-label">
        <label htmlFor={id}>{label}</label>
        {labelAside}
      </div>
      <div className="c3fr-input-wrap">
        <input
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          autoComplete={autoComplete}
          defaultValue={defaultValue}
          id={id}
          minLength={minLength}
          name={id}
          onChange={onChange}
          placeholder={placeholder}
          required={required}
          type={visible ? "text" : "password"}
          value={value}
        />
        <button
          aria-label={`${visible ? "Hide" : "Show"} ${(ariaLabelName ?? label).toLowerCase()}`}
          className="c3fr-chip-button"
          onClick={() => setVisible((current) => !current)}
          type="button"
        >
          {visible ? "Hide" : "Show"}
        </button>
      </div>
    </div>
  );
}

/** The chip under Scout that opens the plain explanation of the sign-in key. */
export function AccountHelpChip({ label }: { label: string }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          className="c3fr-story-note"
          data-testid="identity-key-help-trigger"
          type="button"
        >
          <ShieldCheckIcon size={18} />
          {label}
        </button>
      </DialogTrigger>
      <DialogContent data-testid="identity-key-help-dialog">
        <DialogTitle>How your account stays yours</DialogTitle>
        <DialogDescription asChild>
          <div className="space-y-4 text-pretty">
            <IdentityKeyHelpBody />
          </div>
        </DialogDescription>
      </DialogContent>
    </Dialog>
  );
}

/** The business's dark initial tile (or its logo), with the small accent dot. */
export function BusinessMark({
  name,
  logoUrl,
  onLogoError,
  size,
  dot = "#ffc2a6",
  tone,
}: {
  name: string;
  logoUrl?: string | null;
  onLogoError?: () => void;
  size?: "small" | "compact";
  /** Colour of the dot beside the initial. */
  dot?: string;
  tone?: "light";
}) {
  const initial = name.trim().slice(0, 1).toUpperCase();
  return (
    <span
      aria-hidden="true"
      className="c3fr-mark"
      data-logo={logoUrl ? "true" : undefined}
      data-size={size}
      data-tone={tone}
      style={{ "--fr-mark-dot": dot } as React.CSSProperties}
    >
      {logoUrl ? (
        // biome-ignore lint/a11y/useAltText: decorative, the name sits beside it
        <img alt="" onError={onLogoError} src={logoUrl} />
      ) : (
        initial || <PlusIcon size={20} />
      )}
    </span>
  );
}

/** The workspace card: its mark, its name and, when known, who invited you. */
export function InviteCard({
  invite,
}: {
  invite: { businessName: string; inviter?: string };
}) {
  return (
    <div className="c3fr-card" data-testid="invite-card">
      <div className="c3fr-invite-head">
        <BusinessMark dot="#c6b3f4" name={invite.businessName} />
        <span className="c3fr-preview-text">
          <span className="c3fr-invite-name">{invite.businessName}</span>
          <span className="c3fr-invite-kind">Company workspace</span>
        </span>
      </div>
      {invite.inviter ? (
        <div className="c3fr-invite-by">
          <span aria-hidden="true" className="c3fr-invite-by-avatar">
            {invite.inviter.charAt(0).toUpperCase()}
          </span>
          <span>
            Invited by <strong>{invite.inviter}</strong>
          </span>
        </div>
      ) : null}
    </div>
  );
}
