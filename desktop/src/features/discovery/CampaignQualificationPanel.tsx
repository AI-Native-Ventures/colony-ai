import * as React from "react";

import { errorMessage } from "./BusinessCommon";
import {
  cloneCampaignQualificationSettings,
  qualificationIsConfigured,
} from "./qualificationCampaign";
import {
  cancelQualificationRun,
  qualificationRunSnapshot,
  resumeQualificationRun,
  startQualificationRun,
  useQualificationProgress,
  type QualificationRunLead,
  type QualificationRunProgress,
} from "./qualificationRuntime";
import type {
  DiscoveryCampaign,
  DiscoveryCampaignProvider,
} from "./discoveryProvider";
import type { LeadContext, ProspectRow } from "./leadShared";

function leadsFromRows(rows: ProspectRow[]): QualificationRunLead[] {
  return rows.map(({ record }) => ({
    leadId: record.prospectId,
    website: record.prospect.website,
    maps: record.prospect.maps ?? null,
  }));
}

function progressDescription(progress: QualificationRunProgress): string {
  const checked = `Checked ${progress.checked} of ${progress.total}`;
  const skipped = progress.skippedFresh
    ? `, ${progress.skippedFresh} already checked in the last 30 days`
    : "";
  if (progress.status === "completed") return `${checked}${skipped}.`;
  if (progress.status === "cancelled") {
    return `${checked}. The remaining checks can resume.`;
  }
  if (progress.status === "paused") {
    return progress.failureReason
      ? `${checked}. ${progress.failureReason}`
      : `${checked}. Resume to finish the remaining checks.`;
  }
  if (progress.status === "failed") {
    return progress.failureReason
      ? `${checked}. ${progress.failureReason}`
      : `${checked}. Checks stopped before completion.`;
  }
  return `${checked}.`;
}

function settingsForProgress(
  campaign: DiscoveryCampaign,
  progress: QualificationRunProgress,
) {
  const current = cloneCampaignQualificationSettings(campaign.qualification);
  return {
    ...current,
    runId: progress.runId,
    phase: progress.status,
    failureReason: progress.failureReason,
  };
}

/**
 * Starts a selected campaign check only after the search has completed. The
 * main process owns the durable work journal; this panel persists the campaign
 * selection and exposes its resumable progress.
 */
export function CampaignQualificationPanel({
  campaign,
  context,
  provider,
  rows,
}: {
  campaign: DiscoveryCampaign;
  context: LeadContext;
  provider: DiscoveryCampaignProvider;
  rows: ProspectRow[];
}) {
  const configured = qualificationIsConfigured(campaign.qualification);
  const settings = cloneCampaignQualificationSettings(campaign.qualification);
  const progressByRun = useQualificationProgress({
    channelId: context.channelId,
    communityId: context.communityId,
  });
  const [localProgress, setLocalProgress] =
    React.useState<QualificationRunProgress | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const launched = React.useRef<string | null>(null);
  const runId = settings.runId;
  const progress =
    (runId ? progressByRun.get(runId) : null) ??
    (localProgress?.runId === runId ? localProgress : null);
  const canStart =
    Boolean(provider.updateQualification) &&
    campaign.status === "complete" &&
    configured &&
    rows.length > 0;

  const persistProgress = React.useCallback(
    async (next: QualificationRunProgress) => {
      setLocalProgress(next);
      if (!provider.updateQualification) return;
      await provider.updateQualification(
        campaign.id,
        settingsForProgress(campaign, next),
      );
    },
    [campaign, provider],
  );

  const start = React.useCallback(
    async (refresh: boolean, persistentRunId?: string) => {
      if (!canStart || !provider.updateQualification) return;
      const nextRunId = persistentRunId ?? crypto.randomUUID();
      const nextSettings = {
        ...settings,
        runId: nextRunId,
        phase: "running" as const,
        failureReason: null,
      };
      launched.current = `${campaign.id}:run:${nextRunId}`;
      setBusy(true);
      setError("");
      try {
        // Persist the campaign's recovery pointer before beginning the durable
        // main-process run. A restart can therefore resume the same run id.
        if (!persistentRunId) {
          await provider.updateQualification(campaign.id, nextSettings);
        }
        const initial = await startQualificationRun({
          channelId: context.channelId,
          communityId: context.communityId,
          leads: leadsFromRows(rows),
          refresh,
          runId: nextRunId,
          selectedSignals: nextSettings.selectedSignals,
        });
        setLocalProgress(initial);
        await provider.updateQualification(
          campaign.id,
          settingsForProgress(
            { ...campaign, qualification: nextSettings },
            initial,
          ),
        );
      } catch (startError) {
        const reason = errorMessage(startError);
        setError(reason);
        try {
          await provider.updateQualification(campaign.id, {
            ...nextSettings,
            phase: "failed",
            failureReason: reason,
          });
        } catch (persistError) {
          setError(`${reason} ${errorMessage(persistError)}`);
        }
      } finally {
        setBusy(false);
      }
    },
    [
      campaign,
      canStart,
      context.channelId,
      context.communityId,
      provider,
      rows,
      settings,
    ],
  );

  React.useEffect(() => {
    if (!canStart || runId || settings.phase !== "idle") return;
    if (launched.current?.startsWith(`${campaign.id}:`)) return;
    launched.current = `${campaign.id}:pending`;
    void start(false);
  }, [campaign.id, canStart, runId, settings.phase, start]);

  React.useEffect(() => {
    if (
      !canStart ||
      !runId ||
      progress ||
      settings.phase !== "running" ||
      launched.current === `${campaign.id}:run:${runId}`
    ) {
      return;
    }
    launched.current = `${campaign.id}:run:${runId}`;
    let disposed = false;
    void qualificationRunSnapshot({
      channelId: context.channelId,
      communityId: context.communityId,
      runId,
    })
      .then((snapshot) => {
        if (disposed) return;
        if (snapshot) {
          setLocalProgress(snapshot);
          return;
        }
        return start(false, runId);
      })
      .catch((recoveryError) => {
        if (!disposed) setError(errorMessage(recoveryError));
      });
    return () => {
      disposed = true;
    };
  }, [
    campaign.id,
    canStart,
    context.channelId,
    context.communityId,
    progress,
    runId,
    settings.phase,
    start,
  ]);

  React.useEffect(() => {
    if (!progress || !provider.updateQualification) return;
    if (
      settings.phase === progress.status &&
      settings.failureReason === progress.failureReason
    ) {
      return;
    }
    void persistProgress(progress).catch((persistError) => {
      setError(errorMessage(persistError));
    });
  }, [
    persistProgress,
    progress,
    provider.updateQualification,
    settings.failureReason,
    settings.phase,
  ]);

  async function resume() {
    if (!runId || !provider.updateQualification) return;
    setBusy(true);
    setError("");
    try {
      const initial = await resumeQualificationRun({
        channelId: context.channelId,
        communityId: context.communityId,
        runId,
      });
      await persistProgress(initial);
    } catch (resumeError) {
      const reason = errorMessage(resumeError);
      setError(reason);
      try {
        await provider.updateQualification(campaign.id, {
          ...settings,
          phase: "failed",
          failureReason: reason,
        });
      } catch (persistError) {
        setError(`${reason} ${errorMessage(persistError)}`);
      }
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!runId) return;
    setBusy(true);
    setError("");
    try {
      const cancelled = await cancelQualificationRun({
        channelId: context.channelId,
        communityId: context.communityId,
        runId,
      });
      const snapshot = await qualificationRunSnapshot({
        channelId: context.channelId,
        communityId: context.communityId,
        runId,
      });
      if (snapshot) await persistProgress(snapshot);
      if (!cancelled && !snapshot) {
        setError("The qualification run is no longer available.");
      }
    } catch (cancelError) {
      setError(errorMessage(cancelError));
    } finally {
      setBusy(false);
    }
  }

  if (!configured || campaign.status !== "complete" || rows.length === 0)
    return null;
  return (
    <section
      aria-labelledby="campaign-qualification-run-title"
      className="c3d-qualification-run"
      data-testid="campaign-qualification-run"
    >
      <div>
        <p className="c3d-eyebrow">Free website checks</p>
        <h2 id="campaign-qualification-run-title">Checking their websites</h2>
        <p>
          {progress
            ? progressDescription(progress)
            : settings.phase === "failed" && settings.failureReason
              ? settings.failureReason
              : "Preparing the selected checks on this computer."}
        </p>
      </div>
      <div className="c3d-qualification-run-actions">
        {progress?.status === "running" ? (
          <button disabled={busy} onClick={() => void cancel()} type="button">
            Cancel checks
          </button>
        ) : null}
        {progress?.status === "paused" || progress?.status === "cancelled" ? (
          <button disabled={busy} onClick={() => void resume()} type="button">
            Resume checks
          </button>
        ) : null}
        {progress?.status === "completed" ? (
          <button
            disabled={busy}
            onClick={() => void start(true)}
            type="button"
          >
            Refresh checks
          </button>
        ) : null}
        {!progress && settings.phase === "failed" ? (
          <button
            disabled={busy}
            onClick={() => void start(false)}
            type="button"
          >
            Retry checks
          </button>
        ) : null}
      </div>
      {error ? (
        <p className="c3d-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
