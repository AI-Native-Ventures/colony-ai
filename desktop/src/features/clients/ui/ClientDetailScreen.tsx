import * as React from "react";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { usePeople, type PersonInfo } from "@/features/clients/lib/usePeople";
import { useClientRecordsQuery } from "@/features/clients/useBusinessRecords";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ChevronRightIcon,
  clientInitial,
  ClientStatusPill,
  formatStatus,
  LockIcon,
  PersonAvatar,
  WorkStatusPill,
} from "@/features/clients/ui/BusinessBits";
import { StateAlert, StateButton } from "@/features/clients/ui/BusinessStates";
import { BusinessTrail } from "@/features/clients/ui/BusinessTrail";
import {
  ClientWorkspace,
  RecordMessage,
} from "@/features/clients/ui/ClientWorkspace";
import { useIdentityQuery } from "@/shared/api/hooks";

function personLine(person: PersonInfo): string {
  return [person.name, person.title, person.isAgent ? "AI employee" : null]
    .filter(Boolean)
    .join(" · ");
}

export function ClientDetailScreen({ clientId }: { clientId: string }) {
  const clientRecords = useClientRecordsQuery(clientId);
  const identityQuery = useIdentityQuery();
  const { goChannel, goClients, goWork, goWorkItem } = useAppNavigation();
  const headRecord = clientRecords.clientQuery.data ?? null;
  const head = headRecord?.value;
  const channel = clientRecords.channel;
  const workItems = clientRecords.workItemsQuery.data ?? [];
  const selfPubkey = identityQuery.data?.pubkey.toLowerCase() ?? "";
  const channelMembers = React.useMemo(
    () =>
      (clientRecords.membersQuery.data ?? []).filter(
        (member) => member.pubkey.toLowerCase() !== selfPubkey,
      ),
    [clientRecords.membersQuery.data, selfPubkey],
  );
  const { person } = usePeople(
    [
      ...workItems.flatMap(({ value }) => value.assignedPubkeys),
      ...(head?.approverPubkeys ?? []),
      ...channelMembers.map((member) => member.pubkey),
    ],
    { titles: true },
  );

  if (clientRecords.channelsQuery.isError) {
    return (
      <ClientWorkspace title="Client">
        <RecordMessage kind="error">
          Client channels could not be loaded.
        </RecordMessage>
      </ClientWorkspace>
    );
  }
  if (!channel && clientRecords.channelsQuery.isSuccess) {
    return (
      <ClientWorkspace title="Clients">
        <StateAlert size="lg">
          This client is unavailable to the current identity in this business.
        </StateAlert>
        <div>
          <StateButton onClick={() => void goClients()}>
            All clients
          </StateButton>
        </div>
      </ClientWorkspace>
    );
  }
  if (clientRecords.liveError) {
    return (
      <ClientWorkspace title={head?.displayName ?? "Client"}>
        <RecordMessage kind="error">
          Live client updates could not be started.
        </RecordMessage>
      </ClientWorkspace>
    );
  }
  if (
    clientRecords.clientQuery.isPending ||
    clientRecords.channelsQuery.isPending
  ) {
    return (
      <ClientWorkspace title="Client">
        <RecordMessage kind="loading">Loading client</RecordMessage>
      </ClientWorkspace>
    );
  }
  if (clientRecords.clientQuery.isError) {
    return (
      <ClientWorkspace title="Client">
        <RecordMessage kind="error">
          Client record could not be loaded.
        </RecordMessage>
      </ClientWorkspace>
    );
  }
  if (!head || !headRecord) {
    return (
      <ClientWorkspace title="Clients">
        <StateAlert size="lg">
          No client record exists in the selected private channel.
        </StateAlert>
        <div>
          <StateButton onClick={() => void goClients()}>
            All clients
          </StateButton>
        </div>
      </ClientWorkspace>
    );
  }

  const channelName = channel?.name ?? head.clientId;
  const reviewers = head.approverPubkeys.map((pubkey) => person(pubkey).name);
  const reviewWork = workItems.find(({ value }) => value.status === "review");
  const reviewOwner = reviewWork?.value.assignedPubkeys[0]
    ? person(reviewWork.value.assignedPubkeys[0])
    : null;

  return (
    <ClientWorkspace
      gap={24}
      header={
        <div className="b3-detail-head">
          <div className="b3-detail-who">
            <span aria-hidden="true" className="b3-tile" data-size="lg">
              {clientInitial(head.displayName)}
            </span>
            <div className="b3-detail-copy">
              <h1 className="b3-title">{head.displayName}</h1>
              <span className="b3-detail-line">
                <ClientStatusPill status={head.status} />
              </span>
            </div>
          </div>
          <div className="b3-head-actions">
            <button
              className="b3-btn"
              onClick={() => void goClients()}
              type="button"
            >
              <ArrowLeftIcon />
              All clients
            </button>
            <button
              className="b3-btn"
              data-variant="primary"
              onClick={() => void goChannel(head.clientId)}
              type="button"
            >
              <LockIcon />
              Client channel
            </button>
          </div>
        </div>
      }
      title={head.displayName}
    >
      <BusinessTrail
        crumbs={[
          { label: "Business" },
          { label: "Clients", onClick: () => void goClients() },
          { label: head.displayName },
        ]}
      />
      {clientRecords.workItemsQuery.isError ? (
        <RecordMessage kind="error">
          Work records could not be loaded for this client.
        </RecordMessage>
      ) : null}
      <div className="b3-detail-body">
        <section
          aria-labelledby="client-shared-work"
          className="b3-card b3-detail-main"
        >
          <div className="b3-detail-main-head">
            <h2 className="b3-card-title" id="client-shared-work">
              Shared work
            </h2>
            {clientRecords.workItemsQuery.isSuccess ? (
              <span className="b3-count">
                {workItems.length} {workItems.length === 1 ? "item" : "items"}
              </span>
            ) : null}
            <button
              className="b3-btn"
              data-variant="soft"
              onClick={() => void goWork(head.clientId)}
              type="button"
            >
              Open in Work
              <ArrowRightIcon size={15} />
            </button>
          </div>
          {clientRecords.workItemsQuery.isPending ? (
            <RecordMessage kind="loading">Loading work</RecordMessage>
          ) : null}
          {workItems.map(({ event, value }) => {
            const owner = value.assignedPubkeys[0]
              ? person(value.assignedPubkeys[0])
              : null;
            return (
              <button
                className="b3-work-row"
                key={event.id}
                onClick={() => void goWorkItem(value.workItemId, head.clientId)}
                type="button"
              >
                {owner ? <PersonAvatar person={owner} size={44} /> : null}
                <span className="b3-work-row-copy">
                  <span className="b3-work-row-title">{value.title}</span>
                  <span className="b3-work-row-meta">
                    {owner ? personLine(owner) : "Unassigned"}
                  </span>
                </span>
                <WorkStatusPill size="lg" status={value.status} />
                <ChevronRightIcon className="b3-muted-icon" />
              </button>
            );
          })}
          {reviewWork && reviewOwner ? (
            <p className="b3-paragraph">
              {reviewOwner.name} has delivered this work and is waiting for a
              review before anything is shared with the client.
            </p>
          ) : null}
          {clientRecords.workItemsQuery.isSuccess && workItems.length === 0 ? (
            <RecordMessage>
              No work items are recorded for this client.
            </RecordMessage>
          ) : null}
        </section>

        <div className="b3-detail-side">
          <section
            aria-labelledby="client-record"
            className="b3-card b3-side-card"
          >
            <h2 className="b3-side-title" id="client-record">
              Client record
            </h2>
            <dl className="b3-facts">
              <div className="b3-fact">
                <dt>Business name</dt>
                <dd>{head.displayName}</dd>
              </div>
              <div className="b3-fact">
                <dt>Status</dt>
                <dd>{formatStatus(head.status)}</dd>
              </div>
              <div className="b3-fact">
                <dt>Client channel</dt>
                <dd>
                  <button
                    onClick={() => void goChannel(head.clientId)}
                    type="button"
                  >
                    #{channelName}
                  </button>
                </dd>
              </div>
              <div className="b3-fact">
                <dt>Client reviewers</dt>
                <dd>
                  {reviewers.length}
                  {reviewers.length > 0 ? ` · ${reviewers.join(", ")}` : ""}
                </dd>
              </div>
            </dl>
          </section>

          {channelMembers.length > 0 ? (
            <section
              aria-labelledby="client-team"
              className="b3-card b3-side-card"
              data-tone="wash"
            >
              <h2 className="b3-side-title" id="client-team">
                Working on this client
              </h2>
              {channelMembers.map((member) => {
                const who = person(member.pubkey);
                return (
                  <div className="b3-person-link" key={member.pubkey}>
                    <PersonAvatar person={who} size={38} />
                    <span className="b3-stack">
                      <span className="b3-person-name">{who.name}</span>
                      <span className="b3-person-role">
                        {who.title ? `${who.title} · ` : ""}in #{channelName}
                      </span>
                    </span>
                  </div>
                );
              })}
            </section>
          ) : null}
        </div>
      </div>
    </ClientWorkspace>
  );
}
