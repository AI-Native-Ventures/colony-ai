/**
 * Pure side of the prospect search: the request and response shapes of the
 * relay's `POST /discovery/search`, response parsing, and the plain-words
 * error mapping. The HTTP call itself lives in `outscraperSearchClient.ts`.
 */

export type DiscoveryPlace = {
  placeId: string | null;
  name: string;
  category: string | null;
  subtypes: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  phone: string | null;
  website: string | null;
  email: string | null;
  rating: number | null;
  reviews: number | null;
  latitude: number | null;
  longitude: number | null;
  mapsUrl: string | null;
  description: string | null;
  businessStatus: string | null;
};

export type DiscoverySearchRequest = {
  query: string;
  location: string;
  country?: string;
  limit: number;
  skip: number;
  language?: string;
};

export type DiscoverySearchResponse = {
  provider: string;
  places: DiscoveryPlace[];
  estimatedCostUsd: number;
  nextSkip: number | null;
};

/** Page size the app asks the server for. The server accepts 1 to 50. */
export const SEARCH_PAGE_SIZE = 20;

export const NETWORK_ERROR_MESSAGE =
  "Could not reach the server. Check your connection and retry.";
export const UNREADABLE_RESULT_MESSAGE =
  "The server sent a search result this app cannot read. Update Colony and try again.";
export const UNSUPPORTED_SERVER_MESSAGE =
  "This server does not support prospect search yet. The server owner needs to update it.";
export const MEMBERSHIP_MESSAGE =
  "Join this community to search for prospects.";
export const SEARCH_FAILED_MESSAGE =
  "The prospect search did not finish. Try again.";

/** Server codes worth a quiet retry on a later page; everything else is final. */
const TRANSIENT_CODES = new Set([
  "discovery_provider_busy",
  "discovery_provider_unavailable",
  "network",
]);

export class DiscoverySearchError extends Error {
  readonly code: string | null;
  readonly status: number | null;

  constructor(
    message: string,
    options: { code?: string | null; status?: number | null } = {},
  ) {
    super(message);
    this.name = "DiscoverySearchError";
    this.code = options.code ?? null;
    this.status = options.status ?? null;
  }

  /** True when trying the same page again a moment later can succeed. */
  get transient(): boolean {
    return this.code !== null && TRANSIENT_CODES.has(this.code);
  }
}

export function isTransientSearchError(error: unknown): boolean {
  return error instanceof DiscoverySearchError && error.transient;
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Reads one place from the server's JSON; null when it has no usable name. */
export function parsePlace(raw: unknown): DiscoveryPlace | null {
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw as Record<string, unknown>;
  const name = text(value.name);
  if (!name) return null;
  return {
    placeId: text(value.placeId),
    name,
    category: text(value.category),
    subtypes: text(value.subtypes),
    address: text(value.address),
    city: text(value.city),
    state: text(value.state),
    country: text(value.country),
    phone: text(value.phone),
    website: text(value.website),
    email: text(value.email),
    rating: finiteNumber(value.rating),
    reviews: finiteNumber(value.reviews),
    latitude: finiteNumber(value.latitude),
    longitude: finiteNumber(value.longitude),
    mapsUrl: text(value.mapsUrl),
    description: text(value.description),
    businessStatus: text(value.businessStatus),
  };
}

/** Validates the 200 body. Throws the plain "cannot read" error otherwise. */
export function parseSearchResponse(raw: unknown): DiscoverySearchResponse {
  if (typeof raw !== "object" || raw === null) {
    throw new DiscoverySearchError(UNREADABLE_RESULT_MESSAGE);
  }
  const value = raw as Record<string, unknown>;
  if (!Array.isArray(value.places)) {
    throw new DiscoverySearchError(UNREADABLE_RESULT_MESSAGE);
  }
  const places: DiscoveryPlace[] = [];
  for (const entry of value.places) {
    const place = parsePlace(entry);
    if (place) places.push(place);
  }
  const nextSkip = finiteNumber(value.nextSkip);
  return {
    provider: text(value.provider) ?? "outscraper",
    places,
    estimatedCostUsd: finiteNumber(value.estimatedCostUsd) ?? 0,
    nextSkip: nextSkip !== null && nextSkip >= 0 ? Math.floor(nextSkip) : null,
  };
}

/**
 * Maps a non-2xx answer to an error whose message is safe to show as is: the
 * server's own words when it sent any, otherwise a fixed plain sentence.
 */
export function searchErrorFromHttp(
  status: number,
  body: unknown,
): DiscoverySearchError {
  const json =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : {};
  const serverText = text(json.error);
  // `error` doubles as a machine code on older paths ("relay_membership_...");
  // only a sentence (it contains a space) is shown to people.
  const serverSentence = serverText?.includes(" ") ? serverText : null;
  const code = text(json.code) ?? (serverSentence ? null : serverText);
  if (code === "relay_membership_required") {
    return new DiscoverySearchError(MEMBERSHIP_MESSAGE, { code, status });
  }
  if (status === 404 || status === 405) {
    return new DiscoverySearchError(UNSUPPORTED_SERVER_MESSAGE, {
      code: "discovery_unsupported",
      status,
    });
  }
  return new DiscoverySearchError(serverSentence ?? SEARCH_FAILED_MESSAGE, {
    code,
    status,
  });
}

/** Countries the server maps to a Google Maps region (mirrors its table). */
const KNOWN_COUNTRIES = [
  "South Africa",
  "United States",
  "United Kingdom",
  "Nigeria",
  "Kenya",
  "Namibia",
  "Botswana",
  "Zimbabwe",
  "Zambia",
  "Mozambique",
  "Australia",
  "Canada",
  "India",
  "Ireland",
  "New Zealand",
  "Germany",
  "France",
  "Netherlands",
];

/**
 * The location text when it is exactly a country the server knows, so the
 * search can be limited to that region. Anything else (a city, "Johannesburg,
 * South Africa") passes no country: the app never guesses one.
 */
export function countryForLocation(location: string): string | undefined {
  const normalized = location.trim().toLocaleLowerCase();
  return KNOWN_COUNTRIES.find(
    (country) => country.toLocaleLowerCase() === normalized,
  );
}

export function buildSearchRequest(input: {
  query: string;
  location: string;
  skip: number;
}): DiscoverySearchRequest {
  const location = input.location.trim();
  const country = countryForLocation(location);
  return {
    query: input.query.trim(),
    location,
    ...(country ? { country } : {}),
    limit: SEARCH_PAGE_SIZE,
    skip: Math.max(0, Math.floor(input.skip)),
    language: "en",
  };
}
