/**
 * Resolve-or-create for the private Sales channel that holds a business's
 * records (prospects, leads, proposals). Discovery and Leads both need it; an
 * owner or admin should never have to create it by hand.
 *
 * This file is pure: every effect arrives through `SalesChannelDeps`, so the
 * production wiring (`salesChannelRuntime.ts`) and the unit tests drive the
 * same code.
 */

import type { Channel } from "@/shared/api/types";

export const SALES_CHANNEL_NAME = "Sales";
export const SALES_CHANNEL_DESCRIPTION =
  "Prospects, leads and sales updates for the business.";

export const SALES_NOT_ALLOWED_MESSAGE =
  "The private Sales channel is not set up yet. An owner or admin of this business sets it up by opening Leads once. Ask one of them, then retry.";

const SETTLE_ATTEMPTS = 8;
const SETTLE_DELAY_MS = 300;

/** A failure with words the person can read; the screen shows it with Retry. */
export class SalesChannelSetupError extends Error {
  constructor(reason: string) {
    super(`Could not set up the private Sales channel: ${reason}`);
    this.name = "SalesChannelSetupError";
  }
}

export type SalesChannelOutcome =
  /** `created` is the new channel when this call made it, else null. */
  | { status: "ready"; channelId: string; created: Channel | null }
  /** The person may not create channels here; someone else has to. */
  | { status: "not-allowed" };

export type SalesChannelDeps = {
  /** A fresh channel list from the relay (not a cached snapshot). */
  listChannels: () => Promise<Channel[]>;
  /** The Sales channel id in a list: null when missing, throws on two. */
  resolve: (channels: Channel[]) => Promise<string | null>;
  /** Every private Sales stream the person can see in a list. */
  salesStreams: (channels: Channel[]) => Channel[];
  canCreate: () => Promise<boolean>;
  create: () => Promise<Channel>;
  /** Adds the business's AI employees; idempotent. Throws on failure. */
  addEmployees: (channelId: string) => Promise<void>;
  archive: (channelId: string) => Promise<void>;
  /** Channels still owed their AI employees; survives a restart. */
  pendingEmployees: {
    has: (channelId: string) => boolean;
    add: (channelId: string) => void;
    remove: (channelId: string) => void;
  };
  /** Runs `run` alone across every window of this app on this machine. */
  exclusive: <T>(run: () => Promise<T>) => Promise<T>;
  sleep: (ms: number) => Promise<void>;
  warn: (message: string, error: unknown) => void;
};

export function plainReason(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  if (typeof error === "string" && error.trim()) return error.trim();
  return "The relay did not accept the request. Retry when the connection is available.";
}

/**
 * Tries to give the channel its AI employees. A failure here must not block
 * Leads or Discovery (the channel itself works), so it leaves a durable
 * "owed" record and the next call retries it.
 */
async function syncEmployees(
  deps: SalesChannelDeps,
  channelId: string,
): Promise<void> {
  if (!deps.pendingEmployees.has(channelId)) return;
  try {
    await deps.addEmployees(channelId);
    deps.pendingEmployees.remove(channelId);
  } catch (error) {
    deps.warn("Could not add AI employees to the Sales channel yet", error);
  }
}

async function ready(
  deps: SalesChannelDeps,
  channelId: string,
  created: Channel | null,
): Promise<SalesChannelOutcome> {
  await syncEmployees(deps, channelId);
  return { status: "ready", channelId, created };
}

async function waitUntilListed(
  deps: SalesChannelDeps,
  channelId: string,
): Promise<Channel[] | null> {
  for (let attempt = 0; attempt < SETTLE_ATTEMPTS; attempt += 1) {
    try {
      const channels = await deps.listChannels();
      if (channels.some((channel) => channel.id === channelId)) {
        return channels;
      }
    } catch (error) {
      deps.warn("Could not confirm the new Sales channel yet", error);
    }
    await deps.sleep(SETTLE_DELAY_MS);
  }
  return null;
}

/**
 * Two devices of one person can create at the same moment, which the lock
 * cannot see. Every device picks the same winner (the lowest id), and the
 * loser archives its own empty channel, so exactly one Sales channel stays.
 */
async function settleDuplicates(
  deps: SalesChannelDeps,
  created: Channel,
  listed: Channel[],
): Promise<string> {
  const streams = deps.salesStreams(listed);
  const winner = streams.reduce<Channel | null>(
    (best, channel) => (best === null || channel.id < best.id ? channel : best),
    null,
  );
  if (!winner || winner.id === created.id) return created.id;
  // The channel is ours and empty, so giving it up loses nothing. If the
  // archive fails the error propagates: Retry would otherwise hit two Sales.
  await deps.archive(created.id);
  deps.pendingEmployees.remove(created.id);
  return winner.id;
}

/**
 * The Sales channel id for this business, creating the channel first when the
 * person may and it is missing. Idempotent: re-resolves after creating and
 * re-resolves again under the lock, so it never makes a second "Sales".
 */
export async function ensureSalesChannel(
  deps: SalesChannelDeps,
  channels: Channel[],
): Promise<SalesChannelOutcome> {
  const known = await deps.resolve(channels);
  if (known) return ready(deps, known, null);

  if (!(await deps.canCreate())) return { status: "not-allowed" };

  return deps.exclusive(async () => {
    // Another window or device may have made it while this one waited.
    const existing = await deps.resolve(await deps.listChannels());
    if (existing) return ready(deps, existing, null);

    let created: Channel;
    try {
      created = await deps.create();
    } catch (error) {
      // A timed-out create can still have landed on the relay.
      const landed = await deps
        .listChannels()
        .then((list) => deps.resolve(list))
        .catch(() => null);
      if (landed) {
        deps.pendingEmployees.add(landed);
        return ready(deps, landed, null);
      }
      throw new SalesChannelSetupError(plainReason(error));
    }

    // Written before anything else can fail, so the employees are never lost.
    deps.pendingEmployees.add(created.id);
    const listed = await waitUntilListed(deps, created.id);
    const channelId = listed
      ? await settleDuplicates(deps, created, listed)
      : created.id;
    return ready(deps, channelId, channelId === created.id ? created : null);
  });
}
