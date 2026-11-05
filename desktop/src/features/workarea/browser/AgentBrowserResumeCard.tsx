import * as React from "react";

import { browserTaskScope } from "./browserTaskScope";
import {
  allowAgentAccess,
  type AgentAccessRequest,
  getWaitingAgentAccess,
  subscribeAgentAccess,
} from "./agentBrowserAccess";

const NO_WAITING: readonly AgentAccessRequest[] = Object.freeze([]);

/**
 * The explicit recovery control after a person stopped a browser task. It is
 * rendered in the conversation, not inside the optional browser dock, so the
 * person can act on it wherever they are already reading.
 */
export function AgentBrowserResumeCard({
  channelId,
  channelType,
  threadRootId,
}: {
  channelId: string | null;
  channelType: string;
  threadRootId?: string | null;
}) {
  const waiting = React.useSyncExternalStore(
    subscribeAgentAccess,
    getWaitingAgentAccess,
    () => NO_WAITING,
  );
  const [allowingKey, setAllowingKey] = React.useState<string | null>(null);
  const taskId = channelId
    ? browserTaskScope(channelId, channelType, threadRootId)
    : null;
  const request = React.useMemo(
    () =>
      waiting.find(
        (entry) =>
          entry.channelId === channelId?.toLowerCase() &&
          (entry.taskId.startsWith("conversation:") || entry.taskId === taskId),
      ) ?? null,
    [channelId, taskId, waiting],
  );

  React.useEffect(() => {
    if (!request) setAllowingKey(null);
  }, [request]);

  if (!request) return null;
  const key = `${request.agentId}|${request.taskId}`;
  const allowing = allowingKey === key;
  return (
    <section
      aria-label="Browser access waiting"
      className="mx-5 mt-3 flex flex-wrap items-center justify-between gap-3 rounded border border-border bg-muted/40 px-3 py-2 text-sm"
      data-testid="browser-agent-resume"
    >
      <p role="status">
        An AI employee is waiting to use the browser again. Choose Allow to
        continue.
      </p>
      <button
        className="colony-work-area-choice shrink-0"
        disabled={allowing}
        onClick={() => {
          setAllowingKey(key);
          void allowAgentAccess(request).catch(() => setAllowingKey(null));
        }}
        type="button"
      >
        {allowing ? "Allowing…" : "Allow"}
      </button>
    </section>
  );
}
