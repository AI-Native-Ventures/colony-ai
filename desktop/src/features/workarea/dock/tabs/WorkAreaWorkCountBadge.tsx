import { useCompanyWorkHeadsQuery } from "@/features/company-work/hooks";

import { resolveWorkTabView } from "./workAreaWorkModel";

/**
 * Open work in one channel: everything its Work tab lists that is not yet
 * finished and verified. Read from the same query as the tab, so the number
 * and the list always agree.
 */
export function useChannelOpenWorkCount(channelId: string): number | null {
  const heads = useCompanyWorkHeadsQuery();
  const { channelsQuery } = heads;
  const view = resolveWorkTabView({
    channelId,
    channels: {
      status: channelsQuery.status,
      error: channelsQuery.error,
      data: channelsQuery.data,
    },
    heads: { status: heads.status, error: heads.error, data: heads.data },
  });
  if (view.state !== "ready") return null;
  return view.records.filter(
    (record) =>
      record.head.status !== "done_verified" &&
      record.head.status !== "archived",
  ).length;
}

/** The small number after "Work" on the dock's tab. Nothing when no work is open. */
export function WorkAreaWorkCountBadge({
  channelId,
  id,
}: {
  channelId: string;
  id?: string;
}) {
  const count = useChannelOpenWorkCount(channelId);
  if (!count) return null;
  return (
    <span
      className="colony-work-area-tab-count"
      data-testid="work-area-work-count"
      id={id}
    >
      {count}
    </span>
  );
}
