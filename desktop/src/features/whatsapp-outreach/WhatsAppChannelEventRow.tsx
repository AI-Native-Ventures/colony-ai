import * as React from "react";
import { useNavigate } from "@tanstack/react-router";
import { CheckCircle2, MessageCircle, Send, XCircle } from "lucide-react";

import { useMyRelayMembershipLookupQuery } from "@/features/community-members/hooks";
import { requestWorkAreaTab } from "@/features/workarea/dock/workAreaRequests";
import { Button } from "@/shared/ui/button";
import { KIND_WHATSAPP_BATCH_DECISION } from "@/shared/constants/kinds";
import type { TimelineMessage } from "@/features/messages/types";
import {
  useWhatsAppBatchesQuery,
  useWhatsAppCommand,
} from "./whatsappOutreachQueries";

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
  const batchesQuery = useWhatsAppBatchesQuery("pending");
  const membershipQuery = useMyRelayMembershipLookupQuery();
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
  const role = membershipQuery.data?.membership?.role;
  const canManage =
    membershipQuery.data?.membershipRequired === false ||
    role === "owner" ||
    role === "admin";

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

  return (
    <ChannelCard
      label="WhatsApp batch waiting for approval"
      testId="whatsapp-channel-batch-pending"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-colony-need-bg text-colony-need"
        >
          <MessageCircle size={17} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="m-0 text-sm font-bold">
            WhatsApp batch needs approval
          </h3>
          <p className="mb-0 mt-1 whitespace-pre-wrap text-sm text-colony-fg-secondary">
            {message.body}
          </p>
        </div>
      </div>
      {decision ? (
        <p
          className="m-0 text-sm font-semibold text-colony-success"
          role="status"
        >
          Decision recorded: {decision === "approve" ? "approved" : "rejected"}.
        </p>
      ) : null}
      {batchesQuery.isError ? (
        <p className="m-0 text-sm text-colony-danger" role="alert">
          {batchesQuery.error.message}
        </p>
      ) : matches.length > 1 ? (
        <p className="m-0 text-sm text-colony-danger" role="alert">
          This notice matches more than one pending batch. Refresh the channel
          before deciding.
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
          Approve and send
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
        {!batch && !batchesQuery.isError && matches.length < 2 ? (
          <span className="text-xs text-colony-fg-muted">
            {batchesQuery.isPending
              ? "Finding the pending batch…"
              : "The pending batch is not available."}
          </span>
        ) : !canManage ? (
          <span className="text-xs text-colony-fg-muted">
            Only the owner or an admin can decide.
          </span>
        ) : null}
      </div>
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
