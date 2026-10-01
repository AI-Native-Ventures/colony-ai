import * as React from "react";

import {
  useFactoryRunActionMutation,
  type FactoryPreviewReadiness,
  type FactoryPreviewState,
  type FactoryRunRecord,
} from "@/features/factory/lib/factoryRunRecords";
import type { FactoryRun } from "@/shared/api/factoryRuntime";

const RUNTIME_NOTICE_ID = "factory-preview-runtime-unavailable";

export function FactoryPreviewPane({
  record,
  run,
}: {
  record: FactoryRunRecord | null | undefined;
  run: FactoryRun;
}) {
  const mutation = useFactoryRunActionMutation(run.id);
  const [optimisticPreview, setOptimisticPreview] = React.useState<{
    recordEventId: string | null;
    preview: FactoryPreviewState;
  } | null>(null);
  const recordEventId = record?.event.id ?? null;
  const preview =
    optimisticPreview?.recordEventId === recordEventId
      ? optimisticPreview.preview
      : (record?.head.preview ?? { state: "not_configured" as const });
  const [editing, setEditing] = React.useState(false);

  const saveConfiguration = async (
    command: string,
    port: number,
    readiness: FactoryPreviewReadiness,
  ) => {
    const localUrl = `http://127.0.0.1:${port}`;
    await mutation.mutateAsync({
      action: {
        schemaVersion: 1,
        runId: run.id,
        ...(!record
          ? { runOwnerPubkey: run.scope.identityPubkey }
          : { expectedHeadEventId: record.event.id }),
        action: "configure_preview",
        command,
        localUrl,
        port,
        readiness,
      },
    });
    setOptimisticPreview({
      recordEventId,
      preview: { state: "not_started", command, localUrl, port, readiness },
    });
    setEditing(false);
  };

  if (editing) {
    return (
      <ConfigurePreviewForm
        initialCommand={"command" in preview ? preview.command : ""}
        initialPort={
          "port" in preview && preview.port
            ? String(preview.port)
            : "localUrl" in preview
              ? portFromUrl(preview.localUrl)
              : ""
        }
        initialReadiness={
          "readiness" in preview ? preview.readiness : undefined
        }
        onCancel={() => setEditing(false)}
        onSave={saveConfiguration}
        pending={mutation.isPending}
        runId={run.id}
      />
    );
  }

  if (preview.state === "not_configured") {
    return (
      <section className="fx-run-tool-surface fx-preview-configure-empty">
        <h2>Configure preview</h2>
        <p>No preview configuration is saved for this run.</p>
        <button
          className="fx-button fx-button-primary"
          onClick={() => setEditing(true)}
          type="button"
        >
          Configure preview
        </button>
      </section>
    );
  }

  if (preview.state === "not_started" && !preview.readiness) {
    return (
      <PreviewEmptyState
        body="Run the development server for this project to open its preview."
        title="Preview has not started"
      />
    );
  }

  if (preview.state === "failed" && !preview.readiness) {
    return (
      <LegacyPreviewFailure
        preview={preview}
        runIsActive={run.status === "running"}
      />
    );
  }

  return (
    <PreviewStatus
      onEdit={() => setEditing(true)}
      preview={preview}
      runOwner={record?.head.runOwnerPubkey ?? run.scope.identityPubkey}
      viewer={run.scope.identityPubkey}
    />
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

function LegacyPreviewFailure({
  preview,
  runIsActive,
}: {
  preview: Extract<FactoryPreviewState, { state: "failed" }>;
  runIsActive: boolean;
}) {
  return (
    <div className="fx-run-tool-surface fx-preview-state">
      <div className="fx-run-tool-empty">
        <span aria-hidden="true" className="fx-run-tool-mark">
          ◇
        </span>
        <h2>Preview failed to start</h2>
        <p>
          {preview.reason}
          {runIsActive ? " Your agent session is still running." : ""}
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

function ConfigurePreviewForm({
  initialCommand,
  initialPort,
  initialReadiness,
  onCancel,
  onSave,
  pending,
  runId,
}: {
  initialCommand: string;
  initialPort: string;
  initialReadiness?: FactoryPreviewReadiness;
  onCancel: () => void;
  onSave: (
    command: string,
    port: number,
    readiness: FactoryPreviewReadiness,
  ) => Promise<void>;
  pending: boolean;
  runId: string;
}) {
  const [command, setCommand] = React.useState(initialCommand);
  const [portText, setPortText] = React.useState(initialPort);
  const [readinessMode, setReadinessMode] = React.useState(
    initialReadiness?.mode ?? "",
  );
  const [readinessValue, setReadinessValue] = React.useState(
    initialReadiness?.value ?? "",
  );
  const [validationError, setValidationError] = React.useState(false);
  const [saveFailed, setSaveFailed] = React.useState(false);

  const commandId = `factory-preview-command-${runId}`;
  const portId = `factory-preview-port-${runId}`;
  const readinessModeId = `factory-preview-readiness-mode-${runId}`;
  const readinessValueId = `factory-preview-readiness-value-${runId}`;

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setValidationError(false);
    setSaveFailed(false);
    const port = Number(portText);
    const readinessLength = Array.from(readinessValue).length;
    const readinessValueIsValid =
      readinessMode === "http_endpoint"
        ? readinessValue.startsWith("/") &&
          !readinessValue.startsWith("//") &&
          !readinessValue.includes("\r") &&
          !readinessValue.includes("\n") &&
          readinessLength <= 2048
        : readinessMode === "output_message" &&
          readinessValue.trim().length > 0 &&
          readinessLength <= 512;
    if (
      !command.trim() ||
      !Number.isSafeInteger(port) ||
      port < 1 ||
      port > 65535 ||
      !readinessValueIsValid
    ) {
      setValidationError(true);
      return;
    }
    const readiness = {
      mode: readinessMode,
      value: readinessValue,
    } as FactoryPreviewReadiness;
    try {
      await onSave(command, port, readiness);
    } catch {
      setSaveFailed(true);
    }
  };

  return (
    <form
      className="fx-run-tool-surface fx-preview-config"
      noValidate
      onSubmit={(event) => void submit(event)}
    >
      <h2>Configure preview</h2>
      {saveFailed ? (
        <>
          <SaveFailureNotice />
          <button
            aria-describedby={RUNTIME_NOTICE_ID}
            className="fx-button fx-button-primary"
            disabled
            type="button"
          >
            Retry starting preview
          </button>
          <div
            className="fx-preview-runtime-notice"
            id={RUNTIME_NOTICE_ID}
            role="note"
          >
            <PreviewRuntimeUnavailableNotice />
          </div>
        </>
      ) : null}
      {validationError ? <PreviewValidationNotice /> : null}
      <label htmlFor={commandId}>Start command</label>
      <input
        autoComplete="off"
        id={commandId}
        maxLength={512}
        onChange={(event) => {
          setCommand(event.currentTarget.value);
          setValidationError(false);
          setSaveFailed(false);
        }}
        placeholder="Your project's preview command"
        required
        value={command}
      />
      <div className="fx-preview-fields-row">
        <div>
          <label htmlFor={portId}>Port</label>
          <input
            autoComplete="off"
            id={portId}
            max="65535"
            min="1"
            onChange={(event) => {
              setPortText(event.currentTarget.value);
              setValidationError(false);
              setSaveFailed(false);
            }}
            required
            type="number"
            value={portText}
          />
        </div>
        <div>
          <label htmlFor={readinessModeId}>Ready when</label>
          <select
            id={readinessModeId}
            onChange={(event) => {
              setReadinessMode(event.currentTarget.value);
              setValidationError(false);
              setSaveFailed(false);
            }}
            required
            value={readinessMode}
          >
            <option value="">Choose ready when</option>
            <option value="http_endpoint">HTTP endpoint responds</option>
            <option value="output_message">
              Process writes a ready message
            </option>
          </select>
        </div>
      </div>
      <label htmlFor={readinessValueId}>Readiness path or message</label>
      <input
        autoComplete="off"
        id={readinessValueId}
        maxLength={readinessMode === "output_message" ? 512 : 2048}
        onChange={(event) => {
          setReadinessValue(event.currentTarget.value);
          setValidationError(false);
          setSaveFailed(false);
        }}
        required
        value={readinessValue}
      />
      <div className="fx-preview-runtime-notice" role="note">
        <strong>Runs in this project’s environment</strong>
        <span>
          Only start a command you trust. Configuration is saved separately from
          starting the process.
        </span>
      </div>
      <div className="fx-preview-actions">
        <button
          className="fx-button fx-button-primary"
          disabled={pending}
          type="submit"
        >
          Save configuration
        </button>
        <button
          className="fx-button"
          disabled={pending}
          onClick={onCancel}
          type="button"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function SaveFailureNotice() {
  return (
    <div className="fx-run-tool-error-message" role="alert">
      <strong>Could not save</strong>
      <span>
        Your inputs are kept. Review them or retry without starting again.
      </span>
    </div>
  );
}

function PreviewValidationNotice() {
  return (
    <div className="fx-run-tool-validation-message" role="alert">
      <strong>Check the preview settings</strong>
      <span>A command, valid port and readiness check are required.</span>
    </div>
  );
}

function PreviewStatus({
  onEdit,
  preview,
  runOwner,
  viewer,
}: {
  onEdit: () => void;
  preview: Exclude<FactoryPreviewState, { state: "not_configured" }>;
  runOwner: string;
  viewer: string;
}) {
  const title =
    preview.state === "starting"
      ? "Starting preview"
      : preview.state === "running"
        ? "Preview running"
        : preview.state === "failed"
          ? "Preview failed"
          : preview.state === "stopped"
            ? "Preview stopped"
            : "Preview stopped";
  const port = preview.port ?? portFromUrl(preview.localUrl);
  const readiness = preview.readiness
    ? readinessLabel(preview.readiness)
    : "Not configured";
  const active = preview.state === "starting" || preview.state === "running";
  const primaryLabel =
    preview.state === "failed"
      ? "Retry starting preview"
      : preview.state === "starting" || preview.state === "running"
        ? "Stop preview"
        : "Start preview";

  return (
    <section className="fx-run-tool-surface fx-preview-state">
      <h2>{title}</h2>
      {preview.state === "starting" ? (
        <div className="fx-preview-readiness-notice" role="status">
          <strong>Waiting for readiness</strong>
          <span>
            The process has started but has not passed its readiness check.
          </span>
        </div>
      ) : null}
      {preview.state === "running" ? (
        <div className="fx-preview-running-url">
          <span>Preview URL</span>
          <code>{preview.url}</code>
          {runOwner !== viewer ? (
            <small>
              This loopback address is on the device that owns the run.
            </small>
          ) : null}
        </div>
      ) : null}
      {preview.state === "failed" ? (
        <>
          <p>{preview.reason}</p>
          {preview.startupOutput ? (
            <details className="fx-preview-output">
              <summary>Startup output</summary>
              <pre>{preview.startupOutput}</pre>
            </details>
          ) : null}
        </>
      ) : null}
      {preview.state === "starting" ? (
        <dl className="fx-preview-facts fx-preview-facts-two">
          <div>
            <dt>Port</dt>
            <dd>{port || "Not configured"}</dd>
          </div>
          <div>
            <dt>Ready when</dt>
            <dd>
              {preview.readiness
                ? readinessModeLabel(preview.readiness)
                : readiness}
            </dd>
          </div>
        </dl>
      ) : null}
      {preview.state === "stopped" ||
      preview.state === "failed" ||
      (preview.state === "not_started" && Boolean(preview.readiness)) ? (
        <dl className="fx-preview-facts">
          <div>
            <dt>Command</dt>
            <dd>{preview.command}</dd>
          </div>
          <div>
            <dt>Port</dt>
            <dd>{port || "Not configured"}</dd>
          </div>
          <div>
            <dt>Readiness</dt>
            <dd>{readiness}</dd>
          </div>
        </dl>
      ) : null}
      <div
        className="fx-preview-runtime-notice"
        id={RUNTIME_NOTICE_ID}
        role="note"
      >
        <PreviewRuntimeUnavailableNotice />
      </div>
      <div className="fx-preview-actions">
        <button
          aria-describedby={RUNTIME_NOTICE_ID}
          className="fx-button fx-button-primary"
          disabled
          type="button"
        >
          {primaryLabel}
        </button>
        {!active ? (
          <button className="fx-button" onClick={onEdit} type="button">
            Edit configuration
          </button>
        ) : null}
      </div>
    </section>
  );
}

function PreviewRuntimeUnavailableNotice() {
  return (
    <>
      <strong>Preview runtime unavailable</strong>
      <span>
        This host cannot guarantee process-tree containment and cleanup.
      </span>
    </>
  );
}

function readinessLabel(readiness: FactoryPreviewReadiness) {
  return readiness.mode === "http_endpoint"
    ? `HTTP endpoint responds at ${readiness.value}`
    : `Process output contains ${readiness.value}`;
}

function readinessModeLabel(readiness: FactoryPreviewReadiness) {
  return readiness.mode === "http_endpoint"
    ? "HTTP endpoint responds"
    : "Process writes a ready message";
}

function portFromUrl(value: string) {
  try {
    return new URL(value).port;
  } catch {
    return "";
  }
}
