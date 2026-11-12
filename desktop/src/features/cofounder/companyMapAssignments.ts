import type { FunctionId, FunctionSlotView } from "./cofounderRecords";
import { FUNCTION_DETAILS } from "./functions";

/** Jobs assigned to Scout in the approved company map, unless a part is hired. */
export function companyMapJobIsScoutLed(
  functionId: FunctionId,
  jobName: string,
  slotState: FunctionSlotView["state"],
): boolean {
  if (slotState === "covered_by_scout") return true;
  if (
    functionId === "finance" &&
    ["Quotes", "Deposits", "Recurring plans"].includes(jobName)
  ) {
    return true;
  }
  return (
    slotState === "empty" && ["customer_success", "brand"].includes(functionId)
  );
}

/** Copy that names Scout's map jobs without inventing coverage for other parts. */
export function companyMapScoutCoverageSentence(
  functionId: FunctionId,
  slotState: FunctionSlotView["state"],
): string {
  const jobs = FUNCTION_DETAILS[functionId].subFunctions.filter((jobName) =>
    companyMapJobIsScoutLed(functionId, jobName, slotState),
  );
  if (jobs.length === 0) {
    return `Scout suggests hiring a ${FUNCTION_DETAILS[functionId].suggestedHire}.`;
  }
  if (jobs.length === FUNCTION_DETAILS[functionId].subFunctions.length) {
    return "Scout does its jobs for now.";
  }
  const lastJob = jobs[jobs.length - 1];
  return `Scout does ${jobs.slice(0, -1).join(", ")} and ${lastJob}.`;
}
