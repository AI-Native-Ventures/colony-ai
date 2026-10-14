import * as React from "react";

import { useCommunities } from "@/features/communities/useCommunities";
import { useMyRelayMembershipLookupQuery } from "@/features/community-members/hooks";
import {
  useCompanyBusinessProfileQuery,
  useSaveCompanyBusinessProfile,
} from "@/features/business-profile/businessProfileRelay";
import type {
  CompanyBusinessProfile,
  CompanyBusinessProfileHead,
  CompanyBusinessSocialAccounts,
} from "@/features/business-profile/businessProfileModels";
import {
  isRelayConnectionDegraded,
  useRelayConnection,
} from "@/shared/api/useRelayConnection";
import { Button } from "@/shared/ui/button";

import { SettingsOptionGroup, SettingsOptionRow } from "./SettingsOptionGroup";
import { SettingsSectionHeader } from "./SettingsSectionHeader";

const socialFields = [
  ["instagram", "Instagram"],
  ["facebook", "Facebook"],
  ["tiktok", "TikTok"],
  ["linkedin", "LinkedIn"],
  ["x", "X"],
] as const;
type SocialKey = (typeof socialFields)[number][0];
type SocialDraft = Record<SocialKey, string>;

function toDraft(profile: CompanyBusinessProfile): SocialDraft {
  return {
    instagram: profile.socialAccounts?.instagram ?? "",
    facebook: profile.socialAccounts?.facebook ?? "",
    tiktok: profile.socialAccounts?.tiktok ?? "",
    linkedin: profile.socialAccounts?.linkedin ?? "",
    x: profile.socialAccounts?.x ?? "",
  };
}

function withAccounts(
  profile: CompanyBusinessProfile,
  draft: SocialDraft,
): CompanyBusinessProfile {
  const socialAccounts: CompanyBusinessSocialAccounts = {
    ...profile.socialAccounts,
  };
  for (const [key] of socialFields)
    socialAccounts[key] = draft[key].trim() || null;
  return { ...profile, socialAccounts };
}

function SocialAccountsEditor({
  head,
  canEdit,
  offline,
}: {
  head: CompanyBusinessProfileHead;
  canEdit: boolean;
  offline: boolean;
}) {
  const [baseRevision, setBaseRevision] = React.useState(head.revision);
  const [draft, setDraft] = React.useState(() => toDraft(head.profile));
  const [editedFields, setEditedFields] = React.useState<Set<SocialKey>>(
    () => new Set(),
  );
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);
  const save = useSaveCompanyBusinessProfile();
  const dirty = editedFields.size > 0;
  const newerRevision = head.revision > baseRevision;

  React.useEffect(() => {
    if (newerRevision && !dirty) {
      setBaseRevision(head.revision);
      setDraft(toDraft(head.profile));
    }
  }, [dirty, head, newerRevision]);

  const change = (key: SocialKey, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setEditedFields((current) => new Set(current).add(key));
    setError(null);
    setSaved(false);
  };
  const loadLatest = () => {
    setBaseRevision(head.revision);
    setDraft(toDraft(head.profile));
    setEditedFields(new Set());
    setError(null);
    setSaved(false);
  };
  const persist = async (next: SocialDraft, expectedRevision: number) => {
    if (socialFields.some(([key]) => next[key].trim().length > 500)) {
      setError("Each account name or link must be 500 characters or less.");
      return;
    }
    try {
      const result = await save.mutateAsync({
        profile: withAccounts(head.profile, next),
        expectedRevision,
      });
      setBaseRevision(result.revision);
      setDraft(toDraft(result.profile));
      setEditedFields(new Set());
      setError(null);
      setSaved(true);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The account names could not be saved. Try again.",
      );
    }
  };
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canEdit || offline || newerRevision || !dirty) return;
    await persist(draft, baseRevision);
  };
  const applyMyChanges = async () => {
    if (!canEdit || offline || !newerRevision || !dirty) return;
    const merged = toDraft(head.profile);
    for (const field of editedFields) merged[field] = draft[field];
    await persist(merged, head.revision);
  };

  return (
    <SettingsOptionGroup
      description="Naledi prepares each post. You post it yourself."
      title="Social accounts"
    >
      <SettingsOptionRow>
        <form
          className="grid w-full gap-4"
          onSubmit={(event) => void submit(event)}
        >
          <div className="grid gap-4 md:grid-cols-2">
            {socialFields.map(([key, label]) => (
              <label className="grid gap-1.5 text-sm" key={key}>
                <span className="font-medium">{label}</span>
                <input
                  className="min-h-10 w-full rounded-md border bg-background px-3 py-2 text-sm"
                  disabled={!canEdit || offline || save.isPending}
                  maxLength={500}
                  onChange={(event) => change(key, event.target.value)}
                  placeholder="Account name or link"
                  value={draft[key]}
                />
              </label>
            ))}
          </div>
          {offline ? (
            <p role="status" className="text-sm text-muted-foreground">
              Connection lost. Reconnect to edit account names.
            </p>
          ) : null}
          {newerRevision && dirty ? (
            <p role="alert" className="text-sm text-destructive">
              Account names changed on another computer. Review the latest
              version before saving.
            </p>
          ) : null}
          {error && !(newerRevision && /conflict:/i.test(error)) ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          {saved ? (
            <p role="status" className="text-sm text-muted-foreground">
              Account names saved to this company.
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2 border-t pt-4">
            {canEdit ? (
              <Button
                disabled={!dirty || offline || newerRevision || save.isPending}
                type="submit"
              >
                {save.isPending ? "Saving…" : "Save accounts"}
              </Button>
            ) : null}
            {newerRevision && dirty ? (
              <>
                <Button onClick={loadLatest} type="button" variant="outline">
                  Load latest
                </Button>
                <Button
                  disabled={offline || save.isPending}
                  onClick={() => void applyMyChanges()}
                  type="button"
                  variant="outline"
                >
                  Use my changes
                </Button>
              </>
            ) : null}
          </div>
          {!canEdit ? (
            <p className="text-xs text-muted-foreground">
              Owners and partners can edit these shared account names.
            </p>
          ) : null}
        </form>
      </SettingsOptionRow>
    </SettingsOptionGroup>
  );
}

export function ColonyConnectionsSettingsPanel({
  onOpenBusinessProfile,
}: {
  onOpenBusinessProfile: () => void;
}) {
  const { activeCommunity } = useCommunities();
  const membership = useMyRelayMembershipLookupQuery();
  const profile = useCompanyBusinessProfileQuery(Boolean(activeCommunity));
  const connection = useRelayConnection();
  const canEdit = ["owner", "admin", "partner"].includes(
    membership.data?.membership?.role ?? "",
  );

  return (
    <section className="grid min-w-0 gap-6" data-testid="settings-connections">
      <SettingsSectionHeader
        title="Connections"
        description="The links your team uses to work with customers."
      />
      {!activeCommunity ? (
        <SettingsOptionGroup title="Social accounts">
          <SettingsOptionRow>Connect a business first.</SettingsOptionRow>
        </SettingsOptionGroup>
      ) : profile.isPending ? (
        <p role="status" className="text-sm">
          Loading your account names…
        </p>
      ) : profile.isError ? (
        <div className="grid gap-2 text-sm">
          <p role="alert">The account names could not be loaded.</p>
          <Button
            onClick={() => void profile.refetch()}
            type="button"
            variant="outline"
          >
            Try again
          </Button>
        </div>
      ) : profile.data ? (
        <SocialAccountsEditor
          key={activeCommunity.relayUrl}
          canEdit={canEdit}
          head={profile.data}
          offline={isRelayConnectionDegraded(connection)}
        />
      ) : (
        <SettingsOptionGroup title="Social accounts">
          <SettingsOptionRow>
            <p className="text-sm text-muted-foreground">
              Add your business profile before saving account names.
            </p>
            <Button
              onClick={onOpenBusinessProfile}
              type="button"
              variant="outline"
            >
              Open business profile
            </Button>
          </SettingsOptionRow>
        </SettingsOptionGroup>
      )}
      <SettingsOptionGroup title="Customer email for Grace">
        <SettingsOptionRow>
          <p className="text-sm text-muted-foreground">
            Email forwarding is not connected yet. Grace cannot receive
            forwarded customer emails in Colony.
          </p>
        </SettingsOptionRow>
      </SettingsOptionGroup>
      <SettingsOptionGroup title="Website domain">
        <SettingsOptionRow>
          <p className="text-sm text-muted-foreground">
            Your website's domain status will appear here when its connection is
            ready.
          </p>
        </SettingsOptionRow>
      </SettingsOptionGroup>
    </section>
  );
}
