import * as React from "react";
import { ArrowRight, BriefcaseBusiness } from "lucide-react";
import { Link } from "@tanstack/react-router";

import { parseWorkItemReferenceCoordinate } from "@/features/clients/lib/businessRecords";
import { WorkItemReferenceContext } from "@/features/clients/ui/WorkItemReferenceContext";
import type { UserProfileLookup } from "@/features/profile/lib/identity";
import { KIND_STREAM_MESSAGE } from "@/shared/constants/kinds";
import { truncateNpub } from "@/shared/lib/pubkey";
import type { TimelineMessage } from "@/features/messages/types";

export function WorkItemReferenceCard({
  channelId,
  message,
  profiles,
}: {
  channelId: string | null;
  message: TimelineMessage;
  profiles?: UserProfileLookup;
}) {
  const context = React.useContext(WorkItemReferenceContext);
  const channelTags = message.tags?.filter((tag) => tag[0] === "h") ?? [];
  const referenceTags = message.tags?.filter((tag) => tag[0] === "a") ?? [];
  if (
    message.kind !== KIND_STREAM_MESSAGE ||
    message.body.trim() !== "" ||
    channelTags.length !== 1 ||
    referenceTags.length !== 1 ||
    !channelId ||
    channelTags[0]?.[1]?.toLowerCase() !== channelId.toLowerCase() ||
    context?.channelId?.toLowerCase() !== channelId.toLowerCase()
  ) {
    return null;
  }

  const reference = parseWorkItemReferenceCoordinate(
    referenceTags[0]?.[1] ?? "",
    channelId,
  );
  if (!reference || !context) return null;

  const matchingRecords = context.records.filter(
    ({ event, value }) =>
      value.clientId === channelId.toLowerCase() &&
      value.workItemId === reference.workItemId &&
      event.pubkey.toLowerCase() === reference.authorPubkey &&
      event.tags.filter((tag) => tag[0] === "d").length === 1 &&
      event.tags.find((tag) => tag[0] === "d")?.[1] === reference.dTag,
  );
  if (matchingRecords.length !== 1) return null;

  const record = matchingRecords[0];
  if (!record) return null;
  const ownerNames = record.value.assignedPubkeys
    .map((pubkey) => {
      const normalized = pubkey.toLowerCase();
      return (
        profiles?.[normalized]?.displayName?.trim() || truncateNpub(normalized)
      );
    })
    .join(", ");
  const status = record.value.status;

  return (
    <Link
      aria-label={`Open work item ${record.value.title}`}
      className="my-3 flex max-w-[30rem] items-center gap-[1.125rem] rounded-[10px] border border-border/70 bg-card p-5 transition-colors hover:bg-muted/50 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
      params={{ workId: record.value.workItemId }}
      search={{ client: record.value.clientId }}
      to="/work/$workId"
    >
      <BriefcaseBusiness
        aria-hidden="true"
        className="h-5 w-5 shrink-0 text-muted-foreground"
      />
      <span className="min-w-0 flex-1">
        <strong className="block truncate text-sm font-semibold">
          {record.value.title}
        </strong>
        <span className="mt-1 block truncate text-xs text-muted-foreground">
          {ownerNames || "Unassigned"}
        </span>
        <span className="mt-1 block text-2xs text-muted-foreground">
          {record.value.deliverables.length} deliverables · {status}
        </span>
      </span>
      <ArrowRight
        aria-hidden="true"
        className="h-4 w-4 shrink-0 text-muted-foreground"
      />
    </Link>
  );
}
