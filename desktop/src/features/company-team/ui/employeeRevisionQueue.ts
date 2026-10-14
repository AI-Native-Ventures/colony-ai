import type {
  EmployeeRevisionAction,
  PendingEmployeeRevision,
} from "../employeeHistory";

function pendingKey(employeePubkey: string) {
  return `company-employee-history-pending:${employeePubkey.toLowerCase()}`;
}

export function readPendingRevisions(
  employeePubkey: string,
): PendingEmployeeRevision[] {
  try {
    const raw = localStorage.getItem(pendingKey(employeePubkey));
    if (!raw) return [];
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter(
      (item): item is PendingEmployeeRevision =>
        typeof item === "object" &&
        item !== null &&
        typeof item.pendingId === "string" &&
        typeof item.actorPubkey === "string" &&
        typeof item.action === "object" &&
        item.action !== null &&
        item.action.employeePubkey === employeePubkey.toLowerCase(),
    );
  } catch {
    return [];
  }
}

export function queuePendingRevision(
  employeePubkey: string,
  actorPubkey: string,
  action: EmployeeRevisionAction,
) {
  const current = readPendingRevisions(employeePubkey);
  const next = [
    ...current,
    { pendingId: crypto.randomUUID(), actorPubkey, action },
  ];
  if (next.length > 25) {
    throw new Error(
      "Employee history retry queue is full. Keep this screen open and retry.",
    );
  }
  localStorage.setItem(pendingKey(employeePubkey), JSON.stringify(next));
}

export function removePendingRevision(employeePubkey: string, index: number) {
  const pending = readPendingRevisions(employeePubkey);
  pending.splice(index, 1);
  if (pending.length === 0) localStorage.removeItem(pendingKey(employeePubkey));
  else
    localStorage.setItem(pendingKey(employeePubkey), JSON.stringify(pending));
}
