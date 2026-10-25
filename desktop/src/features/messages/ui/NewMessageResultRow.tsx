import { AgentManagementMarker } from "@/features/agents/ui/OtherSetupAgentMarker";

import { useJobTitleLookup } from "@/features/company-team/useJobTitleLookup";
import { formatOwnerLabel } from "@/features/profile/lib/identity";
import type { UserProfileLookup } from "@/features/profile/lib/identity";
import { ProfileAvatar } from "@/features/profile/ui/ProfileAvatar";
import type { UserSearchResult } from "@/shared/api/types";
import { cn } from "@/shared/lib/cn";
import { truncateNpub } from "@/shared/lib/pubkey";

import { formatRecipientName } from "./useNewMessageRecipients";

const TEXT_SWAP_BASE_CLASS =
  "min-w-0 truncate transition-[opacity,filter] duration-[250ms] ease-in-out motion-reduce:transition-none";
const TEXT_SWAP_VISIBLE_CLASS = "opacity-100 blur-0";
const TEXT_SWAP_HIDDEN_CLASS = "opacity-0 blur-0";
const TEXT_SWAP_HOVER_VISIBLE_CLASS =
  "group-hover/name:opacity-100 group-hover/name:blur-0 group-focus-visible/dm-result:opacity-100 group-focus-visible/dm-result:blur-0";
const TEXT_SWAP_HOVER_HIDDEN_CLASS =
  "group-hover/name:opacity-0 group-hover/name:blur-[2px] group-focus-visible/dm-result:opacity-0 group-focus-visible/dm-result:blur-[2px]";

function HoverRecipientIdentity({
  displayName,
  pubkey,
}: {
  displayName: string;
  pubkey: string;
}) {
  const identityLabel = truncateNpub(pubkey);

  return (
    <span
      className="group/name relative inline-flex h-5 min-w-0 max-w-full self-start leading-5"
      data-testid={`new-dm-name-${pubkey}`}
    >
      <span
        className={cn(
          TEXT_SWAP_BASE_CLASS,
          TEXT_SWAP_VISIBLE_CLASS,
          TEXT_SWAP_HOVER_HIDDEN_CLASS,
          "c3nm-name w-fit max-w-full",
        )}
      >
        {displayName}
      </span>
      <span
        className={cn(
          TEXT_SWAP_BASE_CLASS,
          TEXT_SWAP_HIDDEN_CLASS,
          TEXT_SWAP_HOVER_VISIBLE_CLASS,
          "absolute inset-y-0 left-0 font-mono text-2xs text-colony-muted",
        )}
        data-testid={`new-dm-npub-${pubkey}`}
      >
        {identityLabel}
      </span>
    </span>
  );
}

/**
 * A single selectable person/agent row in the new-message directory. Extracted
 * from the former NewDirectMessageDialog so the compose page renders identical
 * rows (avatar, agent badge, owner label, and a name-to-pubkey hover swap).
 */
export function NewMessageResultRow({
  currentPubkey,
  disabled,
  isAlreadySelected = false,
  isKeyboardHighlighted = false,
  onSelect,
  ownerProfiles,
  user,
}: {
  currentPubkey?: string;
  disabled: boolean;
  isAlreadySelected?: boolean;
  isKeyboardHighlighted?: boolean;
  onSelect: (user: UserSearchResult) => void;
  ownerProfiles?: UserProfileLookup;
  user: UserSearchResult;
}) {
  const name = formatRecipientName(user);
  const lookupJobTitle = useJobTitleLookup();
  const jobTitle = lookupJobTitle(user.pubkey);
  const ownerLabel = formatOwnerLabel(
    user.ownerPubkey,
    currentPubkey,
    ownerProfiles,
  );
  const subtitle = [
    jobTitle,
    user.isAgent && ownerLabel ? `managed by ${ownerLabel}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      aria-disabled={disabled || undefined}
      aria-label={`${isAlreadySelected ? "Already added" : "Add"} ${name}`}
      aria-selected={isAlreadySelected || isKeyboardHighlighted}
      className="c3nm-row"
      data-disabled={disabled ? "true" : undefined}
      data-keyboard-highlighted={isKeyboardHighlighted ? "true" : undefined}
      data-testid={`new-dm-result-${user.pubkey}`}
      id={`new-dm-option-${user.pubkey}`}
      onClick={() => {
        if (!disabled) onSelect(user);
      }}
      onKeyDown={(event) => {
        if (disabled) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(user);
        }
      }}
      role="option"
      tabIndex={-1}
    >
      <ProfileAvatar
        avatarUrl={user.avatarUrl}
        className="c3nm-row-avatar"
        label={name}
        shape={user.isAgent ? "squircle" : "circle"}
      />
      <span className="c3nm-row-text">
        <span className="c3nm-row-line">
          <HoverRecipientIdentity displayName={name} pubkey={user.pubkey} />
          {user.isAgent ? (
            <>
              <span className="c3nm-pill" data-testid="new-dm-agent-icon">
                agent
              </span>
              <AgentManagementMarker
                pubkey={user.pubkey}
                ownerPubkey={user.ownerPubkey}
              />
            </>
          ) : null}
        </span>
        {subtitle ? <span className="c3nm-row-sub">{subtitle}</span> : null}
      </span>
      <span
        aria-hidden="true"
        className="c3nm-add"
        data-primary={isKeyboardHighlighted ? "true" : undefined}
      >
        {isAlreadySelected
          ? "Added"
          : isKeyboardHighlighted
            ? `Add ${name.split(" ")[0]}`
            : "Add"}
      </span>
    </div>
  );
}
