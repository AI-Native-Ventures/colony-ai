/**
 * Production wiring for `ensureSalesChannel`: the relay's channel list, the
 * same create path the sidebar "+" uses, the business's owners, admins and the
 * AI employees this Mac runs, and a lock shared by every window of the app.
 * The logic lives in `salesChannel.ts`.
 */

import { fetchCompanyTeam } from "@/features/company-team/teamRelay";
import type { Community } from "@/features/communities/types";
import {
  getMyRelayMembershipLookup,
  listRelayMembers,
} from "@/shared/api/relayMembers";
import { addChannelMembers } from "@/shared/api/tauri";
import {
  archiveChannel,
  createChannel,
  getChannels,
} from "@/shared/api/tauriChannels";
import { getIdentity } from "@/shared/api/tauriIdentity";
import type { Channel } from "@/shared/api/types";

import { resolveBusinessChannel, salesStreamsOf } from "./businessRecordRelay";
import { pickSalesChannelPeople } from "./salesChannelPeople";
import {
  ensureSalesChannel,
  SALES_CHANNEL_DESCRIPTION,
  SALES_CHANNEL_NAME,
  type SalesChannelDeps,
  type SalesChannelOutcome,
} from "./salesChannel";

const PENDING_KEY_PREFIX = "colony.salesChannel.membersOwed.";

function readPending(communityId: string): string[] {
  try {
    const raw = window.localStorage.getItem(PENDING_KEY_PREFIX + communityId);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === "string")
      : [];
  } catch {
    return [];
  }
}

function writePending(communityId: string, ids: string[]): void {
  try {
    window.localStorage.setItem(
      PENDING_KEY_PREFIX + communityId,
      JSON.stringify(ids),
    );
  } catch {
    // Storage can be blocked. Whoever is missing is then added on a later
    // setup or by hand from the channel's member list.
  }
}

/**
 * One setup at a time per community across every window of the app (the Web
 * Lock queues callers inside one window as well). Without Web Locks the call
 * runs directly and the post-create duplicate check is the only guard.
 */
function exclusiveFor(communityId: string): SalesChannelDeps["exclusive"] {
  const name = `colony-sales-channel:${communityId}`;
  return (run) =>
    typeof navigator !== "undefined" && navigator.locks
      ? navigator.locks.request(name, { mode: "exclusive" }, run)
      : run();
}

function productionDeps(community: Community): SalesChannelDeps {
  return {
    listChannels: async () => (await getChannels(null)).channels ?? [],
    resolve: resolveBusinessChannel,
    salesStreams: salesStreamsOf,
    canCreate: async () => {
      const { membership } = await getMyRelayMembershipLookup();
      // No membership record means the relay does not track roles; let the
      // relay decide, and show its reason if it refuses.
      return !membership || ["owner", "admin"].includes(membership.role);
    },
    create: () =>
      createChannel({
        name: SALES_CHANNEL_NAME,
        description: SALES_CHANNEL_DESCRIPTION,
        channelType: "stream",
        visibility: "private",
      }),
    listPeople: async () => {
      const [{ pubkey: self }, team, relayMembers] = await Promise.all([
        getIdentity(),
        fetchCompanyTeam(community.relayUrl),
        listRelayMembers(),
      ]);
      return pickSalesChannelPeople({
        selfPubkey: self,
        relayMembers,
        teamMembers: team.members,
      });
    },
    addMembers: async (channelId, role, pubkeys) => {
      const result = await addChannelMembers({
        channelId,
        pubkeys,
        role,
        expectedRelayUrl: community.relayUrl,
      });
      const failed = result.errors.find(
        ({ error }) => !error.toLowerCase().includes("already"),
      );
      if (failed) throw new Error(failed.error);
    },
    archive: archiveChannel,
    pendingMembers: {
      has: (channelId) => readPending(community.id).includes(channelId),
      add: (channelId) => {
        const ids = readPending(community.id);
        if (!ids.includes(channelId)) {
          writePending(community.id, [...ids, channelId]);
        }
      },
      remove: (channelId) => {
        const ids = readPending(community.id);
        if (ids.includes(channelId)) {
          writePending(
            community.id,
            ids.filter((id) => id !== channelId),
          );
        }
      },
    },
    exclusive: exclusiveFor(community.id),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    warn: (message, error) => console.warn(message, error),
  };
}

/**
 * The Sales channel for the business behind `community`, created for an owner
 * or admin when it is missing. `channels` is the caller's current list; a
 * second window or device that creates it first is found, not duplicated.
 */
export function ensureBusinessChannel(input: {
  community: Community;
  channels: Channel[];
}): Promise<SalesChannelOutcome> {
  return ensureSalesChannel(productionDeps(input.community), input.channels);
}
