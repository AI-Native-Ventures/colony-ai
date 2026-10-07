import { ChevronLeft } from "lucide-react";
import * as React from "react";

import { useManagedAgentsQuery } from "@/features/agents/hooks";
import { useAgentMemoriesQuery } from "@/features/agent-memory/hooks";
import {
  useChannelMembersQuery,
  useChannelsQuery,
} from "@/features/channels/hooks";
import { PinnedMessagesList } from "@/features/pins/ui/PinnedMessagesList";
import { plainRelayErrorMessage } from "@/shared/lib/relayError";
import { Button } from "@/shared/ui/button";

import type { WorkAreaTabPanelProps } from "../workAreaTabRegistry";
import { KnowledgeChannelNotes } from "./KnowledgeChannelNotes";
import { WorkAreaTabNotice } from "./WorkAreaTabNotice";
import {
  agentsInChannel,
  type KnowledgeDocument,
  type KnowledgeGroup,
  resolveKnowledgeView,
} from "./workAreaKnowledgeModel";

const TEST_ID = "work-area-knowledge";
/** Bound what one agent can paint at once (rule 4); the rest is one click away. */
const DOCUMENTS_SHOWN = 50;

function formatUpdated(unixSeconds: number): string {
  const date = new Date(unixSeconds * 1000);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date)
    : "";
}

/**
 * Knowledge tab: the memory documents of the AI employees you manage that are in
 * this channel, read-only, under its channel notes and pinned messages. Real data
 * only; see `workAreaKnowledgeModel.ts` for the memory read model and
 * `features/pins/pinModels.ts` for the pin contract.
 */
export function WorkAreaKnowledgeTab({ channelId }: WorkAreaTabPanelProps) {
  const channelsQuery = useChannelsQuery();
  const membersQuery = useChannelMembersQuery(channelId);
  const managedQuery = useManagedAgentsQuery();

  const managed = React.useMemo(
    () =>
      (managedQuery.data ?? []).map((agent) => ({
        pubkey: agent.pubkey,
        name: agent.name,
      })),
    [managedQuery.data],
  );
  const agents = React.useMemo(
    () => agentsInChannel(managed, membersQuery.data ?? []),
    [managed, membersQuery.data],
  );
  const memoryQueries = useAgentMemoriesQuery(
    agents.map((agent) => agent.pubkey),
  );

  const view = resolveKnowledgeView({
    channelId,
    channels: {
      status: channelsQuery.status,
      error: channelsQuery.error,
      data: channelsQuery.data,
    },
    members: {
      status: membersQuery.status,
      error: membersQuery.error,
      data: membersQuery.data,
    },
    managedAgents: {
      status: managedQuery.status,
      error: managedQuery.error,
      data: managed,
    },
    memory: memoryQueries.map((query) => ({
      status: query.status,
      error: query.error,
      data: query.data,
    })),
  });

  const channel = (channelsQuery.data ?? []).find(
    (candidate) => candidate.id.toLowerCase() === channelId.toLowerCase(),
  );
  const frame = {
    channelId,
    topic: channel?.topic ?? null,
    purpose: channel?.purpose ?? null,
  };

  const failedError = view.state === "failed" ? view.error : null;
  React.useEffect(() => {
    // The raw text belongs in the log, never on screen.
    if (failedError !== null) {
      console.warn(
        "[work-area] knowledge could not be loaded",
        failedError instanceof Error
          ? failedError.message
          : String(failedError),
      );
    }
  }, [failedError]);

  const retry = React.useCallback(() => {
    void channelsQuery.refetch();
    void membersQuery.refetch();
    void managedQuery.refetch();
    for (const query of memoryQueries) void query.refetch();
  }, [channelsQuery, membersQuery, managedQuery, memoryQueries]);

  const [openKey, setOpenKey] = React.useState<string | null>(null);
  const documents = React.useMemo(
    () =>
      view.state === "ready"
        ? view.groups.flatMap((group) => group.documents)
        : [],
    [view],
  );
  // A doc that stops existing (the agent rewrote its memory) closes the reader.
  const openDocument = documents.find((doc) => doc.key === openKey) ?? null;
  const agentName = (pubkey: string) =>
    agents.find((agent) => agent.pubkey === pubkey)?.name ?? "AI employee";

  if (openDocument) {
    return (
      <KnowledgeReader
        agentName={agentName(openDocument.agentPubkey)}
        doc={openDocument}
        onBack={() => setOpenKey(null)}
      />
    );
  }

  switch (view.state) {
    case "loading":
      return (
        <WorkAreaTabNotice
          state="loading"
          testId={`${TEST_ID}-state`}
          title="Loading knowledge"
        />
      );
    case "failed":
      return (
        <WorkAreaTabNotice
          body={plainRelayErrorMessage(view.error)}
          onRetry={retry}
          state="failed"
          testId={`${TEST_ID}-state`}
          title="Knowledge could not be loaded"
        />
      );
    case "denied":
      return (
        <WorkAreaTabNotice
          body="Knowledge is shown for the channels you belong to. Join this channel to see it."
          onRetry={retry}
          state="denied"
          testId={`${TEST_ID}-state`}
          title="You are not in this channel"
        />
      );
    case "no-agents":
      return (
        <KnowledgeFrame {...frame}>
          <WorkAreaTabNotice
            body="Memory appears here for the AI employees you manage that are in this channel. None of yours are here yet."
            state="empty"
            testId={`${TEST_ID}-state`}
            title="No memory to show yet"
          />
        </KnowledgeFrame>
      );
    case "empty":
      return (
        <KnowledgeFrame {...frame}>
          <WorkAreaTabNotice
            body="The AI employees you manage in this channel have not written anything down yet. What they remember appears here."
            state="empty"
            testId={`${TEST_ID}-state`}
            title="Nothing remembered yet"
          />
        </KnowledgeFrame>
      );
    case "ready":
      return (
        <KnowledgeFrame {...frame}>
          <div className="shrink-0" data-testid={`${TEST_ID}-memory`}>
            {view.unavailable.length > 0 ? (
              <div
                className="flex items-center justify-between gap-3 border-b border-border px-3 py-2 text-xs text-muted-foreground"
                data-testid={`${TEST_ID}-unavailable`}
                role="status"
              >
                <span>
                  Memory could not be read for{" "}
                  {view.unavailable.map((agent) => agent.name).join(", ")}.
                </span>
                <Button
                  className="h-7 px-2 text-xs"
                  onClick={retry}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  Retry
                </Button>
              </div>
            ) : null}
            {view.groups.length === 0 ? (
              <p className="px-3 py-4 text-sm text-muted-foreground">
                Nothing remembered yet by the employees whose memory could be
                read.
              </p>
            ) : (
              view.groups.map((group) => (
                <KnowledgeGroupSection
                  group={group}
                  key={group.agent.pubkey}
                  onOpen={setOpenKey}
                />
              ))
            )}
          </div>
        </KnowledgeFrame>
      );
  }
}

/** Channel notes, then pinned messages, then whatever memory content the caller renders. One scroll area. */
function KnowledgeFrame({
  channelId,
  topic,
  purpose,
  children,
}: {
  channelId: string;
  topic: string | null;
  purpose: string | null;
  children: React.ReactNode;
}) {
  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-auto"
      data-testid={TEST_ID}
    >
      <KnowledgeChannelNotes
        channelId={channelId}
        purpose={purpose}
        topic={topic}
      />
      <section
        aria-labelledby={`${TEST_ID}-pins-title`}
        className="shrink-0 border-b border-border"
        data-testid={`${TEST_ID}-pins`}
      >
        <h2
          className="px-3 pt-3 text-xs font-semibold text-foreground"
          id={`${TEST_ID}-pins-title`}
        >
          Pinned
        </h2>
        <PinnedMessagesList channelId={channelId} />
      </section>
      {children}
    </div>
  );
}

function KnowledgeGroupSection({
  group,
  onOpen,
}: {
  group: KnowledgeGroup;
  onOpen: (key: string) => void;
}) {
  const [showAll, setShowAll] = React.useState(false);
  const shown = showAll
    ? group.documents
    : group.documents.slice(0, DOCUMENTS_SHOWN);
  const titleId = `${TEST_ID}-group-${group.agent.pubkey}`;
  return (
    <section
      aria-labelledby={titleId}
      data-testid={`${TEST_ID}-group-${group.agent.pubkey}`}
    >
      <h2
        className="border-b border-border px-3 py-2 text-xs font-semibold text-foreground"
        id={titleId}
      >
        {group.agent.name}
        <span className="ml-2 font-normal text-muted-foreground">
          {group.documents.length} note
          {group.documents.length === 1 ? "" : "s"}
        </span>
      </h2>
      <ul aria-labelledby={titleId}>
        {shown.map((doc) => (
          <li key={doc.key}>
            <button
              aria-label={`Open ${doc.title}, memory of ${group.agent.name}`}
              className="flex w-full items-center gap-3 border-b border-border px-3 py-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              data-doc-key={doc.key}
              data-testid={`${TEST_ID}-doc-${doc.key}`}
              onClick={() => onOpen(doc.key)}
              type="button"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-foreground">
                  {doc.title}
                </span>
                {doc.preview ? (
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                    {doc.preview}
                  </span>
                ) : null}
              </span>
              <span
                aria-hidden="true"
                className="text-sm text-muted-foreground"
              >
                ›
              </span>
            </button>
          </li>
        ))}
      </ul>
      {group.documents.length > shown.length ? (
        <div className="border-b border-border px-3 py-2">
          <Button
            data-testid={`${TEST_ID}-show-all-${group.agent.pubkey}`}
            onClick={() => setShowAll(true)}
            size="sm"
            type="button"
            variant="ghost"
          >
            Show all {group.documents.length}
          </Button>
        </div>
      ) : null}
      {group.truncated ? (
        <p className="border-b border-border px-3 py-2 text-xs text-muted-foreground">
          This list may be incomplete. The relay returned the most it can.
        </p>
      ) : null}
    </section>
  );
}

/** Read-only reader. The body is shown as plain text: agents write it, nothing runs. */
function KnowledgeReader({
  doc,
  agentName,
  onBack,
}: {
  doc: KnowledgeDocument;
  agentName: string;
  onBack: () => void;
}) {
  const backRef = React.useRef<HTMLButtonElement>(null);
  const key = doc.key;

  // Focus moves into the reader on open and back to the row it came from on
  // close, so keyboard users never land on <body>.
  React.useEffect(() => {
    backRef.current?.focus({ preventScroll: true });
    return () => {
      window.requestAnimationFrame(() => {
        const rows =
          window.document.querySelectorAll<HTMLElement>("[data-doc-key]");
        const row = [...rows].find(
          (candidate) => candidate.dataset.docKey === key,
        );
        row?.focus({ preventScroll: true });
      });
    };
  }, [key]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (
      event.key === "Escape" &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.shiftKey &&
      !event.defaultPrevented
    ) {
      event.preventDefault();
      event.stopPropagation();
      onBack();
    }
  };

  const updated = formatUpdated(doc.updatedAt);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: forwards Escape from the reader's own controls.
    <div
      className="flex min-h-0 flex-1 flex-col"
      data-testid={`${TEST_ID}-reader`}
      onKeyDown={onKeyDown}
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Button
          data-testid={`${TEST_ID}-back`}
          onClick={onBack}
          ref={backRef}
          size="sm"
          type="button"
          variant="ghost"
        >
          <ChevronLeft aria-hidden="true" />
          Knowledge
        </Button>
      </div>
      <article className="min-h-0 flex-1 overflow-auto p-4">
        <h2 className="text-base font-semibold">{doc.title}</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Memory of {agentName}
          {updated ? ` · Updated ${updated}` : ""}
        </p>
        <pre
          className="mt-4 whitespace-pre-wrap break-words font-sans text-sm"
          data-testid={`${TEST_ID}-body`}
        >
          {doc.body}
        </pre>
      </article>
    </div>
  );
}
