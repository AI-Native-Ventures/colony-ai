import { AgentManagementMarker } from "@/features/agents/ui/OtherSetupAgentMarker";
import {
  AnimatePresence,
  motion,
  useAnimationControls,
  useReducedMotion,
} from "motion/react";
import * as React from "react";

import { ProfileAvatar } from "@/features/profile/ui/ProfileAvatar";
import {
  MentionGlyph,
  SendGlyph,
  StopGlyph,
  CloseGlyph,
  CheckGlyph,
} from "./ComposerIcons";
import { Popover, PopoverAnchor, PopoverContent } from "@/shared/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";

export type ComposerAddressAgent = {
  avatarUrl: string | null;
  displayName: string;
  pubkey: string;
};

type AddressAnimationProps = {
  pulseVersion: number;
  shakeVersion: number;
};

function AddressedAgentAvatar({
  agent,
  pulseVersion,
  shakeVersion,
}: AddressAnimationProps & { agent: ComposerAddressAgent }) {
  const controls = useAnimationControls();
  const shouldReduceMotion = useReducedMotion();
  const previousPulseVersionRef = React.useRef(0);
  const previousShakeVersionRef = React.useRef(0);

  React.useEffect(() => {
    if (pulseVersion <= previousPulseVersionRef.current) return;
    previousPulseVersionRef.current = pulseVersion;
    if (shouldReduceMotion) return;
    void controls.start({
      scale: [1, 1.3, 0.96, 1.08, 1],
      y: [0, -4, 1, -1, 0],
      transition: { duration: 0.48, ease: "easeOut" },
    });
  }, [controls, pulseVersion, shouldReduceMotion]);

  React.useEffect(() => {
    if (shakeVersion <= previousShakeVersionRef.current) return;
    previousShakeVersionRef.current = shakeVersion;
    if (shouldReduceMotion) return;
    controls.stop();
    controls.set({ scale: 1, x: 0, y: 0 });
    void controls.start({
      x: [0, -4, 4, -3, 3, -1.5, 1.5, 0],
      transition: { duration: 0.42, ease: "easeOut" },
    });
  }, [controls, shakeVersion, shouldReduceMotion]);

  return (
    <motion.span
      animate={controls}
      className="relative block shrink-0"
      data-pulse-version={pulseVersion}
      data-shake-version={shakeVersion}
      data-testid={`composer-address-lock-${agent.pubkey}`}
      initial={false}
    >
      <ProfileAvatar
        avatarUrl={agent.avatarUrl}
        className="c3c-chip-avatar"
        label={agent.displayName}
        shape="squircle"
        testId="composer-address-lock-avatar"
      />
    </motion.span>
  );
}

function RemainingAgentCount({ count }: { count: number }) {
  return count > 0 ? (
    <span
      aria-label={`${count} more addressed ${count === 1 ? "agent" : "agents"}`}
      className="c3c-chip-count"
      role="img"
    >
      +{count}
    </span>
  ) : null;
}

const VISIBLE_AGENT_LIMIT = 3;

function useNewlyAddedAgentPubkeys(
  agents: readonly ComposerAddressAgent[],
): ReadonlySet<string> {
  const previousPubkeysRef = React.useRef<ReadonlySet<string> | null>(null);
  const currentPubkeys = new Set(agents.map((agent) => agent.pubkey));
  const newlyAddedPubkeys = new Set<string>();

  if (previousPubkeysRef.current) {
    for (const pubkey of currentPubkeys) {
      if (!previousPubkeysRef.current.has(pubkey)) {
        newlyAddedPubkeys.add(pubkey);
      }
    }
  }

  React.useEffect(() => {
    previousPubkeysRef.current = new Set(agents.map((agent) => agent.pubkey));
  }, [agents]);

  return newlyAddedPubkeys;
}

const addressEntryTransition = {
  type: "spring",
  stiffness: 500,
  damping: 30,
} as const;

type AddressAgentsProps = {
  agents: readonly ComposerAddressAgent[];
  pulseVersionByPubkey?: Readonly<Record<string, number>>;
  shakeVersionByPubkey?: Readonly<Record<string, number>>;
};

export function ComposerMentionButton({
  agents,
  confirmationTitle,
  disabled,
  onConfirmationDismiss,
  onConfirmationHoverChange,
  onConfirmationTurnOff,
  onCaptureSelection,
  onOpen,
  onRemove,
  triggerIcon,
  pulseVersionByPubkey = {},
  shakeVersionByPubkey = {},
  showAgents,
}: AddressAgentsProps & {
  confirmationTitle?: string | null;
  disabled: boolean;
  onConfirmationDismiss?: () => void;
  onConfirmationHoverChange?: (hovered: boolean) => void;
  onConfirmationTurnOff?: () => void;
  onCaptureSelection: () => void;
  onOpen: () => void;
  onRemove: (pubkey: string) => void;
  triggerIcon?: React.ReactNode;
  showAgents: boolean;
}) {
  const visibleAgents = showAgents ? agents.slice(0, VISIBLE_AGENT_LIMIT) : [];
  const hiddenCount = showAgents ? agents.length - visibleAgents.length : 0;
  const hasAgents = visibleAgents.length > 0;
  const shouldReduceMotion = useReducedMotion();
  const [showActiveChrome, setShowActiveChrome] = React.useState(hasAgents);
  const newlyAddedAgentPubkeys = useNewlyAddedAgentPubkeys(visibleAgents);

  React.useEffect(() => {
    if (hasAgents) setShowActiveChrome(true);
  }, [hasAgents]);

  return (
    <Popover
      modal={false}
      onOpenChange={(open) => {
        if (!open) onConfirmationDismiss?.();
      }}
      open={Boolean(confirmationTitle)}
    >
      <PopoverAnchor asChild>
        <div
          className="c3c-mention"
          data-active={hasAgents ? "true" : undefined}
        >
          <Tooltip disableHoverableContent>
            <TooltipTrigger asChild>
              <button
                aria-label={hasAgents ? "Manage mentions" : "Mention someone"}
                className="c3c-tool"
                data-active={showActiveChrome ? "true" : undefined}
                data-mention-picker-trigger=""
                data-testid="message-insert-mention"
                disabled={disabled}
                onClick={onOpen}
                onMouseDown={(event) => {
                  onCaptureSelection();
                  event.preventDefault();
                }}
                type="button"
              >
                {triggerIcon ?? <MentionGlyph />}
              </button>
            </TooltipTrigger>
            <TooltipContent>
              {hasAgents ? "Manage mentions" : "Mention someone"}
            </TooltipContent>
          </Tooltip>
          <AnimatePresence
            initial={false}
            onExitComplete={() => {
              if (!hasAgents) setShowActiveChrome(false);
            }}
          >
            {hasAgents ? (
              <motion.span
                animate={{ opacity: 1 }}
                className="c3c-chips"
                data-testid="composer-address-locks"
                exit={{ opacity: 0 }}
                initial={shouldReduceMotion ? false : { opacity: 0 }}
                transition={
                  shouldReduceMotion
                    ? { duration: 0 }
                    : { duration: 0.12, ease: "easeOut" }
                }
              >
                <AnimatePresence mode="popLayout">
                  {visibleAgents.map((agent) => (
                    <motion.span
                      animate={{ opacity: 1, scale: 1 }}
                      className="c3c-chip"
                      data-testid={`composer-address-chip-${agent.pubkey}`}
                      exit={
                        shouldReduceMotion
                          ? { opacity: 0 }
                          : { opacity: 0, scale: 0.8 }
                      }
                      initial={
                        newlyAddedAgentPubkeys.has(agent.pubkey)
                          ? shouldReduceMotion
                            ? { opacity: 0 }
                            : { opacity: 0, scale: 0.8 }
                          : false
                      }
                      key={agent.pubkey}
                      layout={!shouldReduceMotion}
                      transition={
                        shouldReduceMotion
                          ? { duration: 0 }
                          : addressEntryTransition
                      }
                    >
                      <AddressedAgentAvatar
                        agent={agent}
                        pulseVersion={pulseVersionByPubkey[agent.pubkey] ?? 0}
                        shakeVersion={shakeVersionByPubkey[agent.pubkey] ?? 0}
                      />
                      <span className="c3c-chip-name">{agent.displayName}</span>
                      <Tooltip disableHoverableContent>
                        <TooltipTrigger asChild>
                          <button
                            aria-label={`Don't automatically mention ${agent.displayName} in this thread`}
                            className="c3c-chip-remove"
                            data-testid={`composer-address-lock-remove-${agent.pubkey}`}
                            disabled={disabled}
                            onClick={() => onRemove(agent.pubkey)}
                            type="button"
                          >
                            <CloseGlyph size={12} strokeWidth={2.4} />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>
                          Don't automatically mention {agent.displayName} in
                          this thread{" "}
                          <AgentManagementMarker pubkey={agent.pubkey} />
                        </TooltipContent>
                      </Tooltip>
                    </motion.span>
                  ))}
                </AnimatePresence>
                <RemainingAgentCount count={hiddenCount} />
              </motion.span>
            ) : null}
          </AnimatePresence>
        </div>
      </PopoverAnchor>
      {confirmationTitle ? (
        <PopoverContent
          align="center"
          aria-live="polite"
          className="flex max-w-[calc(100vw-2rem)] items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs"
          collisionPadding={8}
          data-testid="composer-auto-pin-confirmation"
          onCloseAutoFocus={(event) => event.preventDefault()}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onPointerEnter={() => onConfirmationHoverChange?.(true)}
          onPointerLeave={() => onConfirmationHoverChange?.(false)}
          side="right"
          sideOffset={8}
          style={{ width: "max-content" }}
        >
          <span className="whitespace-nowrap">{confirmationTitle}</span>
          <button
            className="shrink-0 rounded-md px-1.5 py-1 font-medium text-primary outline-hidden hover:bg-primary/10 focus-visible:ring-1 focus-visible:ring-ring"
            onClick={onConfirmationTurnOff}
            onMouseDown={(event) => event.preventDefault()}
            type="button"
          >
            Turn off
          </button>
        </PopoverContent>
      ) : null}
    </Popover>
  );
}

export function ComposerSendButton({
  isSending,
  label,
  onFinishVoiceNote,
  sendDisabled,
  variant = "toolbar",
}: {
  isSending: boolean;
  /** Overrides the accessible name, e.g. "Send reply" or "Save edit". */
  label?: string;
  onFinishVoiceNote?: () => void;
  sendDisabled: boolean;
  /** `inline` is the 40px send button beside the editor in compact states. */
  variant?: "toolbar" | "inline" | "save";
}) {
  const isFinishingVoiceNote = onFinishVoiceNote != null;
  return (
    <button
      aria-label={
        isFinishingVoiceNote
          ? "Finish voice note"
          : isSending
            ? "Sending"
            : (label ?? "Send message")
      }
      className="c3c-send"
      data-testid={isFinishingVoiceNote ? "finish-voice-note" : "send-message"}
      data-variant={variant}
      disabled={sendDisabled || isSending}
      onClick={onFinishVoiceNote}
      type={isFinishingVoiceNote ? "button" : "submit"}
    >
      {isFinishingVoiceNote ? (
        <StopGlyph />
      ) : isSending ? (
        <SendSpinner />
      ) : variant === "save" ? (
        <CheckGlyph />
      ) : (
        <SendGlyph size={variant === "inline" ? 17 : 18} />
      )}
    </button>
  );
}

function SendSpinner() {
  return (
    <span
      aria-hidden
      className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
    />
  );
}
