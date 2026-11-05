import * as React from "react";

import { errorMessage } from "./BusinessCommon";
import { publishDiscoveryCampaignAction } from "./businessRecordMutations";
import { loadDiscoveryCampaignHeads } from "./businessRecordRelay";
import type { DiscoveryCampaign } from "./discoveryProvider";
import { useDiscoveryCampaign } from "./discoveryProvider";
import type { LeadContext } from "./leadShared";
import {
  buildDiscoveryCampaignCreateAction,
  buildDiscoveryCampaignMutation,
} from "./outreachRecords";
import { canEdit } from "./leadShared";

function isTerminal(
  status: DiscoveryCampaign["status"],
): status is "complete" | "cancelled" | "failed" {
  return status === "complete" || status === "cancelled" || status === "failed";
}

function isConflict(error: unknown): boolean {
  return errorMessage(error).toLocaleLowerCase().includes("conflict");
}

export function CampaignRelaySync({ context }: { context: LeadContext }) {
  const { provider } = useDiscoveryCampaign();
  const [error, setError] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [retryVersion, setRetryVersion] = React.useState(0);
  const inFlight = React.useRef(false);
  const rerunAfterCurrent = React.useRef(false);
  const mounted = React.useRef(false);
  const generation = React.useRef(0);
  const refreshRef = React.useRef(context.refresh);
  refreshRef.current = context.refresh;
  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const campaigns = provider?.getCampaigns() ?? [];
  const signature = JSON.stringify(
    campaigns.map((campaign) => [
      campaign.id,
      campaign.name,
      campaign.audience,
      campaign.industryName,
      campaign.verticalId,
      campaign.verticalName,
      campaign.pickedTags ?? [],
      campaign.criteria,
      campaign.location,
      campaign.target,
      campaign.count,
      campaign.skippedDuplicates ?? 0,
      campaign.status,
      campaign.endNote ?? campaign.failureReason ?? null,
      campaign.runBy?.pubkey ?? null,
      campaign.simulated === true,
    ]),
  );
  const campaignsRef = React.useRef(campaigns);
  campaignsRef.current = campaigns;
  const signatureRef = React.useRef(signature);
  signatureRef.current = signature;
  const retryVersionRef = React.useRef(retryVersion);
  retryVersionRef.current = retryVersion;

  React.useEffect(() => {
    const requestedGeneration = ++generation.current;
    const isCurrent = () =>
      mounted.current && generation.current === requestedGeneration;
    const currentPubkey = context.currentPubkey;
    const requestedSignature = signature;
    const requestedRetryVersion = retryVersion;
    if (!provider || !currentPubkey || !canEdit(context.role)) {
      return;
    }
    if (inFlight.current) {
      rerunAfterCurrent.current = true;
      return;
    }
    const localCampaigns = campaignsRef.current.filter(
      (campaign) => campaign.simulated !== true,
    );
    if (localCampaigns.length === 0) return;
    inFlight.current = true;
    setPending(true);
    setError("");

    void (async () => {
      try {
        let heads = await loadDiscoveryCampaignHeads(
          context.channelId,
          context.communityId,
        );
        if (!isCurrent()) return;
        for (const campaign of localCampaigns) {
          if (!isCurrent()) return;
          let current = heads.find(
            (head) => head.record.campaignId === campaign.id,
          );
          const runnerPubkey = campaign.runBy?.pubkey || currentPubkey;
          const runBy = {
            kind:
              runnerPubkey.toLocaleLowerCase() ===
              currentPubkey.toLocaleLowerCase()
                ? ("person" as const)
                : ("agent" as const),
            pubkey: runnerPubkey,
          };
          if (!current) {
            try {
              if (!isCurrent()) return;
              await publishDiscoveryCampaignAction({
                channelId: context.channelId,
                communityId: context.communityId,
                action: buildDiscoveryCampaignCreateAction({
                  campaignId: campaign.id,
                  name: campaign.name,
                  audience: campaign.audience,
                  industryName: campaign.industryName,
                  verticalId: campaign.verticalId,
                  verticalName: campaign.verticalName,
                  pickedTags: campaign.pickedTags,
                  query: campaign.criteria || undefined,
                  area: campaign.location,
                  target: campaign.target,
                  found: campaign.count,
                  skippedDuplicates: campaign.skippedDuplicates ?? 0,
                  status: campaign.status,
                  endNote:
                    campaign.endNote ?? campaign.failureReason ?? undefined,
                  runBy,
                }),
              });
              if (!isCurrent()) return;
              continue;
            } catch (createError) {
              if (!isCurrent()) return;
              if (!isConflict(createError)) throw createError;
              heads = await loadDiscoveryCampaignHeads(
                context.channelId,
                context.communityId,
              );
              if (!isCurrent()) return;
              current = heads.find(
                (head) => head.record.campaignId === campaign.id,
              );
              if (!current) throw createError;
            }
          }
          if (current.record.archived) continue;

          if (current.record.name !== campaign.name) {
            if (!isCurrent()) return;
            await publishDiscoveryCampaignAction({
              channelId: context.channelId,
              communityId: context.communityId,
              action: buildDiscoveryCampaignMutation({
                campaignId: campaign.id,
                expectedHeadEventId: current.eventId,
                op: "rename",
                name: campaign.name,
              }),
            });
            if (!isCurrent()) return;
            heads = await loadDiscoveryCampaignHeads(
              context.channelId,
              context.communityId,
            );
            if (!isCurrent()) return;
            current = heads.find(
              (head) => head.record.campaignId === campaign.id,
            );
            if (!current) {
              throw new Error("The renamed campaign could not be reloaded.");
            }
          }

          if (isTerminal(campaign.status)) {
            if (isTerminal(current.record.status)) continue;
            if (!isCurrent()) return;
            await publishDiscoveryCampaignAction({
              channelId: context.channelId,
              communityId: context.communityId,
              action: buildDiscoveryCampaignMutation({
                campaignId: campaign.id,
                expectedHeadEventId: current.eventId,
                op: "finish",
                found: campaign.count,
                skippedDuplicates: campaign.skippedDuplicates ?? 0,
                status: campaign.status,
                endNote:
                  campaign.endNote ?? campaign.failureReason ?? undefined,
              }),
            });
            if (!isCurrent()) return;
            continue;
          }

          const shared = current.record;
          const status = campaign.status === "paused" ? "paused" : "running";
          if (
            shared.status === "complete" ||
            shared.status === "cancelled" ||
            shared.status === "failed"
          ) {
            continue;
          }
          if (
            shared.found === campaign.count &&
            shared.skippedDuplicates === (campaign.skippedDuplicates ?? 0) &&
            shared.status === status
          ) {
            continue;
          }
          if (!isCurrent()) return;
          await publishDiscoveryCampaignAction({
            channelId: context.channelId,
            communityId: context.communityId,
            action: buildDiscoveryCampaignMutation({
              campaignId: campaign.id,
              expectedHeadEventId: current.eventId,
              op: "progress",
              found: campaign.count,
              skippedDuplicates: campaign.skippedDuplicates ?? 0,
              status,
            }),
          });
          if (!isCurrent()) return;
        }
        if (!isCurrent()) return;
        await refreshRef.current();
      } catch (syncError) {
        if (isCurrent()) setError(errorMessage(syncError));
      } finally {
        inFlight.current = false;
        if (mounted.current) setPending(false);
        if (rerunAfterCurrent.current) {
          rerunAfterCurrent.current = false;
          if (mounted.current) {
            setRetryVersion((version) => version + 1);
          }
        } else if (
          signatureRef.current !== requestedSignature ||
          retryVersionRef.current !== requestedRetryVersion
        ) {
          if (mounted.current) {
            setRetryVersion((version) => version + 1);
          }
        }
      }
    })();
    return () => {
      if (generation.current === requestedGeneration) {
        generation.current += 1;
      }
    };
  }, [
    context.channelId,
    context.communityId,
    context.currentPubkey,
    context.role,
    provider,
    retryVersion,
    signature,
  ]);

  if (!error) return null;
  return (
    <div className="c3l-outreach-sync-error" role="alert">
      <span>Discovery campaigns could not be shared: {error}</span>
      <button
        disabled={pending}
        onClick={() => {
          void refreshRef
            .current()
            .catch((refreshError: unknown) => {
              setError(errorMessage(refreshError));
            })
            .finally(() => {
              setRetryVersion((version) => version + 1);
            });
        }}
        type="button"
      >
        {pending ? "Retrying…" : "Retry"}
      </button>
    </div>
  );
}
