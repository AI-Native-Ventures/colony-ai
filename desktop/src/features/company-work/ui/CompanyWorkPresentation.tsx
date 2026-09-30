import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import type {
  CompanyWorkHeadRecord,
  CompanyWorkStatus,
} from "../companyWorkModels";

export const companyWorkPrimaryButtonClass =
  "bg-[#536d9c] text-white shadow hover:bg-[#4d668f] disabled:bg-[#536d9c] disabled:text-white disabled:opacity-100";

export function companyWorkStatusLabel(status: CompanyWorkStatus): string {
  return status.replaceAll("_", " ");
}

export function CompanyWorkStatusBadge({
  status,
}: {
  status: CompanyWorkStatus;
}) {
  const className =
    status === "active" || status === "done_verified"
      ? "bg-[#507d69]/[0.12] text-[#507d69] dark:bg-[#92b7a1]/[0.12] dark:text-[#92b7a1]"
      : status === "blocked" || status === "done_unverified"
        ? "bg-[#eee7f4] text-[#76608c] dark:bg-[#403449] dark:text-[#c1a6d8]"
        : "bg-muted text-muted-foreground";
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-1 text-xs ${className}`}
    >
      {companyWorkStatusLabel(status)}
    </span>
  );
}

export function CompanyWorkListRow({
  record,
  ownerLabel,
  channelLabel,
}: {
  record: CompanyWorkHeadRecord;
  ownerLabel: string;
  channelLabel: string;
}) {
  const { goCompanyWorkDetail } = useAppNavigation();
  return (
    <button
      aria-label={`Open work item ${record.head.title}`}
      className="flex w-full items-center gap-4 border-b border-border px-3 py-5 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      data-testid={`company-work-row-${record.head.workItemId}`}
      onClick={() => void goCompanyWorkDetail(record.head.workItemId)}
      type="button"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-foreground">
          {record.head.title}
        </span>
        <span className="mt-1 block truncate text-xs text-muted-foreground">
          {ownerLabel} · #{channelLabel}
        </span>
      </span>
      <CompanyWorkStatusBadge status={record.head.status} />
      <span aria-hidden="true" className="text-lg text-muted-foreground">
        ›
      </span>
    </button>
  );
}

export function CompanyWorkPageHeader({ title }: { title: string }) {
  return (
    <div className="flex h-[78px] w-full flex-none items-center border-b border-border px-6">
      <p className="text-sm font-semibold text-foreground">Company / {title}</p>
    </div>
  );
}

export function CompanyWorkBackButton({
  label = "Back",
  onClick,
}: {
  label?: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={label}
      className="mb-8 inline-flex items-center gap-1 pt-4 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={onClick}
      type="button"
    >
      <span aria-hidden="true">‹</span> {label}
    </button>
  );
}

export function CompanyWorkLoadError({
  title,
  message,
  onRetry,
}: {
  title: string;
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="mt-8 rounded-lg border border-border p-6">
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{message}</p>
      <button
        className="mt-5 rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={onRetry}
        type="button"
      >
        Try again
      </button>
    </div>
  );
}
