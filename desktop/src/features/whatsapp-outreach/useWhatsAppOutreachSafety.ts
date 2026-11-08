import * as React from "react";

import { KIND_WHATSAPP_SAFETY_ACTION } from "@/shared/constants/kinds";
import { optOutSuppressionsByWaId } from "./whatsappOutreachContactState";
import type { WhatsAppCommandKind } from "./whatsappOutreachApi";
import { useWhatsAppSafetyLedgerQuery } from "./whatsappOutreachQueries";

/** Keeps the optional owner-only safety ledger out of the core chat-screen state machine. */
export function useWhatsAppOptOutSuppressionByWaId(
  canManage: boolean,
  connected: boolean,
) {
  const safetyLedgerQuery = useWhatsAppSafetyLedgerQuery(
    canManage && connected,
  );
  return React.useMemo(
    () => optOutSuppressionsByWaId(safetyLedgerQuery.data?.suppressions ?? []),
    [safetyLedgerQuery.data?.suppressions],
  );
}

export function undoWhatsAppOptOut(
  command: (
    kind: WhatsAppCommandKind,
    payload: Record<string, unknown>,
  ) => Promise<void>,
  waId: string,
) {
  return command(KIND_WHATSAPP_SAFETY_ACTION, {
    v: 1,
    action: "opt_out_undo",
    waId,
  });
}
