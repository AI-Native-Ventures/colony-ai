import { verifyEvent } from "nostr-tools/pure";

import type { RelayEvent } from "@/shared/api/types";
import { KIND_BUSINESS_PROFILE_HEAD } from "@/shared/constants/kinds";
import type { OnboardingBusinessProfile } from "@/features/onboarding/ui/BusinessSetupStep";

export const BUSINESS_PROFILE_D_TAG = "business-profile";

export type CompanyBusinessContact = {
  email?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  address?: string | null;
};

export type CompanyBusinessInvoice = {
  registeredName?: string | null;
  registrationNumber?: string | null;
  vatNumber?: string | null;
  bankDetails?: string | null;
};

export type CompanyBusinessProfile = {
  schemaVersion: 1;
  name: string;
  timeZone: string;
  whatYouSell?: string | null;
  whoBuys?: string | null;
  whereYouSell?: string[];
  city?: string | null;
  country?: string | null;
  links?: string[];
  website?: string | null;
  goals?: string[];
  bestSellers?: string[];
  priceRange?: string | null;
  voiceWords?: string[];
  contact?: CompanyBusinessContact;
  buyLink?: string | null;
  invoice?: CompanyBusinessInvoice;
  socialAccounts?: Record<string, string | null>;
};

export type CompanyBusinessProfileHead = {
  event: RelayEvent;
  revision: number;
  profile: CompanyBusinessProfile;
};

function oneTagValue(tags: string[][], key: string): string | null {
  const matches = tags.filter((tag) => tag[0] === key);
  return matches.length === 1 && matches[0]?.length === 2
    ? (matches[0][1] ?? null)
    : null;
}

function validTextList(value: unknown): boolean {
  return (
    value === undefined ||
    (Array.isArray(value) &&
      value.length <= 10 &&
      value.every((item) => typeof item === "string" && item.length <= 500))
  );
}

export function parseCompanyBusinessProfileHead(
  event: RelayEvent,
  relaySelf: string,
): CompanyBusinessProfileHead | null {
  if (
    event.kind !== KIND_BUSINESS_PROFILE_HEAD ||
    event.pubkey.toLowerCase() !== relaySelf.toLowerCase() ||
    !verifyEvent(event) ||
    oneTagValue(event.tags, "d") !== BUSINESS_PROFILE_D_TAG ||
    event.tags.some((tag) => tag[0] === "h")
  ) {
    return null;
  }
  const revisionText = oneTagValue(event.tags, "revision");
  const revision = revisionText ? Number(revisionText) : NaN;
  if (!Number.isSafeInteger(revision) || revision < 1) return null;
  try {
    const profile: unknown = JSON.parse(event.content);
    if (!profile || typeof profile !== "object") return null;
    const value = profile as Partial<CompanyBusinessProfile>;
    if (
      value.schemaVersion !== 1 ||
      typeof value.name !== "string" ||
      !value.name.trim() ||
      value.name.length > 120 ||
      typeof value.timeZone !== "string" ||
      !value.timeZone ||
      !validTextList(value.whereYouSell) ||
      !validTextList(value.links) ||
      !validTextList(value.goals)
    ) {
      return null;
    }
    new Intl.DateTimeFormat("en", { timeZone: value.timeZone });
    return {
      event,
      revision,
      profile: value as CompanyBusinessProfile,
    };
  } catch {
    return null;
  }
}

export function onboardingToCompanyBusinessProfile(
  profile: OnboardingBusinessProfile,
): CompanyBusinessProfile {
  const [city, ...countryParts] = (profile.location ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return {
    schemaVersion: 1,
    name: profile.name.trim(),
    timeZone: profile.timeZone || "UTC",
    whatYouSell: profile.description.trim() || null,
    whoBuys: profile.buyers?.trim() || null,
    whereYouSell: profile.channels ?? [],
    city: city || null,
    country: countryParts.join(", ") || null,
    links: profile.links ?? [],
    website:
      profile.links?.find((link) => /^https?:\/\//i.test(link.trim())) ?? null,
    goals: [...(profile.goals ?? []), profile.goalText?.trim() || ""].filter(
      Boolean,
    ),
  };
}

export function onboardingFieldsMatch(
  current: CompanyBusinessProfile,
  expected: CompanyBusinessProfile,
): boolean {
  return (
    current.name === expected.name &&
    (current.whatYouSell ?? null) === (expected.whatYouSell ?? null) &&
    (current.whoBuys ?? null) === (expected.whoBuys ?? null) &&
    JSON.stringify(current.whereYouSell ?? []) ===
      JSON.stringify(expected.whereYouSell ?? []) &&
    (current.city ?? null) === (expected.city ?? null) &&
    (current.country ?? null) === (expected.country ?? null) &&
    current.timeZone === expected.timeZone &&
    JSON.stringify(current.links ?? []) ===
      JSON.stringify(expected.links ?? []) &&
    (current.website ?? null) === (expected.website ?? null) &&
    JSON.stringify(current.goals ?? []) === JSON.stringify(expected.goals ?? [])
  );
}
