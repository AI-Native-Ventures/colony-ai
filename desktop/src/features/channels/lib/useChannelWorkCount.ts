import { useCompanyWorkHeadsQuery } from "@/features/company-work/hooks";
import { resolveWorkTabView } from "@/features/workarea/dock/tabs/workAreaWorkModel";

/**
 * How many work items this channel's Work tab lists, for the count beside the
 * tab name. Null until the list has loaded and whenever the channel lists no
 * work (a direct message, an archived channel, a channel the person is not in).
 */
export function useChannelWorkCount(channelId: string | null): number | null {
  const heads = useCompanyWorkHeadsQuery();
  const { channelsQuery } = heads;
  if (!channelId) return null;
  const view = resolveWorkTabView({
    channelId,
    channels: {
      status: channelsQuery.status,
      error: channelsQuery.error,
      data: channelsQuery.data,
    },
    heads: { status: heads.status, error: heads.error, data: heads.data },
  });
  return view.state === "ready" ? view.records.length : null;
}
