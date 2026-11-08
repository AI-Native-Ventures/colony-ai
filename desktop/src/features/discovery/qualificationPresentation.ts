import type {
  QualifyObservation,
  QualifyObservationHead,
} from "./businessRecordContract";
import { qualificationSignalDefinition } from "./qualificationCampaign";
import { QUALIFY_SURE_CONFIDENCE } from "./qualifyDraftContext";

export type QualificationObservationPresentation = {
  observation: QualifyObservation;
  label: string;
  certainty: "Sure" | "Likely";
};

export function qualificationObserved(
  head: QualifyObservationHead | null | undefined,
): QualificationObservationPresentation[] {
  if (!head) return [];
  return head.observations
    .filter((observation) => observation.state === "observed")
    .map((observation) => ({
      observation,
      label: qualificationSignalDefinition(observation.signal).label,
      certainty:
        observation.confidence >= QUALIFY_SURE_CONFIDENCE ? "Sure" : "Likely",
    }));
}

export function qualificationNotChecked(
  head: QualifyObservationHead | null | undefined,
): QualifyObservation[] {
  return (
    head?.observations.filter(
      (observation) => observation.state === "not_checked",
    ) ?? []
  );
}

export function qualificationReason(reason: string | null): string {
  if (!reason) return "This check did not complete.";
  if (reason === "blocked_by_site") return "The site asked not to be read.";
  if (reason === "business_timeout")
    return "The website took too long to respond.";
  if (reason === "site_down") return "The website could not be reached.";
  return reason.replace(/_/g, " ");
}

export function qualificationCheckedDate(seconds: number): string {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(seconds * 1_000));
}
