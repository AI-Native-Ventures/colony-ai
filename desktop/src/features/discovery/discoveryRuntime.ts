/**
 * Production wiring for the real discovery runner: resolves the Sales channel
 * and the signed-in person, searches through the community's relay, saves
 * prospects as business records and posts the results in the Sales channel.
 * The state machine itself is `realDiscoveryProvider.ts`.
 */

import {
  loadActiveCommunityId,
  loadCommunities,
} from "@/features/communities/communityStorage";
import type { Community } from "@/features/communities/types";
import { getChannels } from "@/shared/api/tauriChannels";
import { getIdentity } from "@/shared/api/tauriIdentity";
import { sendChannelMessage } from "@/shared/api/tauriMessages";
import { getProfile } from "@/shared/api/tauriProfiles";
import { buildLeadLink } from "@/shared/lib/entityLink";

import { publishProspectAction } from "./businessRecordMutations";
import {
  loadBusinessRecords,
  resolveBusinessChannel,
} from "./businessRecordRelay";
import { browserStorage, storageKey } from "./discoveryCampaignStore";
import { leadNameKey, placeProspectId } from "./discoveryMapping";
import type { DiscoveryCampaignProvider } from "./discoveryProvider";
import { registerDiscoveryRuntime } from "./discoveryRuntimeRegistry";
import { searchPlaces } from "./outscraperSearchClient";
import {
  createDiscoveryController,
  NO_SALES_CHANNEL_ERROR,
  type DiscoveryContext,
  type DiscoveryController,
  type DiscoveryDeps,
} from "./realDiscoveryProvider";

const GUEST_ERROR =
  "Only members of this business can find prospects. Ask an owner or admin for access.";

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("The search was stopped.", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("The search was stopped.", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function resolveContext(community: Community): Promise<DiscoveryContext> {
  const identity = await getIdentity();
  const { channels } = await getChannels(null);
  const channelId = await resolveBusinessChannel(channels ?? []);
  if (!channelId) throw new Error(NO_SALES_CHANNEL_ERROR);
  const records = await loadBusinessRecords(channelId, identity.pubkey);
  if (records.role === "guest" || records.role === null) {
    throw new Error(GUEST_ERROR);
  }
  let displayName = identity.displayName.trim();
  try {
    const profile = await getProfile();
    displayName = profile.displayName?.trim() || displayName;
  } catch {
    // The name only labels the run ("Run by ..."); the identity's own name is
    // a complete fallback, so a profile read failing loses nothing.
  }
  return {
    channelId,
    communityId: community.id,
    pubkey: identity.pubkey,
    displayName: displayName || "You",
    existingProspectIds: new Set(
      records.prospects.map((row) => row.record.prospectId),
    ),
    existingNames: new Set(
      records.prospects.map((row) =>
        leadNameKey(row.record.prospect.party.displayName),
      ),
    ),
  };
}

function productionDeps(community: Community): DiscoveryDeps {
  return {
    storage: browserStorage(),
    storageKey: storageKey(community.id),
    nowSeconds: () => Math.floor(Date.now() / 1_000),
    newId: () => crypto.randomUUID(),
    sleep: abortableSleep,
    getOwnerPubkey: async () => (await getIdentity()).pubkey,
    resolveContext: () => resolveContext(community),
    search: (request, signal) =>
      searchPlaces({ relayUrl: community.relayUrl, request, signal }),
    prospectId: placeProspectId,
    publishProspect: async ({ context, changes }) => {
      await publishProspectAction({
        channelId: context.channelId,
        communityId: context.communityId,
        current: null,
        changes,
      });
    },
    postToSales: async ({ context, content }) => {
      await sendChannelMessage(
        context.channelId,
        content,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        // The post must go out as this person, in this community, or not at all.
        community.relayUrl,
        context.pubkey,
      );
    },
    leadLink: buildLeadLink,
  };
}

let active: { communityId: string; controller: DiscoveryController } | null =
  null;

/**
 * The runner for the active community, created on first use. Null when no
 * community is active yet.
 */
export function getRealDiscoveryProvider(): DiscoveryCampaignProvider | null {
  const communityId = loadActiveCommunityId();
  if (!communityId) return null;
  if (active?.communityId === communityId) return active.controller;
  const community = loadCommunities().find((entry) => entry.id === communityId);
  if (!community) return null;
  active?.controller.dispose();
  const controller = createDiscoveryController(productionDeps(community));
  active = { communityId, controller };
  registerDiscoveryRuntime(() => {
    controller.dispose();
    if (active?.controller === controller) active = null;
  });
  return controller;
}
