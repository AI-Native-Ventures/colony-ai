import type { FunctionId, FunctionSlotView } from "./cofounderRecords";
import { FUNCTION_DETAILS } from "./functions";

export type CompanyMapJobDoer =
  | { kind: "specialist"; pubkey: string }
  | { kind: "head"; pubkey: string }
  | { kind: "scout" };

/**
 * One source of truth for every job circle. A specialist argument is already
 * first so the later specialist-hire slice only has to supply its assignment.
 */
export function companyMapJobDoer(
  slot: FunctionSlotView,
  specialistPubkey: string | null = null,
): CompanyMapJobDoer {
  if (specialistPubkey) return { kind: "specialist", pubkey: specialistPubkey };
  if (slot.state === "filled" && slot.leadPubkey) {
    return { kind: "head", pubkey: slot.leadPubkey };
  }
  return { kind: "scout" };
}

/** Compatibility helper for existing map presentation call sites. */
export function companyMapJobIsScoutLed(
  functionId: FunctionId,
  _jobName: string,
  slotState: FunctionSlotView["state"],
): boolean {
  return (
    companyMapJobDoer({
      functionId,
      state: slotState,
      leadPubkey: slotState === "filled" ? "assigned-head" : null,
    }).kind === "scout"
  );
}

/** Copy that describes the one job ownership rule on a part card. */
export function companyMapScoutCoverageSentence(
  functionId: FunctionId,
  slotState: FunctionSlotView["state"],
): string {
  if (
    companyMapJobDoer({
      functionId,
      state: slotState,
      leadPubkey: slotState === "filled" ? "assigned-head" : null,
    }).kind === "scout"
  ) {
    return "Scout does its jobs for now.";
  }
  return `${FUNCTION_DETAILS[functionId].name} lead does its jobs.`;
}
