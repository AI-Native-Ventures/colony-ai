import * as React from "react";

import { useMyRelayMembershipLookupQuery } from "@/features/community-members/hooks";
import { useCompanyTeamQuery } from "@/features/company-team/teamRelay";
import { useUsersBatchQuery } from "@/features/profile/hooks";
import { mintInvite, type MintedInvite } from "@/shared/api/invites";
import {
  isRelayConnectionDegraded,
  useRelayConnection,
} from "@/shared/api/useRelayConnection";
import { normalizePubkey, truncateNpub } from "@/shared/lib/pubkey";
import { writeTextToClipboard } from "@/shared/lib/clipboard";
import { Button } from "@/shared/ui/button";
import { nip19 } from "nostr-tools";

import { SettingsSectionHeader } from "./SettingsSectionHeader";

const INVITE_TTL_SECS = 7 * 24 * 60 * 60;

function memberName(
  member: { pubkey: string },
  profileName?: string | null,
): string {
  const name = profileName?.trim();
  if (name && !name.toLowerCase().startsWith("npub1")) return name;
  try {
    return truncateNpub(nip19.npubEncode(member.pubkey));
  } catch {
    return "Unnamed person";
  }
}

function MemberInviteLink({ offline }: { offline: boolean }) {
  const [invite, setInvite] = React.useState<MintedInvite | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);
  const [working, setWorking] = React.useState(false);
  const [now, setNow] = React.useState(() => Date.now());
  const inFlight = React.useRef(false);
  const hasUsableLink = Boolean(invite && invite.expiresAt * 1000 > now);

  React.useEffect(() => {
    if (!invite) return;
    const delay = Math.max(0, invite.expiresAt * 1000 - Date.now() + 50);
    const timer = window.setTimeout(() => setNow(Date.now()), delay);
    return () => window.clearTimeout(timer);
  }, [invite]);

  async function copyInvite() {
    const reusable = invite && invite.expiresAt > Date.now() / 1000;
    if (inFlight.current || (offline && !reusable)) return;
    inFlight.current = true;
    setWorking(true);
    setError(null);
    setCopied(false);
    try {
      // Reuse an issued link while valid. A failed clipboard write must not
      // mint another durable invite on the next click.
      const current = reusable
        ? invite
        : await mintInvite({ ttlSecs: INVITE_TTL_SECS, maxUses: 1 });
      if (current.expiresAt <= Date.now() / 1000) {
        throw new Error("This invite already expired. Try again.");
      }
      setNow(Date.now());
      setInvite(current);
      try {
        await writeTextToClipboard(current.url);
        setCopied(true);
      } catch {
        setError("Couldn’t copy the link. Select it below to copy manually.");
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The invite link could not be created. Try again.",
      );
    } finally {
      inFlight.current = false;
      setWorking(false);
    }
  }

  return (
    <section className="grid min-w-0 gap-3 border-t border-border/70 pt-6">
      <div className="grid gap-1">
        <h2 className="text-sm font-semibold">Invite someone</h2>
        <p className="text-xs text-muted-foreground">
          A link works once and expires after 7 days.
        </p>
      </div>
      <div className="grid min-w-0 gap-3">
        <p className="text-sm text-muted-foreground">
          This link grants community member access. Partner permissions and
          invitation emails are still being built.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            data-testid="people-copy-invite"
            disabled={(offline && !hasUsableLink) || working}
            onClick={() => void copyInvite()}
            type="button"
            variant="outline"
          >
            {working ? "Preparing link…" : "Copy member invite link"}
          </Button>
          {copied ? (
            <span role="status" className="text-sm text-muted-foreground">
              Link copied. Share it with the person you want to invite.
            </span>
          ) : null}
        </div>
        {invite && hasUsableLink ? (
          <label className="grid min-w-0 gap-1 text-sm">
            <span>Invite link</span>
            <input
              aria-label="Invite link"
              className="min-h-10 w-full rounded-md border bg-background px-3 py-2 text-sm"
              onFocus={(event) => event.target.select()}
              readOnly
              value={invite.url}
            />
            <span className="text-xs text-muted-foreground">
              Save this link before leaving this page. It will not be shown
              again.
            </span>
          </label>
        ) : null}
        {invite && !hasUsableLink ? (
          <p role="status" className="text-sm text-muted-foreground">
            This invite expired. Copy a new link to share.
          </p>
        ) : null}
        {offline ? (
          <p role="status" className="text-sm text-muted-foreground">
            You’re offline. Creating an invite needs the internet.
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}

export function ColonyPeopleSettingsPanel({
  currentPubkey,
}: {
  currentPubkey?: string;
}) {
  const membership = useMyRelayMembershipLookupQuery();
  const role = membership.data?.membership?.role;
  const canManage = role === "owner" || role === "admin";
  const canViewPeople = canManage || role === "partner";
  const teamQuery = useCompanyTeamQuery(canViewPeople);
  const members = React.useMemo(
    () =>
      (teamQuery.data?.members ?? []).filter(
        (member) => member.kind === "human" && member.role !== null,
      ),
    [teamQuery.data],
  );
  const profilesQuery = useUsersBatchQuery(
    members.map((member) => member.pubkey),
    { enabled: canViewPeople && members.length > 0 },
  );
  const profiles = profilesQuery.data?.profiles;
  const people = members.filter(
    (member) => profiles?.[normalizePubkey(member.pubkey)]?.isAgent !== true,
  );
  const offline = isRelayConnectionDegraded(useRelayConnection());

  return (
    <section className="grid min-w-0 gap-6" data-testid="settings-people">
      <SettingsSectionHeader
        title="People"
        description="The people who can work with your team."
      />
      <section aria-labelledby="colony-people-heading" className="grid gap-3">
        <h2 className="text-sm font-semibold" id="colony-people-heading">
          People
        </h2>
        {membership.isPending ? (
          <div className="py-3 text-sm">
            <p role="status">Checking access…</p>
          </div>
        ) : membership.isError ? (
          <div className="flex flex-wrap items-center gap-3 py-3 text-sm">
            <p role="alert">People could not be loaded.</p>
            <Button onClick={() => void membership.refetch()} variant="outline">
              Try again
            </Button>
          </div>
        ) : !canViewPeople ? (
          <div className="py-3">
            <p className="text-sm text-muted-foreground">
              {membership.data?.membershipRequired
                ? "Your account cannot manage this company’s people."
                : "This workspace does not provide a people list yet."}
            </p>
          </div>
        ) : teamQuery.isPending ||
          (members.length > 0 && profilesQuery.isPending) ? (
          <div className="py-3 text-sm">
            <p role="status">Loading people…</p>
          </div>
        ) : teamQuery.isError ||
          (members.length > 0 && profilesQuery.isError) ? (
          <div className="flex flex-wrap items-center gap-3 py-3 text-sm">
            <p role="alert">People could not be loaded.</p>
            <Button
              onClick={() =>
                void (teamQuery.isError
                  ? teamQuery.refetch()
                  : profilesQuery.refetch())
              }
              variant="outline"
            >
              Try again
            </Button>
          </div>
        ) : people.length === 0 ? (
          <div className="py-3">
            <p className="text-sm text-muted-foreground">
              No people found in this company.
            </p>
          </div>
        ) : (
          <div className="border-b border-border/70">
            {people.map((member) => {
              const profile = profiles?.[normalizePubkey(member.pubkey)];
              const isSelf =
                normalizePubkey(member.pubkey) ===
                normalizePubkey(currentPubkey ?? "");
              return (
                <div
                  className="flex min-h-14 min-w-0 items-center justify-between gap-4 border-b border-border/70 py-3 last:border-b-0"
                  key={member.pubkey}
                >
                  <div className="grid min-w-0 gap-0.5">
                    <span className="truncate text-sm font-medium">
                      {memberName(member, profile?.displayName)}
                      {isSelf ? " · You" : ""}
                    </span>
                    {profile?.nip05Handle ? (
                      <span className="truncate text-xs text-muted-foreground">
                        {profile.nip05Handle}
                      </span>
                    ) : null}
                  </div>
                  <span className="shrink-0 text-xs capitalize text-muted-foreground">
                    {member.role}
                  </span>
                </div>
              );
            })}
          </div>
        )}
        {teamQuery.isSuccess &&
        profilesQuery.isSuccess &&
        people.length === 1 &&
        normalizePubkey(people[0].pubkey) ===
          normalizePubkey(currentPubkey ?? "") ? (
          <p className="text-xs text-muted-foreground">
            Just you for now. Invite someone to share the work.
          </p>
        ) : null}
      </section>
      {canManage ? <MemberInviteLink offline={offline} /> : null}
      {role === "partner" ? (
        <p className="text-xs text-muted-foreground">
          Partner invitations are being prepared. Only the owner can remove
          people.
        </p>
      ) : null}
      {canManage ? (
        <p className="text-xs text-muted-foreground">
          Recent activity and invitation history are not available yet.
        </p>
      ) : null}
    </section>
  );
}
