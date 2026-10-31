import { useEffect, useMemo, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useCommunities } from "@/features/communities/useCommunities";
import { useChannelsQuery } from "@/features/channels/hooks";
import {
  useCompanyAccessQuery,
  usePublishAccessAction,
} from "@/features/cofounder/accessHooks";
import {
  buildAccessRows,
  buildGapNeedsYouItems,
} from "@/features/cofounder/accessRecords";
import type { GapNeedsYouItem } from "@/features/cofounder/accessRecords";
import { useCofounderSettingsQuery } from "@/features/cofounder/hooks";
import { useNeedsYouQuery } from "@/features/cofounder/needsYouHooks";
import type {
  NeedsYouActionId,
  NeedsYouItem,
} from "@/features/cofounder/needsYou";
import { useWhatsAppCommand } from "@/features/whatsapp-outreach/whatsappOutreachQueries";
import { planActions } from "@/features/cofounder/planActions";
import { usePlanAction, usePlansQuery } from "@/features/cofounder/planHooks";
import { openCapabilityGapBrowser } from "@/features/cofounder/openCapabilityGapBrowser";
import { KIND_WHATSAPP_BATCH_DECISION } from "@/shared/constants/kinds";

import { CofounderAccessScreen } from "./CofounderAccessScreen";
import { CofounderNeedsYouScreen } from "./CofounderNeedsYouScreen";
import "./cofounderPhase2.css";

function CofounderModeGate({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { activeCommunity } = useCommunities();
  const settingsQuery = useCofounderSettingsQuery(activeCommunity?.id ?? null);
  const enabled = settingsQuery.data?.settings.enabled === true;

  useEffect(() => {
    if (settingsQuery.data && !settingsQuery.data.settings.enabled) {
      void navigate({ to: "/today", replace: true });
    }
  }, [navigate, settingsQuery.data]);

  if (settingsQuery.isError) {
    return (
      <div className="cf2-page" role="alert">
        Co-founder mode could not be verified. Try again.
      </div>
    );
  }
  if (!enabled) return null;
  return children;
}

function Phase2Unavailable() {
  return (
    <p
      className="cf2-empty-note"
      data-testid="cofounder-phase2-loading"
      role="status"
    >
      Loading co-founder work…
    </p>
  );
}

export function CofounderNeedsYouRoute() {
  const navigate = useNavigate();
  const { activeCommunity } = useCommunities();
  const settings = useCofounderSettingsQuery(activeCommunity?.id ?? null);
  const cofounderOn = settings.data?.settings.enabled === true;
  const communityId = cofounderOn ? (activeCommunity?.id ?? null) : null;
  const plansQuery = usePlansQuery(cofounderOn);
  const needsYouQuery = useNeedsYouQuery();
  const companyAccessQuery = useCompanyAccessQuery(communityId);
  const planAction = usePlanAction();
  const accessAction = usePublishAccessAction();
  const whatsappCommand = useWhatsAppCommand();
  const channelsQuery = useChannelsQuery({ enabled: cofounderOn });
  const scoutChannel = channelsQuery.data?.find(
    (channel) =>
      channel.channelType === "dm" &&
      channel.name.trim().toLocaleLowerCase() === "scout",
  );
  const capabilityGaps = useMemo(
    () => buildGapNeedsYouItems(companyAccessQuery.data?.gaps ?? []),
    [companyAccessQuery.data],
  );
  const plans = plansQuery.data ?? [];
  const { goAskDetail, goChannel } = useAppNavigation();

  async function applyPlanStepAction(
    item: NeedsYouItem,
    action: NeedsYouActionId,
  ) {
    if (item.source.kind !== "plan" || !item.source.stepId) return;
    const source = item.source;
    const stepId = source.stepId;
    if (!stepId) return;
    const plan = plans.find((candidate) => candidate.planId === source.planId);
    if (!plan) throw new Error("This plan changed. Refresh and try again.");
    const input =
      action === "approve"
        ? planActions.approveStep(plan, stepId)
        : action === "reject"
          ? planActions.rejectStep(plan, stepId)
          : action === "done"
            ? planActions.markDone(plan, stepId)
            : null;
    if (!input) return;
    await planAction.mutateAsync(input);
  }

  async function applyCapabilityGapAction(
    item: GapNeedsYouItem,
    op: "gap_approve" | "gap_decline" | "gap_done",
  ) {
    await accessAction.mutateAsync({
      op,
      gapId: item.gapId,
      expectedHeadEventId: item.headEventId,
    });
  }

  async function openBrowser(url: string, channelId?: string) {
    const refreshedChannels = channelId ? null : await channelsQuery.refetch();
    const targetChannel =
      scoutChannel ??
      refreshedChannels?.data?.find(
        (channel) =>
          channel.channelType === "dm" &&
          channel.name.trim().toLocaleLowerCase() === "scout",
      );
    const targetChannelId = channelId ?? targetChannel?.id;
    if (!targetChannelId) {
      throw new Error("Scout's channel is not available yet.");
    }
    await goChannel(targetChannelId);
    if (!openCapabilityGapBrowser(url, targetChannelId)) {
      throw new Error("The browser page could not be opened.");
    }
  }

  async function openNeedsYouItem(item: NeedsYouItem) {
    if (item.source.kind === "ask") {
      await goAskDetail(item.source.channelId, item.source.askId);
      return;
    }
    if (item.source.kind === "whatsapp_batch") {
      await navigate({
        to: "/whatsapp/batches/$batchId",
        params: { batchId: item.source.batchId },
      });
      return;
    }
    throw new Error("This item is no longer available. Refresh and try again.");
  }

  async function applyWhatsAppDraftAction(
    draftId: string,
    decision: "approve" | "reject",
    text?: string,
  ) {
    await whatsappCommand(KIND_WHATSAPP_BATCH_DECISION, {
      v: 1,
      draftId,
      decision,
      ...(text ? { text } : {}),
    });
  }

  return (
    <CofounderModeGate>
      {needsYouQuery.isPending ||
      plansQuery.isPending ||
      companyAccessQuery.isPending ? (
        <Phase2Unavailable />
      ) : needsYouQuery.error ||
        plansQuery.error ||
        companyAccessQuery.error ? (
        <div className="cf2-page" role="alert">
          Needs you could not be loaded. Try again.
        </div>
      ) : (
        <CofounderNeedsYouScreen
          liveNeedsYou={needsYouQuery.model}
          livePlans={plans}
          liveCapabilityGaps={capabilityGaps}
          whatsappError={needsYouQuery.whatsappError}
          onPlanStepAction={applyPlanStepAction}
          onCapabilityGapAction={applyCapabilityGapAction}
          onOpenItem={openNeedsYouItem}
          onWhatsAppDraftAction={applyWhatsAppDraftAction}
          onOpenCapabilityGapBrowser={(url) => openBrowser(url)}
        />
      )}
    </CofounderModeGate>
  );
}

export function CofounderAccessRoute() {
  const { activeCommunity } = useCommunities();
  const settings = useCofounderSettingsQuery(activeCommunity?.id ?? null);
  const cofounderOn = settings.data?.settings.enabled === true;
  const communityId = cofounderOn ? (activeCommunity?.id ?? null) : null;
  const accessQuery = useCompanyAccessQuery(communityId);
  const accessAction = usePublishAccessAction();
  const channelsQuery = useChannelsQuery({ enabled: cofounderOn });
  const scoutChannel = channelsQuery.data?.find(
    (channel) =>
      channel.channelType === "dm" &&
      channel.name.trim().toLocaleLowerCase() === "scout",
  );
  const entries = useMemo(
    () => buildAccessRows(accessQuery.data?.access ?? []),
    [accessQuery.data],
  );
  const pendingGaps = useMemo(
    () =>
      buildGapNeedsYouItems(accessQuery.data?.gaps ?? []).filter(
        (item) => item.group === "approve",
      ),
    [accessQuery.data],
  );
  const { goChannel } = useAppNavigation();

  async function openGapBrowser(item: GapNeedsYouItem) {
    if (!item.pageUrl) return;
    const refreshedChannels = scoutChannel
      ? null
      : await channelsQuery.refetch();
    const targetChannel =
      scoutChannel ??
      refreshedChannels?.data?.find(
        (channel) =>
          channel.channelType === "dm" &&
          channel.name.trim().toLocaleLowerCase() === "scout",
      );
    if (!targetChannel) {
      throw new Error("Scout's channel is not available yet.");
    }
    await goChannel(targetChannel.id);
    if (!openCapabilityGapBrowser(item.pageUrl, targetChannel.id)) {
      throw new Error("The browser page could not be opened.");
    }
  }

  async function applyGapAction(
    item: GapNeedsYouItem,
    op: "gap_approve" | "gap_decline",
  ) {
    await accessAction.mutateAsync({
      op,
      gapId: item.gapId,
      expectedHeadEventId: item.headEventId,
    });
    if (op === "gap_approve") await openGapBrowser(item);
  }

  return (
    <CofounderModeGate>
      {accessQuery.isPending ? (
        <Phase2Unavailable />
      ) : accessQuery.error ? (
        <div className="cf2-page" role="alert">
          Access could not be loaded. Try again.
        </div>
      ) : (
        <CofounderAccessScreen
          entries={entries}
          onApproveGap={(item) => applyGapAction(item, "gap_approve")}
          onDeclineGap={(item) => applyGapAction(item, "gap_decline")}
          onRevoke={async (entry) => {
            await accessAction.mutateAsync({
              op: "revoke",
              accessId: entry.accessId,
              expectedHeadEventId: entry.headEventId,
            });
          }}
          pendingGaps={pendingGaps}
        />
      )}
    </CofounderModeGate>
  );
}
