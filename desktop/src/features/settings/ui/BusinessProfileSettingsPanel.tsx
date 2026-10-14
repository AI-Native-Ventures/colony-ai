import * as React from "react";
import { useNavigate } from "@tanstack/react-router";

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
import {
  isRelayConnectionDegraded,
  useRelayConnection,
} from "@/shared/api/useRelayConnection";

import { SettingsOptionGroup, SettingsOptionRow } from "./SettingsOptionGroup";
import { SettingsSectionHeader } from "./SettingsSectionHeader";

type EditableProfile = {
  name: string;
  whatYouSell: string;
  whoBuys: string;
  whereYouSell: string;
  city: string;
  country: string;
  website: string;
  buyLink: string;
  contactEmail: string;
  contactPhone: string;
  contactWhatsApp: string;
  contactAddress: string;
  invoiceRegisteredName: string;
  invoiceRegistrationNumber: string;
  invoiceVatNumber: string;
  invoiceBankDetails: string;
  timeZone: string;
  links: string;
};

function toDraft(profile: CompanyBusinessProfile): EditableProfile {
  return {
    name: profile.name,
    whatYouSell: profile.whatYouSell ?? "",
    whoBuys: profile.whoBuys ?? "",
    whereYouSell: (profile.whereYouSell ?? []).join("\n"),
    city: profile.city ?? "",
    country: profile.country ?? "",
    website: profile.website ?? "",
    buyLink: profile.buyLink ?? "",
    contactEmail: profile.contact?.email ?? "",
    contactPhone: profile.contact?.phone ?? "",
    contactWhatsApp: profile.contact?.whatsapp ?? "",
    contactAddress: profile.contact?.address ?? "",
    invoiceRegisteredName: profile.invoice?.registeredName ?? "",
    invoiceRegistrationNumber: profile.invoice?.registrationNumber ?? "",
    invoiceVatNumber: profile.invoice?.vatNumber ?? "",
    invoiceBankDetails: profile.invoice?.bankDetails ?? "",
    timeZone: profile.timeZone,
    links: (profile.links ?? []).join("\n"),
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
    website: draft.website.trim() || null,
    buyLink: draft.buyLink.trim() || null,
    contact: {
      ...current.contact,
      email: draft.contactEmail.trim() || null,
      phone: draft.contactPhone.trim() || null,
      whatsapp: draft.contactWhatsApp.trim() || null,
      address: draft.contactAddress.trim() || null,
    },
    invoice: {
      ...current.invoice,
      registeredName: draft.invoiceRegisteredName.trim() || null,
      registrationNumber: draft.invoiceRegistrationNumber.trim() || null,
      vatNumber: draft.invoiceVatNumber.trim() || null,
      bankDetails: draft.invoiceBankDetails.trim() || null,
    },
    timeZone: draft.timeZone.trim(),
    links: lines(draft.links),
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
    ["Website", draft.website],
    ["Where customers buy", draft.buyLink],
    ["Customer email", draft.contactEmail],
    ["Phone", draft.contactPhone],
    ["WhatsApp number", draft.contactWhatsApp],
    ["Address", draft.contactAddress],
    ["Registered business name", draft.invoiceRegisteredName],
    ["Registration number", draft.invoiceRegistrationNumber],
    ["VAT number", draft.invoiceVatNumber],
    ["Banking details", draft.invoiceBankDetails],
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
  ]) {
    const items = lines(value);
    if (items.length > 10) return `${label} can have at most 10 items.`;
    if (items.some((item) => item.length > 500))
      return `Each ${label.toLowerCase()} item must be 500 characters or less.`;
  }
  for (const [label, value] of [
    ["Website", draft.website],
    ["Where customers buy", draft.buyLink],
  ]) {
    if (!value.trim()) continue;
    try {
      const url = new URL(value.trim());
      if (url.protocol !== "https:" && url.protocol !== "http:")
        return `${label} must be a web address starting with https:// or http://.`;
    } catch {
      return `${label} must be a web address starting with https:// or http://.`;
    }
  }
  return null;
}

type ProfileField = {
  key: keyof EditableProfile;
  label: string;
  multiline?: boolean;
  hint?: string;
  inputType?: "email" | "url";
};

const fieldGroups: Array<{ title: string; fields: ProfileField[] }> = [
  {
    title: "Your business",
    fields: [
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
    ],
  },
  {
    title: "Online and contact",
    fields: [
      { key: "website", label: "Website", inputType: "url" },
      { key: "buyLink", label: "Where customers buy", inputType: "url" },
      {
        key: "links",
        label: "Online links and @names",
        multiline: true,
        hint: "One per line",
      },
      { key: "contactEmail", label: "Customer email", inputType: "email" },
      { key: "contactPhone", label: "Phone" },
      { key: "contactWhatsApp", label: "WhatsApp number, optional" },
      { key: "contactAddress", label: "Address, optional", multiline: true },
    ],
  },
  {
    title: "Invoice details",
    fields: [
      { key: "invoiceRegisteredName", label: "Registered business name" },
      {
        key: "invoiceRegistrationNumber",
        label: "Registration number, optional",
      },
      { key: "invoiceVatNumber", label: "VAT number, optional" },
      {
        key: "invoiceBankDetails",
        label: "Banking details for invoices, optional",
        multiline: true,
      },
    ],
  },
  {
    title: "Time",
    fields: [
      {
        key: "timeZone",
        label: "Time zone",
        hint: "Use a city-based time zone, such as Africa/Johannesburg",
      },
    ],
  },
];

const socialNames: Record<string, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
  x: "X",
};

function ProfileEditor({
  head,
  canEdit,
  fallbackName,
  offline,
}: {
  head: CompanyBusinessProfileHead | null;
  canEdit: boolean;
  fallbackName: string;
  offline: boolean;
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
  const [editedFields, setEditedFields] = React.useState<
    Set<keyof EditableProfile>
  >(() => new Set());
  const [error, setError] = React.useState<string | null>(null);
  const [savedNotice, setSavedNotice] = React.useState(false);
  const save = useSaveCompanyBusinessProfile();
  const navigate = useNavigate();
  const newerRevision = (head?.revision ?? 0) > (baseRevision ?? 0);

  React.useEffect(() => {
    if (newerRevision && !dirty) {
      setBaseRevision(head?.revision ?? null);
      setDraft(toDraft(initial));
      setEditedFields(new Set());
    }
  }, [dirty, head?.revision, initial, newerRevision]);

  const update = (field: keyof EditableProfile, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setDirty(true);
    setEditedFields((current) => new Set(current).add(field));
    setError(null);
    setSavedNotice(false);
  };
  const reload = () => {
    setDraft(toDraft(initial));
    setBaseRevision(head?.revision ?? null);
    setDirty(false);
    setEditedFields(new Set());
    setError(null);
    setSavedNotice(false);
  };

  const persist = async (
    nextDraft: EditableProfile,
    current: CompanyBusinessProfile,
    expectedRevision: number | null,
  ) => {
    const validation = validate(nextDraft);
    if (validation) {
      setError(validation);
      return;
    }
    try {
      const saved = await save.mutateAsync({
        profile: toProfile(nextDraft, current),
        expectedRevision,
      });
      setBaseRevision(saved.revision);
      setDraft(toDraft(saved.profile));
      setDirty(false);
      setEditedFields(new Set());
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

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canEdit || offline || newerRevision) return;
    await persist(draft, initial, baseRevision);
  };

  const applyMyChanges = async () => {
    if (!canEdit || offline || !head || !newerRevision || !dirty) return;
    const merged = toDraft(head.profile);
    for (const field of editedFields) merged[field] = draft[field];
    await persist(merged, head.profile, head.revision);
  };

  return (
    <form
      className="grid w-full max-w-2xl gap-6"
      onSubmit={(event) => void submit(event)}
    >
      {offline ? (
        <p role="status" className="text-sm text-muted-foreground">
          Connection lost. Your business facts are readable. Reconnect to edit.
        </p>
      ) : null}
      {fieldGroups.map((group) => (
        <SettingsOptionGroup key={group.title} title={group.title}>
          <SettingsOptionRow className="w-full">
            <div className="grid w-full gap-4 md:grid-cols-2">
              {group.fields.map(
                ({ key, label, multiline, hint, inputType }) => (
                  <label
                    className={`grid gap-1.5 text-sm ${multiline ? "md:col-span-2" : ""}`}
                    htmlFor={`business-profile-${key}`}
                    key={key}
                  >
                    <span className="font-medium">{label}</span>
                    {hint ? (
                      <span className="text-xs text-muted-foreground">
                        {hint}
                      </span>
                    ) : null}
                    {multiline ? (
                      <textarea
                        id={`business-profile-${key}`}
                        className="min-h-20 w-full rounded-md border bg-background px-3 py-2 text-sm"
                        disabled={!canEdit || offline || save.isPending}
                        maxLength={
                          key === "whereYouSell" || key === "links" ? 5000 : 500
                        }
                        onChange={(event) => update(key, event.target.value)}
                        value={draft[key]}
                      />
                    ) : (
                      <input
                        id={`business-profile-${key}`}
                        className="min-h-10 w-full rounded-md border bg-background px-3 py-2 text-sm"
                        disabled={!canEdit || offline || save.isPending}
                        maxLength={key === "name" ? 120 : 500}
                        type={inputType ?? "text"}
                        onChange={(event) => update(key, event.target.value)}
                        value={draft[key]}
                      />
                    )}
                  </label>
                ),
              )}
            </div>
          </SettingsOptionRow>
        </SettingsOptionGroup>
      ))}
      <SettingsOptionGroup title="Social accounts">
        <SettingsOptionRow>
          <div className="grid gap-1">
            <span>
              {Object.entries(initial.socialAccounts ?? {})
                .filter(([, value]) => Boolean(value))
                .map(
                  ([service, value]) =>
                    `${socialNames[service] ?? service} ${value}`,
                )
                .join(", ") || "No accounts added yet"}
            </span>
            <span className="text-xs text-muted-foreground">
              Your team uses these account names when preparing posts.
            </span>
          </div>
          <Button
            onClick={() =>
              void navigate({
                to: "/settings",
                search: { section: "connections" },
              })
            }
            type="button"
            variant="outline"
          >
            Change in Connections
          </Button>
        </SettingsOptionRow>
      </SettingsOptionGroup>
      {newerRevision && dirty ? (
        <p role="alert" className="text-sm text-destructive">
          This profile changed on another computer. Review the latest version
          before saving.
        </p>
      ) : null}
      {error && !(newerRevision && /conflict:/i.test(error)) ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {savedNotice ? (
        <p role="status" className="text-sm text-muted-foreground">
          Saved to this company.
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2 border-t px-3 py-4">
        {canEdit ? (
          <Button
            disabled={!dirty || offline || newerRevision || save.isPending}
            type="submit"
          >
            {save.isPending ? "Saving…" : "Save changes"}
          </Button>
        ) : null}
        {newerRevision && dirty ? (
          <>
            <Button onClick={reload} type="button" variant="outline">
              Load latest
            </Button>
            <Button
              disabled={offline || save.isPending || !head}
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
          Owners and partners can edit this shared profile.
        </p>
      ) : null}
    </form>
  );
}

export function BusinessProfileSettingsPanel() {
  const { activeCommunity } = useCommunities();
  const relayConnection = useRelayConnection();
  const membership = useMyRelayMembershipLookupQuery();
  const profile = useCompanyBusinessProfileQuery(Boolean(activeCommunity));
  const role = membership.data?.membership?.role;
  const canEdit = role === "owner" || role === "admin" || role === "partner";

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
          offline={isRelayConnectionDegraded(relayConnection)}
        />
      )}
    </section>
  );
}
