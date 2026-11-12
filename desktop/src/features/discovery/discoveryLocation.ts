/**
 * A location chosen from the relay-owned geocoder. The label is what people
 * read and what the relay sends to the search provider; the remaining fields make the search
 * unambiguous without guessing a country in the client.
 */
export type DiscoveryLocationKind = "suburb" | "city" | "region" | "country";

export type DiscoveryLocation = {
  label: string;
  latitude: number;
  longitude: number;
  countryCode: string | null;
  /** Administrative region, as returned by the selected geocoder result. */
  region: string | null;
  kind: DiscoveryLocationKind;
  /** `[west, south, east, north]`, when the geocoder supplied an extent. */
  boundingBox: [number, number, number, number] | null;
  /** Nearby places offered after this query has genuinely run out. */
  nearby?: DiscoveryLocation[];
};

export const LOCATION_RECENTS_KEY = "colony:discovery-recent-locations:v1";
const MAX_RECENT_LOCATIONS = 8;
const MAX_NEARBY_LOCATIONS = 6;
/** A suburb further than this from the selected place is not "nearby". */
const NEARBY_RADIUS_KM = 60;
const EARTH_RADIUS_KM = 6_371;

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function coordinate(value: unknown, min: number, max: number): number | null {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= min &&
    value <= max
    ? value
    : null;
}

function locationKind(value: unknown): DiscoveryLocationKind | null {
  return value === "suburb" ||
    value === "city" ||
    value === "region" ||
    value === "country"
    ? value
    : null;
}

function boundingBox(value: unknown): DiscoveryLocation["boundingBox"] {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const values = value.map((entry) => coordinate(entry, -180, 180));
  return values.every((entry): entry is number => entry !== null)
    ? [values[0], values[1], values[2], values[3]]
    : null;
}

function parseDiscoveryLocationCore(raw: unknown): DiscoveryLocation | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    return null;
  const value = raw as Record<string, unknown>;
  const label = text(value.label);
  const latitude = coordinate(value.latitude, -90, 90);
  const longitude = coordinate(value.longitude, -180, 180);
  const kind = locationKind(value.kind);
  const countryCode = text(value.countryCode)?.toUpperCase() ?? null;
  const region = text(value.region);
  if (!label || latitude === null || longitude === null || !kind) return null;
  if (countryCode !== null && !/^[A-Z]{2}$/.test(countryCode)) return null;
  return {
    label,
    latitude,
    longitude,
    countryCode,
    region,
    kind,
    boundingBox: boundingBox(value.boundingBox),
  };
}

/** Parses persisted or relay-provided place data defensively. */
export function parseDiscoveryLocation(raw: unknown): DiscoveryLocation | null {
  const location = parseDiscoveryLocationCore(raw);
  if (!location || typeof raw !== "object" || raw === null) return location;
  const nearby = Array.isArray((raw as Record<string, unknown>).nearby)
    ? ((raw as Record<string, unknown>).nearby as unknown[])
        .flatMap((entry) => {
          const candidate = parseDiscoveryLocationCore(entry);
          return candidate ? [candidate] : [];
        })
        .slice(0, MAX_NEARBY_LOCATIONS)
    : [];
  return nearby.length ? { ...location, nearby } : location;
}

/** Parses the narrow, relay-owned response used by the location combobox. */
export function parseDiscoveryLocationSuggestions(
  raw: unknown,
): DiscoveryLocation[] {
  if (typeof raw !== "object" || raw === null) return [];
  const locations = (raw as Record<string, unknown>).locations;
  if (!Array.isArray(locations)) return [];
  const seen = new Set<string>();
  return locations
    .flatMap((entry) => {
      const location = parseDiscoveryLocation(entry);
      if (!location) return [];
      const key = discoveryLocationKey(location);
      if (seen.has(key)) return [];
      seen.add(key);
      return [location];
    })
    .slice(0, 8);
}

/** Stable identity for a selected place and for a cross-campaign query key. */
export function discoveryLocationKey(
  location: DiscoveryLocation | null,
): string {
  if (!location) return "";
  return [
    location.label.trim().toLocaleLowerCase(),
    location.latitude.toFixed(6),
    location.longitude.toFixed(6),
    location.countryCode ?? "",
    location.region?.trim().toLocaleLowerCase() ?? "",
    location.kind,
  ].join("|");
}

/** Great-circle distance between two places, in kilometres. */
function distanceKm(from: DiscoveryLocation, to: DiscoveryLocation): number {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitude = radians(to.latitude - from.latitude);
  const longitude = radians(to.longitude - from.longitude);
  const a =
    Math.sin(latitude / 2) ** 2 +
    Math.cos(radians(from.latitude)) *
      Math.cos(radians(to.latitude)) *
      Math.sin(longitude / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * The suggestion list also holds recently used places, so a suburb in the
 * same country can be a thousand kilometres away. Only suburbs within
 * `NEARBY_RADIUS_KM` of the selected place are offered as nearby areas.
 */
export function attachNearbyLocations(
  selected: DiscoveryLocation,
  suggestions: DiscoveryLocation[],
): DiscoveryLocation {
  const selectedKey = discoveryLocationKey(selected);
  const nearby = suggestions
    .filter((candidate) => candidate.kind === "suburb")
    .filter((candidate) => candidate.countryCode === selected.countryCode)
    .filter((candidate) => distanceKm(selected, candidate) <= NEARBY_RADIUS_KM)
    .filter((candidate) => discoveryLocationKey(candidate) !== selectedKey)
    .filter(
      (candidate, index, all) =>
        all.findIndex(
          (other) =>
            discoveryLocationKey(other) === discoveryLocationKey(candidate),
        ) === index,
    )
    .slice(0, MAX_NEARBY_LOCATIONS)
    .map((candidate) => ({ ...candidate }));
  // A recently used place carries the list it was given before; never keep it.
  const { nearby: _previous, ...place } = selected;
  return nearby.length ? { ...place, nearby } : place;
}

export type LocationStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export function readRecentDiscoveryLocations(
  storage: LocationStorage | null,
): DiscoveryLocation[] {
  if (!storage) return [];
  try {
    const raw: unknown = JSON.parse(
      storage.getItem(LOCATION_RECENTS_KEY) ?? "[]",
    );
    if (!Array.isArray(raw)) return [];
    return raw
      .flatMap((entry) => {
        const location = parseDiscoveryLocation(entry);
        return location ? [location] : [];
      })
      .slice(0, MAX_RECENT_LOCATIONS);
  } catch {
    return [];
  }
}

export function rememberDiscoveryLocation(
  storage: LocationStorage | null,
  location: DiscoveryLocation,
): DiscoveryLocation[] {
  const recents = [location, ...readRecentDiscoveryLocations(storage)].filter(
    (candidate, index, all) =>
      all.findIndex(
        (other) =>
          discoveryLocationKey(other) === discoveryLocationKey(candidate),
      ) === index,
  );
  const next = recents.slice(0, MAX_RECENT_LOCATIONS).map((candidate) => ({
    ...candidate,
  }));
  if (!storage) return next;
  try {
    storage.setItem(LOCATION_RECENTS_KEY, JSON.stringify(next));
  } catch {
    // A private or full webview should not block a manually chosen location.
  }
  return next;
}
