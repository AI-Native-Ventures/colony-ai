import { Link } from "@tanstack/react-router";

import { useClientDirectoryQuery } from "@/features/clients/useBusinessRecords";
import {
  RecordMessage,
  ClientWorkspace,
} from "@/features/clients/ui/ClientWorkspace";

export function ClientsScreen() {
  const clientsQuery = useClientDirectoryQuery();
  const records = clientsQuery.data ?? [];

  return (
    <ClientWorkspace title="Clients">
      {clientsQuery.channelsQuery.isError ? (
        <RecordMessage kind="error">
          Client channels could not be loaded.
        </RecordMessage>
      ) : null}
      {clientsQuery.liveError ? (
        <RecordMessage kind="error">
          Live client updates could not be started.
        </RecordMessage>
      ) : null}
      {clientsQuery.isError ? (
        <RecordMessage kind="error">
          Client records could not be loaded.
        </RecordMessage>
      ) : null}
      {clientsQuery.isPending ? (
        <RecordMessage>Loading clients</RecordMessage>
      ) : null}
      {clientsQuery.isSuccess && records.length === 0 ? (
        <RecordMessage>
          No client records are available in this business.
        </RecordMessage>
      ) : null}
      {records.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-border/70 bg-card shadow-xs">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border/70 text-left text-muted-foreground">
                <th className="px-4 py-3 font-medium">Client</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {records.map(({ event, value }) => (
                <tr
                  className="border-b border-border/50 last:border-0"
                  key={event.id}
                >
                  <td className="px-4 py-3 font-medium">
                    <Link
                      className="text-foreground underline-offset-4 hover:underline"
                      params={{ clientId: value.clientId }}
                      to="/clients/$clientId"
                    >
                      {value.displayName}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    {formatClientStatus(value.status)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
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
