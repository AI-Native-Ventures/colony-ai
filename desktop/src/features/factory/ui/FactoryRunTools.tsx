import * as React from "react";
import {
  useFactoryRunActionMutation,
  useFactoryRunRecordQuery,
} from "@/features/factory/lib/factoryRunRecords";
import type { FactoryRun } from "@/shared/api/factoryRuntime";

export type FactoryRunTool = "agent" | "preview" | "review";

export function FactoryRunToolPane({
  onOpenAgent,
  run,
  tool,
}: {
  onOpenAgent: () => void;
  run: FactoryRun;
  tool: Exclude<FactoryRunTool, "agent">;
}) {
  const recordQuery = useFactoryRunRecordQuery(run.id);
  const configureMutation = useFactoryRunActionMutation(run.id);

  if (recordQuery.isPending) {
    return <div aria-busy="true" className="fx-run-tool-loading" />;
  }
  if (recordQuery.error) {
    return (
      <div className="fx-run-tool-surface fx-run-tool-error" role="alert">
        <span>{recordQuery.error.message}</span>
        <button
          className="fx-button"
          onClick={() => void recordQuery.refetch()}
          type="button"
        >
          Retry
        </button>
      </div>
    );
  }

  const record = recordQuery.data;
  if (tool === "preview") {
    const preview = record?.head.preview ?? {
      state: "not_configured" as const,
    };
    if (preview.state === "not_configured") {
      return (
        <ConfigurePreviewPane
          error={configureMutation.error?.message ?? null}
          onConfigure={async (command, localUrl) => {
            await configureMutation.mutateAsync({
              action: {
                schemaVersion: 1,
                runId: run.id,
                ...(!record
                  ? { runOwnerPubkey: run.scope.identityPubkey }
                  : { expectedHeadEventId: record.event.id }),
                action: "configure_preview",
                command,
                localUrl,
              },
            });
          }}
          pending={configureMutation.isPending}
          runId={run.id}
        />
      );
    }
    if (preview.state === "not_started") {
      return (
        <PreviewEmptyState
          body="Run the development server for this project to open its preview."
          title="Preview has not started"
        />
      );
    }
    if (preview.state === "failed") {
      return (
        <div className="fx-run-tool-surface fx-preview-state">
          <div className="fx-run-tool-empty">
            <span aria-hidden="true" className="fx-run-tool-mark">
              ◇
            </span>
            <h2>Preview failed to start</h2>
            <p>
              {preview.reason}
              {run.status === "running"
                ? " Your agent session is still running."
                : ""}
            </p>
          </div>
          {preview.startupOutput ? (
            <details className="fx-preview-output" open>
              <summary>Startup output</summary>
              <pre>{preview.startupOutput}</pre>
            </details>
          ) : null}
        </div>
      );
    }
    return null;
  }

  if (record?.head.pullRequest) return null;
  return <ReviewWithoutPullRequest onOpenAgent={onOpenAgent} runId={run.id} />;
}

function ConfigurePreviewPane({
  error,
  onConfigure,
  pending,
  runId,
}: {
  error: string | null;
  onConfigure: (command: string, localUrl: string) => Promise<void>;
  pending: boolean;
  runId: string;
}) {
  const [command, setCommand] = React.useState("");
  const [localUrl, setLocalUrl] = React.useState("");
  const [submissionError, setSubmissionError] = React.useState<string | null>(
    null,
  );

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmissionError(null);
    try {
      await onConfigure(command, localUrl);
    } catch (cause) {
      setSubmissionError(
        cause instanceof Error
          ? cause.message
          : "The preview configuration could not be saved.",
      );
    }
  };

  return (
    <form className="fx-run-tool-surface fx-preview-config" onSubmit={submit}>
      <div className="fx-run-tool-empty">
        <span aria-hidden="true" className="fx-run-tool-mark">
          ◇
        </span>
        <h2>Choose a preview command</h2>
        <p>This project has no saved preview command or local address.</p>
        <button
          className="fx-button fx-button-primary"
          disabled={pending}
          type="submit"
        >
          Configure preview
        </button>
      </div>
      <div className="fx-preview-fields">
        <label htmlFor={`factory-preview-command-${runId}`}>
          Development command
        </label>
        <input
          autoComplete="off"
          id={`factory-preview-command-${runId}`}
          maxLength={512}
          onChange={(event) => setCommand(event.currentTarget.value)}
          required
          value={command}
        />
        <label htmlFor={`factory-preview-url-${runId}`}>
          Local preview URL
        </label>
        <input
          autoComplete="url"
          id={`factory-preview-url-${runId}`}
          maxLength={2048}
          onChange={(event) => setLocalUrl(event.currentTarget.value)}
          required
          type="url"
          value={localUrl}
        />
        {submissionError || error ? (
          <p className="fx-run-tool-error-message" role="alert">
            {submissionError ?? error}
          </p>
        ) : null}
      </div>
    </form>
  );
}

function PreviewEmptyState({ body, title }: { body: string; title: string }) {
  return (
    <div className="fx-run-tool-surface">
      <div className="fx-run-tool-empty">
        <span aria-hidden="true" className="fx-run-tool-mark">
          ◇
        </span>
        <h2>{title}</h2>
        <p>{body}</p>
      </div>
    </div>
  );
}

function ReviewWithoutPullRequest({
  onOpenAgent,
  runId,
}: {
  onOpenAgent: () => void;
  runId: string;
}) {
  return (
    <div className="fx-run-tool-surface fx-review-empty">
      <div className="fx-run-tool-empty">
        <span aria-hidden="true" className="fx-run-tool-mark">
          ◇
        </span>
        <h2>No pull request linked</h2>
        <p>
          This run has no linked pull request yet. Create one from the agent
          session or attach an existing URL.
        </p>
        <button
          className="fx-button fx-button-primary"
          onClick={onOpenAgent}
          type="button"
        >
          Open agent session
        </button>
      </div>
      <label
        className="fx-review-url-field"
        htmlFor={`factory-review-url-${runId}`}
      >
        <span>Pull request URL</span>
        <input
          aria-disabled="true"
          autoComplete="off"
          id={`factory-review-url-${runId}`}
          readOnly
          value=""
        />
      </label>
    </div>
  );
}
