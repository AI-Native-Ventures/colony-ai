import { useNavigate } from "@tanstack/react-router";

import { useCommunities } from "@/features/communities/useCommunities";
import {
  useCompanyFunctionHeadsQuery,
  usePublishCompanyFunctionAction,
  useCofounderSettingsQuery,
  useSetCofounderSettings,
} from "@/features/cofounder/hooks";
import {
  useBriefQuery,
  useOnboardingQuery,
  usePublishBriefAction,
  usePublishOnboardingAction,
} from "@/features/cofounder/initiativeHooks";
import {
  buildCofounderOnboardingModel,
  type CofounderBusinessBrief,
} from "@/features/cofounder/cofounderPhase2Model";
import { usePlansQuery } from "@/features/cofounder/planHooks";
import { openCapabilityGapBrowser } from "@/features/cofounder/openCapabilityGapBrowser";
import type { Channel } from "@/shared/api/types";
import type { ApprovalSwitches, MoneyPreference } from "./cofounderRecords";
import type { OnboardingMap } from "./initiativeRecords";

export function useCofounderPhase2Chat(activeChannel: Channel | null) {
  const navigate = useNavigate();
  const { activeCommunity } = useCommunities();
  const settings = useCofounderSettingsQuery(activeCommunity?.id ?? null);
  const isCofounderScoutChat =
    activeChannel?.channelType === "dm" &&
    activeChannel.name.trim().toLocaleLowerCase() === "scout" &&
    settings.data?.settings.enabled === true;
  const briefQuery = useBriefQuery(isCofounderScoutChat);
  const onboardingQuery = useOnboardingQuery(isCofounderScoutChat);
  const functionHeadsQuery = useCompanyFunctionHeadsQuery(
    isCofounderScoutChat ? (activeCommunity?.id ?? null) : null,
  );
  const briefAction = usePublishBriefAction();
  const onboardingAction = usePublishOnboardingAction();
  const functionAction = usePublishCompanyFunctionAction();
  const saveCofounderSettings = useSetCofounderSettings();
  const onboardingHead = onboardingQuery.data?.head ?? null;
  const briefHead = briefQuery.data?.head ?? null;
  const cofounderChatModel =
    onboardingHead && settings.data
      ? buildCofounderOnboardingModel({
          head: onboardingHead,
          brief: briefHead,
          companyName: activeCommunity?.name ?? "your company",
          accountChannelId: activeChannel?.id ?? "",
          moneyPreference: settings.data.settings.moneyPreference,
          approvalSwitches: settings.data.settings.approvalSwitches,
        })
      : null;
  const showCofounderChatSurface = Boolean(
    isCofounderScoutChat &&
      (onboardingQuery.isPending || onboardingQuery.isError || onboardingHead),
  );
  const cofounderPlans = usePlansQuery(isCofounderScoutChat);
  const chatPlan =
    cofounderPlans.data?.find((plan) => plan.status === "proposed") ??
    cofounderPlans.data?.[0] ??
    null;

  async function answerOnboardingQuestion(
    step: "brief" | "money" | "approvals" | "accounts",
    fields: {
      moneyPreference?: MoneyPreference;
      approvalSwitches?: ApprovalSwitches;
    } = {},
  ) {
    const current = await onboardingQuery.refetch();
    const head = current.data?.head;
    if (!head || head.question?.step !== step) {
      throw new Error(
        "Scout’s onboarding question changed. Refresh and try again.",
      );
    }
    await onboardingAction.mutateAsync({
      kind: "answer",
      step,
      ...fields,
      expectedHeadEventId: head.eventId,
    });
  }

  async function confirmBrief() {
    if (onboardingHead?.question?.step !== "brief") {
      throw new Error("There is no open brief question to answer.");
    }
    if (briefHead?.pending) {
      await briefAction.mutateAsync({
        kind: "confirm",
        expectedHeadEventId: briefHead.eventId,
      });
    } else if (!briefHead?.confirmed) {
      throw new Error("Scout has not proposed a business brief yet.");
    }
    await answerOnboardingQuestion("brief");
  }

  async function correctBrief(changes: CofounderBusinessBrief) {
    const content = {
      whatYouSell: changes.whatYouSell.trim(),
      whoBuys: changes.whoBuys.trim(),
      ...(changes.prices.trim() ? { prices: changes.prices.trim() } : {}),
      howYouTalk: changes.howYouTalk.trim(),
      sources: changes.sources,
    };
    await briefAction.mutateAsync({
      kind: "edit",
      content,
      expectedHeadEventId: briefHead?.eventId,
    });
    if (onboardingHead?.question?.step === "brief") {
      await answerOnboardingQuestion("brief");
    }
  }

  async function saveMoneyPreference(preference: MoneyPreference) {
    const current = settings.data;
    if (!current) throw new Error("Company settings are still loading.");
    await saveCofounderSettings.mutateAsync({
      settings: { ...current.settings, moneyPreference: preference },
      expectedHeadEventId: current.eventId,
    });
    await answerOnboardingQuestion("money", { moneyPreference: preference });
  }

  async function saveApprovalSwitches(switches: ApprovalSwitches) {
    const current = settings.data;
    if (!current) throw new Error("Company settings are still loading.");
    await saveCofounderSettings.mutateAsync({
      settings: { ...current.settings, approvalSwitches: switches },
      expectedHeadEventId: current.eventId,
    });
    await answerOnboardingQuestion("approvals", { approvalSwitches: switches });
  }

  async function answerAccountQuestion() {
    await answerOnboardingQuestion("accounts");
  }

  async function applyApprovedCompanyMap(map: OnboardingMap) {
    for (const entry of map.entries) {
      if (entry.placement === "empty") continue;
      const latest = await functionHeadsQuery.refetch();
      if (latest.isError) throw latest.error;
      const head = latest.data?.find(
        (candidate) => candidate.functionId === entry.function,
      );
      const alreadyApplied =
        (entry.placement === "scout" && head?.state === "covered_by_scout") ||
        (entry.placement === "existing_agent" &&
          head?.state === "filled" &&
          head.leadPubkey === entry.leadPubkey?.toLowerCase());
      if (alreadyApplied) continue;
      await functionAction.mutateAsync({
        functionId: entry.function,
        kind: entry.placement === "scout" ? "cover_by_scout" : "assign_lead",
        ...(entry.placement === "existing_agent" && entry.leadPubkey
          ? { leadPubkey: entry.leadPubkey.toLowerCase() }
          : {}),
        expectedHeadEventId: head?.eventId ?? null,
      });
      const confirmed = await functionHeadsQuery.refetch();
      if (confirmed.isError) throw confirmed.error;
      const updatedHead = confirmed.data?.find(
        (candidate) => candidate.functionId === entry.function,
      );
      const applied =
        (entry.placement === "scout" &&
          updatedHead?.state === "covered_by_scout") ||
        (entry.placement === "existing_agent" &&
          updatedHead?.state === "filled" &&
          updatedHead.leadPubkey === entry.leadPubkey?.toLowerCase());
      if (!applied) {
        throw new Error(
          `The ${entry.function.replaceAll("_", " ")} slot has not appeared in the company map yet. Try again.`,
        );
      }
    }
  }

  async function approveCompanyMap() {
    const current = await onboardingQuery.refetch();
    const head = current.data?.head;
    if (!head?.map) {
      throw new Error("There is no proposed company map to approve.");
    }
    if (!head.map.approved) {
      await onboardingAction.mutateAsync({
        kind: "approve_map",
        expectedHeadEventId: head.eventId,
      });
    }
    await applyApprovedCompanyMap(head.map);
  }

  async function rejectCompanyMap() {
    const current = await onboardingQuery.refetch();
    const head = current.data?.head;
    if (!head?.map || head.map.approved) {
      throw new Error(
        "The proposed company map changed. Refresh and try again.",
      );
    }
    await onboardingAction.mutateAsync({
      kind: "reject_map",
      expectedHeadEventId: head.eventId,
    });
    await navigate({ to: "/company/map" });
  }

  async function completeOnboarding() {
    const current = await onboardingQuery.refetch();
    const head = current.data?.head;
    if (!head?.map?.approved) {
      throw new Error("Approve the proposed company map before finishing.");
    }
    await applyApprovedCompanyMap(head.map);
    await onboardingAction.mutateAsync({
      kind: "complete",
      expectedHeadEventId: head.eventId,
    });
  }

  function openOnboardingAccount(url: string, channelId: string) {
    if (!channelId || !openCapabilityGapBrowser(url, channelId)) {
      throw new Error("The browser page could not be opened.");
    }
  }

  return {
    answerAccountQuestion,
    approveCompanyMap,
    briefQuery,
    chatPlan,
    cofounderChatModel,
    completeOnboarding,
    confirmBrief,
    correctBrief,
    isCofounderScoutChat,
    onboardingHead,
    onboardingQuery,
    openOnboardingAccount,
    plansPending: cofounderPlans.isPending,
    rejectCompanyMap,
    saveApprovalSwitches,
    saveMoneyPreference,
    showCofounderChatSurface,
  };
}
