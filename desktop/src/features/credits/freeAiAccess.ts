import {
  getRelayHttpUrl,
  invokeTauri,
  signRelayEvent,
} from "@/shared/api/tauri";

/**
 * Whether this signed-in account may use the Colony Agent through the relay
 * gateway without credits. Only "free" lets onboarding pick it automatically.
 *
 * - off: this build or this relay has no gateway (older relay, flag off, 404).
 * - unreachable: the relay could not be asked. Same outcome as off, kept apart
 *   so a caller can tell a missing feature from a network problem.
 * - not-free: the gateway is on but this account is not on the free list.
 */
export type FreeAiAccess = "free" | "not-free" | "off" | "unreachable";

const dependencies = {
  enabled: () => invokeTauri<boolean>("colony_credits_gateway_enabled"),
  relay: getRelayHttpUrl,
  fetch: (input: RequestInfo | URL, init?: RequestInit) =>
    globalThis.fetch(input, init),
  sign: signRelayEvent,
  nonce: () => crypto.randomUUID(),
};

/** Ask the relay about this account. Never throws: every failure is an answer. */
export async function readFreeAiAccess(
  deps: typeof dependencies = dependencies,
): Promise<FreeAiAccess> {
  try {
    if (!(await deps.enabled())) return "off";
    const base = (await deps.relay()).replace(/\/+$/, "");
    const capabilities = await deps.fetch(
      `${base}/api/credits-gateway/capabilities`,
      { signal: AbortSignal.timeout(8_000), redirect: "error" },
    );
    // Older relays do not have the gateway route at all.
    if (capabilities.status === 404) return "off";
    if (!capabilities.ok) return "unreachable";
    const gateway = await capabilities.json();
    if (
      gateway?.enabled !== true ||
      gateway.runtime !== "colony" ||
      typeof gateway.model !== "string" ||
      !gateway.model.trim()
    )
      return "off";
    // No free account configured: skip the signed call entirely.
    if (gateway.freeAiConfigured !== true) return "not-free";
    const url = `${base}/api/credits-gateway/access`;
    const event = await deps.sign({
      kind: 27235,
      content: "",
      tags: [
        ["u", url],
        ["method", "GET"],
        ["nonce", deps.nonce()],
      ],
    });
    const access = await deps.fetch(url, {
      headers: { Authorization: `Nostr ${btoa(JSON.stringify(event))}` },
      signal: AbortSignal.timeout(8_000),
      redirect: "error",
    });
    if (!access.ok) return "unreachable";
    return (await access.json())?.freeAi === true ? "free" : "not-free";
  } catch {
    return "unreachable";
  }
}
