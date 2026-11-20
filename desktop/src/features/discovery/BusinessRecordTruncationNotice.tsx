import type {
  BusinessRecordCollection,
  BusinessRecords,
} from "./businessRecordRelay";

const RECORD_LABELS: Array<[BusinessRecordCollection, string]> = [
  ["services", "services"],
  ["prospects", "prospects"],
  ["proposalHeads", "proposal heads"],
  ["proposalVersions", "proposal versions"],
  ["proposalAcceptances", "proposal acceptances"],
  ["proposalReceipts", "proposal receipts"],
  ["outreachLists", "outreach lists"],
  ["discoveryCampaigns", "discovery campaigns"],
  ["qualificationObservations", "qualification observations"],
];

export function BusinessRecordTruncationNotice({
  records,
}: {
  records: BusinessRecords;
}) {
  const messages = RECORD_LABELS.flatMap(([kind, label]) =>
    records.truncated[kind]
      ? [
          `Showing the newest ${records.loaded[kind].toLocaleString()} ${label}. Older ones are not loaded.`,
        ]
      : [],
  );
  if (messages.length === 0) return null;

  return (
    <section
      aria-label="Business record loading limit"
      className="business-record-truncation-notice"
      role="status"
    >
      {messages.map((message) => (
        <p key={message}>{message}</p>
      ))}
    </section>
  );
}
