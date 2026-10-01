import * as React from "react";

import {
  factoryPullRequestNumber,
  useFactoryRunActionMutation,
  type FactoryPullRequest,
  type FactoryRunRecord,
} from "@/features/factory/lib/factoryRunRecords";
import type { FactoryRun } from "@/shared/api/factoryRuntime";

const REVIEW_REQUEST_NOTICE_ID = "factory-review-request-unavailable";

export function FactoryReviewPane({
  onOpenAgent,
  record,
  run,
}: {
  onOpenAgent: () => void;
  record: FactoryRunRecord | null | undefined;
  run: FactoryRun;
}) {
  const mutation = useFactoryRunActionMutation(run.id);
  const [optimisticPullRequest, setOptimisticPullRequest] = React.useState<{
    recordEventId: string | null;
    pullRequest: FactoryPullRequest;
  } | null>(null);
  const recordEventId = record?.event.id ?? null;
  const pullRequest =
    optimisticPullRequest?.recordEventId === recordEventId
      ? optimisticPullRequest.pullRequest
      : record?.head.pullRequest;
  const checks = pullRequest ? stableCheckKeys(pullRequest.checkResults) : [];
  const [editing, setEditing] = React.useState(false);

  const savePullRequest = async (nextPullRequest: FactoryPullRequest) => {
    await mutation.mutateAsync({
      action: {
        schemaVersion: 1,
        runId: run.id,
        ...(!record
          ? { runOwnerPubkey: run.scope.identityPubkey }
          : { expectedHeadEventId: record.event.id }),
        action: "link_pull_request",
        pullRequest: nextPullRequest,
      },
    });
    setOptimisticPullRequest({ recordEventId, pullRequest: nextPullRequest });
    setEditing(false);
  };

  if (editing || !pullRequest) {
    return (
      <AttachPullRequestForm
        initialPullRequest={pullRequest}
        onCancel={() => {
          if (pullRequest) setEditing(false);
          else onOpenAgent();
        }}
        onSave={savePullRequest}
        pending={mutation.isPending}
      />
    );
  }

  return (
    <section className="fx-run-tool-surface fx-review-pane">
      <article className="fx-review-card">
        <h2>Pull request #{pullRequest.number}</h2>
        <span
          className={`fx-review-state fx-review-state-${pullRequest.state}`}
        >
          {pullRequest.state}
        </span>
        <a href={pullRequest.url} rel="noreferrer" target="_blank">
          {pullRequest.url}
        </a>
        <div className="fx-preview-actions">
          <button
            className="fx-button"
            onClick={() => setEditing(true)}
            type="button"
          >
            Change linked request
          </button>
        </div>
      </article>
      <aside className="fx-review-card fx-review-checks">
        <h2>Checks and review</h2>
        {pullRequest.checkResults.length ? (
          <ul className="fx-review-check-list">
            {checks.map(({ check, key }) => (
              <li key={key}>
                <strong>{check.status}</strong>
                <span>{check.name}</span>
                {check.detailsUrl ? (
                  <a href={check.detailsUrl} rel="noreferrer" target="_blank">
                    Details
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p>No check results are recorded.</p>
        )}
        {pullRequest.reviewHandoff ? (
          <div className="fx-review-handoff-record">
            <h3>Review handoff</h3>
            <p>{pullRequest.reviewHandoff}</p>
          </div>
        ) : (
          <p>No review handoff is recorded.</p>
        )}
        <div
          className="fx-review-unavailable-notice"
          id={REVIEW_REQUEST_NOTICE_ID}
          role="note"
        >
          No reviewer assignment or review delivery record is available.
        </div>
        <button
          aria-describedby={REVIEW_REQUEST_NOTICE_ID}
          className="fx-button fx-button-primary"
          disabled
          type="button"
        >
          Request a review
        </button>
      </aside>
    </section>
  );
}

function stableCheckKeys(checkResults: FactoryPullRequest["checkResults"]) {
  const occurrences = new Map<string, number>();
  return checkResults.map((check) => {
    const content = JSON.stringify([
      check.name,
      check.status,
      check.detailsUrl ?? null,
    ]);
    const occurrence = occurrences.get(content) ?? 0;
    occurrences.set(content, occurrence + 1);
    return { check, key: `${content}:${occurrence}` };
  });
}

function AttachPullRequestForm({
  initialPullRequest,
  onCancel,
  onSave,
  pending,
}: {
  initialPullRequest?: FactoryPullRequest;
  onCancel: () => void;
  onSave: (pullRequest: FactoryPullRequest) => Promise<void>;
  pending: boolean;
}) {
  const [url, setUrl] = React.useState(initialPullRequest?.url ?? "");
  const [validationError, setValidationError] = React.useState<{
    title: string;
    body: string;
  } | null>(null);
  const [saveFailed, setSaveFailed] = React.useState(false);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setValidationError(null);
    setSaveFailed(false);
    const value = url.trim();
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      setValidationError({
        title: "Check the pull request URL",
        body: "Enter a complete HTTPS pull request URL.",
      });
      return;
    }
    const number = factoryPullRequestNumber(value);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
      setValidationError({
        title: "Check the pull request URL",
        body: "Enter a complete HTTPS pull request URL without credentials.",
      });
      return;
    }
    if (!number) {
      setValidationError({
        title: "This is not a pull request URL",
        body: "Paste the full URL, including its pull request or merge request number.",
      });
      return;
    }
    const unchanged = initialPullRequest?.url === value;
    try {
      await onSave({
        url: value,
        number,
        state: unchanged ? initialPullRequest.state : "unknown",
        checkResults: unchanged ? initialPullRequest.checkResults : [],
        ...(unchanged && initialPullRequest.reviewHandoff
          ? { reviewHandoff: initialPullRequest.reviewHandoff }
          : {}),
      });
    } catch {
      setSaveFailed(true);
    }
  };

  return (
    <form
      className="fx-run-tool-surface fx-review-attach"
      noValidate
      onSubmit={(event) => void submit(event)}
    >
      <h2>Attach a pull request</h2>
      {saveFailed ? <SaveFailureNotice /> : null}
      {validationError ? (
        <ValidationNotice
          body={validationError.body}
          title={validationError.title}
        />
      ) : null}
      <label htmlFor="factory-pull-request-url">Pull request URL</label>
      <input
        autoComplete="url"
        id="factory-pull-request-url"
        maxLength={2048}
        onChange={(event) => {
          setUrl(event.currentTarget.value);
          setValidationError(null);
          setSaveFailed(false);
        }}
        placeholder="Full pull request URL"
        required
        type="url"
        value={url}
      />
      <p className="fx-review-helper">
        This saves the URL to the run record. It does not merge, approve, or
        fetch provider details. The relay accepts configured provider hosts
        only.
      </p>
      <div className="fx-preview-actions">
        <button
          className="fx-button fx-button-primary"
          disabled={pending}
          type="submit"
        >
          Attach pull request
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

function ValidationNotice({ body, title }: { body: string; title: string }) {
  return (
    <div className="fx-run-tool-validation-message" role="alert">
      <strong>{title}</strong>
      <span>{body}</span>
    </div>
  );
}
