/**
 * Pure side of the prospect search: the request and response shapes of the
 * relay's `POST /discovery/search`, response parsing, and the plain-words
 * error mapping. The HTTP call itself lives in `outscraperSearchClient.ts`.
 */

import {
  discoveryLocationKey,
  type DiscoveryLocation,
} from "./discoveryLocation";
import type { ActionFailure } from "@/shared/lib/actionFailure";

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
  /** ISO country code from the chosen place, never guessed from free text. */
  country?: string;
  /** Provider region from the chosen place, for example ZA or Gauteng. */
  region?: string;
  /** The chosen place's center, sent only through the authenticated relay. */
  coordinates?: { latitude: number; longitude: number };
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

/**
 * Page size the app asks the server for. Google Maps pages in steps of 20 (its
 * skip "should be multiple to 20"), so every request is a full page at a skip
 * that is a multiple of it. Anything else returns repeats that are paid for.
 */
export const SEARCH_PAGE_SIZE = 20;

/** Google gives at most 400 places for one query; skip 400 is its end. */
export const QUERY_PLACE_CEILING = 400;

/** The nearest page start at or below `skip`, never negative. */
export function alignSkip(skip: number): number {
  const whole = Number.isFinite(skip) ? Math.max(0, Math.floor(skip)) : 0;
  return whole - (whole % SEARCH_PAGE_SIZE);
}

/** True while a query's cursor still points at a page worth asking for. */
export function cursorHasPages(cursor: number | null | undefined): boolean {
  return cursor !== null && (cursor ?? 0) < QUERY_PLACE_CEILING;
}

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
  /** Relay-supplied monthly-limit reset timestamp, when available. */
  readonly resetsAt: string | null;
  readonly actionFailure: ActionFailure | null;

  constructor(
    message: string,
    options: {
      code?: string | null;
      status?: number | null;
      resetsAt?: string | null;
      actionFailure?: ActionFailure | null;
    } = {},
  ) {
    super(message);
    this.name = "DiscoverySearchError";
    this.code = options.code ?? null;
    this.status = options.status ?? null;
    this.resetsAt = options.resetsAt ?? null;
    this.actionFailure = options.actionFailure ?? null;
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
  const resetsAt = text(json.resets_at);
  if (code === "relay_membership_required") {
    return new DiscoverySearchError(MEMBERSHIP_MESSAGE, {
      code,
      status,
      resetsAt,
    });
  }
  if (status === 404 || status === 405) {
    return new DiscoverySearchError(UNSUPPORTED_SERVER_MESSAGE, {
      code: "discovery_unsupported",
      status,
      resetsAt,
    });
  }
  return new DiscoverySearchError(serverSentence ?? SEARCH_FAILED_MESSAGE, {
    code,
    status,
    resetsAt,
  });
}

export function buildSearchRequest(input: {
  query: string;
  location: string;
  locationSelection?: DiscoveryLocation | null;
  skip: number;
  /**
   * Search the named area as a whole. The request then carries no point, so
   * Maps covers the place the text names instead of one small window around
   * its centre (a province searched from its centre point found 8 places).
   */
  wholeArea?: boolean;
}): DiscoverySearchRequest {
  const location = input.location.trim();
  const selected = input.locationSelection ?? null;
  return {
    query: input.query.trim(),
    location,
    ...(selected?.countryCode ? { country: selected.countryCode } : {}),
    ...(selected?.region ? { region: selected.region } : {}),
    ...(selected && !input.wholeArea
      ? {
          coordinates: {
            latitude: selected.latitude,
            longitude: selected.longitude,
          },
        }
      : {}),
    limit: SEARCH_PAGE_SIZE,
    skip: alignSkip(input.skip),
    language: "en",
  };
}

export type PlannedDiscoverySearch = {
  /** Index in `pickedTags`; null is the unfiltered search. */
  tagIndex: number | null;
  request: DiscoverySearchRequest;
};

/** Words that end a catalogue label but that no business puts in its name. */
const LABEL_FILLER_ENDINGS: ReadonlySet<string> = new Set([
  "businesses",
  "companies",
  "establishments",
  "firms",
  "operators",
  "outlets",
  "providers",
]);

/** The most search words one campaign runs through, one after another. */
export const MAX_SEARCH_WORDS = 5;

/**
 * A catalogue label as words Maps understands: "Furniture & Upholstery Repair
 * Businesses" becomes "Furniture Upholstery Repair". Maps found 2 places in a
 * whole province for the label as written and full pages for the plain words.
 */
export function plainSearchLabel(label: string): string {
  const words = label.replace(/&/g, " ").split(/\s+/).filter(Boolean);
  while (
    words.length > 1 &&
    LABEL_FILLER_ENDINGS.has((words.at(-1) ?? "").toLocaleLowerCase())
  ) {
    words.pop();
  }
  return words.join(" ").slice(0, 120).trim();
}

/**
 * The words one campaign searches Maps with, in order: the plain label, then
 * the catalogue's everyday names for the type ("upholsterers", "furniture
 * restoration"). Each is its own Maps search; the campaign moves to the next
 * when one runs out.
 */
export function buildSearchWords(
  label: string,
  aliases: readonly string[] = [],
): string[] {
  const seen = new Set<string>();
  const words: string[] = [];
  for (const candidate of [plainSearchLabel(label), ...aliases]) {
    const word = candidate.replace(/\s+/g, " ").trim().slice(0, 120).trim();
    const key = word.toLocaleLowerCase();
    if (!word || seen.has(key)) continue;
    seen.add(key);
    words.push(word);
    if (words.length >= MAX_SEARCH_WORDS) break;
  }
  return words;
}

/** The stored words of a campaign, cleaned; empty for a campaign made before them. */
export function normalizeSearchWords(searchWords: string[] = []): string[] {
  return [
    ...new Set(searchWords.map((word) => word.trim()).filter(Boolean)),
  ].slice(0, MAX_SEARCH_WORDS);
}

/** The word a campaign is searching with now, or null for an older campaign. */
export function searchWordAt(
  searchWords: string[] = [],
  wordIndex = 0,
): string | null {
  const words = normalizeSearchWords(searchWords);
  if (!words.length) return null;
  const index = Number.isFinite(wordIndex) ? Math.floor(wordIndex) : 0;
  return words[Math.min(Math.max(index, 0), words.length - 1)] ?? null;
}

export function normalizePickedTags(pickedTags: string[] = []): string[] {
  return [
    ...new Set(pickedTags.map((tag) => tag.trim()).filter(Boolean)),
  ].slice(0, 3);
}

/**
 * Stable coverage identity for one provider query. The structured location
 * keeps two cities with the same name apart. A tagged campaign has one actual
 * provider query per picked tag, so each stream gets its own cursor rather
 * than letting one tag advance past pages another tag has not bought yet.
 */
export function discoveryCoverageKey(input: {
  verticalId: string;
  tag?: string | null;
  /**
   * The Maps search word of a campaign that has search words. It makes the
   * key a new one, so pages an older version bought with the catalogue label
   * and one small map window never mark this better search as finished.
   */
  word?: string | null;
  location: string;
  locationSelection?: DiscoveryLocation | null;
}): string {
  const tag = input.tag?.trim().toLocaleLowerCase() ?? "";
  const word = input.word?.trim().toLocaleLowerCase() ?? "";
  const place =
    discoveryLocationKey(input.locationSelection ?? null) ||
    `legacy:${input.location.trim().toLocaleLowerCase()}`;
  return [
    input.verticalId.trim().toLocaleLowerCase(),
    `tag:${tag}`,
    ...(word ? [`word:${word}`] : []),
    place,
  ].join("::");
}

/** One durable cursor key for each provider stream in a campaign. */
export function discoveryCoverageKeys(input: {
  verticalId: string;
  pickedTags?: string[];
  searchWords?: string[];
  wordIndex?: number;
  location: string;
  locationSelection?: DiscoveryLocation | null;
}): string[] {
  const tags = normalizePickedTags(input.pickedTags);
  const streams = tags.length ? tags : [null];
  // A tag is searched together with the first word; an untagged campaign
  // searches one word at a time.
  const word = searchWordAt(
    input.searchWords,
    tags.length ? 0 : (input.wordIndex ?? 0),
  );
  return streams.map((tag) =>
    discoveryCoverageKey({
      verticalId: input.verticalId,
      tag,
      word,
      location: input.location,
      locationSelection: input.locationSelection,
    }),
  );
}

/**
 * One result page's provider request. Without picked tags it is the plain
 * search. With picked tags the tags take turns, one full 20-place page each
 * (never a page split between tags, which made skips that are not multiples
 * of 20). `turn` is the number of pages already fetched, so the tags rotate.
 */
export function buildDiscoverySearchPlan(input: {
  verticalName: string;
  location: string;
  locationSelection?: DiscoveryLocation | null;
  skip: number;
  pickedTags?: string[];
  tagCursors?: Array<number | null>;
  turn?: number;
  /** The campaign's Maps search words; empty for a campaign made before them. */
  searchWords?: string[];
  /** Which word an untagged campaign is searching with now. */
  wordIndex?: number;
}): {
  requests: PlannedDiscoverySearch[];
  totalRequestedResults: number;
  pickedTags: string[];
} {
  const pickedTags = normalizePickedTags(input.pickedTags);
  // With search words the campaign asks Maps in plain words and for the whole
  // named area. Without them (a campaign from an older version) it keeps the
  // request it was started with, so its saved cursors still mean the same.
  const word = searchWordAt(input.searchWords, input.wordIndex);
  const firstWord = searchWordAt(input.searchWords, 0);
  const wholeArea = word !== null;
  if (!pickedTags.length) {
    const request = buildSearchRequest({
      query: word ?? input.verticalName,
      location: input.location,
      locationSelection: input.locationSelection,
      skip: input.skip,
      wholeArea,
    });
    return {
      requests: [{ tagIndex: null, request }],
      totalRequestedResults: request.limit,
      pickedTags,
    };
  }

  const active = pickedTags.flatMap((tag, index) => {
    const providedCursor = input.tagCursors?.[index];
    const cursor = providedCursor === undefined ? 0 : providedCursor;
    return cursor !== null && cursorHasPages(cursor)
      ? [{ tag, index, cursor }]
      : [];
  });
  const turn = Math.max(0, Math.floor(input.turn ?? 0));
  const next = active[turn % Math.max(1, active.length)];
  const requests = next
    ? [
        {
          tagIndex: next.index,
          request: buildSearchRequest({
            query: buildTagSearchQuery(
              next.tag,
              firstWord ?? input.verticalName,
            ),
            location: input.location,
            locationSelection: input.locationSelection,
            skip: next.cursor,
            wholeArea,
          }),
        },
      ]
    : [];
  return {
    requests,
    totalRequestedResults: requests.reduce(
      (total, entry) => total + entry.request.limit,
      0,
    ),
    pickedTags,
  };
}

/** Keep both pieces of a picked-tag query inside the relay's 200 char bound. */
export function buildTagSearchQuery(tag: string, verticalName: string): string {
  return `${tag.trim()} ${verticalName.trim()}`.trim().slice(0, 200).trim();
}

/** Combine tag requests into one saved campaign page, deduplicating by place id. */
export function mergeDiscoverySearchResponses(
  responses: DiscoverySearchResponse[],
  nextSkip: number | null,
): DiscoverySearchResponse {
  const places: DiscoveryPlace[] = [];
  const seenPlaceIds = new Set<string>();
  for (const response of responses) {
    for (const place of response.places) {
      if (place.placeId) {
        if (seenPlaceIds.has(place.placeId)) continue;
        seenPlaceIds.add(place.placeId);
      }
      places.push(place);
    }
  }
  return {
    provider: responses[0]?.provider ?? "outscraper",
    places,
    estimatedCostUsd: responses.reduce(
      (total, response) => total + response.estimatedCostUsd,
      0,
    ),
    nextSkip,
  };
}
