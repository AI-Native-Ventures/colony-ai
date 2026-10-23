/**
 * The time zone a person saves on their account page. It is chosen from the
 * IANA list and kept per person on this device; until one is saved, the zone
 * the computer reports is the answer.
 */
const STORAGE_PREFIX = "colony.time-zone.v1";

const FALLBACK_ZONES = [
  "Africa/Cairo",
  "Africa/Johannesburg",
  "Africa/Lagos",
  "Africa/Nairobi",
  "America/Chicago",
  "America/Los_Angeles",
  "America/New_York",
  "America/Sao_Paulo",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Europe/Berlin",
  "Europe/London",
  "Europe/Paris",
  "Pacific/Auckland",
  "UTC",
];

function storageKey(pubkey: string | undefined) {
  return `${STORAGE_PREFIX}:${pubkey?.toLowerCase() ?? "local"}`;
}

export function detectedTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** The saved zone for this person, or null when none was saved. */
export function readTimeZonePreference(
  pubkey: string | undefined,
  storage: Pick<Storage, "getItem"> = window.localStorage,
): string | null {
  try {
    const value = storage.getItem(storageKey(pubkey));
    return value && isTimeZone(value) ? value : null;
  } catch {
    return null;
  }
}

/** Returns whether the zone was saved; a blocked store answers false. */
export function writeTimeZonePreference(
  pubkey: string | undefined,
  zone: string,
  storage: Pick<Storage, "setItem"> = window.localStorage,
): boolean {
  if (!isTimeZone(zone)) return false;
  try {
    storage.setItem(storageKey(pubkey), zone);
    return true;
  } catch {
    return false;
  }
}

/** Every zone the person can choose, with the current one always present. */
export function timeZoneOptions(current: string): string[] {
  let zones: string[];
  try {
    const supported = (
      Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
    ).supportedValuesOf?.("timeZone");
    zones = supported && supported.length > 0 ? supported : FALLBACK_ZONES;
  } catch {
    zones = FALLBACK_ZONES;
  }
  return zones.includes(current) ? zones : [current, ...zones];
}

/** "Africa/Johannesburg · SAST": the zone with its short name today. */
export function timeZoneLabel(zone: string, at: Date = new Date()): string {
  try {
    const short = new Intl.DateTimeFormat("en-ZA", {
      timeZone: zone,
      timeZoneName: "short",
    })
      .formatToParts(at)
      .find((part) => part.type === "timeZoneName")?.value;
    return short ? `${zone} · ${short}` : zone;
  } catch {
    return zone;
  }
}
