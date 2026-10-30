import { useCallback, useState } from "react";

import type {
  CofounderAccessModel,
  CofounderAccessRequest,
  CofounderNeedsYouModel,
  CofounderOnboardingModel,
  CofounderPhase2Fixture,
} from "./cofounderPhase2Model";
import type { ApprovalSwitches, MoneyPreference } from "./cofounderRecords";

type Phase2E2eWindow = Window & {
  __BUZZ_E2E__?: {
    mock?: {
      cofounderPhase2?: CofounderPhase2Fixture;
    };
  };
};

function readFixture(): CofounderPhase2Fixture | null {
  if (import.meta.env.MODE !== "e2e" || typeof window === "undefined") {
    return null;
  }
  const fixture = (window as Phase2E2eWindow).__BUZZ_E2E__?.mock
    ?.cofounderPhase2;
  return fixture ? structuredClone(fixture) : null;
}

function updatePlan(
  model: CofounderPhase2Fixture,
  planId: string,
  changes: { title?: string; status?: "approved" | "rejected" },
): CofounderPhase2Fixture {
  const mapPlan = (plan: CofounderPhase2Fixture["chatPlan"]) =>
    plan.id === planId ? { ...plan, ...changes } : plan;
  return {
    ...model,
    chatPlan: mapPlan(model.chatPlan),
    needsYou: {
      ...model.needsYou,
      plans: model.needsYou.plans
        .map(mapPlan)
        .filter((plan) => plan.status === "proposed"),
    },
  };
}

export function useCofounderPhase2Fixture() {
  const [model, setModel] = useState<CofounderPhase2Fixture | null>(
    readFixture,
  );
  const update = useCallback(
    (change: (current: CofounderPhase2Fixture) => CofounderPhase2Fixture) => {
      setModel((current) => (current ? change(current) : current));
    },
    [],
  );

  const confirmBrief = useCallback(() => {
    update((current) => ({
      ...current,
      onboarding: { ...current.onboarding, step: "money" },
    }));
  }, [update]);

  const correctBrief = useCallback(
    (brief: CofounderOnboardingModel["brief"]) => {
      update((current) => ({
        ...current,
        onboarding: {
          ...current.onboarding,
          brief,
          step: "money",
        },
      }));
    },
    [update],
  );

  const chooseMoney = useCallback(
    (moneyPreference: MoneyPreference) => {
      update((current) => ({
        ...current,
        onboarding: {
          ...current.onboarding,
          moneyPreference,
          step: "approvals",
        },
      }));
    },
    [update],
  );

  const saveApprovalSwitches = useCallback(
    (approvalSwitches: ApprovalSwitches) => {
      update((current) => ({
        ...current,
        onboarding: {
          ...current.onboarding,
          approvalSwitches,
          step: "account",
        },
      }));
    },
    [update],
  );

  const accountConnected = useCallback(() => {
    update((current) => ({
      ...current,
      onboarding: {
        ...current.onboarding,
        accountConnected: true,
        step: "map",
      },
    }));
  }, [update]);

  const approveMap = useCallback(() => {
    update((current) => ({
      ...current,
      onboarding: { ...current.onboarding, step: "complete" },
    }));
  }, [update]);

  const resolvePlan = useCallback(
    (planId: string, status: "approved" | "rejected") => {
      update((current) => updatePlan(current, planId, { status }));
    },
    [update],
  );

  const editPlan = useCallback(
    (planId: string, changes: { title: string }) => {
      update((current) => updatePlan(current, planId, changes));
    },
    [update],
  );

  const resolveNeedsYouAction = useCallback(
    (itemId: string, action: string) => {
      update((current) => {
        const separator = itemId.indexOf(":");
        const parentId = separator === -1 ? itemId : itemId.slice(0, separator);
        const selectedOption =
          separator === -1 ? null : itemId.slice(separator + 1);
        const resolvesItem = [
          "approve",
          "reject",
          "approve_recommended",
        ].includes(action);
        const approvals = current.needsYou.approvals.flatMap((item) => {
          if (
            item.kind === "reply_drafts" &&
            (action === "send" || action === "discard") &&
            item.drafts.some((draft) => draft.id === itemId)
          ) {
            const drafts = item.drafts.filter((draft) => draft.id !== itemId);
            return drafts.length > 0 ? [{ ...item, drafts }] : [];
          }
          if (
            item.kind === "taste" &&
            item.id === parentId &&
            action === "approve" &&
            selectedOption
          ) {
            return [{ ...item, recommendedOption: selectedOption }];
          }
          if (
            item.kind === "taste" &&
            item.id === itemId &&
            action === "ask_for_changes"
          ) {
            return [
              {
                ...item,
                summary: "You asked Scout for a different direction.",
              },
            ];
          }
          if (item.id === itemId && resolvesItem) return [];
          return [item];
        });
        const needsYou: CofounderNeedsYouModel = {
          ...current.needsYou,
          approvals,
          doItems:
            action === "done"
              ? current.needsYou.doItems.filter((item) => item.id !== itemId)
              : current.needsYou.doItems,
          decisions:
            action === "accept" || action === "decline"
              ? current.needsYou.decisions.filter((item) => item.id !== itemId)
              : current.needsYou.decisions,
        };
        return { ...current, needsYou };
      });
    },
    [update],
  );

  const editReplyDraft = useCallback(
    (draftId: string, message: string) => {
      update((current) => ({
        ...current,
        needsYou: {
          ...current.needsYou,
          approvals: current.needsYou.approvals.map((item) =>
            item.kind === "reply_drafts"
              ? {
                  ...item,
                  drafts: item.drafts.map((draft) =>
                    draft.id === draftId ? { ...draft, message } : draft,
                  ),
                }
              : item,
          ),
        },
      }));
    },
    [update],
  );

  const revokeAccess = useCallback(
    (entryId: string) => {
      update((current) => ({
        ...current,
        access: {
          ...current.access,
          entries: current.access.entries.filter(
            (entry) => entry.id !== entryId,
          ),
        },
      }));
    },
    [update],
  );

  const declineAccessRequest = useCallback(
    (requestId: string) => {
      update((current) => ({
        ...current,
        access: withoutPendingRequest(current.access, requestId),
      }));
    },
    [update],
  );

  const clearPendingAccessRequest = useCallback(
    (request: CofounderAccessRequest) => {
      update((current) => ({
        ...current,
        access: withoutPendingRequest(current.access, request.id),
      }));
    },
    [update],
  );

  return {
    model,
    confirmBrief,
    correctBrief,
    chooseMoney,
    saveApprovalSwitches,
    accountConnected,
    approveMap,
    resolvePlan,
    editPlan,
    resolveNeedsYouAction,
    editReplyDraft,
    revokeAccess,
    declineAccessRequest,
    clearPendingAccessRequest,
  };
}

function withoutPendingRequest(
  access: CofounderAccessModel,
  requestId: string,
): CofounderAccessModel {
  return access.pendingRequest?.id === requestId
    ? { ...access, pendingRequest: null }
    : access;
}
