import * as React from "react";
import { listen } from "@tauri-apps/api/event";

import { publishQualifyObservationAction } from "./businessRecordMutations";
import { loadQualifyObservationHead } from "./businessRecordRelay";
import type {
  QualifyObservationAction,
  QualifySignal,
} from "./businessRecordContract";
import type { LeadContext } from "./leadShared";
import type { TenantCommunityId } from "@/features/communities/tenantCommunity";
import { invokeTauri } from "@/shared/api/tauriTransport";

const UUID_PATTERN =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

export type QualificationRunScope = {
  channelId: string;
  communityId: TenantCommunityId;
};

export type QualificationRunLead = {
  leadId: string;
  website: string | null;
  maps?: Record<string, unknown> | null;
};

export type QualificationRunProgress = {
  runId: string;
  status: "running" | "paused" | "failed" | "completed" | "cancelled";
  total: number;
  complete: number;
  checked: number;
  skippedFresh: number;
  pending: number;
  failed: number;
  failureReason: string | null;
};

export type QualificationStartInput = QualificationRunScope & {
  runId: string;
  selectedSignals: QualifySignal[];
  leads: QualificationRunLead[];
  refresh?: boolean;
};

type QualificationRendererRequest = {
  requestId: string;
  generation: number;
  operation: "load_head" | "publish";
  payload: unknown;
};

type QualificationRendererPayload = QualificationRunScope & {
  leadId?: string;
  action?: unknown;
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validScope(
  value: unknown,
  context: LeadContext,
): value is QualificationRendererPayload {
  return (
    record(value) &&
    value.channelId === context.channelId &&
    value.communityId === context.communityId
  );
}

function validRendererRequest(
  value: unknown,
): value is QualificationRendererRequest {
  return (
    record(value) &&
    typeof value.requestId === "string" &&
    typeof value.generation === "number" &&
    (value.operation === "load_head" || value.operation === "publish") &&
    "payload" in value
  );
}

function messageFor(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Qualification action failed.";
}

async function replyToQualificationRenderer(
  request: QualificationRendererRequest,
  response: { ok: true; result: unknown } | { ok: false; error: string },
): Promise<void> {
  await invokeTauri("qualify_renderer_response", {
    requestId: request.requestId,
    generation: request.generation,
    ...response,
  });
}

/**
 * Resolves the main-process engine's record reads and signed record writes in
 * the current renderer. Each request is tied to the active community scope.
 */
export function QualificationRendererBridge({
  context,
}: {
  context: LeadContext;
}) {
  const contextRef = React.useRef(context);
  contextRef.current = context;

  React.useEffect(() => {
    let disposed = false;
    const unlisten = listen<unknown>("qualify:request", (event) => {
      const request = event.payload;
      if (!validRendererRequest(request) || disposed) return;
      const current = contextRef.current;
      void (async () => {
        try {
          if (!validScope(request.payload, current)) {
            throw new Error("Qualification request is outside this business.");
          }
          if (request.operation === "load_head") {
            if (
              typeof request.payload.leadId !== "string" ||
              !UUID_PATTERN.test(request.payload.leadId)
            ) {
              throw new Error("Qualification request has an invalid lead.");
            }
            const result = await loadQualifyObservationHead(
              current.channelId,
              current.communityId,
              request.payload.leadId,
            );
            if (!disposed) {
              await replyToQualificationRenderer(request, { ok: true, result });
            }
            return;
          }
          if (!request.payload.action) {
            throw new Error("Qualification request has no observation action.");
          }
          const eventId = await publishQualifyObservationAction({
            channelId: current.channelId,
            communityId: current.communityId,
            action: request.payload.action as QualifyObservationAction,
          });
          if (!disposed) {
            await replyToQualificationRenderer(request, {
              ok: true,
              result: { eventId },
            });
          }
        } catch (error) {
          if (!disposed) {
            await replyToQualificationRenderer(request, {
              ok: false,
              error: messageFor(error),
            });
          }
        }
      })().catch(() => {
        // The main-process request has a timeout and records a retryable
        // ready-to-publish state if this acknowledgement cannot be delivered.
      });
    });
    return () => {
      disposed = true;
      void unlisten.then((remove) => remove());
    };
  }, []);

  return null;
}

export function startQualificationRun(
  input: QualificationStartInput,
): Promise<QualificationRunProgress> {
  return invokeTauri<QualificationRunProgress>("qualify_start", input);
}

export function resumeQualificationRun(
  input: QualificationRunScope & { runId: string },
): Promise<QualificationRunProgress> {
  return invokeTauri<QualificationRunProgress>("qualify_resume", input);
}

export async function cancelQualificationRun(
  input: QualificationRunScope & { runId: string },
): Promise<boolean> {
  const result = await invokeTauri<{ cancelled?: unknown }>(
    "qualify_cancel",
    input,
  );
  return result.cancelled === true;
}

export function qualificationRunSnapshot(
  input: QualificationRunScope & { runId: string },
): Promise<QualificationRunProgress | null> {
  return invokeTauri<QualificationRunProgress | null>(
    "qualify_snapshot",
    input,
  );
}

function validProgress(value: unknown): value is QualificationRunProgress {
  if (!record(value)) return false;
  return (
    typeof value.runId === "string" &&
    ["running", "paused", "failed", "completed", "cancelled"].includes(
      String(value.status),
    ) &&
    ["total", "complete", "checked", "skippedFresh", "pending", "failed"].every(
      (key) => typeof value[key] === "number",
    ) &&
    (value.failureReason === null || typeof value.failureReason === "string")
  );
}

/** Subscribe to persisted main-process progress for one business scope. */
export function useQualificationProgress(scope: QualificationRunScope) {
  const [runs, setRuns] = React.useState<Map<string, QualificationRunProgress>>(
    () => new Map(),
  );

  React.useEffect(() => {
    let disposed = false;
    const unlisten = listen<unknown>("qualify:progress", (event) => {
      const payload = event.payload;
      if (!record(payload) || disposed) return;
      if (
        payload.channelId !== scope.channelId ||
        payload.communityId !== scope.communityId ||
        !validProgress(payload.progress)
      ) {
        return;
      }
      const progress = payload.progress;
      setRuns((current) => {
        const next = new Map(current);
        next.set(progress.runId, progress);
        return next;
      });
    });
    return () => {
      disposed = true;
      void unlisten.then((remove) => remove());
    };
  }, [scope.channelId, scope.communityId]);

  return runs;
}
