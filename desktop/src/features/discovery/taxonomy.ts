import industryData from "./data/industry-taxonomy.json";
import peopleData from "./data/people-taxonomy.json";

export type TaxonomySector = { id: string; label: string };

/** One business type. `id` is the canonical id the cover-picture map uses. */
export type TaxonomyVertical = {
  id: string;
  label: string;
  /** What the screens show: the old market note where one carried over, else the definition. */
  description?: string;
  /** The v4 definition. */
  definition?: string;
  /** The South Africa market note of the old vertical this type replaces. */
  note?: string;
  /** Other names people type for this business type. */
  aliases?: string[];
  /** Every industry the type is listed in, its own first. */
  industries?: string[];
  /** The sector id the type sits in, per industry id. */
  sectors?: Record<string, string>;
  /** ISIC Rev.5 codes. */
  isic?: string[];
  /** Under an industry: the sector this type sits in there. */
  sectorId?: string;
};

export type IndustryCategory = {
  id: string;
  label: string;
  description?: string;
  sectors?: TaxonomySector[];
  verticals: TaxonomyVertical[];
};

export type PeopleField = {
  id: string;
  name: string;
  imageKey?: string;
  roles: string[];
};

export type CatalogueRow = {
  id: string;
  name: string;
  description: string;
  parentId: string;
  parentName: string;
  /** Set when the type's name does not match but its tags do: the tags that matched, at most two. */
  tagMatches?: string[];
};

/** The Discovery v4 catalogue as `build_industry_taxonomy.py` writes it. */
export type CatalogueType = TaxonomyVertical & {
  definition: string;
  industries: string[];
  sectors: Record<string, string>;
  isic: string[];
};

type CatalogueData = {
  industries: {
    id: string;
    label: string;
    description: string;
    sectors: TaxonomySector[];
  }[];
  types: CatalogueType[];
  redirects: Record<string, string>;
  /** Every id the 34 industry list used, and the type it became (if any). */
  legacy: Record<string, string | null>;
};

const catalogue = industryData as unknown as CatalogueData;
const typeIds = new Set(catalogue.types.map((type) => type.id));

function withDescription(type: CatalogueType): CatalogueType {
  return { ...type, description: type.note ?? type.definition };
}

/** Every business type once, however many industries list it. */
export const verticalTypes: CatalogueType[] =
  catalogue.types.map(withDescription);
const verticalById = new Map(verticalTypes.map((type) => [type.id, type]));

/** A type sits in every industry it lists and is shown under each one. */
export const industryTaxonomy: IndustryCategory[] = catalogue.industries.map(
  (industry) => ({
    ...industry,
    verticals: verticalTypes
      .filter((type) => type.industries.includes(industry.id))
      .sort((a, b) => a.label.localeCompare(b.label))
      .map((type) => ({ ...type, sectorId: type.sectors[industry.id] })),
  }),
);
export const peopleTaxonomy = peopleData as PeopleField[];

/** Business types, each counted once however many industries list it. */
export function countVerticals(): number {
  return catalogue.types.length;
}

/** A business type by current or saved id (see `resolveVerticalId`). */
export function findVertical(id: string): CatalogueType | undefined {
  const current = resolveVerticalId(id);
  return current ? verticalById.get(current) : undefined;
}

/**
 * The current type id for an id saved earlier (a retired canonical id, or an
 * id from the 34 industry list), or undefined when the id has no successor.
 */
export function resolveVerticalId(id: string): string | undefined {
  const seen = new Set<string>();
  let next: string | null | undefined = id;
  while (next && !seen.has(next)) {
    if (typeIds.has(next)) return next;
    seen.add(next);
    next = catalogue.redirects[next] ?? catalogue.legacy[next];
  }
  return undefined;
}

export function countPeopleRoles(): number {
  return peopleTaxonomy.reduce((count, field) => count + field.roles.length, 0);
}

/*
 * Matching. Both sides are lower-cased, "&" reads as "and", punctuation goes,
 * and each word loses a plural ending, so "Guest Houses" and "guesthouse"
 * meet. A query matches a field when its words run together appear in the
 * field ("guest house" in "guesthouses") or when every word does. Words of one
 * or two letters and "and" carry no meaning alone, so "B&B" only matches
 * through the run-together form.
 */
const IGNORED_WORDS = new Set(["and", "the", "for", "of"]);

function stemWord(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss"))
    return word.slice(0, -1);
  return word;
}

function normalizedWords(text: string): string[] {
  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/&/g, " and ")
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map(stemWord);
}

type Field = { spaced: string; joined: string };

function field(text: string): Field {
  const words = normalizedWords(text);
  return { spaced: ` ${words.join(" ")} `, joined: words.join("") };
}

type SearchQuery = { joined: string; words: string[] };

function searchQuery(text: string): SearchQuery {
  const words = normalizedWords(text);
  return {
    joined: words.join(""),
    words: words.filter((word) => word.length >= 3 && !IGNORED_WORDS.has(word)),
  };
}

/** Does this text hold the whole query? `fields` are the pieces it is made of. */
function holds(fields: Field[], query: SearchQuery): boolean {
  if (fields.some((entry) => entry.joined.includes(query.joined))) return true;
  if (query.words.length === 0) return false;
  return query.words.every((word) =>
    fields.some((entry) => entry.spaced.includes(word)),
  );
}

/** The AI tag layer of one business type, as `build_vertical_tags.py` writes it. */
export type VerticalTagData = {
  tags: [string, string][];
  search: string[];
  sa: string[];
};

/*
 * The tag layer is 4.5 MB, so it is its own chunk (a dynamic import, shipped
 * inside the app) and loads the first time Discovery opens. Until it has
 * loaded, search runs on the fields above; a failed load leaves it that way
 * and is not retried.
 */
let verticalTags: Record<string, VerticalTagData> | null = null;
let tagLoad: Promise<boolean> | null = null;

/** Install the tag layer (and drop the index built without it). */
export function setVerticalTags(
  data: Record<string, VerticalTagData> | null,
): void {
  verticalTags = data;
  searchIndex = null;
}

export function verticalTagsLoaded(): boolean {
  return verticalTags !== null;
}

/**
 * Load the tag layer once. Resolves true when it is in place, false when the
 * load failed; never rejects and never retries.
 */
export function loadVerticalTagsFrom(
  load: () => Promise<Record<string, VerticalTagData>>,
): Promise<boolean> {
  tagLoad ??= load().then(
    (data) => {
      setVerticalTags(data);
      return true;
    },
    () => false,
  );
  return tagLoad;
}

export function loadVerticalTags(): Promise<boolean> {
  return loadVerticalTagsFrom(async () => {
    const module = await import("./data/vertical-tags.json");
    return module.default as unknown as Record<string, VerticalTagData>;
  });
}

/** Forget the tag layer and any load result (tests only). */
export function resetVerticalTagsForTest(): void {
  setVerticalTags(null);
  tagLoad = null;
}

/** Many texts as one field. Both forms keep a gap between texts, so a run-together query never spans two. */
function joinFields(fields: Field[]): Field {
  return {
    spaced: fields.map((entry) => entry.spaced).join(""),
    joined: fields.map((entry) => entry.joined).join(" "),
  };
}

/** One business type with its text prepared once, nearest-to-the-name first. */
type SearchEntry = {
  row: CatalogueRow;
  industries: string[];
  /**
   * Label, names (aliases, search terms, SA terms), tags, industry names, note.
   * A query is looked for in the first one, then the first two, and so on.
   */
  segments: Field[];
  /** The tags as typed, and each one prepared on first use for the "Matches" hint. */
  tagTexts: string[];
  tagFields?: Field[];
};

const TAG_LEVEL = 2;

let searchIndex: SearchEntry[] | null = null;

function buildSearchIndex(): SearchEntry[] {
  const industryLabels = new Map(
    catalogue.industries.map((industry) => [industry.id, industry.label]),
  );
  return verticalTypes.map((type) => {
    const extra = verticalTags?.[type.id];
    const label = field(type.label);
    const names = joinFields([
      ...(type.aliases ?? []).map(field),
      ...(extra?.search ?? []).map(field),
      ...(extra?.sa ?? []).map(field),
    ]);
    const tagTexts = (extra?.tags ?? []).map(([tag]) => tag);
    const tags = joinFields(tagTexts.map(field));
    const industryNames = joinFields(
      type.industries.map((id) => field(industryLabels.get(id) ?? "")),
    );
    const note = field(`${type.definition} ${type.note ?? ""}`);
    const parentId = type.industries[0] ?? "";
    return {
      row: {
        id: type.id,
        name: type.label,
        description: type.description ?? "",
        parentId,
        parentName: industryLabels.get(parentId) ?? "",
      },
      industries: type.industries,
      segments: [label, names, tags, industryNames, note],
      tagTexts,
    };
  });
}

/**
 * The nearest segment level that holds the whole query, or -1. Same rule as
 * `holds` over the first N segments, but each segment is scanned once, not once
 * per level: the tag text is large and this runs on every keystroke.
 */
function tierOf(entry: SearchEntry, query: SearchQuery): number {
  // One word that is the whole query: a hit in `spaced` is always a hit in `joined`.
  const words =
    query.words.length === 1 && query.words[0] === query.joined
      ? []
      : query.words;
  const covered = words.map(() => false);
  let joinedHit = false;
  for (let level = 0; level < entry.segments.length; level++) {
    const segment = entry.segments[level];
    if (!joinedHit && segment.joined.includes(query.joined)) joinedHit = true;
    if (joinedHit) return level;
    if (words.length === 0) continue;
    let all = true;
    for (let index = 0; index < words.length; index++) {
      if (!covered[index] && segment.spaced.includes(words[index]))
        covered[index] = true;
      if (!covered[index]) all = false;
    }
    if (all) return level;
  }
  return -1;
}

/**
 * Why a type whose name does not match came up: at most two of its tags that
 * hold the whole query. When only the words are spread over the tags and other
 * names (tag tier), the tags that hold one of the words.
 */
function matchedTags(
  entry: SearchEntry,
  query: SearchQuery,
  tier: number,
): string[] {
  if (tier < 1 || tier > TAG_LEVEL || entry.tagTexts.length === 0) return [];
  entry.tagFields ??= entry.tagTexts.map(field);
  const fields = entry.tagFields;
  const whole = entry.tagTexts.filter((_, index) =>
    holds([fields[index]], query),
  );
  if (whole.length || tier < TAG_LEVEL) return whole.slice(0, 2);
  return entry.tagTexts
    .filter((_, index) =>
      query.words.some((word) => fields[index].spaced.includes(word)),
    )
    .slice(0, 2);
}

function rankedBusinessRows(
  query: string,
  industryId: string | null,
): CatalogueRow[] {
  searchIndex ??= buildSearchIndex();
  const wanted = searchQuery(query);
  const ranked: { tier: number; row: CatalogueRow }[] = [];
  for (const entry of searchIndex) {
    if (industryId && !entry.industries.includes(industryId)) continue;
    const tier = wanted.joined ? tierOf(entry, wanted) : 0;
    if (tier < 0) continue;
    const tagMatches = wanted.joined
      ? matchedTags(entry, wanted, tier)
      : undefined;
    ranked.push({
      tier,
      row: {
        ...entry.row,
        ...(industryId
          ? {
              parentId: industryId,
              parentName:
                industryTaxonomy.find((industry) => industry.id === industryId)
                  ?.label ?? "",
            }
          : {}),
        ...(tagMatches?.length ? { tagMatches } : {}),
      },
    });
  }
  // Array.prototype.sort is stable: equal tiers keep catalogue order.
  return ranked.sort((a, b) => a.tier - b.tier).map((entry) => entry.row);
}

export function searchCatalogue(
  mode: "businesses" | "people",
  query: string,
  industryId: string | null,
): CatalogueRow[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (mode === "businesses") return rankedBusinessRows(query, industryId);

  return peopleTaxonomy.flatMap((field) => {
    if (industryId && field.id !== industryId) return [];
    return field.roles
      .map((role) => ({
        id: role
          .toLocaleLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, ""),
        name: role,
        description: "",
        parentId: field.id,
        parentName: field.name,
      }))
      .filter((role) => {
        if (!normalizedQuery) return true;
        return `${role.name} ${field.name}`
          .toLocaleLowerCase()
          .includes(normalizedQuery);
      });
  });
}
