import type { PendingBulkProspectUpdate } from "./bulkProspectUpdate";
import { pendingBulkUpdateDescription } from "./bulkProspectUpdateRuntime";

import "./pending-bulk-prospect-update.css";

export function PendingBulkProspectUpdateNotice({
  pending,
  busy,
  onRetry,
}: {
  pending: PendingBulkProspectUpdate;
  busy: boolean;
  onRetry: () => void;
}) {
  return (
    <section
      aria-label="Saved bulk update"
      className="c3b-pending-update"
      role="status"
    >
      <span>{pendingBulkUpdateDescription(pending)}.</span>
      <button disabled={busy} onClick={onRetry} type="button">
        {busy ? "Retrying…" : "Retry update"}
      </button>
    </section>
  );
}
