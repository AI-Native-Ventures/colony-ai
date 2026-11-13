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
import { useNeedsYouSummary } from "@/features/cofounder/needsYouSummary";
import {
  useMoneyRailsActions,
  useMoneyRailsSnapshot,
} from "@/features/cofounder/moneyRailsBridge";
import { numbersActions } from "@/features/cofounder/numbersActions";
import { useNumbersAction } from "@/features/cofounder/numbersHooks";
import {
  playbookActions,
  playbookJobActions,
} from "@/features/cofounder/playbookActions";
import {
  usePlaybookAction,
  usePlaybookJobAction,
} from "@/features/cofounder/playbookHooks";
import { useWhatsAppCommand } from "@/features/whatsapp-outreach/whatsappOutreachQueries";
import { openWorkArea } from "@/features/workarea/dock/workAreaStore";
import { clearMoneyLinkTaskContext } from "@/features/workarea/browser/agentBrowserAccess";
import { planActions } from "@/features/cofounder/planActions";
import { usePlanAction, usePlansQuery } from "@/features/cofounder/planHooks";
import { openCapabilityGapBrowser } from "@/features/cofounder/openCapabilityGapBrowser";
import { KIND_WHATSAPP_BATCH_DECISION } from "@/shared/constants/kinds";

import { CofounderAccessScreen } from "./CofounderAccessScreen";
import { CofounderNeedsYouScreen } from "./CofounderNeedsYouScreen";
import type { NeedsYouRowDecision } from "./CofounderNeedsYouScreen";
import type { NeedsYouRow } from "./needsYou/needsYouRows";
import {
  buildNeedsYouRows,
  describeNeedsYouAction,
} from "./needsYou/needsYouRows";
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
  const summary = useNeedsYouSummary();
  const moneyRails = useMoneyRailsSnapshot();
  const planAction = usePlanAction();
  const accessAction = usePublishAccessAction();
  const playbookAction = usePlaybookAction();
  const playbookJobAction = usePlaybookJobAction();
  const numbersAction = useNumbersAction();
  const moneyAction = useMoneyRailsActions();
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
  const rows = useMemo(
    () =>
      buildNeedsYouRows({
        model: needsYouQuery.model,
        paymentLinks: moneyRails.paymentLinks,
        capabilityGaps,
        capabilityGapHeads: companyAccessQuery.data?.gaps ?? [],
        whatsappContacts: needsYouQuery.whatsappContacts,
        whatsappDrafts: needsYouQuery.whatsappDrafts,
      }),
    [
      capabilityGaps,
      companyAccessQuery.data?.gaps,
      moneyRails.paymentLinks,
      needsYouQuery.model,
      needsYouQuery.whatsappContacts,
      needsYouQuery.whatsappDrafts,
    ],
  );
  const { goAskDetail, goChannel } = useAppNavigation();

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

  async function openWhatsAppChat(contactWaId: string) {
    const channelId = needsYouQuery.whatsappOutreachChannelId;
    if (!channelId) throw new Error("WhatsApp chats are not available yet.");
    await goChannel(channelId);
    openWorkArea(channelId, "whatsapp", "whatsapp", { contactWaId });
  }

  async function openNeedsYouRow(row: NeedsYouRow) {
    if (row.kind === "draft") {
      const contactWaId = row.draft?.waId ?? row.contact?.waId;
      if (!contactWaId) throw new Error("This reply is no longer available.");
      await openWhatsAppChat(contactWaId);
      return;
    }
    if (row.kind === "call_request") {
      await openWhatsAppChat(row.contact.waId);
      return;
    }
    if (row.kind === "payment_link") {
      await navigate({
        to: "/clients/record/$partyId",
        params: { partyId: row.card.customerPartyId },
      });
      return;
    }
    if (row.kind === "capability_gap") {
      if (row.item.group === "do" && row.item.pageUrl) {
        await openBrowser(row.item.pageUrl);
        return;
      }
      await navigate({ to: "/company/access" });
      return;
    }
    const { item } = row;
    switch (item.source.kind) {
      case "ask":
        await goAskDetail(item.source.channelId, item.source.askId);
        return;
      case "whatsapp_batch":
        await navigate({
          to: "/whatsapp/batches/$batchId",
          params: { batchId: item.source.batchId },
        });
        return;
      case "review_decision":
        await navigate({ to: "/company/weekly-review" });
        return;
      case "playbook":
      case "playbook_job":
        await navigate({
          to: "/company/function/$function",
          params: { function: "operations" },
        });
        return;
      case "plan":
      case "goal":
        if (item.functionId) {
          await navigate({
            to: "/company/function/$function",
            params: { function: item.functionId },
          });
        } else {
          await navigate({ to: "/company/map" });
        }
        return;
      case "whatsapp_drafts":
        throw new Error("This reply is no longer available.");
    }
  }

  async function applyNeedsYouAction(
    row: NeedsYouRow,
    decision: NeedsYouRowDecision,
  ) {
    const command = describeNeedsYouAction(row, decision);
    if (!command) throw new Error("This action is not available.");
    switch (command.kind) {
      case "open":
        await openNeedsYouRow(command.row);
        return;
      case "payment_link":
        await moneyAction.execute({
          type: command.decision,
          linkId: command.card.id,
          headEventId: command.card.headEventId,
          card: command.card,
          ...(command.decision === "reject"
            ? { reason: "Rejected by the owner." }
            : {}),
        });
        if (command.decision === "reject") {
          clearMoneyLinkTaskContext(command.card.id);
        }
        return;
      case "capability_gap":
        if (command.operation === "open_page") {
          if (!command.item.pageUrl) {
            throw new Error("This page is no longer available.");
          }
          await openBrowser(command.item.pageUrl);
          return;
        }
        await accessAction.mutateAsync({
          op: command.operation,
          gapId: command.item.gapId,
          expectedHeadEventId: command.item.headEventId,
        });
        if (command.operation === "gap_approve" && command.item.pageUrl) {
          await openBrowser(command.item.pageUrl);
        }
        return;
      case "whatsapp_batch":
        await whatsappCommand(KIND_WHATSAPP_BATCH_DECISION, {
          v: 1,
          batchId: command.batchId,
          decision: command.decision,
          dropRows: [],
          editRows: [],
        });
        return;
      case "whatsapp_draft":
        await whatsappCommand(KIND_WHATSAPP_BATCH_DECISION, {
          v: 1,
          draftId: command.draftId,
          decision: command.decision,
        });
        return;
      case "plan": {
        const plan = plans.find(
          (candidate) => candidate.planId === command.planId,
        );
        if (!plan) throw new Error("This plan changed. Refresh and try again.");
        const input = command.stepId
          ? command.operation === "done"
            ? planActions.markDone(plan, command.stepId)
            : command.operation === "approve"
              ? planActions.approveStep(plan, command.stepId)
              : planActions.rejectStep(plan, command.stepId)
          : command.operation === "approve"
            ? planActions.approve(plan)
            : planActions.reject(plan);
        await planAction.mutateAsync(input);
        return;
      }
      case "playbook": {
        const playbook = needsYouQuery.livePlaybooks.find(
          (candidate) => candidate.playbookId === command.playbookId,
        );
        if (!playbook) {
          throw new Error("This playbook changed. Refresh and try again.");
        }
        await playbookAction.mutateAsync(
          command.decision === "approve"
            ? playbookActions.approve(playbook)
            : playbookActions.reject(playbook),
        );
        return;
      }
      case "playbook_job": {
        const job = needsYouQuery.livePlaybookJobs.find(
          (candidate) => candidate.jobId === command.jobId,
        );
        if (!job) throw new Error("This work changed. Refresh and try again.");
        const input =
          command.operation === "done"
            ? playbookJobActions.markDone(job, command.stepId)
            : command.operation === "approve"
              ? playbookJobActions.approveStep(job, command.stepId)
              : playbookJobActions.rejectStep(job, command.stepId);
        await playbookJobAction.mutateAsync(input);
        return;
      }
      case "goal": {
        const goal = needsYouQuery.liveGoals.find(
          (candidate) => candidate.goalId === command.goalId,
        );
        if (!goal) throw new Error("This goal changed. Refresh and try again.");
        await numbersAction.mutateAsync(
          command.decision === "approve"
            ? numbersActions.approveGoal(goal)
            : numbersActions.rejectGoal(goal),
        );
        return;
      }
      case "review_decision": {
        const review = needsYouQuery.liveReviews.find(
          (candidate) => candidate.reviewDate === command.reviewDate,
        );
        if (!review) {
          throw new Error("This review changed. Refresh and try again.");
        }
        await numbersAction.mutateAsync(
          numbersActions.decide(review, command.decisionId, command.decision),
        );
        return;
      }
    }
  }

  return (
    <CofounderModeGate>
      {needsYouQuery.isPending ||
      plansQuery.isPending ||
      companyAccessQuery.isPending ||
      needsYouQuery.whatsappSummaryIsPending ||
      summary.isPending ? (
        <Phase2Unavailable />
      ) : needsYouQuery.error ||
        plansQuery.error ||
        companyAccessQuery.error ? (
        <div className="cf2-page" role="alert">
          Needs you could not be loaded. Try again.
        </div>
      ) : (
        <CofounderNeedsYouScreen
          rows={rows}
          sharedTotal={summary.data?.total ?? rows.length}
          statusMessage={
            needsYouQuery.whatsappError
              ? "Some WhatsApp items could not be loaded. Refresh to try again."
              : moneyRails.availability === "error"
                ? "Payment approvals could not be loaded. Refresh to try again."
                : null
          }
          onAction={applyNeedsYouAction}
          onOpenRow={openNeedsYouRow}
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
