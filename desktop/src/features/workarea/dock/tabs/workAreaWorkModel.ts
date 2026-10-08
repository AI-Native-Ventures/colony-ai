import type {
  CompanyWorkHeadRecord,
  CompanyWorkStatus,
} from "@/features/company-work/companyWorkModels";

import {
  type GateChannel,
  type QueryProgress,
  resolveChannelGate,
} from "./workAreaChannelGate";

/**
 * What the Work tab shows for one channel. One pure function decides it, so
 * every state is a table row in the unit test instead of a branch in a
 * component.
 *
 * `denied` is the channel gate (see `workAreaChannelGate.ts`). The Company
 * Work reader lists work only for the member stream channels it is given.
 */
export type WorkTabView =
  | { state: "loading" }
  | { state: "failed"; error: unknown }
  | { state: "denied" }
  /** Work is not read for this kind of conversation (direct message, forum, archived). */
  | { state: "unlisted"; reason: "not-a-channel" | "archived" }
  | { state: "empty" }
  | { state: "ready"; records: CompanyWorkHeadRecord[] };

export type WorkTabChannel = GateChannel;

export type WorkTabInput = {
  channelId: string;
  channels: QueryProgress & { data: readonly WorkTabChannel[] | undefined };
  heads: QueryProgress & {
    data: readonly CompanyWorkHeadRecord[] | undefined;
  };
};

/** Open work first, finished work after, archived last. */
const STATUS_ORDER: Record<CompanyWorkStatus, number> = {
  active: 0,
  blocked: 1,
  paused: 2,
  done_unverified: 3,
  done_verified: 4,
  archived: 5,
};

export function sortChannelWork(
  records: readonly CompanyWorkHeadRecord[],
): CompanyWorkHeadRecord[] {
  return [...records].sort(
    (left, right) =>
      STATUS_ORDER[left.head.status] - STATUS_ORDER[right.head.status] ||
      left.head.title.localeCompare(right.head.title) ||
      left.head.workItemId.localeCompare(right.head.workItemId),
  );
}

export function resolveWorkTabView({
  channelId,
  channels,
  heads,
}: WorkTabInput): WorkTabView {
  const gate = resolveChannelGate(channelId, channels);
  if (gate.state !== "open") return gate;
  const { channel } = gate;
  if (channel.channelType !== "stream") {
    return { state: "unlisted", reason: "not-a-channel" };
  }
  if (channel.archivedAt !== null) {
    return { state: "unlisted", reason: "archived" };
  }

  if (heads.status === "error") return { state: "failed", error: heads.error };
  if (heads.status === "pending") return { state: "loading" };

  const id = channelId.toLowerCase();
  const records = sortChannelWork(
    (heads.data ?? []).filter(
      (record) => record.channelId.toLowerCase() === id,
    ),
  );
  return records.length === 0
    ? { state: "empty" }
    : { state: "ready", records };
}
