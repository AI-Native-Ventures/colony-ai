import { getRelayHttpUrl, invokeTauri } from "@/shared/api/tauri";
import { readCredits, type CreditSnapshot } from "./accountPayments";
import { getGlobalAgentConfig } from "@/shared/api/tauriGlobalAgentConfig";
import type { GlobalAgentConfig } from "@/shared/api/types";

export type CreditsGatewayState =
  | { configured: false }
  | { configured: true; credits: CreditSnapshot };

const dependencies = {
  enabled: () => invokeTauri<boolean>("colony_credits_gateway_enabled"),
  relay: getRelayHttpUrl,
  fetch: (input: RequestInfo | URL, init?: RequestInit) =>
    globalThis.fetch(input, init),
  credits: readCredits,
};

/** Confirm both relay services before reading account data or offering a paid test. */
export async function readCreditsGateway(
  deps = dependencies,
): Promise<CreditsGatewayState> {
  if (!(await deps.enabled())) return { configured: false };
  const base = (await deps.relay()).replace(/\/+$/, "");
  const read = async (path: string) => {
    const response = await deps.fetch(`${base}/api/${path}`, {
      signal: AbortSignal.timeout(15_000),
      redirect: "error",
    });
    // Older relays do not have the gateway route. Other failures remain retryable.
    if (response.status === 404) return null;
    if (!response.ok)
      throw new Error("Colony credits could not be checked. Try again.");
    return response.json();
  };
  const gateway = await read("credits-gateway/capabilities");
  if (
    gateway?.enabled !== true ||
    gateway.runtime !== "colony" ||
    typeof gateway.model !== "string" ||
    !gateway.model.trim()
  )
    return { configured: false };
  const checkout = await read("payments/packs");
  if (checkout?.enabled !== true || checkout.provider !== "stripe")
    return { configured: false };
  const credits = await deps.credits();
  if ((await deps.relay()).replace(/\/+$/, "") !== base)
    throw new Error("Your business changed. Check Colony credits again.");
  // Recheck the authenticated snapshot so a changed checkout configuration cannot opt in.
  if (credits.enabled !== true || credits.provider !== "stripe")
    return { configured: false };
  if (!Number.isFinite(credits.balanceUsdCents) || credits.balanceUsdCents < 0)
    throw new Error("Your balance could not be checked. Try again.");
  for (const link of [
    credits.policyUrls?.terms,
    credits.policyUrls?.acceptableUse,
  ]) {
    const url = new URL(link);
    if (url.protocol !== "https:" || url.username || url.password)
      throw new Error("Credit terms are unavailable. Try again later.");
  }
  return { configured: true, credits };
}

/** Store the connection choice only. Session authority and model stay native/relay-owned. */
export function colonyCreditsCandidate(
  config: GlobalAgentConfig,
): GlobalAgentConfig {
  return {
    ...config,
    preferred_runtime: "buzz-agent",
    provider: "colony-credits",
    model: null,
  };
}

/** Recheck service and funds at selection, then pass a keyless in-memory candidate to proof. */
export async function connectColonyCredits(
  prove: (candidate: GlobalAgentConfig) => Promise<void>,
  isCurrent: () => boolean,
  deps = { gateway: readCreditsGateway, config: getGlobalAgentConfig },
) {
  const current = await deps.gateway();
  if (!isCurrent()) return;
  if (!current.configured)
    throw new Error(
      "Colony credits are not configured. Choose another connection or try again later.",
    );
  if (current.credits.balanceUsdCents <= 0)
    throw new Error("Out of credits. Buy credits, then try again.");
  const config = await deps.config();
  if (!isCurrent()) return;
  await prove(colonyCreditsCandidate(config));
}
