import { useEffect, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useCommunities } from "@/features/communities/useCommunities";
import { useCofounderSettingsQuery } from "@/features/cofounder/hooks";
import { useNeedsYouQuery } from "@/features/cofounder/needsYouHooks";
import type {
  NeedsYouActionId,
  NeedsYouItem,
} from "@/features/cofounder/needsYou";
import { planActions } from "@/features/cofounder/planActions";
import { usePlanAction, usePlansQuery } from "@/features/cofounder/planHooks";
import { openCapabilityGapBrowser } from "@/features/cofounder/openCapabilityGapBrowser";
import { useCofounderPhase2Fixture } from "@/features/cofounder/useCofounderPhase2Fixture";

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

const EMPTY_NEEDS_YOU_FIXTURE = {
  plans: [],
  approvals: [],
  doItems: [],
  decisions: [],
};

export function CofounderNeedsYouRoute() {
  const phase2 = useCofounderPhase2Fixture();
  const { activeCommunity } = useCommunities();
  const settings = useCofounderSettingsQuery(activeCommunity?.id ?? null);
  const plansQuery = usePlansQuery(settings.data?.settings.enabled === true);
  const needsYouQuery = useNeedsYouQuery();
  const planAction = usePlanAction();
  const model = phase2.model?.needsYou ?? EMPTY_NEEDS_YOU_FIXTURE;
  const plans = plansQuery.data ?? [];
  const { goChannel } = useAppNavigation();

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

  async function openBrowser(url: string, channelId: string) {
    await goChannel(channelId);
    openCapabilityGapBrowser(url, channelId);
  }

  return (
    <CofounderModeGate>
      {needsYouQuery.isPending || plansQuery.isPending ? (
        <Phase2Unavailable />
      ) : needsYouQuery.error || plansQuery.error ? (
        <div className="cf2-page" role="alert">
          Needs you could not be loaded. Try again.
        </div>
      ) : (
        <CofounderNeedsYouScreen
          liveNeedsYou={needsYouQuery.model}
          livePlans={plans}
          model={model}
          onPlanStepAction={applyPlanStepAction}
          onAction={phase2.resolveNeedsYouAction}
          onEditDraft={phase2.editReplyDraft}
          onOpenBrowser={openBrowser}
          onPlanApprove={(planId) => phase2.resolvePlan(planId, "approved")}
          onPlanEdit={phase2.editPlan}
          onPlanReject={(planId) => phase2.resolvePlan(planId, "rejected")}
        />
      )}
    </CofounderModeGate>
  );
}

export function CofounderAccessRoute() {
  const phase2 = useCofounderPhase2Fixture();
  const model = phase2.model;
  const { goChannel } = useAppNavigation();

  return (
    <CofounderModeGate>
      {model ? (
        <CofounderAccessScreen
          model={model.access}
          onApproveRequest={async (request) => {
            await goChannel(request.browserChannelId);
            if (
              openCapabilityGapBrowser(
                request.browserUrl,
                request.browserChannelId,
              )
            ) {
              phase2.clearPendingAccessRequest(request);
            }
          }}
          onDeclineRequest={phase2.declineAccessRequest}
          onRevoke={phase2.revokeAccess}
        />
      ) : (
        <Phase2Unavailable />
      )}
    </CofounderModeGate>
  );
}
