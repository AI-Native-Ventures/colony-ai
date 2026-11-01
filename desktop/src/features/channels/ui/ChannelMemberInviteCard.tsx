import * as React from "react";

import { parsePubkeyInput } from "@/shared/lib/nostrUtils";
import { truncateNpub } from "@/shared/lib/pubkey";
import { useIsArchivedPredicate } from "@/features/identity-archive/hooks";
import { useUserSearchQuery } from "@/features/profile/hooks";
import type {
  AddChannelMembersResult,
  ChannelMember,
  UserSearchResult,
} from "@/shared/api/types";
import { ProfileAvatar } from "@/features/profile/ui/ProfileAvatar";
import {
  AskCloseIcon,
  AskHireIcon,
  AskSearchIcon,
} from "@/features/company-asks/ui/askIcons";

function formatSearchUserName(user: UserSearchResult) {
  return (
    user.displayName?.trim() ||
    user.nip05Handle?.trim() ||
    truncateNpub(user.pubkey)
  );
}

export function ChannelMemberInviteCard({
  canAssignElevatedRoles,
  existingMembers,
  isPending,
  onSubmit,
  open,
  requestErrorMessage,
  footerNote,
  onCancel,
}: {
  canAssignElevatedRoles: boolean;
  existingMembers: ChannelMember[];
  isPending: boolean;
  onSubmit: (input: {
    pubkeys: string[];
    role: Exclude<ChannelMember["role"], "owner">;
  }) => Promise<AddChannelMembersResult>;
  open: boolean;
  requestErrorMessage?: string | null;
  /** A line under the member box, above the buttons. */
  footerNote?: React.ReactNode;
  /** Shows a Cancel button next to Add members. */
  onCancel?: () => void;
}) {
  const [inviteQuery, setInviteQuery] = React.useState("");
  const [selectedInvitees, setSelectedInvitees] = React.useState<
    UserSearchResult[]
  >([]);
  const [inviteRole, setInviteRole] =
    React.useState<Exclude<ChannelMember["role"], "owner">>("member");
  const [submissionErrors, setSubmissionErrors] = React.useState<
    AddChannelMembersResult["errors"]
  >([]);

  // Only owners/admins may grant the elevated "admin" role — the relay rejects
  // it for everyone else. Hide it from the dropdown so we never offer a role
  // the server will refuse. "member", "guest", and "bot" are non-elevated and
  // any channel member may grant them.
  const availableRoles = React.useMemo<
    Exclude<ChannelMember["role"], "owner">[]
  >(
    () =>
      canAssignElevatedRoles
        ? ["member", "admin", "guest", "bot"]
        : ["member", "guest", "bot"],
    [canAssignElevatedRoles],
  );

  // Guard against a stale elevated selection if the caller's permissions change
  // while the card is mounted (e.g. the member gets demoted).
  React.useEffect(() => {
    if (!availableRoles.includes(inviteRole)) {
      setInviteRole("member");
    }
  }, [availableRoles, inviteRole]);

  const deferredInviteQuery = React.useDeferredValue(inviteQuery.trim());
  const selectedInviteePubkeys = React.useMemo(
    () =>
      new Set(selectedInvitees.map((invitee) => invitee.pubkey.toLowerCase())),
    [selectedInvitees],
  );
  const memberPubkeys = React.useMemo(
    () => new Set(existingMembers.map((member) => member.pubkey.toLowerCase())),
    [existingMembers],
  );
  const userSearchQuery = useUserSearchQuery(deferredInviteQuery, {
    enabled: open && deferredInviteQuery.length > 0,
    // Ask for more than we'll display so server-side ranking has room to be
    // refined client-side. The Tauri command clamps at 50.
    limit: 25,
  });
  const isArchivedDiscovery = useIsArchivedPredicate();
  const inviteSearchResults = React.useMemo(
    () =>
      (userSearchQuery.data ?? []).filter(
        (user) =>
          !memberPubkeys.has(user.pubkey.toLowerCase()) &&
          !selectedInviteePubkeys.has(user.pubkey.toLowerCase()) &&
          !isArchivedDiscovery(user.pubkey),
      ),
    [
      isArchivedDiscovery,
      memberPubkeys,
      selectedInviteePubkeys,
      userSearchQuery.data,
    ],
  );

  // Someone without a kind:0 profile on the relay is invisible to user
  // search — let the caller paste their npub or hex pubkey directly instead.
  const directInvitee = React.useMemo<UserSearchResult | null>(() => {
    const pubkey = parsePubkeyInput(deferredInviteQuery);
    if (
      pubkey === null ||
      memberPubkeys.has(pubkey) ||
      selectedInviteePubkeys.has(pubkey) ||
      (userSearchQuery.data ?? []).some(
        (user) => user.pubkey.toLowerCase() === pubkey,
      )
    ) {
      return null;
    }
    return {
      pubkey,
      displayName: null,
      avatarUrl: null,
      nip05Handle: null,
      ownerPubkey: null,
      isAgent: false,
    };
  }, [
    deferredInviteQuery,
    memberPubkeys,
    selectedInviteePubkeys,
    userSearchQuery.data,
  ]);

  React.useEffect(() => {
    if (!open) {
      setInviteQuery("");
      setSelectedInvitees([]);
      setSubmissionErrors([]);
    }
  }, [open]);

  const inviteTargets = selectedInvitees.map((invitee) => invitee.pubkey);

  return (
    <form
      className="ask3-invite-form"
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmit({
          pubkeys: inviteTargets,
          role: inviteRole,
        }).then((result) => {
          const addedPubkeys = new Set(
            result.added.map((pubkey) => pubkey.toLowerCase()),
          );
          setSelectedInvitees((current) =>
            current.filter(
              (invitee) => !addedPubkeys.has(invitee.pubkey.toLowerCase()),
            ),
          );
          setInviteQuery("");
          setSubmissionErrors(result.errors);
        });
      }}
    >
      <div className="ask3-invite-box">
        <div className="ask3-invite-box-head">
          <AskHireIcon size={16} />
          <span>Add members</span>
          {inviteTargets.length > 0 ? (
            <span className="ask3-invite-count">
              {inviteTargets.length} selected
            </span>
          ) : null}
        </div>
        <div>
          <label className="sr-only" htmlFor="channel-management-search-users">
            Search people
          </label>
          <div className="ask3-invite-search">
            <div className="ask3-invite-search-row">
              <AskSearchIcon className="text-colony-muted" size={16} />
              <input
                data-testid="channel-management-search-users"
                disabled={isPending}
                id="channel-management-search-users"
                onChange={(event) => setInviteQuery(event.target.value)}
                placeholder="Search people, or paste a public key"
                value={inviteQuery}
              />
            </div>
            {selectedInvitees.length > 0 ? (
              <div className="ask3-invite-chips">
                {selectedInvitees.map((invitee) => (
                  <div
                    className="ask3-invite-chip"
                    data-testid={`selected-invitee-${invitee.pubkey}`}
                    key={invitee.pubkey}
                  >
                    <ProfileAvatar
                      avatarUrl={invitee.avatarUrl ?? null}
                      className="ask3-av size-6"
                      label={formatSearchUserName(invitee)}
                      pubkey={invitee.pubkey}
                      shape={invitee.isAgent ? "squircle" : "circle"}
                    />
                    <span>{formatSearchUserName(invitee)}</span>
                    <button
                      aria-label={`Remove ${formatSearchUserName(invitee)}`}
                      onClick={() => {
                        setSelectedInvitees((current) =>
                          current.filter(
                            (candidate) => candidate.pubkey !== invitee.pubkey,
                          ),
                        );
                      }}
                      type="button"
                    >
                      <AskCloseIcon size={12} strokeWidth={2.8} />
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
            {deferredInviteQuery.length > 0 ? (
              <div className="ask3-invite-results">
                {userSearchQuery.isLoading && !directInvitee ? (
                  <p className="ask3-state-text">Searching…</p>
                ) : inviteSearchResults.length > 0 || directInvitee ? (
                  <>
                    {directInvitee ? (
                      <button
                        className="ask3-invite-result"
                        data-testid={`channel-direct-invite-${directInvitee.pubkey}`}
                        onClick={() => {
                          setSelectedInvitees((current) => [
                            ...current,
                            directInvitee,
                          ]);
                          setInviteQuery("");
                        }}
                        type="button"
                      >
                        <ProfileAvatar
                          avatarUrl={null}
                          className="ask3-av size-7"
                          label={truncateNpub(directInvitee.pubkey)}
                          pubkey={directInvitee.pubkey}
                        />
                        <span className="ask3-invite-result-name">
                          {truncateNpub(directInvitee.pubkey)}
                          <span className="ask3-hint"> by public key</span>
                        </span>
                        <span className="ask3-invite-result-add">Add</span>
                      </button>
                    ) : null}
                    {inviteSearchResults.map((result) => (
                      <button
                        className="ask3-invite-result"
                        data-testid={`channel-user-search-result-${result.pubkey}`}
                        key={result.pubkey}
                        onClick={() => {
                          setSelectedInvitees((current) => [
                            ...current,
                            result,
                          ]);
                          setInviteQuery("");
                        }}
                        type="button"
                      >
                        <ProfileAvatar
                          avatarUrl={result.avatarUrl}
                          className="ask3-av size-7"
                          label={formatSearchUserName(result)}
                          pubkey={result.pubkey}
                          shape={result.isAgent ? "squircle" : "circle"}
                        />
                        <span className="ask3-invite-result-name">
                          {formatSearchUserName(result)}
                          {result.isAgent ? (
                            <span className="ask3-hint"> agent</span>
                          ) : null}
                        </span>
                        <span className="ask3-invite-result-add">Add</span>
                      </button>
                    ))}
                  </>
                ) : (
                  <p className="ask3-state-text">No matching users.</p>
                )}
              </div>
            ) : null}
          </div>
          {userSearchQuery.error instanceof Error ? (
            <p className="ask3-error">{userSearchQuery.error.message}</p>
          ) : null}
        </div>
        <label className="ask3-invite-role" htmlFor="channel-member-role">
          Role
          <select
            data-testid="channel-management-add-role"
            disabled={isPending}
            id="channel-member-role"
            onChange={(event) =>
              setInviteRole(
                event.target.value as Exclude<ChannelMember["role"], "owner">,
              )
            }
            value={inviteRole}
          >
            {availableRoles.map((role) => (
              <option key={role} value={role}>
                {role.charAt(0).toUpperCase() + role.slice(1)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {requestErrorMessage ? (
        <p className="ask3-error">{requestErrorMessage}</p>
      ) : null}
      {submissionErrors.length > 0 ? (
        <div className="ask3-error">
          {submissionErrors.map((error) => (
            <p key={`${error.pubkey}-${error.error}`}>
              {truncateNpub(error.pubkey)}: {error.error}
            </p>
          ))}
        </div>
      ) : null}
      {footerNote}
      <div className="ask3-invite-footer">
        {onCancel ? (
          <button
            className="ask3-btn"
            data-variant="secondary"
            onClick={onCancel}
            type="button"
          >
            Cancel
          </button>
        ) : null}
        <button
          className="ask3-btn"
          data-testid="channel-management-add-members"
          disabled={isPending || inviteTargets.length === 0}
          type="submit"
        >
          {isPending ? "Adding..." : "Add members"}
        </button>
      </div>
    </form>
  );
}
