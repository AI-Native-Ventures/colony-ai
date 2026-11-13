import type { FunctionId, FunctionSlotView } from "./cofounderRecords";
import { companyMapJobIsScoutLed } from "./companyMapAssignments";

/** The board wire forms. Seat is reserved for future add or newly proposed workflow nodes. */
export type CompanyMapConnectorState = "live" | "on" | "seat" | "off";

/**
 * Choose the wire for a current job node. Whether a job has its own screen
 * does not change its wire: only work in motion and the person who runs it do.
 */
export function companyMapJobConnectorState(
  functionId: FunctionId,
  jobName: string,
  slotState: FunctionSlotView["state"],
  partIsLive: boolean,
  jobHasWaitingWork: boolean,
): CompanyMapConnectorState {
  if (partIsLive && jobHasWaitingWork) return "live";
  return companyMapJobIsScoutLed(functionId, jobName, slotState) ||
    slotState === "filled"
    ? "on"
    : "off";
}
