import type { ReactNode, Ref } from "react";

import { cn } from "@/shared/lib/cn";
import { Spinner } from "@/shared/ui/spinner";

// ── Primary actions ──────────────────────────────────────────────────────────

/**
 * The row of actions under the profile hero (`ProfilePanel.dc.html`): Message
 * leads in the accent colour, the agent controls follow as outlined buttons.
 * Follow and Huddle are not part of Colony 3.0.
 */
export function ProfilePrimaryActions({
  actionGroupRef,
  agentActionDisabled,
  agentStartBlockReason,
  agentActionLabel,
  className,
  messagePending,
  onAgentPrimaryAction,
  onAgentRestart,
  onMessage,
  onWave,
  wavePending,
}: {
  actionGroupRef?: Ref<HTMLDivElement>;
  agentActionDisabled?: boolean;
  agentStartBlockReason?: string;
  agentActionLabel?: string;
  className?: string;
  messagePending?: boolean;
  onAgentPrimaryAction?: () => void;
  onAgentRestart?: () => void;
  onMessage?: () => void;
  onWave?: () => void;
  wavePending?: boolean;
}) {
  const hasActions =
    onWave !== undefined ||
    onMessage !== undefined ||
    (onAgentPrimaryAction !== undefined && agentActionLabel !== undefined) ||
    onAgentRestart !== undefined;

  if (!hasActions) {
    return null;
  }

  return (
    <ProfileActionGroup className={className} ref={actionGroupRef}>
      {onMessage ? (
        <ProfileActionButton
          accent
          disabled={messagePending}
          isLoading={messagePending}
          label="Message"
          onClick={onMessage}
          testId="user-profile-message"
        />
      ) : null}
      {onAgentRestart ? (
        <ProfileActionButton
          disabled={agentActionDisabled}
          label="Restart agent"
          onClick={onAgentRestart}
          testId="user-profile-agent-restart"
        />
      ) : null}
      {onAgentPrimaryAction && agentActionLabel ? (
        <ProfileActionButton
          disabled={agentActionDisabled || Boolean(agentStartBlockReason)}
          title={agentStartBlockReason}
          label={agentActionLabel}
          onClick={onAgentPrimaryAction}
          testId="user-profile-agent-primary-action"
        />
      ) : null}
      {onWave ? (
        <ProfileActionButton
          disabled={wavePending}
          isLoading={wavePending}
          label="Wave"
          onClick={onWave}
          testId="user-profile-wave"
        />
      ) : null}
    </ProfileActionGroup>
  );
}

export function ProfilePersonaPrimaryActions({
  actionGroupRef,
  className,
  disabled,
  onStartAgent,
}: {
  actionGroupRef?: Ref<HTMLDivElement>;
  className?: string;
  disabled: boolean;
  onStartAgent: () => void;
}) {
  return (
    <ProfileActionGroup className={className} ref={actionGroupRef}>
      <ProfileActionButton
        accent
        disabled={disabled}
        label="Start agent"
        onClick={onStartAgent}
        testId="user-profile-start-agent"
      />
    </ProfileActionGroup>
  );
}

function ProfileActionGroup({
  children,
  className,
  ref,
}: {
  children: ReactNode;
  className?: string;
  ref?: Ref<HTMLDivElement>;
}) {
  return (
    <div
      className={cn("pp-actions", className)}
      data-testid="user-profile-primary-actions"
      ref={ref}
    >
      {children}
    </div>
  );
}

function ProfileActionButton({
  accent,
  disabled,
  isLoading,
  label,
  onClick,
  testId,
  title,
}: {
  accent?: boolean;
  disabled?: boolean;
  isLoading?: boolean;
  label: string;
  onClick: () => void;
  testId?: string;
  title?: string;
}) {
  return (
    <button
      aria-busy={isLoading || undefined}
      aria-label={label}
      className="pp-action"
      data-accent={accent ? "true" : undefined}
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
      title={title}
      type="button"
    >
      {isLoading ? (
        <Spinner aria-hidden="true" className="h-4 w-4 border-2" />
      ) : null}
      {label}
    </button>
  );
}
