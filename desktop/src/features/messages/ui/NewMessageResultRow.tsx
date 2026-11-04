import { AgentManagementMarker } from "@/features/agents/ui/OtherSetupAgentMarker";

import { useJobTitleLookup } from "@/features/company-team/useJobTitleLookup";
import {
  resolveIdentityLabel,
  type UserProfileLookup,
} from "@/features/profile/lib/identity";
import { IdentityLabelText } from "@/features/profile/ui/IdentityLabelText";
import { ProfileAvatar } from "@/features/profile/ui/ProfileAvatar";
import type { UserSearchResult } from "@/shared/api/types";

/**
 * A single selectable person/agent row in the new-message directory.
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
  const identityLabel = resolveIdentityLabel({
    pubkey: user.pubkey,
    currentPubkey,
    fallbackName: user.displayName ?? user.nip05Handle,
    ownerProfiles,
    isAgent: user.isAgent,
    ownerPubkey: user.ownerPubkey,
  });
  const name = identityLabel.text;
  const lookupJobTitle = useJobTitleLookup();
  const jobTitle = lookupJobTitle(user.pubkey);
  const subtitle = [jobTitle].filter(Boolean).join(" · ");

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
        pubkey={user.pubkey}
        shape={user.isAgent ? "squircle" : "circle"}
      />
      <span className="c3nm-row-text">
        <span className="c3nm-row-line">
          <IdentityLabelText
            className="c3nm-name w-fit max-w-full"
            label={identityLabel}
          />
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
