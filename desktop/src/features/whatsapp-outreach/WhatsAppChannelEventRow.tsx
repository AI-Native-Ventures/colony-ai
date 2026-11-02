import * as React from "react";
import { useNavigate } from "@tanstack/react-router";
import { CheckCircle2, MessageCircle, Send, XCircle } from "lucide-react";

import { useMyRelayMembershipLookupQuery } from "@/features/community-members/hooks";
import { useBusinessRecords } from "@/features/discovery/useBusinessRecords";
import { useUsersBatchQuery } from "@/features/profile/hooks";
import { requestWorkAreaTab } from "@/features/workarea/dock/workAreaRequests";
import { useIdentityQuery } from "@/shared/api/hooks";
import { normalizePubkey } from "@/shared/lib/pubkey";
import { Button } from "@/shared/ui/button";
import { KIND_WHATSAPP_BATCH_DECISION } from "@/shared/constants/kinds";
import type { TimelineMessage } from "@/features/messages/types";
import { WhatsAppSendNowAction } from "./WhatsAppSendNowAction";
import { useWhatsAppSendNowAccess } from "./whatsappSendNowHooks";
import {
  useWhatsAppApprovedBatchDetailsQuery,
  useWhatsAppBatchQuery,
  useWhatsAppBatchesQuery,
  useWhatsAppCommand,
  useWhatsAppContactsQuery,
  useWhatsAppStatusQuery,
  useWhatsAppTemplatesQuery,
} from "./whatsappOutreachQueries";
import { whatsappQueuedScheduleLabel } from "./whatsappOutreachModels";
import { canSendNowWhatsAppBatch } from "./whatsappSendNowEligibility";

function tagValue(message: TimelineMessage, name: string): string | null {
  return message.tags?.find((tag) => tag[0] === name)?.[1]?.trim() || null;
}

function batchPrefix(content: string): string | null {
  return (
    /\bbatch\s+([a-z0-9-]{4,64})\b/iu
      .exec(content)?.[1]
      ?.replaceAll("-", "")
      .toLocaleLowerCase() ?? null
  );
}

function decisionDateTimeLabel(value: string | null | undefined): string {
  if (!value) return "Time unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Time unavailable";
  return new Intl.DateTimeFormat("en-ZA", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "Africa/Johannesburg",
  }).format(date);
}

function ChannelCard({
  children,
  label,
  testId,
  wide = false,
}: {
  children: React.ReactNode;
  label: string;
  testId: string;
  wide?: boolean;
}) {
  return (
    <article
      aria-label={label}
      className={`mx-2 mb-3 flex flex-col gap-3 rounded-xl border border-colony-border bg-colony-pop text-colony-fg shadow-sm ${wide ? "max-w-4xl p-5 sm:p-6" : "max-w-3xl p-3"}`}
      data-testid={testId}
    >
      {children}
    </article>
  );
}

function NoticeCard({
  code,
  message,
}: {
  code: string;
  message: TimelineMessage;
}) {
  const isConnected = code === "connected";
  const isCompleted = code === "batch_completed";
  const title = isConnected
    ? "WhatsApp number connected"
    : isCompleted
      ? "Batch sent"
      : "WhatsApp update";
  const testId = isConnected
    ? "whatsapp-channel-connected"
    : isCompleted
      ? "whatsapp-channel-batch-sent"
      : "whatsapp-channel-notice";

  return (
    <ChannelCard label={title} testId={testId}>
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-colony-success-bg text-colony-success"
        >
          {isConnected ? (
            <CheckCircle2 size={17} />
          ) : isCompleted ? (
            <Send size={16} />
          ) : (
            <MessageCircle size={17} />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="m-0 text-sm font-bold">{title}</h3>
          <p className="mb-0 mt-1 whitespace-pre-wrap text-sm text-colony-fg-secondary">
            {message.body}
          </p>
        </div>
      </div>
    </ChannelCard>
  );
}

function PendingBatchCard({ message }: { message: TimelineMessage }) {
  const navigate = useNavigate();
  const batchesQuery = useWhatsAppBatchesQuery();
  const membershipQuery = useMyRelayMembershipLookupQuery();
  const identityQuery = useIdentityQuery();
  const command = useWhatsAppCommand();
  const [decision, setDecision] = React.useState<"approve" | "reject" | null>(
    null,
  );
  const [showAllRows, setShowAllRows] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [actionError, setActionError] = React.useState("");
  const businessRecords = useBusinessRecords({ createIfMissing: false });
  const taggedBatchId = tagValue(message, "wa-batch");
  const prefix = taggedBatchId
    ? taggedBatchId.replaceAll("-", "").toLocaleLowerCase()
    : batchPrefix(message.body);
  const matches = (batchesQuery.data ?? []).filter((batch) =>
    prefix
      ? batch.batchId.replaceAll("-", "").toLocaleLowerCase().startsWith(prefix)
      : false,
  );
  const ambiguousPendingMatches =
    matches.length > 1 && matches.every((match) => match.status === "pending");
  const batch = matches.length === 1 ? matches[0] : null;
  const initialDisplayStatus =
    decision === "approve"
      ? "approved"
      : decision === "reject"
        ? "rejected"
        : batch?.status;
  const batchDetailsQuery = useWhatsAppBatchQuery(batch?.batchId ?? null);
  const contactsQuery = useWhatsAppContactsQuery(Boolean(batch));
  const templatesQuery = useWhatsAppTemplatesQuery(Boolean(batch));
  const statusQuery = useWhatsAppStatusQuery(Boolean(batch));
  const approvedDetailsQuery = useWhatsAppApprovedBatchDetailsQuery(
    initialDisplayStatus === "approved",
  );
  const displayStatus =
    decision === "reject"
      ? "rejected"
      : decision === "approve"
        ? batchDetailsQuery.data?.status === "completed"
          ? "completed"
          : "approved"
        : (batchDetailsQuery.data?.status ?? batch?.status);
  const role = membershipQuery.data?.membership?.role;
  const canManage =
    membershipQuery.data?.membershipRequired === false ||
    role === "owner" ||
    role === "admin";
  const currentPubkey = identityQuery.data?.pubkey;
  const canUseSendNow = useWhatsAppSendNowAccess({
    role,
    pubkey: currentPubkey,
    ownerPubkey: undefined,
  });
  const approvedDetail =
    batchDetailsQuery.data?.status === "approved"
      ? batchDetailsQuery.data
      : (approvedDetailsQuery.data?.find(
          (detail) => detail.batchId === batch?.batchId,
        ) ?? (decision === "approve" ? batchDetailsQuery.data : null));
  const approvedByPubkey =
    approvedDetail?.decidedBy ??
    batchDetailsQuery.data?.decidedBy ??
    (decision ? (currentPubkey ?? null) : null);
  const approverProfilesQuery = useUsersBatchQuery(
    approvedByPubkey ? [approvedByPubkey] : [],
    { enabled: Boolean(approvedByPubkey) },
  );
  const approver = approvedByPubkey
    ? approverProfilesQuery.data?.profiles[normalizePubkey(approvedByPubkey)]
    : undefined;
  const approvedByName = approver?.displayName?.trim() || "an owner";
  const decisionDetail =
    batchDetailsQuery.data?.batchId === batch?.batchId
      ? batchDetailsQuery.data
      : null;
  const decidedTemplateName = decisionDetail?.template ?? batch?.template ?? "";
  const decidedTemplateTitle =
    templatesQuery.data?.find(
      (template) => template.name === decidedTemplateName,
    )?.title ?? decidedTemplateName;
  const decidedMessageCount =
    decisionDetail?.counts.total ?? batch?.rows.total ?? 0;
  const decisionSummary = decisionDetail
    ? `${decidedTemplateTitle} · ${decidedMessageCount} ${decidedMessageCount === 1 ? "message" : "messages"} · ${decisionDateTimeLabel(decisionDetail.decidedAt)} · ${approvedByName}`
    : batchDetailsQuery.isError
      ? "Decision details could not be loaded."
      : "Loading decision details…";
  const scheduleRow = approvedDetail?.rows.find(
    (row) => row.state === "ready" || row.state === "queued",
  );
  const scheduleLabel = whatsappQueuedScheduleLabel(
    scheduleRow?.sendsAt ?? approvedDetail?.nextSendAt,
  );
  const sendNowBatch =
    approvedDetailsQuery.data?.find(
      (detail) => detail.batchId === batch?.batchId,
    ) ??
    (batchDetailsQuery.data?.status === "approved"
      ? batchDetailsQuery.data
      : null);
  const canSendNow = canSendNowWhatsAppBatch(sendNowBatch, canUseSendNow);
  const listId = tagValue(message, "list");
  const outreachList = listId
    ? businessRecords.records?.outreachLists.find(
        ({ record }) => record.listId === listId,
      )?.record
    : null;
  const detail = batchDetailsQuery.data;
  const template = templatesQuery.data?.find(
    (candidate) =>
      candidate.name.toLocaleLowerCase() ===
        batch?.template.toLocaleLowerCase() &&
      candidate.language.toLocaleLowerCase() ===
        batch?.language.toLocaleLowerCase(),
  );
  const previewRow = detail?.rows.find((row) => row.state === "ready") ?? null;
  const leadNameForRow = (row: { leadId: string | null; to: string }) => {
    const digits = row.to.replace(/\D/gu, "");
    const contact = contactsQuery.data?.find(
      (candidate) => candidate.waId === digits,
    );
    if (contact?.businessName) return contact.businessName;
    return row.leadId
      ? (businessRecords.records?.prospects.find(
          ({ record }) => record.prospectId === row.leadId,
        )?.record.prospect.party.displayName ?? null)
      : null;
  };
  const previewLead = previewRow ? leadNameForRow(previewRow) : null;
  const skippedSummary = tagValue(message, "wa-skipped");
  const visibleRows = detail?.rows.filter((row) => row.state === "ready") ?? [];
  const displayedRows = showAllRows ? visibleRows : visibleRows.slice(0, 4);

  function maskedNumber(value: string): string {
    const digits = value.replace(/\D/gu, "");
    if (digits.length < 7) return value;
    return `+${digits.slice(0, 2)} ${digits.slice(2, 4)} *** ${digits.slice(-4)}`;
  }

  async function decide(nextDecision: "approve" | "reject") {
    if (!batch || !canManage || busy) return;
    setActionError("");
    setBusy(true);
    try {
      await command(KIND_WHATSAPP_BATCH_DECISION, {
        v: 1,
        batchId: batch.batchId,
        decision: nextDecision,
        ...(nextDecision === "approve" ? { dropRows: [], editRows: [] } : {}),
      });
      setDecision(nextDecision);
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "Could not record the WhatsApp batch decision.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (!batch && !ambiguousPendingMatches) {
    const missingText = batchesQuery.isPending
      ? "Finding the WhatsApp batch…"
      : batchesQuery.isError
        ? batchesQuery.error.message
        : matches.length > 1
          ? "This notice matches more than one batch. Refresh the channel."
          : "This batch is no longer available.";
    return (
      <ChannelCard
        label="WhatsApp batch unavailable"
        testId="whatsapp-channel-batch-unavailable"
      >
        <p className="m-0 text-sm text-colony-fg-secondary">{missingText}</p>
      </ChannelCard>
    );
  }

  const isPending = displayStatus === "pending" || ambiguousPendingMatches;
  const isRejected = displayStatus === "rejected";
  const sentCounts = batchDetailsQuery.data?.counts ??
    batch?.rows ?? {
      total: 0,
      sent: 0,
    };
  const isSent =
    displayStatus === "completed" ||
    (sentCounts.total > 0 && sentCounts.sent >= sentCounts.total);
  const title = isPending
    ? "WhatsApp batch needs approval"
    : isRejected
      ? "WhatsApp batch rejected"
      : isSent
        ? "WhatsApp batch sent"
        : "WhatsApp batch approved";
  const cardLabel = isPending ? "WhatsApp batch waiting for approval" : title;
  const testId = isPending
    ? "whatsapp-channel-batch-pending"
    : isRejected
      ? "whatsapp-channel-batch-rejected"
      : isSent
        ? "whatsapp-channel-batch-sent-state"
        : "whatsapp-channel-batch-approved";

  return (
    <>
      {isPending ? (
        <p className="mx-2 mb-2 max-w-4xl whitespace-pre-wrap text-sm text-colony-fg-secondary">
          {message.body}
        </p>
      ) : null}
      <ChannelCard label={cardLabel} testId={testId} wide>
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className={`mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-full ${
              isRejected
                ? "bg-colony-danger-bg text-colony-danger"
                : isPending
                  ? "bg-colony-need-bg text-colony-need"
                  : "bg-colony-success-bg text-colony-success"
            }`}
          >
            {isRejected ? (
              <XCircle size={17} />
            ) : isSent ? (
              <Send size={16} />
            ) : isPending ? (
              <MessageCircle size={17} />
            ) : (
              <CheckCircle2 size={17} />
            )}
          </span>
          <div className="min-w-0 flex-1">
            {!isPending ? (
              <h3 className="m-0 text-sm font-bold">{title}</h3>
            ) : null}
            {isRejected || isSent ? (
              <p
                className="m-0 mt-1 text-sm text-colony-fg-secondary"
                data-testid="whatsapp-channel-batch-summary"
              >
                {decisionSummary}
              </p>
            ) : null}
            {isPending ? (
              <div className="mt-3 flex flex-col gap-4">
                <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
                  <span className="rounded-full bg-colony-need-bg px-3 py-1 text-colony-need">
                    Needs you
                  </span>
                  <span className="rounded-full bg-colony-bg-secondary px-3 py-1 text-colony-fg-secondary">
                    WhatsApp batch
                  </span>
                  {statusQuery.data?.displayPhoneNumber ? (
                    <span className="text-colony-fg-muted">
                      Sends from {statusQuery.data.displayPhoneNumber}
                    </span>
                  ) : null}
                </div>
                <h3 className="m-0 text-base font-bold">
                  {detail?.note ||
                    `Scout wants to message ${batch?.rows.ready ?? 0} ${outreachList?.name ?? "leads"}`}
                </h3>
                {outreachList || template ? (
                  <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
                    {outreachList && listId ? (
                      <a
                        className="rounded-full bg-violet-100 px-3 py-1 text-violet-800 hover:underline dark:bg-violet-950 dark:text-violet-200"
                        href={`#/lists/${listId}`}
                      >
                        For · {outreachList.name}
                      </a>
                    ) : null}
                    {template ? (
                      <span className="rounded-full bg-violet-100 px-3 py-1 text-violet-800 dark:bg-violet-950 dark:text-violet-200">
                        Template · {template.title}
                      </span>
                    ) : null}
                  </div>
                ) : null}
                {previewRow ? (
                  <section
                    aria-label="First WhatsApp message preview"
                    className="flex max-w-2xl flex-col gap-2"
                  >
                    <h4 className="m-0 text-sm font-semibold">
                      First message, as {previewLead ?? "the business"} will see
                      it
                    </h4>
                    <p className="m-0 whitespace-pre-wrap rounded-xl bg-colony-bg-secondary p-4 text-sm leading-relaxed text-colony-fg-secondary">
                      {previewRow.preview}
                    </p>
                  </section>
                ) : batchDetailsQuery.isError ? (
                  <p className="m-0 text-sm text-colony-danger" role="alert">
                    The message preview could not be loaded. Open the batch to
                    review it.
                  </p>
                ) : null}
                {skippedSummary ? (
                  <p className="m-0 rounded-lg bg-colony-need-bg px-3 py-2 text-sm font-medium text-colony-need">
                    Skipped {skippedSummary}
                  </p>
                ) : null}
                {displayedRows.length ? (
                  <section aria-label="Ready to send" className="flex flex-col">
                    <div className="flex items-center justify-between gap-3 border-b border-colony-border pb-2 text-xs font-semibold uppercase tracking-wide text-colony-fg-muted">
                      <span>
                        {outreachList?.name ?? "Ready to send"} ·{" "}
                        {visibleRows.length}
                      </span>
                      <span>Preview each message before approval</span>
                    </div>
                    <ul className="m-0 list-none divide-y divide-colony-border p-0">
                      {displayedRows.map((row) => {
                        const name = leadNameForRow(row);
                        return (
                          <li
                            className="flex min-w-0 items-center gap-3 py-3"
                            key={`${row.idx}:${row.to}`}
                          >
                            <span
                              aria-hidden="true"
                              className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-colony-success-bg text-sm font-semibold text-colony-success"
                            >
                              {(name ?? "?").slice(0, 1).toLocaleUpperCase()}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-semibold text-colony-fg">
                                {name ?? `Lead ${row.idx + 1}`}
                              </span>
                              <span className="block text-xs text-colony-fg-muted">
                                {maskedNumber(row.to)}
                              </span>
                            </span>
                            <span className="hidden max-w-48 truncate text-xs text-colony-fg-secondary sm:block">
                              {row.preview}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                    {visibleRows.length > 4 ? (
                      <Button
                        className="self-start"
                        onClick={() => setShowAllRows((shown) => !shown)}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        {showAllRows
                          ? "Show fewer"
                          : `Show all ${visibleRows.length}`}
                      </Button>
                    ) : null}
                  </section>
                ) : null}
                {batch && statusQuery.data ? (
                  <p className="m-0 rounded-lg bg-colony-bg-secondary px-3 py-2 text-sm text-colony-fg-secondary">
                    {statusQuery.data.newChatsSentToday} of{" "}
                    {statusQuery.data.dailyNewChatCap} new chats used today.{" "}
                    {batch.rows.ready} send today. Replies are never capped.
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
        {isPending ? (
          <>
            {batchesQuery.isError ? (
              <p className="m-0 text-sm text-colony-danger" role="alert">
                {batchesQuery.error.message}
              </p>
            ) : ambiguousPendingMatches ? (
              <p className="m-0 text-sm text-colony-danger" role="alert">
                This notice matches more than one pending batch. Refresh the
                channel before deciding.
              </p>
            ) : null}
            {actionError ? (
              <p className="m-0 text-sm text-colony-danger" role="alert">
                {actionError}
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                disabled={!batch || !canManage || busy || decision !== null}
                onClick={() => void decide("approve")}
                size="sm"
                type="button"
              >
                Approve all {batch?.rows.ready ?? 0}
              </Button>
              <Button
                disabled={!batch || busy || decision !== null}
                onClick={() => {
                  if (batch) {
                    void navigate({
                      to: "/whatsapp/batches/$batchId",
                      params: { batchId: batch.batchId },
                    });
                  }
                }}
                size="sm"
                variant="outline"
                type="button"
              >
                Review each message
              </Button>
              <Button
                disabled={!batch || !canManage || busy || decision !== null}
                onClick={() => void decide("reject")}
                size="sm"
                variant="ghost"
                type="button"
              >
                <XCircle aria-hidden="true" />
                Reject
              </Button>
              {!canManage ? (
                <span className="text-xs text-colony-fg-muted">
                  Only the owner or an admin can decide.
                </span>
              ) : null}
            </div>
          </>
        ) : isRejected || isSent ? null : (
          <>
            <p className="m-0 text-sm text-colony-fg-secondary">
              Approved by {approvedByName}. {scheduleLabel}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {batch && canSendNow ? (
                <WhatsAppSendNowAction batchId={batch.batchId} />
              ) : null}
              <Button
                onClick={() => requestWorkAreaTab("whatsapp")}
                size="sm"
                type="button"
                variant="outline"
              >
                <MessageCircle aria-hidden="true" />
                Open chats
              </Button>
            </div>
          </>
        )}
      </ChannelCard>
    </>
  );
}

function ReplyCard({ message }: { message: TimelineMessage }) {
  const navigate = useNavigate();
  const contactWaId = tagValue(message, "wa");
  const contactName = tagValue(message, "wa-name") ?? "WhatsApp contact";
  const leadId = tagValue(message, "lead");

  return (
    <ChannelCard
      label={`WhatsApp reply from ${contactName}`}
      testId="whatsapp-channel-reply"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-colony-success-bg text-colony-success"
        >
          <MessageCircle size={17} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="m-0 text-sm font-bold">
            {contactName} replied on WhatsApp
          </h3>
          <p className="mb-0 mt-1 whitespace-pre-wrap text-sm text-colony-fg-secondary">
            {message.body}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          disabled={!contactWaId}
          onClick={() => {
            if (contactWaId) {
              requestWorkAreaTab("whatsapp", { contactWaId });
            }
          }}
          size="sm"
          type="button"
        >
          <MessageCircle aria-hidden="true" />
          Open in WhatsApp
        </Button>
        {leadId ? (
          <Button
            onClick={() =>
              void navigate({
                to: "/sales/lead/$prospectId",
                params: { prospectId: leadId },
              })
            }
            size="sm"
            variant="outline"
            type="button"
          >
            Open lead
          </Button>
        ) : null}
      </div>
    </ChannelCard>
  );
}

export function WhatsAppChannelEventRow({
  message,
  latestWhatsAppReply,
}: {
  message: TimelineMessage;
  latestWhatsAppReply?: TimelineMessage;
}) {
  const notice = tagValue(message, "wa-notice");
  if (notice === "batch_pending") {
    return <PendingBatchCard message={message} />;
  }
  if (notice) return <NoticeCard code={notice} message={message} />;
  if (latestWhatsAppReply) {
    return <ReplyCard message={latestWhatsAppReply} />;
  }
  return null;
}
