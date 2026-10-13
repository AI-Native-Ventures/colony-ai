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
} from "@/features/business-profile/businessProfileModels";
import { Button } from "@/shared/ui/button";

import { SettingsOptionGroup, SettingsOptionRow } from "./SettingsOptionGroup";
import { SettingsSectionHeader } from "./SettingsSectionHeader";

type EditableProfile = {
  name: string;
  whatYouSell: string;
  whoBuys: string;
  whereYouSell: string;
  city: string;
  country: string;
  timeZone: string;
  links: string;
  goals: string;
};

function toDraft(profile: CompanyBusinessProfile): EditableProfile {
  return {
    name: profile.name,
    whatYouSell: profile.whatYouSell ?? "",
    whoBuys: profile.whoBuys ?? "",
    whereYouSell: (profile.whereYouSell ?? []).join("\n"),
    city: profile.city ?? "",
    country: profile.country ?? "",
    timeZone: profile.timeZone,
    links: (profile.links ?? []).join("\n"),
    goals: (profile.goals ?? []).join("\n"),
  };
}

function lines(value: string) {
  return [
    ...new Set(
      value
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
    ),
  ];
}

function toProfile(
  draft: EditableProfile,
  current: CompanyBusinessProfile,
): CompanyBusinessProfile {
  return {
    ...current,
    name: draft.name.trim(),
    whatYouSell: draft.whatYouSell.trim() || null,
    whoBuys: draft.whoBuys.trim() || null,
    whereYouSell: lines(draft.whereYouSell),
    city: draft.city.trim() || null,
    country: draft.country.trim() || null,
    timeZone: draft.timeZone.trim(),
    links: lines(draft.links),
    goals: lines(draft.goals),
  };
}

function validate(draft: EditableProfile): string | null {
  if (!draft.name.trim()) return "Add a business name.";
  if (draft.name.trim().length > 120)
    return "Business name must be 120 characters or less.";
  for (const [label, value] of [
    ["What you sell", draft.whatYouSell],
    ["Who buys from you", draft.whoBuys],
    ["City", draft.city],
    ["Country", draft.country],
  ]) {
    if (value.trim().length > 500)
      return `${label} must be 500 characters or less.`;
  }
  try {
    new Intl.DateTimeFormat("en", { timeZone: draft.timeZone.trim() });
  } catch {
    return "Use a valid time zone, such as Africa/Johannesburg.";
  }
  for (const [label, value] of [
    ["Sales channels", draft.whereYouSell],
    ["Links", draft.links],
    ["Goals", draft.goals],
  ]) {
    const items = lines(value);
    if (items.length > 10) return `${label} can have at most 10 items.`;
    if (items.some((item) => item.length > 500))
      return `Each ${label.toLowerCase()} item must be 500 characters or less.`;
  }
  return null;
}

function ProfileEditor({
  head,
  canEdit,
  fallbackName,
}: {
  head: CompanyBusinessProfileHead | null;
  canEdit: boolean;
  fallbackName: string;
}) {
  const initial = React.useMemo<CompanyBusinessProfile>(
    () =>
      head?.profile ?? {
        schemaVersion: 1,
        name: fallbackName,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      },
    [fallbackName, head],
  );
  const [baseRevision, setBaseRevision] = React.useState(
    head?.revision ?? null,
  );
  const [draft, setDraft] = React.useState(() => toDraft(initial));
  const [dirty, setDirty] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [savedNotice, setSavedNotice] = React.useState(false);
  const save = useSaveCompanyBusinessProfile();
  const newerRevision = (head?.revision ?? null) !== baseRevision;

  React.useEffect(() => {
    if (newerRevision && !dirty) {
      setBaseRevision(head?.revision ?? null);
      setDraft(toDraft(initial));
    }
  }, [dirty, head?.revision, initial, newerRevision]);

  const update = (field: keyof EditableProfile, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setDirty(true);
    setError(null);
    setSavedNotice(false);
  };
  const reload = () => {
    setDraft(toDraft(initial));
    setBaseRevision(head?.revision ?? null);
    setDirty(false);
    setError(null);
    setSavedNotice(false);
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canEdit || newerRevision) return;
    const validation = validate(draft);
    if (validation) {
      setError(validation);
      return;
    }
    try {
      const saved = await save.mutateAsync({
        profile: toProfile(draft, initial),
        expectedRevision: baseRevision,
      });
      setBaseRevision(saved.revision);
      setDraft(toDraft(saved.profile));
      setDirty(false);
      setError(null);
      setSavedNotice(true);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The business profile could not be saved. Try again.",
      );
    }
  };

  const fields: Array<{
    key: keyof EditableProfile;
    label: string;
    multiline?: boolean;
    hint?: string;
  }> = [
    { key: "name", label: "Business name" },
    { key: "whatYouSell", label: "What you sell", multiline: true },
    { key: "whoBuys", label: "Who buys from you", multiline: true },
    {
      key: "whereYouSell",
      label: "Where you sell",
      multiline: true,
      hint: "One place per line",
    },
    { key: "city", label: "City" },
    { key: "country", label: "Country" },
    { key: "timeZone", label: "Time zone" },
    {
      key: "links",
      label: "Online links and @names",
      multiline: true,
      hint: "One per line",
    },
    {
      key: "goals",
      label: "Next 3 months",
      multiline: true,
      hint: "One goal per line",
    },
  ];

  return (
    <SettingsOptionGroup title="Your business">
      <SettingsOptionRow>
        <form
          className="grid w-full max-w-2xl gap-4"
          onSubmit={(event) => void submit(event)}
        >
          {fields.map(({ key, label, multiline, hint }) => (
            <label
              className="grid gap-1.5 text-sm"
              htmlFor={`business-profile-${key}`}
              key={key}
            >
              <span className="font-medium">{label}</span>
              {hint ? (
                <span className="text-xs text-muted-foreground">{hint}</span>
              ) : null}
              {multiline ? (
                <textarea
                  id={`business-profile-${key}`}
                  className="min-h-20 w-full rounded-md border bg-background px-3 py-2 text-sm"
                  disabled={!canEdit || save.isPending}
                  maxLength={
                    key === "whatYouSell" || key === "whoBuys" ? 500 : 5000
                  }
                  onChange={(event) => update(key, event.target.value)}
                  value={draft[key]}
                />
              ) : (
                <input
                  id={`business-profile-${key}`}
                  className="min-h-10 w-full rounded-md border bg-background px-3 py-2 text-sm"
                  disabled={!canEdit || save.isPending}
                  maxLength={key === "name" ? 120 : 500}
                  onChange={(event) => update(key, event.target.value)}
                  value={draft[key]}
                />
              )}
            </label>
          ))}
          {newerRevision && dirty ? (
            <p role="alert" className="text-sm text-destructive">
              This profile changed on another computer. Review the latest
              version before saving.
            </p>
          ) : null}
          {error && !newerRevision ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          {savedNotice ? (
            <p role="status" className="text-sm text-muted-foreground">
              Saved to this company.
            </p>
          ) : null}
          <div className="sticky bottom-0 z-10 -mx-3 flex flex-wrap gap-2 border-t bg-background px-3 py-3">
            {canEdit ? (
              <Button
                disabled={!dirty || newerRevision || save.isPending}
                type="submit"
              >
                {save.isPending ? "Saving…" : "Save changes"}
              </Button>
            ) : null}
            {newerRevision && dirty ? (
              <Button onClick={reload} type="button" variant="outline">
                Load latest
              </Button>
            ) : null}
          </div>
          {!canEdit ? (
            <p className="text-xs text-muted-foreground">
              Owners and admins can edit this shared profile.
            </p>
          ) : null}
        </form>
      </SettingsOptionRow>
    </SettingsOptionGroup>
  );
}

export function BusinessProfileSettingsPanel() {
  const { activeCommunity } = useCommunities();
  const membership = useMyRelayMembershipLookupQuery();
  const profile = useCompanyBusinessProfileQuery(Boolean(activeCommunity));
  const role = membership.data?.membership?.role;
  const canEdit = role === "owner" || role === "admin";

  return (
    <section className="min-w-0" data-testid="settings-business-profile">
      <SettingsSectionHeader
        title="Business profile"
        description="Business details saved with this company."
      />
      {!activeCommunity ? (
        <SettingsOptionGroup title="Your business">
          <SettingsOptionRow>No business is connected.</SettingsOptionRow>
        </SettingsOptionGroup>
      ) : profile.isPending ? (
        <p role="status" className="text-sm">
          Loading your business profile…
        </p>
      ) : profile.isError ? (
        <div className="grid gap-2 text-sm">
          <p role="alert">
            The business profile could not be loaded. Your changes are safe.
          </p>
          <Button
            onClick={() => void profile.refetch()}
            size="sm"
            variant="outline"
          >
            Try again
          </Button>
        </div>
      ) : (
        <ProfileEditor
          key={activeCommunity.relayUrl}
          canEdit={canEdit}
          fallbackName={activeCommunity.name}
          head={profile.data ?? null}
        />
      )}
    </section>
  );
}
