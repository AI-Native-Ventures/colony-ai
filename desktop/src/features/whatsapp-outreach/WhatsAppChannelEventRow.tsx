import * as React from "react";
import { useNavigate } from "@tanstack/react-router";
import { CheckCircle2, MessageCircle, Send, XCircle } from "lucide-react";

import { useMyRelayMembershipLookupQuery } from "@/features/community-members/hooks";
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

function ChannelCard({
  children,
  label,
  testId,
}: {
  children: React.ReactNode;
  label: string;
  testId: string;
}) {
  return (
    <article
      aria-label={label}
      className="mx-2 mb-3 flex max-w-3xl flex-col gap-2 rounded-xl border border-colony-border bg-colony-pop p-3 text-colony-fg shadow-sm"
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
  const [busy, setBusy] = React.useState(false);
  const [actionError, setActionError] = React.useState("");
  const prefix = batchPrefix(message.body);
  const matches = (batchesQuery.data ?? []).filter((batch) =>
    prefix
      ? batch.batchId.replaceAll("-", "").toLocaleLowerCase().startsWith(prefix)
      : false,
  );
  const batch = matches.length === 1 ? matches[0] : null;
  const initialDisplayStatus =
    decision === "approve"
      ? "approved"
      : decision === "reject"
        ? "rejected"
        : batch?.status;
  const batchDetailsQuery = useWhatsAppBatchQuery(
    batch && initialDisplayStatus === "approved" ? batch.batchId : null,
  );
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
    (decision === "approve" ? (currentPubkey ?? null) : null);
  const approverProfilesQuery = useUsersBatchQuery(
    approvedByPubkey ? [approvedByPubkey] : [],
    { enabled: Boolean(approvedByPubkey) },
  );
  const approver = approvedByPubkey
    ? approverProfilesQuery.data?.profiles[normalizePubkey(approvedByPubkey)]
    : undefined;
  const approvedByName = approver?.displayName?.trim() || "an owner";
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

  if (!batch) {
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

  const isPending = displayStatus === "pending";
  const isRejected = displayStatus === "rejected";
  const sentCounts = batchDetailsQuery.data?.counts ?? batch.rows;
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
    <ChannelCard label={cardLabel} testId={testId}>
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
          <h3 className="m-0 text-sm font-bold">{title}</h3>
          {isPending ? (
            <p className="mb-0 mt-1 whitespace-pre-wrap text-sm text-colony-fg-secondary">
              {message.body}
            </p>
          ) : null}
        </div>
      </div>
      {isPending ? (
        <>
          {batchesQuery.isError ? (
            <p className="m-0 text-sm text-colony-danger" role="alert">
              {batchesQuery.error.message}
            </p>
          ) : null}
          {actionError ? (
            <p className="m-0 text-sm text-colony-danger" role="alert">
              {actionError}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              disabled={!canManage || busy || decision !== null}
              onClick={() => void decide("approve")}
              size="sm"
              type="button"
            >
              Approve and send
            </Button>
            <Button
              disabled={busy || decision !== null}
              onClick={() =>
                void navigate({
                  to: "/whatsapp/batches/$batchId",
                  params: { batchId: batch.batchId },
                })
              }
              size="sm"
              variant="outline"
              type="button"
            >
              Review each message
            </Button>
            <Button
              disabled={!canManage || busy || decision !== null}
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
            {canSendNow ? (
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
