import * as React from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import {
  QUALIFICATION_SIGNAL_DEFINITIONS,
  RECOMMENDED_QUALIFY_SIGNALS,
} from "./qualificationCampaign";
import type { QualifySignal } from "./businessRecordContract";

function toggle(values: readonly QualifySignal[], signal: QualifySignal) {
  return values.includes(signal)
    ? values.filter((value) => value !== signal)
    : [...values, signal];
}

/** Select the bounded, free website checks before a manual lead run. */
export function QualificationRunDialog({
  initialSignals = [],
  leadCount,
  onOpenChange,
  onRun,
  open,
}: {
  initialSignals?: readonly QualifySignal[];
  leadCount: number;
  onOpenChange: (open: boolean) => void;
  onRun: (input: {
    refresh: boolean;
    selectedSignals: QualifySignal[];
  }) => Promise<void>;
  open: boolean;
}) {
  const [selectedSignals, setSelectedSignals] = React.useState<QualifySignal[]>(
    [],
  );
  const [refresh, setRefresh] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    if (!open) return;
    setSelectedSignals([...initialSignals]);
    setRefresh(false);
    setBusy(false);
    setError("");
  }, [initialSignals, open]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selectedSignals.length === 0) {
      setError("Choose at least one website check.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onRun({ refresh, selectedSignals });
      onOpenChange(false);
    } catch (runError) {
      setError(
        runError instanceof Error && runError.message.trim()
          ? runError.message
          : "Website checks could not start. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="c3l-dialog-content c3q-run-dialog"
        data-testid="qualification-run-dialog"
      >
        <DialogHeader>
          <p className="c3d-eyebrow">Free, no AI</p>
          <DialogTitle>Check their websites</DialogTitle>
          <DialogDescription>
            Colony checks only the selected public facts on this computer. It
            does not send outreach or use AI.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => void submit(event)}>
          <div className="c3q-run-dialog-head">
            <span>{leadCount} selected</span>
            <button
              disabled={busy}
              onClick={() =>
                setSelectedSignals([...RECOMMENDED_QUALIFY_SIGNALS])
              }
              type="button"
            >
              Select the 7 recommended
            </button>
          </div>
          <fieldset className="c3q-run-signals">
            <legend>What to look for</legend>
            {QUALIFICATION_SIGNAL_DEFINITIONS.map((definition) => (
              <label key={definition.signal}>
                <input
                  checked={selectedSignals.includes(definition.signal)}
                  disabled={busy}
                  onChange={() =>
                    setSelectedSignals((current) =>
                      toggle(current, definition.signal),
                    )
                  }
                  type="checkbox"
                />
                <span>
                  {definition.label}
                  <small>{definition.description}</small>
                </span>
              </label>
            ))}
          </fieldset>
          <label className="c3q-refresh-toggle">
            <input
              checked={refresh}
              disabled={busy}
              onChange={(event) => setRefresh(event.currentTarget.checked)}
              type="checkbox"
            />
            Refresh checks completed in the last 30 days
          </label>
          {error ? (
            <p className="c3l-outreach-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="c3q-run-dialog-actions">
            <button
              className="c3l-btn c3l-btn-outline c3l-btn-small"
              disabled={busy}
              onClick={() => onOpenChange(false)}
              type="button"
            >
              Cancel
            </button>
            <button
              className="c3l-btn c3l-btn-primary c3l-btn-small"
              disabled={busy || leadCount === 0}
              type="submit"
            >
              {busy ? "Starting…" : "Start checks"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
