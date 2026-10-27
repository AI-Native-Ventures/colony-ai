import * as React from "react";
import { OtherSetupAgentMarker } from "@/features/agents/ui/OtherSetupAgentMarker";
import type { TeamMentionMember } from "@/features/messages/lib/mentionCandidates";
import { ProfileAvatar } from "@/features/profile/ui/ProfileAvatar";

import { cn } from "@/shared/lib/cn";
import { POPOVER_CUSTOM_ENTER_MOTION_CLASS } from "@/shared/ui/popoverSurface";
import { Switch } from "@/shared/ui/switch";
import { Toggle } from "@/shared/ui/toggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";
import { safeNpub } from "@/shared/lib/nostrUtils";
import { truncateNpub } from "@/shared/lib/pubkey";
import { getPlatformKeysById } from "@/shared/lib/keyboard-shortcuts";
import { PinGlyph } from "./ComposerIcons";

export type MentionSuggestion = {
  pubkey?: string;
  personaId?: string;
  teamId?: string;
  teamMembers?: TeamMentionMember[];
  kind?: "identity" | "persona" | "team";
  displayName: string;
  avatarUrl?: string | null;
  isAgent?: boolean;
  agentProvenance?: "managed-here" | "managed-elsewhere";
  notInChannel?: boolean;
  ownerLabel?: string | null;
  role?: string | null;
  /** Job title from the team's position record; set by the menu itself. */
  jobTitle?: string | null;
};

type MentionAutocompleteProps = {
  suggestions: MentionSuggestion[];
  selectedIndex: number;
  /** Whether the owning composer currently owns document focus. */
  composerOwnsFocus: boolean;
  onFetchMore?: () => void;
  onSelect: (suggestion: MentionSuggestion) => void;
  lockedAgentPubkeys?: ReadonlySet<string>;
  onToggleAlwaysAddressAgent?: (suggestion: MentionSuggestion) => void;
  keepMentionedAgentsPinned?: boolean;
  onKeepMentionedAgentsPinnedChange?: (value: boolean) => void;
  openOptionsRequest?: number;
  onOptionsRevealComplete?: (request: number) => void;
  onDismiss?: () => void;
  /** Job title for a person or agent; the owning composer reads the team list. */
  lookupJobTitle?: (pubkey: string | null | undefined) => string | null;
  position?: "above" | "below";
};

const NO_JOB_TITLE = () => null;

/** Shown on an agent of the person's own that this device does not run. */
const NOT_ON_THIS_MAC_HINT = "Not on this Mac";

export function showMentionAgentProvenanceMarker(
  suggestion: MentionSuggestion,
): boolean {
  return suggestion.agentProvenance === "managed-elsewhere";
}

/** Focus the now-always-visible automatic-mentions switch. */
export function focusMentionOptionsTrigger(
  container: HTMLElement | null,
): boolean {
  const trigger = container?.querySelector<HTMLElement>(
    '[data-testid="mention-keep-agents-pinned-toggle"]',
  );
  if (!trigger) return false;
  trigger.focus();
  return true;
}

export const MentionAutocomplete = React.memo(function MentionAutocomplete({
  suggestions,
  selectedIndex,
  composerOwnsFocus = true,
  onFetchMore,
  onSelect,
  lockedAgentPubkeys,
  onToggleAlwaysAddressAgent,
  keepMentionedAgentsPinned = true,
  onKeepMentionedAgentsPinnedChange,
  openOptionsRequest = 0,
  onOptionsRevealComplete,
  onDismiss,
  lookupJobTitle = NO_JOB_TITLE,
  position = "above",
}: MentionAutocompleteProps) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const optionsSurfaceRef = React.useRef<HTMLDivElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);
  const keepPinnedSwitchId = React.useId();
  const handledOptionsRequestRef = React.useRef(0);
  const alwaysAddressShortcut = getPlatformKeysById("always-address-agent");

  React.useEffect(() => {
    const activeItem = listRef.current?.querySelector<HTMLElement>(
      `[data-mention-suggestion-index="${selectedIndex}"]`,
    );
    activeItem?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  React.useEffect(() => {
    if (openOptionsRequest <= handledOptionsRequestRef.current) return;
    handledOptionsRequestRef.current = openOptionsRequest;
    onOptionsRevealComplete?.(openOptionsRequest);
  }, [onOptionsRevealComplete, openOptionsRequest]);

  React.useEffect(() => {
    if (!onDismiss) return;

    const handlePointerDown = (event: PointerEvent) => {
      const root = rootRef.current;
      const target = event.target;
      if (!root || !(target instanceof Node)) return;
      if (
        listRef.current?.contains(target) ||
        optionsSurfaceRef.current?.contains(target)
      ) {
        return;
      }

      const composer = root.closest("form");
      const mentionTrigger =
        target instanceof Element
          ? target.closest("[data-mention-picker-trigger]")
          : null;
      if (composer && mentionTrigger && composer.contains(mentionTrigger)) {
        return;
      }

      onDismiss();
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    return () =>
      document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [onDismiss]);

  const handleScroll = React.useCallback(() => {
    const list = listRef.current;
    if (!list || !onFetchMore) return;

    if (list.scrollHeight - list.scrollTop - list.clientHeight < 48) {
      onFetchMore();
    }
  }, [onFetchMore]);

  const handleOverlayKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      rootRef.current
        ?.closest("form")
        ?.querySelector<HTMLElement>('[data-testid="message-input"]')
        ?.focus();
      onDismiss?.();
    },
    [onDismiss],
  );

  if (!composerOwnsFocus || suggestions.length === 0) {
    return null;
  }

  // Name collisions are the impersonation vector: a vanity-ground key can
  // wear any display name. When two suggestions share a name, surface each
  // one's npub (truncated; full key in the hover tooltip) to tell them apart.
  const nameCounts = new Map<string, number>();
  for (const suggestion of suggestions) {
    const name = suggestion.displayName.toLowerCase();
    nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the overlay's controls own keyboard interaction; Escape returns focus to the editor.
    <div
      className={cn(
        "c3c-mention-layer",
        position === "below"
          ? "c3c-mention-layer-below"
          : "c3c-mention-layer-above",
      )}
      data-testid="mention-autocomplete-layer"
      onKeyDown={handleOverlayKeyDown}
      ref={rootRef}
    >
      <div
        className={cn(
          "c3c-mention-card",
          POPOVER_CUSTOM_ENTER_MOTION_CLASS,
          position === "below" ? "origin-top" : "origin-bottom",
        )}
      >
        {onKeepMentionedAgentsPinnedChange ? (
          // biome-ignore lint/a11y/noStaticElementInteractions: pointer-only guard, no behavior of its own: an unprevented mousedown on this surface (its padding, the switch's label) blurs the editor, and the focus gate above would unmount the overlay before the click lands.
          <div
            className="c3c-mention-head"
            data-testid="mention-options-settings"
            onMouseDown={(event) => event.preventDefault()}
            ref={optionsSurfaceRef}
          >
            <span className="c3c-mention-head-copy">
              <span className="c3c-mention-eyebrow">People and agents</span>
              <span className="c3c-mention-hint">
                Address selected agents in thread replies
              </span>
            </span>
            <span className="c3c-mention-pin-label">
              {/* biome-ignore lint/a11y/useKeyWithClickEvents: pointer-only label affordance; the associated switch remains the keyboard path. */}
              <label
                htmlFor={keepPinnedSwitchId}
                onClick={(event) => {
                  event.preventDefault();
                  onKeepMentionedAgentsPinnedChange(!keepMentionedAgentsPinned);
                }}
              >
                Automatically mention agents
              </label>
              <Switch
                aria-label="Automatically mention agents"
                checked={keepMentionedAgentsPinned}
                className="c3c-mention-switch"
                data-testid="mention-keep-agents-pinned-toggle"
                id={keepPinnedSwitchId}
                onCheckedChange={onKeepMentionedAgentsPinnedChange}
                onMouseDown={(event) => event.preventDefault()}
              />
            </span>
          </div>
        ) : null}
        {/* biome-ignore lint/a11y/noStaticElementInteractions: pointer-only guard keeps padding and scrollbar presses from blurring the owning editor. */}
        <div
          className="c3c-mention-list"
          data-testid="mention-autocomplete"
          onMouseDown={(event) => event.preventDefault()}
          onScroll={handleScroll}
          ref={listRef}
        >
          {suggestions.map((suggestion, index) => {
            const suggestionKey =
              suggestion.pubkey ??
              (suggestion.personaId
                ? `persona-${suggestion.personaId}`
                : null) ??
              (suggestion.teamId ? `team-${suggestion.teamId}` : null) ??
              suggestion.displayName;
            const hasNameCollision =
              (nameCounts.get(suggestion.displayName.toLowerCase()) ?? 0) > 1;
            const showAgentProvenanceMarker =
              showMentionAgentProvenanceMarker(suggestion);
            const ownerLabel =
              hasNameCollision && suggestion.agentProvenance
                ? null
                : suggestion.ownerLabel;
            const collisionNpub =
              hasNameCollision && suggestion.pubkey
                ? safeNpub(suggestion.pubkey)
                : null;
            const jobTitle =
              suggestion.jobTitle ?? lookupJobTitle(suggestion.pubkey);
            // People show their job title (or their admin role when they have
            // none); agents show title, owner and channel membership.
            const personSubtitle =
              !suggestion.isAgent && suggestion.kind !== "team"
                ? (jobTitle ?? suggestion.role ?? null)
                : null;
            const agentSubtitleParts: string[] = [];
            if (suggestion.isAgent) {
              if (jobTitle) agentSubtitleParts.push(jobTitle);
              if (ownerLabel)
                agentSubtitleParts.push(`managed by ${ownerLabel}`);
              // The cloud marker alone cannot tell two Scouts apart. When
              // another row shares the name, say it in words.
              if (hasNameCollision && showAgentProvenanceMarker) {
                agentSubtitleParts.push(NOT_ON_THIS_MAC_HINT);
              }
              if (suggestion.notInChannel) {
                agentSubtitleParts.push("not in channel");
              }
            } else if (suggestion.notInChannel && suggestion.kind !== "team") {
              agentSubtitleParts.push("not in channel");
            }
            const subtitle =
              suggestion.kind === "team"
                ? `team · ${suggestion.teamMembers?.length ?? 0} agents`
                : (personSubtitle ?? agentSubtitleParts.join(" · "));
            const canAlwaysAddress = Boolean(
              onToggleAlwaysAddressAgent &&
                suggestion.isAgent &&
                suggestion.pubkey,
            );
            const isAlwaysAddressed = Boolean(
              suggestion.pubkey &&
                lockedAgentPubkeys?.has(suggestion.pubkey.toLowerCase()),
            );

            return (
              <div
                className="c3c-mention-row"
                data-selected={index === selectedIndex ? "true" : undefined}
                data-testid={`mention-suggestion-${suggestionKey}`}
                data-mention-suggestion-index={index}
                key={suggestionKey}
              >
                <button
                  aria-label={`Mention ${suggestion.displayName}`}
                  className="c3c-mention-main"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    onSelect(suggestion);
                  }}
                  tabIndex={-1}
                  type="button"
                >
                  {suggestion.kind === "team" ? (
                    <span className="c3c-mention-team" aria-hidden="true">
                      {(suggestion.teamMembers ?? [])
                        .slice(0, 3)
                        .map((member) => (
                          <ProfileAvatar
                            avatarUrl={null}
                            className="c3c-mention-team-cell"
                            key={
                              member.pubkey ??
                              member.personaId ??
                              member.displayName
                            }
                            label={member.displayName}
                            shape="squircle"
                          />
                        ))}
                    </span>
                  ) : (
                    <ProfileAvatar
                      avatarUrl={suggestion.avatarUrl ?? null}
                      className={
                        suggestion.isAgent || suggestion.kind === "persona"
                          ? "c3c-mention-avatar"
                          : "c3c-mention-avatar c3c-mention-avatar-person"
                      }
                      label={suggestion.displayName}
                      shape={
                        suggestion.isAgent || suggestion.kind === "persona"
                          ? "squircle"
                          : "circle"
                      }
                      testId="mention-suggestion-avatar"
                    />
                  )}
                  <span className="c3c-mention-text">
                    <span
                      className="c3c-mention-name"
                      title={suggestion.displayName}
                    >
                      {suggestion.displayName}
                      {suggestion.isAgent ? (
                        <span
                          className="c3c-mention-pill"
                          data-testid="mention-agent-icon"
                        >
                          agent
                        </span>
                      ) : null}
                      {showAgentProvenanceMarker ? (
                        <OtherSetupAgentMarker testId="mention-agent-provenance" />
                      ) : null}
                    </span>
                    {subtitle || collisionNpub ? (
                      <span className="c3c-mention-sub">
                        {subtitle ? (
                          <span className="min-w-0 truncate" title={subtitle}>
                            {subtitle}
                          </span>
                        ) : null}
                        {collisionNpub ? (
                          <span
                            className="shrink-0 font-mono"
                            data-testid="mention-collision-npub"
                            title={collisionNpub}
                          >
                            {truncateNpub(collisionNpub)}
                          </span>
                        ) : null}
                      </span>
                    ) : null}
                  </span>
                </button>
                {canAlwaysAddress ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="c3c-mention-pin">
                        <Toggle
                          aria-label={`${isAlwaysAddressed ? "Don't automatically mention" : "Automatically mention"} ${suggestion.displayName}${isAlwaysAddressed ? " in this thread" : ""}`}
                          className="c3c-mention-pin-toggle"
                          data-always-address-pubkey={suggestion.pubkey?.toLowerCase()}
                          data-testid={`mention-always-address-${suggestion.pubkey}`}
                          onPressedChange={() =>
                            onToggleAlwaysAddressAgent?.(suggestion)
                          }
                          onClick={(event) => event.stopPropagation()}
                          onMouseDown={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                          }}
                          pressed={isAlwaysAddressed}
                          size="xs"
                          type="button"
                        >
                          <span
                            className="inline-flex"
                            data-testid="mention-auto-pin-icon"
                          >
                            <PinGlyph
                              className={
                                isAlwaysAddressed ? "fill-current" : undefined
                              }
                            />
                          </span>
                        </Toggle>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent
                      className="flex items-center gap-2"
                      side="top"
                    >
                      <span>
                        {isAlwaysAddressed
                          ? "Don't automatically mention in this thread"
                          : "Automatically mention"}
                      </span>
                      {alwaysAddressShortcut ? (
                        <kbd className="flex items-center gap-0.5 rounded border border-secondary-foreground/20 bg-secondary-foreground/10 px-1 py-0 font-mono text-sm text-secondary-foreground">
                          {(alwaysAddressShortcut.includes("+")
                            ? alwaysAddressShortcut.split("+")
                            : Array.from(alwaysAddressShortcut)
                          ).map((key) => (
                            <span key={key}>{key}</span>
                          ))}
                        </kbd>
                      ) : null}
                    </TooltipContent>
                  </Tooltip>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
});
