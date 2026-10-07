import * as React from "react";

import { useManagedAgentsQuery } from "@/features/agents/hooks";
import { useCommunities } from "@/features/communities/useCommunities";
import { sanitizeUntrusted } from "../../../../electron/browser-broker/redaction.mjs";
import { useWorkAreaChannel } from "../dock/workAreaChannelContext";
import { createBrowserControlStore } from "./browserControlStore";
import { getBrowserBusinessId } from "./browserTabsStore";
import {
  browserApprovalOrigin,
  browserConfirmationTitle,
  browserTaskScope,
} from "./browserTaskScope";

/** Person-owned approval and recovery controls above the native browser view. */
export function BrowserAgentControls({
  channelId,
  hostId,
  active,
  url,
  onSharingChange,
}: {
  channelId: string;
  hostId: string | null;
  active: boolean;
  url: string;
  onSharingChange?: (shared: boolean) => void;
}) {
  const channel = useWorkAreaChannel();
  const businessId = getBrowserBusinessId();
  const taskId = browserTaskScope(
    channelId,
    channel?.channelType ?? "",
    channel?.threadRootId,
  );
  const store = React.useMemo(
    () =>
      createBrowserControlStore({
        businessId: businessId ?? "",
        tabId: hostId ?? "",
        taskId,
      }),
    [businessId, hostId, taskId],
  );
  const state = React.useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  const { activeCommunity } = useCommunities();
  const agents = useManagedAgentsQuery({ enabled: state.enabled });
  const [selectedAgent, setSelectedAgent] = React.useState("");
  const [approving, setApproving] = React.useState(false);
  const [uploadReady, setUploadReady] = React.useState<string | null>(null);
  const agentSelectId = React.useId();
  const site = browserApprovalOrigin(url);
  const grant = state.grant;
  const name = sanitizeUntrusted(
    agents.data?.find((agent) => agent.pubkey === grant?.agentId)?.name ??
      "Agent",
    80,
  );
  const eligible = (agents.data ?? []).filter(
    (agent) =>
      agent.status === "running" &&
      agent.relayUrl === activeCommunity?.relayUrl &&
      (channel?.channelType === "dm" || agent.sessionPolicy === "thread"),
  );
  const taskLabel =
    channel?.channelType === "dm" ? "this conversation" : "this thread";
  const busy = state.busy !== null;

  React.useEffect(() => {
    setApproving(false);
    setUploadReady(null);
    void store.start();
    return () => store.dispose();
  }, [store]);
  React.useEffect(() => {
    onSharingChange?.(Boolean(grant));
    return () => onSharingChange?.(false);
  }, [grant, onSharingChange]);

  React.useEffect(() => {
    if (grant) setApproving(false);
  }, [grant]);

  // Store operations expose their failure through the visible retry affordance.
  const run = (action: () => Promise<unknown>) => {
    void action().catch(() => {});
  };

  if (!state.enabled && !state.error) return null;

  return (
    <section
      aria-label="Agent browser controls"
      className="flex shrink-0 flex-col gap-2 border-b border-border px-3 py-2 text-xs"
      data-testid="browser-agent-controls"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span aria-live="polite" role="status" data-testid="browser-controller">
          {grant ? `${name} has control` : "You’re browsing"}
        </span>
        {grant ? (
          <div className="flex gap-2">
            <button
              className="colony-work-area-choice"
              disabled={state.busy === "stop" || state.busy === "take-over"}
              onClick={() => run(store.stop)}
              type="button"
            >
              Stop
            </button>
            <button
              className="colony-work-area-choice"
              disabled={state.busy === "stop" || state.busy === "take-over"}
              onClick={() => run(store.takeOver)}
              type="button"
            >
              Take over
            </button>
          </div>
        ) : (
          <button
            className="colony-work-area-choice"
            disabled={!state.enabled || !hostId || !site || !taskId || busy}
            onClick={() => setApproving(true)}
            type="button"
          >
            Allow an agent
          </button>
        )}
      </div>
      {busy ? (
        <p aria-live="polite" role="status">
          {state.busy === "stop" || state.busy === "take-over"
            ? "Stopping agent actions…"
            : "Updating browser access…"}
        </p>
      ) : null}
      {!grant && !taskId ? (
        <p className="text-muted-foreground">
          Open a conversation thread to approve a browser task.
        </p>
      ) : null}
      {approving && !grant ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (
              !site ||
              !eligible.some((agent) => agent.pubkey === selectedAgent)
            )
              return;
            run(async () => {
              await store.approve(selectedAgent, site);
            });
          }}
        >
          <label htmlFor={agentSelectId}>Agent</label>
          <select
            className="rounded border border-input bg-background px-2 py-1 text-xs"
            id={agentSelectId}
            onChange={(event) => setSelectedAgent(event.target.value)}
            value={selectedAgent}
          >
            <option value="">Choose an agent</option>
            {eligible.map((agent) => (
              <option key={agent.pubkey} value={agent.pubkey}>
                {sanitizeUntrusted(agent.name, 80)}
              </option>
            ))}
          </select>
          {!eligible.length ? (
            <p>No running agent is available for {taskLabel}.</p>
          ) : null}
          <p>
            Allow this agent to use{" "}
            <strong className="break-all">{site}</strong> for {taskLabel}?
          </p>
          <p className="text-muted-foreground">
            Access expires after 15 minutes. Sends, posts, purchases and
            permission changes need your confirmation.
          </p>
          <div className="flex gap-2">
            <button
              className="colony-work-area-choice"
              disabled={
                busy ||
                !eligible.some((agent) => agent.pubkey === selectedAgent)
              }
              type="submit"
            >
              Allow for this task
            </button>
            <button
              className="colony-work-area-choice"
              disabled={busy}
              onClick={() => setApproving(false)}
              type="button"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}
      {grant ? (
        <details>
          <summary className="cursor-pointer">Approved sites and files</summary>
          <div className="flex flex-col gap-2 pt-2">
            <p>
              {grant.taskId === taskId
                ? `Approved for ${taskLabel}.`
                : "Approved for another conversation task."}
            </p>
            <ul className="list-inside list-disc">
              {grant.allowedOrigins.map((origin) => (
                <li className="break-all" key={origin}>
                  {origin}
                </li>
              ))}
            </ul>
            <button
              className="colony-work-area-choice self-start"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const result = await store.chooseUpload();
                  if (result && !result.cancelled) setUploadReady(grant.id);
                })
              }
              type="button"
            >
              Choose a file for this task
            </button>
            {uploadReady === grant.id ? (
              <p role="status">
                File ready for this task. Uploading still needs your
                confirmation.
              </p>
            ) : null}
          </div>
        </details>
      ) : null}
      {grant
        ? state.requestedSites.map((origin) => (
            <fieldset
              className="flex min-w-0 flex-col gap-2 rounded border border-border p-2"
              key={origin}
            >
              <legend className="sr-only">Site approval</legend>
              <p>
                Allow {name} to use{" "}
                <strong className="break-all">{origin}</strong> for this task?
              </p>
              <button
                className="colony-work-area-choice self-start"
                disabled={busy}
                onClick={() => run(() => store.allowSite(origin))}
                type="button"
              >
                Allow this site
              </button>
            </fieldset>
          ))
        : null}
      {grant
        ? state.pending.map((pending) => (
            <Confirmation
              key={pending.actionId}
              active={active}
              title={browserConfirmationTitle(pending.category)}
              summary={pending.summary}
              busy={busy}
              onConfirm={() => run(() => store.confirm(pending.actionId, true))}
              onReject={() => run(() => store.confirm(pending.actionId, false))}
            />
          ))
        : null}
      {state.log.length ? (
        <details data-testid="browser-action-log">
          <summary className="cursor-pointer">Action log</summary>
          <ol className="flex max-h-40 flex-col gap-1 overflow-auto pt-2">
            {state.log.map((entry) => (
              <li className="break-words" key={entry.seq}>
                <span>
                  {entry.summary ||
                    entry.tool.replaceAll("browser_", "").replaceAll("_", " ")}
                </span>
                <span className="ml-2 text-muted-foreground">
                  {entry.status.replaceAll("_", " ")}
                </span>
              </li>
            ))}
          </ol>
        </details>
      ) : null}
      {state.error ? (
        <div role="alert">
          <p>{state.error}</p>
          <button
            className="colony-work-area-choice mt-1"
            onClick={() => run(store.refresh)}
            type="button"
          >
            Refresh controls
          </button>
        </div>
      ) : null}
    </section>
  );
}

function Confirmation({
  title,
  summary,
  active,
  busy,
  onConfirm,
  onReject,
}: {
  title: string;
  summary: string;
  active: boolean;
  busy: boolean;
  onConfirm: () => void;
  onReject: () => void;
}) {
  const rejectRef = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    if (!active) return;
    const previous = document.activeElement;
    const handle = window.requestAnimationFrame(() =>
      rejectRef.current?.focus(),
    );
    return () => {
      window.cancelAnimationFrame(handle);
      if (
        document.activeElement === rejectRef.current &&
        previous instanceof HTMLElement &&
        previous.isConnected
      )
        previous.focus({ preventScroll: true });
    };
  }, [active]);
  const titleId = React.useId();
  const textId = React.useId();
  return (
    <div
      aria-describedby={textId}
      aria-labelledby={titleId}
      className="flex flex-col gap-2 rounded border border-border p-2"
      role="alertdialog"
    >
      <p className="font-medium" id={titleId}>
        {title}
      </p>
      <div id={textId}>
        <p className="text-muted-foreground">Page text</p>
        <blockquote className="break-words">{summary}</blockquote>
      </div>
      <div className="flex gap-2">
        <button
          className="colony-work-area-choice"
          disabled={busy}
          onClick={onConfirm}
          type="button"
        >
          Confirm action
        </button>
        <button
          className="colony-work-area-choice"
          disabled={busy}
          onClick={onReject}
          ref={rejectRef}
          type="button"
        >
          Reject
        </button>
      </div>
    </div>
  );
}
