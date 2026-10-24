import { mapSpecializedAskCard } from "../askCardMapping";
import type { AskHead, AskOutcome, AskType } from "../askRecords";

export type OutcomeTone = "ok" | "bad" | "need" | "info" | "idle";
export type OutcomeIcon = "check" | "x" | "pencil" | "alert" | null;
export type OutcomeChip = {
  label: string;
  tone: OutcomeTone;
  icon: OutcomeIcon;
};

export function outcomeLabel(outcome: AskOutcome) {
  switch (outcome) {
    case "approved":
      return "Approved";
    case "rejected":
      return "Rejected";
    case "revision_requested":
      return "Revision requested";
    case "answered":
      return "Answered";
    case "chosen":
      return "Choice recorded";
    case "confirmed":
      return "Checklist confirmed";
    case "pass":
      return "Pass";
    case "fail":
      return "Fail";
    case "secret_bound":
      return "Secret saved";
  }
}

export function typeLabel(type: AskType) {
  if (type === "tool_consent") return "Tool consent";
  return type.charAt(0).toUpperCase() + type.slice(1);
}

/** The chip an outcome card wears: its colour and glyph follow the outcome. */
export function outcomeChip(outcome: AskOutcome): OutcomeChip {
  const label = outcomeLabel(outcome);
  switch (outcome) {
    case "approved":
    case "pass":
      return { label, tone: "ok", icon: "check" };
    case "rejected":
    case "fail":
      return { label, tone: "bad", icon: "x" };
    case "revision_requested":
      return { label, tone: "need", icon: "pencil" };
    case "answered":
    case "chosen":
      return { label, tone: "info", icon: null };
    case "confirmed":
    case "secret_bound":
      return { label, tone: "ok", icon: null };
  }
}

/** The verb before "by <name>" on a decision line. */
export function outcomeVerb(outcome: AskOutcome) {
  switch (outcome) {
    case "chosen":
      return "Chosen";
    case "confirmed":
      return "Confirmed";
    default:
      return outcomeLabel(outcome);
  }
}

/** The small caps label above an outcome card's title. */
export function cardEyebrow(ask: Pick<AskHead["ask"], "category" | "type">) {
  const specialized = mapSpecializedAskCard(ask);
  if (specialized?.kind === "funding") return specialized.listLabel;
  if (specialized?.kind === "hire" || specialized?.kind === "duty") {
    return specialized.decisionTitle;
  }
  return typeLabel(ask.type);
}

export type OutcomeContent = {
  chip: OutcomeChip;
  /** "Approved", "Declined", ... shown before "by <name>"; null when the card has no decision line. */
  verb: string | null;
  /** The reason or the answer, shown as a quote. */
  quote: string | null;
  /** Every option of a choice, with the chosen one marked. */
  options: Array<{ id: string; label: string; chosen: boolean }> | null;
  /** Every item of a confirmed checklist. */
  items: Array<{ id: string; label: string }> | null;
};

/** What a resolved ask's outcome card shows, from its signed head alone. */
export function describeOutcome(head: AskHead): OutcomeContent | null {
  const resolution = head.resolution;
  if (head.status !== "resolved" || !resolution) return null;
  const outcome = resolution.outcome;
  const hire = mapSpecializedAskCard(head.ask)?.kind === "hire";
  let chip = outcomeChip(outcome);
  let verb: string | null = outcomeVerb(outcome);
  if (hire && outcome === "rejected") {
    chip = { label: "Request declined", tone: "bad", icon: null };
    verb = "Declined";
  } else if (hire && outcome === "approved") {
    chip = { label: "Decision recorded", tone: "ok", icon: null };
  }
  const text = (resolution.answer ?? resolution.reason ?? "").trim();
  if (outcome === "chosen") {
    return {
      chip,
      verb,
      quote: null,
      options: (head.ask.options ?? []).map((option) => ({
        id: option.id,
        label: option.label,
        chosen: option.id === resolution.optionId,
      })),
      items: null,
    };
  }
  if (outcome === "confirmed") {
    return {
      chip,
      verb: null,
      quote: null,
      options: null,
      items: (head.ask.items ?? []).map((item) => ({
        id: item.id,
        label: item.label,
      })),
    };
  }
  return {
    chip,
    verb,
    quote: text.length > 0 ? text : null,
    options: null,
    items: null,
  };
}
