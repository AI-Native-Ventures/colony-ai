import { invokeTauri } from "@/shared/api/tauriTransport";

export type AiPlanProvider = "claude" | "codex";

export type AiPlanUsage = {
  provider: AiPlanProvider;
  availability: "available" | "unavailable";
  usedPercent: number | null;
  resetAt: number | null;
  source:
    | "claude-code"
    | "codex-app-server"
    | "colony-token-counts"
    | "unavailable";
  observedAt: number;
  freshness: "fresh" | "stale" | "unavailable";
  confidence: "estimated" | "reported" | null;
  message: string | null;
};

export type AiPlanReservePreference = {
  enabled: boolean;
  reservedPercent: number;
};

export type AiPlanReserveAdmission = {
  state: "allowed" | "paused";
  reasonCode:
    | "no_reserve"
    | "one_off_override"
    | "reserve_crossed"
    | "reserve_off"
    | "usage_unavailable"
    | "within_reserve";
  reason: string | null;
  provider?: AiPlanProvider;
  resetAt?: number;
  overrideKey?: string;
};

export type AiPlanReserveState = {
  preference: AiPlanReservePreference;
  usage: AiPlanUsage[];
  admission: AiPlanReserveAdmission;
  revision: number;
  generation: number;
};

/** Read normalized plan usage through the credential-owning Electron main process. */
export function getAiPlanUsage(): Promise<AiPlanUsage[]> {
  return invokeTauri("get_ai_plan_usage");
}

/** Read the desktop-local reserve preference and current draft admission result. */
export function getAiPlanReserve(): Promise<AiPlanReserveState> {
  return invokeTauri("get_ai_plan_reserve");
}

/** Persist the owner-controlled desktop-local reserve preference. */
export function updateAiPlanReserve(
  preference: AiPlanReservePreference,
): Promise<AiPlanReserveState> {
  return invokeTauri("update_ai_plan_reserve", preference);
}

/** Consume the single owner override for the currently paused usage window. */
export function overrideAiPlanReserveOnce(): Promise<AiPlanReserveState> {
  return invokeTauri("override_ai_plan_reserve_once");
}
