import { nip19 } from "nostr-tools";
import * as React from "react";
import { toast } from "sonner";

import {
  useAddRelayMemberMutation,
  useChangeRelayMemberRoleMutation,
  useMyRelayMembershipLookupQuery,
  useRelayMembersQuery,
  useRemoveRelayMemberMutation,
} from "@/features/community-members/hooks";
import { useUsersBatchQuery } from "@/features/profile/hooks";
import { ProfileAvatar } from "@/features/profile/ui/ProfileAvatar";
import { UserProfilePopover } from "@/features/profile/ui/UserProfilePopover";
import { mintInvite } from "@/shared/api/invites";
import { CommunityInviteDialog } from "./CommunityInviteDialog";
import type {
  RelayMember,
  RelayMemberRole,
  UserProfileSummary,
} from "@/shared/api/types";
import { writeTextToClipboard } from "@/shared/lib/clipboard";
import { normalizePubkey } from "@/shared/lib/pubkey";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { VirtualizedList } from "@/shared/ui/VirtualizedList";
import { DEFAULT_INVITE_TTL_SECS } from "./InviteLinkSection";

function formatDisplayName(member: RelayMember, displayName?: string | null) {
  const trimmedDisplayName = displayName?.trim();
  if (
    trimmedDisplayName &&
    !trimmedDisplayName.toLowerCase().startsWith("npub1")
  ) {
    return trimmedDisplayName;
  }
  return member.role === "owner" ? "Community owner" : "Unnamed member";
}

function npubFromPubkey(pubkey: string): string | null {
  try {
    return nip19.npubEncode(pubkey);
  } catch {
    return null;
  }
}

/** A person's job title, when their profile carries one. */
function jobTitleOf(profile: UserProfileSummary | undefined): string {
  const title = (profile as { jobTitle?: string | null } | undefined)?.jobTitle;
  return title?.trim() ?? "";
}

function roleLabel(role: RelayMemberRole) {
  return role === "owner" ? "Owner" : role === "admin" ? "Admin" : "Member";
}

/** Reads an npub or a 64-character hex key; anything else is not a key. */
function pubkeyFromInput(value: string): string | null {
  const trimmed = value.trim();
  if (/^[0-9a-f]{64}$/i.test(trimmed)) return trimmed.toLowerCase();
  if (trimmed.toLowerCase().startsWith("npub1")) {
    try {
      const decoded = nip19.decode(trimmed);
      return decoded.type === "npub" ? decoded.data : null;
    } catch {
      return null;
    }
  }
  return null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function MoreIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="currentColor"
      height="1.125rem"
      viewBox="0 0 24 24"
      width="1.125rem"
    >
      <circle cx="5.5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="18.5" cy="12" r="1.8" />
    </svg>
  );
}

function RelayMemberRow({
  currentRole,
  currentPubkey,
  profile,
  member,
}: {
  currentRole: RelayMemberRole;
  currentPubkey?: string;
  profile?: UserProfileSummary;
  member: RelayMember;
}) {
  const removeMutation = useRemoveRelayMemberMutation();
  const changeRoleMutation = useChangeRelayMemberRoleMutation();
  const isSelf = currentPubkey
    ? normalizePubkey(currentPubkey) === normalizePubkey(member.pubkey)
    : false;
  const isBusy = removeMutation.isPending || changeRoleMutation.isPending;
  const canRemove =
    !isSelf &&
    member.role !== "owner" &&
    (currentRole === "owner" || member.role === "member");
  const canChangeRole = currentRole === "owner" && member.role !== "owner";
  const displayName = formatDisplayName(member, profile?.displayName);
  const subtitle = jobTitleOf(profile) || roleLabel(member.role);

  async function mutateWithToast(
    action: () => Promise<unknown>,
    success: string,
  ) {
    try {
      await action();
      toast.success(success);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Couldn’t update this community member.",
      );
    }
  }

  return (
    <div
      className="cs-member"
      data-testid={`relay-member-row-${member.pubkey}`}
    >
      <UserProfilePopover
        pubkey={member.pubkey}
        triggerAriaLabel={`Open profile for ${displayName}`}
        triggerElement="span"
      >
        <ProfileAvatar
          avatarUrl={profile?.avatarUrl ?? null}
          className="cs-member-avatar"
          label={displayName}
          shape={profile?.isAgent === true ? "squircle" : "circle"}
        />
      </UserProfilePopover>
      <span className="cs-member-copy">
        <span
          className="cs-member-name"
          data-testid={`relay-member-name-${member.pubkey}`}
        >
          {displayName}
          {isSelf ? <em> · you</em> : null}
        </span>
        <span className="cs-member-title">{subtitle}</span>
      </span>
      {member.role === "owner" ? (
        <span className="cs-badge cs-badge-large" data-tone="accent">
          Owner
        </span>
      ) : (
        <>
          <label className="sr-only" htmlFor={`member-role-${member.pubkey}`}>
            Role for {displayName}
          </label>
          <select
            className="cs-select cs-select-member"
            data-testid={`relay-member-role-${member.pubkey}`}
            disabled={!canChangeRole || isBusy}
            id={`member-role-${member.pubkey}`}
            onChange={(event) =>
              void mutateWithToast(
                () =>
                  changeRoleMutation.mutateAsync({
                    pubkey: member.pubkey,
                    role: event.target.value,
                  }),
                event.target.value === "admin"
                  ? "Made community admin"
                  : "Made community member",
              )
            }
            value={member.role}
          >
            <option value="admin">Admin</option>
            <option value="member">Member</option>
          </select>
          {canRemove ? (
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <button
                  aria-label={`Actions for ${displayName}`}
                  className="cs-icon-ghost"
                  data-testid={`relay-member-actions-${member.pubkey}`}
                  disabled={isBusy}
                  type="button"
                >
                  <MoreIcon />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() =>
                    void mutateWithToast(
                      () => removeMutation.mutateAsync(member.pubkey),
                      "Removed community member",
                    )
                  }
                >
                  Remove from community
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <span aria-hidden="true" className="cs-icon-ghost" />
          )}
        </>
      )}
    </div>
  );
}

/**
 * The invite form on the People & access page. A key (npub or hex) adds that
 * person at once with the chosen role; an email address mints the community's
 * invite link and copies it, because Colony does not send email yet.
 */
function InviteForm({ isOwner }: { isOwner: boolean }) {
  const addMember = useAddRelayMemberMutation();
  const [value, setValue] = React.useState("");
  const [role, setRole] = React.useState<"member" | "admin">("member");
  const [message, setMessage] = React.useState<{
    tone: "ok" | "bad";
    text: string;
  } | null>(null);
  const [pending, setPending] = React.useState(false);
  const [dialogOpen, setDialogOpen] = React.useState(false);

  async function copyInviteLink(): Promise<boolean> {
    try {
      const invite = await mintInvite({
        ttlSecs: DEFAULT_INVITE_TTL_SECS,
        maxUses: null,
      });
      await writeTextToClipboard(invite.url);
      return true;
    } catch {
      return false;
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const entry = value.trim();
    setMessage(null);
    if (!entry) {
      setMessage({ tone: "bad", text: "Enter an email address to invite." });
      return;
    }
    const pubkey = pubkeyFromInput(entry);
    setPending(true);
    try {
      if (pubkey) {
        await addMember.mutateAsync({ pubkey, role });
        setValue("");
        setMessage({ tone: "ok", text: "Added to the community." });
        return;
      }
      if (!EMAIL.test(entry)) {
        setMessage({ tone: "bad", text: "Enter a valid email address." });
        return;
      }
      if (await copyInviteLink()) {
        setMessage({
          tone: "ok",
          text: `Invite link copied. Colony does not email invites yet, so paste it into your message to ${entry}.`,
        });
        setValue("");
      } else {
        setMessage({ tone: "bad", text: "Couldn’t create an invite link." });
      }
    } catch (error) {
      setMessage({
        tone: "bad",
        text:
          error instanceof Error
            ? error.message
            : "Couldn’t add this person to the community.",
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <form
        aria-label="Invite someone"
        className="cs-card cs-invite"
        data-testid="community-invite-form"
        onSubmit={(event) => void handleSubmit(event)}
      >
        <div className="cs-field cs-invite-email">
          <label className="cs-label" htmlFor="invite-email">
            Invite by email
          </label>
          <input
            autoCapitalize="none"
            autoCorrect="off"
            className="cs-input"
            data-testid="community-invite-input"
            id="invite-email"
            onChange={(event) => setValue(event.target.value)}
            placeholder="name@business.com"
            spellCheck={false}
            type="text"
            value={value}
          />
        </div>
        <div className="cs-field cs-invite-role">
          <label className="cs-label" htmlFor="invite-role">
            Role
          </label>
          <select
            className="cs-select"
            data-testid="community-invite-role"
            id="invite-role"
            onChange={(event) =>
              setRole(event.target.value as "member" | "admin")
            }
            value={role}
          >
            <option value="member">Member</option>
            {isOwner ? <option value="admin">Admin</option> : null}
          </select>
        </div>
        <button
          className="cs-primary"
          data-testid="community-invite-send"
          disabled={pending}
          type="submit"
        >
          Send invite
        </button>
        <button
          className="cs-button cs-button-large cs-button-copy"
          data-testid="community-invite-dialog-trigger"
          disabled={pending}
          onClick={() => setDialogOpen(true)}
          type="button"
        >
          Copy invite link
        </button>
      </form>
      <CommunityInviteDialog
        isOwner={isOwner}
        onOpenChange={setDialogOpen}
        open={dialogOpen}
      />
      {message ? (
        <p
          className="cs-notice"
          data-tone={message.tone}
          role={message.tone === "bad" ? "alert" : "status"}
        >
          {message.text}
        </p>
      ) : null}
    </>
  );
}

function ShieldIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="1rem"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2.2"
      viewBox="0 0 24 24"
      width="1rem"
    >
      <path d="M12 3.5 19 6v6c0 4.5-3 7.5-7 8.5-4-1-7-4-7-8.5V6z" />
    </svg>
  );
}

function SearchGlyph() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="0.9375rem"
      stroke="currentColor"
      strokeLinecap="round"
      strokeWidth="2.2"
      viewBox="0 0 24 24"
      width="0.9375rem"
    >
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4-4" />
    </svg>
  );
}

export function CommunityMembersSettingsCard({
  currentPubkey,
  onBack,
  onOpenTeam,
}: {
  onBack?: () => void;
  onOpenTeam?: () => void;
  currentPubkey?: string;
}) {
  const myMembershipQuery = useMyRelayMembershipLookupQuery();
  const currentRole = myMembershipQuery.data?.membership?.role ?? null;
  const canManageRelay = currentRole === "owner" || currentRole === "admin";
  const membersQuery = useRelayMembersQuery(canManageRelay);
  const members = React.useMemo(
    () => membersQuery.data ?? [],
    [membersQuery.data],
  );
  const profilesQuery = useUsersBatchQuery(
    members.map((member) => member.pubkey),
    {
      enabled: canManageRelay && members.length > 0,
    },
  );
  const profiles = profilesQuery.data?.profiles;
  const [search, setSearch] = React.useState("");

  const filteredMembers = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return members;
    return members.filter((member) => {
      const normalizedPubkey = normalizePubkey(member.pubkey);
      const profile = profiles?.[normalizedPubkey];
      const displayName = profile?.displayName?.toLowerCase() ?? "";
      const nip05 = profile?.nip05Handle?.toLowerCase() ?? "";
      const title = jobTitleOf(profile).toLowerCase();
      const npub = npubFromPubkey(member.pubkey)?.toLowerCase() ?? "";
      return (
        displayName.includes(q) ||
        nip05.includes(q) ||
        title.includes(q) ||
        npub.includes(q) ||
        member.pubkey.toLowerCase().includes(q) ||
        member.role.includes(q)
      );
    });
  }, [members, profiles, search]);

  const heading = (
    <div className="cs-people-head">
      <h2 className="cs-section-title" id="people-access-title">
        People &amp; access
      </h2>
      <span className="cs-section-note">
        Invite people and choose what they can manage. AI employees are managed
        in{" "}
        <button
          className="cs-link"
          data-testid="people-open-team"
          onClick={onOpenTeam}
          type="button"
        >
          Team
        </button>
        .
      </span>
    </div>
  );

  if (myMembershipQuery.isLoading) {
    return (
      <div className="cs-led" data-testid="settings-community-members">
        {heading}
        <p aria-busy="true" className="cs-section-note" role="status">
          Checking permissions…
        </p>
      </div>
    );
  }

  if (!canManageRelay || !currentRole) {
    return (
      <div className="cs-led" data-testid="settings-community-members">
        {heading}
        <div className="cs-card cs-card-body">
          <p
            className="cs-section-note"
            role={myMembershipQuery.isError ? "alert" : undefined}
          >
            {myMembershipQuery.isError
              ? "Could not check your access. Try again."
              : "Only workspace owners and administrators can manage people and access."}
          </p>
          <div className="cs-confirm-actions">
            {myMembershipQuery.isError ? (
              <button
                className="cs-button"
                onClick={() => void myMembershipQuery.refetch()}
                type="button"
              >
                Retry
              </button>
            ) : null}
            <button className="cs-button" onClick={onBack} type="button">
              Back to business
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="cs-led cs-led-tight"
      data-testid="settings-community-members"
    >
      {heading}
      <InviteForm isOwner={currentRole === "owner"} />

      <section aria-labelledby="members-title" className="cs-card">
        <div className="cs-members-bar">
          <h3 className="cs-eyebrow" id="members-title">
            Members
            {members.length > 0 ? ` · ${members.length}` : ""}
          </h3>
          <label className="cs-member-search">
            <SearchGlyph />
            <input
              aria-label="Find a member"
              autoCapitalize="none"
              autoCorrect="off"
              data-testid="community-members-search"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Find a member"
              spellCheck={false}
              type="search"
              value={search}
            />
          </label>
        </div>

        {membersQuery.error instanceof Error ? (
          <p className="cs-notice" data-tone="bad">
            {membersQuery.error.message}
          </p>
        ) : null}

        {membersQuery.isLoading ? (
          <p className="cs-members-empty">Loading community members…</p>
        ) : members.length === 0 ? (
          <p className="cs-members-empty">No community members yet.</p>
        ) : filteredMembers.length === 0 ? (
          <p className="cs-members-empty">No members match your search.</p>
        ) : (
          <VirtualizedList
            className="cs-members-list"
            estimateSize={69}
            getItemKey={(member) => member.pubkey}
            items={filteredMembers}
            renderItem={(member) => (
              <RelayMemberRow
                currentPubkey={currentPubkey}
                currentRole={currentRole}
                member={member}
                profile={profiles?.[normalizePubkey(member.pubkey)]}
              />
            )}
          />
        )}
      </section>

      <p className="cs-people-foot">
        <ShieldIcon />
        Only workspace owners and administrators can invite people or change
        roles.
      </p>
    </div>
  );
}
