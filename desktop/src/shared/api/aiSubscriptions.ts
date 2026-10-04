import { invokeTauri } from "@/shared/api/tauriTransport";

export type AiSubscription = {
  id: "claude" | "codex";
  signedIn: boolean | null;
  plan: string | null;
  source: "live" | "cached" | "unavailable";
  windows: Array<{
    label: string;
    remainingPercent: number;
    resetsAt: number | null;
  }>;
  message: string | null;
  observedAt?: number;
};

/** Read subscription data through the trusted Electron main process. */
export function getAiSubscriptions(): Promise<AiSubscription[]> {
  return invokeTauri("get_ai_subscriptions");
}

/** Ask for explicit permission before reading Claude's protected sign-in. */
export function checkClaudeSubscription(): Promise<AiSubscription> {
  return invokeTauri("check_claude_subscription");
}
