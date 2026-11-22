import type { CompanyHireHeadRecord } from "@/features/company-hiring/companyHireModels";

import type { FunctionId } from "./cofounderRecords";
import type { SlotHireHead } from "./accessRecords";
import { prebuiltHeadForFunction } from "./prebuiltAgents";

export type RecoverablePrebuiltHire = {
  slotHire: SlotHireHead;
  head: CompanyHireHeadRecord;
};

/** Whether this signed head belongs to the pre-built head for a part. */
export function isPrebuiltHeadHireForFunction(
  record: CompanyHireHeadRecord | null,
  hireId: string,
  functionId: FunctionId,
): record is CompanyHireHeadRecord {
  if (!record) return false;
  return (
    record.head.proposal.hireId.toLowerCase() === hireId.toLowerCase() &&
    record.head.proposal.title === prebuiltHeadForFunction(functionId)?.name
  );
}

/** Terminal heads keep their slot intent for audit but cannot be resumed. */
export function isTerminalPrebuiltHire(
  record: CompanyHireHeadRecord,
): boolean {
  return record.head.status === "denied" || record.head.status === "hired";
}

/**
 * Resolves every slot intent against its current relay head. The first active
 * match stays recoverable while terminal historic intents remain inspectable.
 */
export async function findRecoverablePrebuiltHire(
  slotHires: readonly SlotHireHead[],
  functionId: FunctionId,
  fetchHead: (hireId: string) => Promise<CompanyHireHeadRecord | null>,
): Promise<RecoverablePrebuiltHire | null> {
  for (const slotHire of slotHires) {
    if (slotHire.functionId !== functionId) continue;
    const head = await fetchHead(slotHire.hireId);
    if (
      !isPrebuiltHeadHireForFunction(head, slotHire.hireId, functionId) ||
      isTerminalPrebuiltHire(head)
    ) {
      continue;
    }
    return { slotHire, head };
  }
  return null;
}
