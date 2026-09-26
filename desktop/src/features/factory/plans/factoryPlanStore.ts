import type { FactoryScope } from "@/shared/api/factoryRuntime";

export type FactoryPlanRecord = {
  id: string;
  projectId: string;
  title: string;
  outcome: string;
  acceptanceCriteria: string[];
  tasks: Array<{
    id: string;
    title: string;
    dependencies: string[];
    status: "ready" | "blocked" | "done";
  }>;
  revisions: Array<{ version: number; updatedAt: string; title: string }>;
  status: "draft" | "review" | "approved";
  updatedAt: string;
};

export const FACTORY_PLAN_STORAGE_VERSION = 1;
export const FACTORY_PLAN_CHANGE_EVENT = "colony:factory-plans-changed";

export function factoryPlanStorageKey(scope: FactoryScope) {
  const parts = [
    scope.relayUrl,
    scope.identityPubkey,
    scope.businessCommunityId,
    scope.clientChannelId ?? "",
  ];
  return `colony.factory.plans.v${FACTORY_PLAN_STORAGE_VERSION}:${parts
    .map((part) => encodeURIComponent(part))
    .join(":")}`;
}

export function loadFactoryPlans(
  storage: Pick<Storage, "getItem">,
  scope: FactoryScope,
): FactoryPlanRecord[] {
  const raw = storage.getItem(factoryPlanStorageKey(scope));
  if (raw === null) return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error("Factory plans are not stored as a list.");
  }
  return parsed as FactoryPlanRecord[];
}

export function saveFactoryPlan(
  storage: Pick<Storage, "getItem" | "setItem">,
  scope: FactoryScope,
  plan: FactoryPlanRecord,
): FactoryPlanRecord[] {
  const plans = loadFactoryPlans(storage, scope);
  const next = [plan, ...plans.filter((item) => item.id !== plan.id)];
  const storageKey = factoryPlanStorageKey(scope);
  storage.setItem(storageKey, JSON.stringify(next));
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(FACTORY_PLAN_CHANGE_EVENT, { detail: storageKey }),
    );
  }
  return next;
}

export function deleteFactoryPlan(
  storage: Pick<Storage, "getItem" | "setItem">,
  scope: FactoryScope,
  planId: string,
): FactoryPlanRecord[] {
  const plans = loadFactoryPlans(storage, scope);
  const next = plans.filter((item) => item.id !== planId);
  const storageKey = factoryPlanStorageKey(scope);
  storage.setItem(storageKey, JSON.stringify(next));
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(FACTORY_PLAN_CHANGE_EVENT, { detail: storageKey }),
    );
  }
  return next;
}
