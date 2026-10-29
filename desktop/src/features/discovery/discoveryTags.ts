import type { DiscoveryPlace } from "./discoverySearch";
import {
  discoveryTextMatches,
  verticalTagsFor,
  VERTICAL_TAG_KINDS,
  type VerticalTagKind,
} from "./taxonomy";

export type DiscoveryTagMatch = {
  tag: string;
  kind: string;
  picked: boolean;
};

/** Website host words only. This never fetches the business website. */
export function websiteDomainWords(website: string | null): string {
  if (!website?.trim()) return "";
  const candidate = website.trim();
  try {
    const url = new URL(
      candidate.includes("://") ? candidate : `https://${candidate}`,
    );
    return url.hostname.replace(/^www\./i, "").replace(/[.-]+/g, " ");
  } catch {
    return candidate.replace(/[/:?#.-]+/g, " ");
  }
}

/** Match one provider result against its selected type's generated tag layer. */
export function matchDiscoveryTags(
  verticalId: string,
  pickedTags: string[],
  place: DiscoveryPlace,
): DiscoveryTagMatch[] {
  const fields = [
    place.name,
    place.category ?? "",
    place.subtypes ?? "",
    place.description ?? "",
    websiteDomainWords(place.website),
  ];
  const picked = new Set(pickedTags);
  return verticalTagsFor(verticalId)
    .filter(({ tag }) => discoveryTextMatches(tag, fields))
    .map(({ tag, kind }) => ({ tag, kind, picked: picked.has(tag) }))
    .sort((left, right) => Number(right.picked) - Number(left.picked));
}

/** Picked search tags count twice when ranking an individual lead. */
export function discoveryTagFitWeight(tags: DiscoveryTagMatch[]): number {
  return tags.reduce((total, match) => total + (match.picked ? 2 : 1), 0);
}

/** Best-fit order: tag evidence first, then the existing provider score. */
export function compareDiscoveryTagFit(
  leftTags: DiscoveryTagMatch[],
  leftScore: number | null | undefined,
  rightTags: DiscoveryTagMatch[],
  rightScore: number | null | undefined,
): number {
  return (
    discoveryTagFitWeight(rightTags) - discoveryTagFitWeight(leftTags) ||
    (rightScore ?? -1) - (leftScore ?? -1)
  );
}

/** A small label only when the matched tag evidence is useful. */
export function discoveryTagFitLabel(
  tags: DiscoveryTagMatch[],
): "Strong fit" | "Possible fit" | null {
  const weight = discoveryTagFitWeight(tags);
  if (weight >= 4) return "Strong fit";
  if (weight >= 2) return "Possible fit";
  return null;
}

/** All matched tags, grouped in the stable taxonomy kind order. */
export function groupDiscoveryTags(
  tags: DiscoveryTagMatch[],
): Array<{ kind: VerticalTagKind; tags: DiscoveryTagMatch[] }> {
  return VERTICAL_TAG_KINDS.flatMap((kind) => {
    const matches = tags.filter((match) => match.kind === kind);
    return matches.length ? [{ kind, tags: matches }] : [];
  });
}
