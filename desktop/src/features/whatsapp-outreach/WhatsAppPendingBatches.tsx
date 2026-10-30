import * as React from "react";
import { useNavigate } from "@tanstack/react-router";

import { useChannelsQuery } from "@/features/channels/hooks";
import { useUsersBatchQuery } from "@/features/profile/hooks";
import { useIdentityQuery } from "@/shared/api/hooks";
import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/cn";
import type { WhatsAppTemplate } from "./whatsappOutreachModels";
import { formatWhatsAppDateTime } from "./WhatsAppThreadMessage";
import { useWhatsAppBatchesQuery } from "./whatsappOutreachQueries";
import { findWhatsAppBatchCreatorChannel } from "./whatsappBatchNavigation";

export function WhatsAppPendingBatches({
  canManage,
  templates,
  placement = "settings",
}: {
  canManage: boolean;
  templates: readonly WhatsAppTemplate[];
  placement?: "outreach" | "settings";
}) {
  const navigate = useNavigate();
  const batchesQuery = useWhatsAppBatchesQuery("pending", canManage);
  const channelsQuery = useChannelsQuery();
  const identityQuery = useIdentityQuery();
  const batches = batchesQuery.data ?? [];
  const creatorPubkeys = React.useMemo(
    () => [...new Set(batches.map((batch) => batch.createdBy))],
    [batches],
  );
  const profilesQuery = useUsersBatchQuery(creatorPubkeys, {
    enabled: canManage,
  });

  if (!canManage) return null;

  const creatorProfiles = profilesQuery.data?.profiles ?? {};
  const channels = channelsQuery.data ?? [];
  const className = cn(
    "c3wa-pending-batches",
    placement === "outreach" && "is-outreach",
  );

  if (batchesQuery.isPending) {
    return (
      <section
        aria-busy="true"
        aria-labelledby="c3wa-pending-batches-title"
        className={className}
        data-testid="whatsapp-pending-batches"
      >
        <h2 className="text-sm" id="c3wa-pending-batches-title">
          Waiting for your approval
        </h2>
        <p className="text-xs">Checking pending batches</p>
      </section>
    );
  }

  if (batchesQuery.isError && batches.length === 0) {
    return (
      <section
        aria-labelledby="c3wa-pending-batches-title"
        className={className}
        data-testid="whatsapp-pending-batches"
      >
        <h2 className="text-sm" id="c3wa-pending-batches-title">
          Waiting for your approval
        </h2>
        <p className="text-xs" role="alert">
          Pending WhatsApp batches could not be loaded.
        </p>
        <Button
          onClick={() => void batchesQuery.refetch()}
          size="sm"
          type="button"
          variant="outline"
        >
          Try again
        </Button>
      </section>
    );
  }

  if (batches.length === 0) return null;

  return (
    <section
      aria-labelledby="c3wa-pending-batches-title"
      className={className}
      data-testid="whatsapp-pending-batches"
    >
      <h2 className="text-sm" id="c3wa-pending-batches-title">
        Waiting for your approval
      </h2>
      {batchesQuery.isError ? (
        <div className="c3wa-pending-batch-error">
          <p className="text-xs" role="alert">
            Pending WhatsApp batches could not be refreshed.
          </p>
          <Button
            onClick={() => void batchesQuery.refetch()}
            size="sm"
            type="button"
            variant="outline"
          >
            Try again
          </Button>
        </div>
      ) : null}
      <ul className="c3wa-pending-batch-list">
        {batches.map((batch) => {
          const template = templates.find(
            (candidate) =>
              candidate.name.toLocaleLowerCase() ===
                batch.template.toLocaleLowerCase() ||
              candidate.title.toLocaleLowerCase() ===
                batch.template.toLocaleLowerCase(),
          );
          const templateTitle = template?.title ?? batch.template;
          const creatorChannel = findWhatsAppBatchCreatorChannel(
            channels,
            batch.createdBy,
            identityQuery.data?.pubkey,
          );
          const profileName =
            creatorProfiles[
              batch.createdBy.toLocaleLowerCase()
            ]?.displayName?.trim();
          const creatorName =
            profileName ||
            creatorChannel?.name ||
            `Member ${batch.createdBy.slice(0, 8)}`;
          const createdAt = formatWhatsAppDateTime(batch.createdAt);
          const rowCount = batch.rows.total;

          return (
            <li
              className="c3wa-pending-batch"
              data-testid={`whatsapp-pending-batch-${batch.batchId}`}
              key={batch.batchId}
            >
              <div className="c3wa-pending-batch-copy">
                <strong className="text-sm">{templateTitle}</strong>
                <span className="text-xs">
                  {rowCount} {rowCount === 1 ? "row" : "rows"}
                </span>
                <span className="text-xs">
                  Created by {creatorName}
                  {createdAt ? ` · ${createdAt}` : " · Time unavailable"}
                </span>
                {!creatorChannel && !channelsQuery.isPending ? (
                  <span className="text-xs" role="status">
                    Creator chat is not available
                  </span>
                ) : null}
              </div>
              <Button
                data-testid={`whatsapp-review-batch-${batch.batchId}`}
                disabled={!creatorChannel}
                onClick={() => {
                  if (!creatorChannel) return;
                  void navigate({
                    to: "/channels/$channelId",
                    params: { channelId: creatorChannel.id },
                    search: { whatsappBatchId: batch.batchId },
                  });
                }}
                size="sm"
                type="button"
                variant="outline"
              >
                Review
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
