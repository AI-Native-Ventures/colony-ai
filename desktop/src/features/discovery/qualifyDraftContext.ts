import type {
  QualifyObservation,
  QualifyObservationHead,
  QualifySignal,
} from "./businessRecordContract";

export const QUALIFY_DRAFT_FRESHNESS_SECONDS = 30 * 24 * 60 * 60;
export const QUALIFY_DRAFT_MIN_CONFIDENCE = 0.6;
export const QUALIFY_SURE_CONFIDENCE = 0.85;

export type QualificationDraftFact = {
  signal: QualifySignal;
  statement: string;
  confidence: number;
  certainty: "sure" | "likely";
  evidenceUrls: string[];
  observedAt: number;
};

export type QualificationApprovalEvidence = Pick<
  QualificationDraftFact,
  | "signal"
  | "statement"
  | "confidence"
  | "certainty"
  | "evidenceUrls"
  | "observedAt"
>;

export type QualificationDraftContext = {
  facts: QualificationDraftFact[];
  approvalEvidence: QualificationApprovalEvidence[];
};

const NEGATIVE_SIGNALS = new Set<QualifySignal>([
  "NO_WEBSITE",
  "SITE_DOWN",
  "NO_HTTPS",
  "NOT_MOBILE_FRIENDLY",
  "NO_ONLINE_BOOKING",
  "NO_WHATSAPP_LINK",
  "STALE_SITE",
]);

function isFresh(observation: QualifyObservation, nowSeconds: number): boolean {
  return (
    observation.observedAt <= nowSeconds &&
    nowSeconds - observation.observedAt <= QUALIFY_DRAFT_FRESHNESS_SECONDS
  );
}

function likelyNegativeStatement(signal: QualifySignal): string {
  switch (signal) {
    case "NO_WEBSITE":
      return "I couldn't find a real business website listed.";
    case "SITE_DOWN":
      return "I couldn't reach the homepage when it was checked.";
    case "NO_HTTPS":
      return "I couldn't find an HTTPS version of the homepage.";
    case "NOT_MOBILE_FRIENDLY":
      return "I couldn't find basic mobile-friendly page hints.";
    case "NO_ONLINE_BOOKING":
      return "I couldn't find an online booking option in the pages checked.";
    case "NO_WHATSAPP_LINK":
      return "I couldn't find a WhatsApp link in the static pages checked.";
    case "STALE_SITE":
      return "I couldn't find a recent dated update on the pages checked.";
    default:
      return "I couldn't find the expected website signal.";
  }
}

function plainStatement(observation: QualifyObservation): string {
  switch (observation.signal) {
    case "NO_WEBSITE":
      return "No real business website was listed.";
    case "SITE_DOWN":
      return "The homepage did not load when it was checked.";
    case "NO_HTTPS":
      return "The homepage used HTTP rather than HTTPS.";
    case "NOT_MOBILE_FRIENDLY":
      return "The homepage lacked basic mobile-friendly page hints.";
    case "NO_ONLINE_BOOKING":
      return "No online booking option was found in the pages checked.";
    case "NO_WHATSAPP_LINK":
      return "No WhatsApp link was found in the static pages checked.";
    case "HAS_WHATSAPP_LINK":
      return "A WhatsApp link is available on the site.";
    case "RUNNING_ADS":
      return "Google Ads or Meta pixel markers were found on the site.";
    case "STALE_SITE":
      return `The site appears out of date: ${String(observation.value)}.`;
    case "SITE_BUILDER":
      return `The site uses ${String(observation.value)}.`;
    case "INCUMBENT_BUILDER":
      return `A footer credit names ${String(observation.value)}.`;
    case "SOCIAL_LINKS":
      return "A social link is available on the site.";
    case "PUBLIC_EMAIL":
      return "A public contact email is listed on the site.";
  }
}

function statementFor(observation: QualifyObservation): {
  statement: string;
  certainty: "sure" | "likely";
} {
  const certainty =
    observation.confidence >= QUALIFY_SURE_CONFIDENCE ? "sure" : "likely";
  return {
    certainty,
    statement:
      certainty === "likely" && NEGATIVE_SIGNALS.has(observation.signal)
        ? likelyNegativeStatement(observation.signal)
        : plainStatement(observation),
  };
}

function eligible(
  observation: QualifyObservation,
  nowSeconds: number,
): boolean {
  return (
    observation.state === "observed" &&
    observation.confidence >= QUALIFY_DRAFT_MIN_CONFIDENCE &&
    observation.evidenceUrls.length > 0 &&
    isFresh(observation, nowSeconds) &&
    observation.signal !== "PUBLIC_EMAIL" &&
    !observation.personalData
  );
}

/**
 * Build the only qualification facts a drafter may quote and the same evidence
 * payload an approval card can render. Public email stays out of v1 drafting.
 */
export function buildQualificationDraftContext(
  head: QualifyObservationHead | null | undefined,
  nowSeconds: number,
): QualificationDraftContext {
  if (!head) return { facts: [], approvalEvidence: [] };
  const facts = head.observations
    .filter((observation) => eligible(observation, nowSeconds))
    .map((observation) => {
      const wording = statementFor(observation);
      return {
        signal: observation.signal,
        statement: wording.statement,
        confidence: observation.confidence,
        certainty: wording.certainty,
        evidenceUrls: [...observation.evidenceUrls],
        observedAt: observation.observedAt,
      };
    });
  return { facts, approvalEvidence: facts.map((fact) => ({ ...fact })) };
}
