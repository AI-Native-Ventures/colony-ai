import { loadCommunities } from "@/features/communities/communityStorage";
import type { GlobalAgentConfig } from "@/shared/api/types";
import type { OnboardingConnectionProof } from "./ui/onboardingConnectionTest";

export type WelcomeBusinessContext = {
  name: string;
  website: string;
  description: string;
};
export type VerifiedWelcomeConnection = {
  reply: string;
  runtimeId: string;
  fingerprint: string;
  completedAt: number;
};
const TTL_MS = 15 * 60_000;
const key = (communityId: string) =>
  `colony-welcome-connection.v1:${communityId}`;

async function fingerprint(config: GlobalAgentConfig) {
  const data = JSON.stringify({
    runtime: config.preferred_runtime,
    model: config.model?.trim() || null,
    provider: config.provider?.trim() || null,
    env: Object.entries(config.env_vars)
      .filter(([, value]) => value !== "")
      .sort(([a], [b]) => a.localeCompare(b)),
  });
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(data),
  );
  return Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}
/** Persist the real reply for one business. Credentials are hashed, never stored here. */
export async function saveVerifiedWelcomeConnection(
  communityId: string,
  config: GlobalAgentConfig,
  proof: OnboardingConnectionProof,
) {
  if (
    !config.preferred_runtime ||
    !proof.reply.trim() ||
    new TextEncoder().encode(proof.reply).length > 8192
  )
    throw new Error(
      "The verified reply could not be saved. Retry the connection.",
    );
  const receipt: VerifiedWelcomeConnection = {
    runtimeId: config.preferred_runtime,
    reply: proof.reply,
    fingerprint: await fingerprint(config),
    completedAt: Date.now(),
  };
  localStorage.setItem(key(communityId), JSON.stringify(receipt));
}
/** Read only recent evidence for this business and the exact tested configuration. */
export async function readVerifiedWelcomeConnection(
  communityId: string | undefined,
  config: GlobalAgentConfig,
): Promise<VerifiedWelcomeConnection | null> {
  if (!communityId) return null;
  const raw = localStorage.getItem(key(communityId));
  if (!raw || raw.length > 12_000) return null;
  let receipt: VerifiedWelcomeConnection;
  try {
    receipt = JSON.parse(raw);
  } catch {
    return null;
  }
  if (
    !receipt ||
    typeof receipt !== "object" ||
    typeof receipt.reply !== "string" ||
    !receipt.reply.trim() ||
    new TextEncoder().encode(receipt.reply).length > 8192 ||
    typeof receipt.completedAt !== "number" ||
    !Number.isFinite(receipt.completedAt) ||
    typeof receipt.runtimeId !== "string" ||
    receipt.runtimeId !== config.preferred_runtime ||
    Date.now() < receipt.completedAt ||
    Date.now() - receipt.completedAt >= TTL_MS ||
    receipt.fingerprint !== (await fingerprint(config))
  )
    return null;
  return receipt;
}
/** How long a tested route on this Mac stays good evidence for a new workspace. */
export const DEVICE_VERIFIED_TTL_MS = 30 * 24 * 60 * 60_000;
const KEY_PREFIX = "colony-welcome-connection.v1:";

/**
 * The runtime this Mac already proved with a real reply in ANY workspace, for
 * the exact saved configuration. The reply is business text, so it is never
 * returned: a new workspace may only learn that the route works. Evidence
 * lasts longer than one business's handoff because the route belongs to the
 * computer, not to the workspace (a second workspace has no receipt of its
 * own). Changing the runtime, model, provider or credentials drops it.
 */
export async function readDeviceVerifiedRuntime(
  config: GlobalAgentConfig,
  now = Date.now(),
): Promise<string | null> {
  if (!config.preferred_runtime || typeof localStorage === "undefined")
    return null;
  let keys: string[] = [];
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const name = localStorage.key(index);
      if (name?.startsWith(KEY_PREFIX)) keys.push(name);
    }
  } catch {
    return null;
  }
  keys = keys.slice(0, 64);
  const current = await fingerprint(config);
  for (const name of keys) {
    const raw = localStorage.getItem(name);
    if (!raw || raw.length > 12_000) continue;
    try {
      const receipt = JSON.parse(raw) as Partial<VerifiedWelcomeConnection>;
      if (
        typeof receipt.completedAt === "number" &&
        Number.isFinite(receipt.completedAt) &&
        receipt.runtimeId === config.preferred_runtime &&
        receipt.fingerprint === current &&
        now >= receipt.completedAt &&
        now - receipt.completedAt < DEVICE_VERIFIED_TTL_MS
      )
        return receipt.runtimeId;
    } catch {
      // A broken receipt is simply not evidence.
    }
  }
  return null;
}
/** Community-scoped standing context, read by both starter seeding and kickoff. */
export function readWelcomeBusinessContext(
  relayUrl?: string | null,
): WelcomeBusinessContext | null {
  if (!relayUrl || typeof localStorage === "undefined") return null;
  const normalize = (url: string) =>
    url.trim().replace(/\/$/, "").toLowerCase();
  const community = loadCommunities().find(
    (entry) => normalize(entry.relayUrl) === normalize(relayUrl),
  );
  if (!community?.businessCommunityId) return null;
  const raw = localStorage.getItem(
    `colony-business-profile.v1:${community.businessCommunityId}`,
  );
  if (!raw || raw.length > 12_000) return null;
  try {
    const profile = JSON.parse(raw);
    if (
      ![profile.name, profile.website, profile.description].every(
        (value) => typeof value === "string",
      )
    )
      return null;
    return {
      name: profile.name,
      website: profile.website,
      description: profile.description,
    };
  } catch {
    return null;
  }
}
