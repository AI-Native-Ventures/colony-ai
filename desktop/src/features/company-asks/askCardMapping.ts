import type { AskRecord } from "./askRecords";

export type SpecializedAskCard = {
  kind: "funding" | "tool" | "hire";
  listLabel: string;
  decisionTitle: string;
  submitLabel: string;
};

/** Maps only supported approval records to their category-specific detail card. */
export function mapSpecializedAskCard(
  ask: Pick<AskRecord, "category" | "type">,
): SpecializedAskCard | null {
  if (ask.type !== "approval") return null;

  switch (ask.category) {
    case "money":
      return {
        kind: "funding",
        listLabel: "Budget",
        decisionTitle: "Funding approval",
        submitLabel: "Record funding decision",
      };
    case "tool":
      return {
        kind: "tool",
        listLabel: "Tool consent",
        decisionTitle: "Tool consent",
        submitLabel: "Record tool decision",
      };
    case "hire":
      return {
        kind: "hire",
        listLabel: "Approval",
        decisionTitle: "Hiring approval",
        submitLabel: "Record hiring decision",
      };
    default:
      return null;
  }
}

export function needsMeAskLabel(ask: Pick<AskRecord, "category" | "type">) {
  const specialized = mapSpecializedAskCard(ask);
  return specialized?.listLabel ?? ask.type;
}
