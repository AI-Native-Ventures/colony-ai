import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useClientRecordsQuery } from "@/features/clients/useBusinessRecords";
import {
  RecordCard,
  RecordField,
  RecordMessage,
  ClientWorkspace,
} from "@/features/clients/ui/ClientWorkspace";
import { Button } from "@/shared/ui/button";

export function ClientDetailScreen({ clientId }: { clientId: string }) {
  const clientRecords = useClientRecordsQuery(clientId);
  const { goChannel, goClients, goWork, goWorkItem } = useAppNavigation();
  const headRecord = clientRecords.clientQuery.data ?? null;
  const head = headRecord?.value;
  const channel = clientRecords.channel;

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
        <RecordMessage kind="error">
          This client is unavailable to the current identity in this business.
        </RecordMessage>
        <Button onClick={() => void goClients()} variant="outline">
          All clients
        </Button>
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
        <RecordMessage>Loading client</RecordMessage>
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
        <RecordMessage kind="error">
          No client record exists in the selected private channel.
        </RecordMessage>
        <Button onClick={() => void goClients()} variant="outline">
          All clients
        </Button>
      </ClientWorkspace>
    );
  }

  return (
    <ClientWorkspace
      action={
        <div className="flex flex-wrap justify-end gap-2">
          <Button onClick={() => void goClients()} variant="outline">
            All clients
          </Button>
          <Button
            onClick={() => void goChannel(head.clientId)}
            variant="outline"
          >
            Client channel
          </Button>
        </div>
      }
      title={head.displayName}
    >
      {clientRecords.workItemsQuery.isError ? (
        <RecordMessage kind="error">
          Work records could not be loaded for this client.
        </RecordMessage>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => void goWork(head.clientId)} variant="link">
          Shared work
        </Button>
      </div>
      <RecordCard title="Client record">
        <dl className="grid gap-5 sm:grid-cols-2">
          <RecordField label="Business name">{head.displayName}</RecordField>
          <RecordField label="Status">
            {formatClientStatus(head.status)}
          </RecordField>
          <RecordField label="Client channel">
            {channel?.name ?? head.clientId}
          </RecordField>
          <RecordField label="Client reviewers">
            {head.approverPubkeys.length}
          </RecordField>
        </dl>
      </RecordCard>
      <RecordCard title="Shared work">
        {clientRecords.workItemsQuery.isPending ? (
          <RecordMessage>Loading work</RecordMessage>
        ) : null}
        {clientRecords.workItemsQuery.data?.length ? (
          <div className="divide-y divide-border/70">
            {clientRecords.workItemsQuery.data.map(({ event, value }) => (
              <button
                className="flex w-full items-center justify-between gap-4 py-3 text-left first:pt-0 last:pb-0 hover:text-primary"
                key={event.id}
                onClick={() => void goWorkItem(value.workItemId, head.clientId)}
                type="button"
              >
                <span className="min-w-0 truncate text-sm font-medium">
                  {value.title}
                </span>
                <span className="shrink-0 text-sm capitalize text-muted-foreground">
                  {value.status}
                </span>
              </button>
            ))}
          </div>
        ) : null}
        {clientRecords.workItemsQuery.isSuccess &&
        clientRecords.workItemsQuery.data?.length === 0 ? (
          <RecordMessage>
            No work items are recorded for this client.
          </RecordMessage>
        ) : null}
      </RecordCard>
    </ClientWorkspace>
  );
}

function formatClientStatus(status: string) {
  return status
    .split(/([\s_-]+)/)
    .map((part) =>
      /^[a-z]/i.test(part) ? part[0].toUpperCase() + part.slice(1) : part,
    )
    .join("");
}
