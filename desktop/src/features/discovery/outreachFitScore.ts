import type {
  ProspectMapsMetadata,
  QualifyObservationHead,
  QualifySignal,
} from "./businessRecordContract";

/**
 * Transparent opportunity weights for outreach. A score is not an AI result:
 * it is the capped sum of the stored reputation bands and observed website
 * signals below. Signal points are reduced by their stored confidence.
 */
export const OUTREACH_FIT_SIGNAL_WEIGHTS: Readonly<
  Record<QualifySignal, number>
> = {
  NO_WEBSITE: 30,
  SITE_DOWN: 25,
  NO_HTTPS: 6,
  NOT_MOBILE_FRIENDLY: 25,
  NO_ONLINE_BOOKING: 12,
  NO_WHATSAPP_LINK: 20,
  HAS_WHATSAPP_LINK: 0,
  RUNNING_ADS: 4,
  STALE_SITE: 10,
  SITE_BUILDER: 3,
  INCUMBENT_BUILDER: 4,
  SOCIAL_LINKS: 2,
  PUBLIC_EMAIL: 0,
};

/** One visible contribution to the transparent outreach score. */
export type OutreachFitScorePart = {
  key: "maps_rating" | "maps_reviews" | QualifySignal;
  label: string;
  points: number;
  maximumPoints: number;
  confidence?: number;
};

/** The capped score and all of the stored facts that contributed to it. */
export type OutreachFitScore = {
  score: number;
  parts: OutreachFitScorePart[];
};

/**
 * The full enum intentionally includes safety states owned by the outreach
 * safety lane. The current desktop emits only the first three current-data
 * cases through `outreachNotContactedReason`.
 */
export const OUTREACH_NOT_CONTACTED_REASON_CODES = [
  "below_minimum_fit",
  "no_whatsapp_number",
  "not_checked",
  "opted_out",
  "never_contact_list",
  "already_in_conversation",
] as const;

/** Codes shared with future safety work even when this UI cannot emit them yet. */
export type OutreachNotContactedReasonCode =
  (typeof OUTREACH_NOT_CONTACTED_REASON_CODES)[number];

/** One user-visible reason that excludes a lead from a proposed batch. */
export type OutreachNotContactedReason = {
  code: OutreachNotContactedReasonCode;
  label: string;
  detail: string;
};

const SIGNAL_LABELS: Readonly<Record<QualifySignal, string>> = {
  NO_WEBSITE: "No website",
  SITE_DOWN: "Website not loading",
  NO_HTTPS: "Not secure (no padlock)",
  NOT_MOBILE_FRIENDLY: "Hard to use on a phone",
  NO_ONLINE_BOOKING: "No online booking found",
  NO_WHATSAPP_LINK: "No WhatsApp button found",
  HAS_WHATSAPP_LINK: "Has a WhatsApp button",
  RUNNING_ADS: "Paying for ads",
  STALE_SITE: "Looks out of date",
  SITE_BUILDER: "Built with a site builder",
  INCUMBENT_BUILDER: "Built by another provider",
  SOCIAL_LINKS: "Social pages found",
  PUBLIC_EMAIL: "Public contact email",
};

function mapsRatingPoints(ratingHundredths: number | null | undefined): {
  label: string;
  points: number;
} | null {
  if (
    typeof ratingHundredths !== "number" ||
    !Number.isFinite(ratingHundredths) ||
    ratingHundredths < 0
  ) {
    return null;
  }
  const rating = ratingHundredths / 100;
  const points =
    rating >= 4.5
      ? 12
      : rating >= 4
        ? 9
        : rating >= 3.5
          ? 6
          : rating >= 3
            ? 3
            : 0;
  return {
    label: `${rating.toFixed(1)} rating`,
    points,
  };
}

function mapsReviewPoints(reviewCount: number | null | undefined): {
  label: string;
  points: number;
} | null {
  if (
    typeof reviewCount !== "number" ||
    !Number.isFinite(reviewCount) ||
    reviewCount < 0
  ) {
    return null;
  }
  const reviews = Math.floor(reviewCount);
  const points = reviews >= 50 ? 6 : reviews >= 20 ? 4 : reviews >= 5 ? 2 : 0;
  return {
    label: `${String(reviews)} ${reviews === 1 ? "review" : "reviews"}`,
    points,
  };
}

function boundedConfidence(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

/**
 * Calculate an explainable outreach score from the currently stored facts.
 * A missing or incomplete qualification intentionally returns `null`: unknown
 * website facts must never masquerade as an absence or a score of zero.
 */
export function calculateOutreachFitScore(
  maps: ProspectMapsMetadata | null | undefined,
  qualification: QualifyObservationHead | null | undefined,
): OutreachFitScore | null {
  if (
    !qualification ||
    qualification.observations.some(
      (observation) => observation.state === "not_checked",
    )
  ) {
    return null;
  }

  const parts: OutreachFitScorePart[] = [];
  const rating = mapsRatingPoints(maps?.ratingHundredths);
  if (rating?.points) {
    parts.push({
      key: "maps_rating",
      label: rating.label,
      points: rating.points,
      maximumPoints: 12,
    });
  }
  const reviews = mapsReviewPoints(maps?.reviewCount);
  if (reviews?.points) {
    parts.push({
      key: "maps_reviews",
      label: reviews.label,
      points: reviews.points,
      maximumPoints: 6,
    });
  }

  const seenSignals = new Set<QualifySignal>();
  for (const observation of qualification.observations) {
    if (
      observation.state !== "observed" ||
      seenSignals.has(observation.signal)
    ) {
      continue;
    }
    seenSignals.add(observation.signal);
    const maximumPoints = OUTREACH_FIT_SIGNAL_WEIGHTS[observation.signal];
    const confidence = boundedConfidence(observation.confidence);
    const points = Math.round(maximumPoints * confidence);
    if (points === 0) continue;
    parts.push({
      key: observation.signal,
      label: SIGNAL_LABELS[observation.signal],
      points,
      maximumPoints,
      confidence,
    });
  }

  return {
    score: Math.min(
      100,
      parts.reduce((total, part) => total + part.points, 0),
    ),
    parts,
  };
}

function validMinimumFit(value: number | null | undefined): number | null {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > 100
  ) {
    return null;
  }
  return value;
}

/**
 * Resolve one current reason in priority order. A delivery address is required
 * before score eligibility. Unscored leads are held only while a minimum score
 * is active, leaving the default setting intentionally off.
 */
export function outreachNotContactedReason(input: {
  fit: OutreachFitScore | null;
  hasWhatsAppNumber: boolean;
  minimumFit: number | null | undefined;
}): OutreachNotContactedReason | null {
  if (!input.hasWhatsAppNumber) {
    return {
      code: "no_whatsapp_number",
      label: "No WhatsApp number",
      detail: "No WhatsApp number is saved for this lead.",
    };
  }
  const minimumFit = validMinimumFit(input.minimumFit);
  if (minimumFit === null) return null;
  if (!input.fit) {
    return {
      code: "not_checked",
      label: "Not checked yet",
      detail: "No score until its website has been checked.",
    };
  }
  if (input.fit.score < minimumFit) {
    return {
      code: "below_minimum_fit",
      label: `Below your minimum of ${String(minimumFit)}`,
      detail: `Fit score ${String(input.fit.score)} is below your minimum of ${String(minimumFit)}.`,
    };
  }
  return null;
}
