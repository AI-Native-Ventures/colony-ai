import { Globe } from "lucide-react";
import * as React from "react";

import { useManagedAgentsQuery } from "@/features/agents/hooks";
import { openWorkArea } from "@/features/workarea/dock/workAreaStore";
import { cn } from "@/shared/lib/cn";

import {
  type BrowserActivity,
  getBrowserActivityForChannel,
  getBrowserActivityForHost,
  subscribeBrowserActivity,
} from "./agentBrowserActivity";
import { browserTabId } from "./browserTabId";
import { getBrowserPageByHost } from "./browserTabsStore";

/**
 * The small marks that say an AI employee is using the browser. Nothing here
 * moves the person's view: a mark is information, and clicking one is the
 * person's own choice to watch.
 */

const NO_ACTIVITY: readonly BrowserActivity[] = Object.freeze([]);

export function useBrowserActivity(
  channelId: string | null,
): readonly BrowserActivity[] {
  return React.useSyncExternalStore(
    subscribeBrowserActivity,
    () => (channelId ? getBrowserActivityForChannel(channelId) : NO_ACTIVITY),
    () => NO_ACTIVITY,
  );
}

export function useBrowserActivityForHost(
  hostId: string | null,
): readonly BrowserActivity[] {
  return React.useSyncExternalStore(
    subscribeBrowserActivity,
    () => getBrowserActivityForHost(hostId),
    () => NO_ACTIVITY,
  );
}

/** "Scout is using the browser", or "Scout needs you in the browser". */
export function describeBrowserActivity(
  activities: readonly BrowserActivity[],
  nameOf: (agentId: string) => string,
): string {
  if (activities.length === 0) return "";
  const asking = activities.filter((item) => item.state === "needs-you");
  const group = asking.length > 0 ? asking : activities;
  const names = [...new Set(group.map((item) => nameOf(item.agentId)))];
  const who =
    names.length <= 2
      ? names.join(" and ")
      : `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
  if (asking.length > 0)
    return `${who} ${names.length > 1 ? "need" : "needs"} you in the browser`;
  return `${who} ${names.length > 1 ? "are" : "is"} using the browser`;
}

/** The label for a set of activities, with each agent's own name. */
export function useBrowserActivityLabel(
  activities: readonly BrowserActivity[],
): string {
  const agents = useManagedAgentsQuery({ enabled: activities.length > 0 });
  return describeBrowserActivity(activities, (agentId) => {
    const name = agents.data?.find((agent) => agent.pubkey === agentId)?.name;
    return name ? name.slice(0, 40) : "An AI employee";
  });
}

/** Open the dock on the newest page the agent is using. The person asked to view. */
export function watchBrowserActivity(
  channelId: string,
  activities: readonly BrowserActivity[],
) {
  const newest = activities[0];
  const hostIds = newest?.hostIds ?? [];
  const hostId = hostIds[hostIds.length - 1];
  const page = hostId ? getBrowserPageByHost(hostId) : null;
  if (page && page.channelId === channelId)
    openWorkArea(channelId, "browser", browserTabId(page.key));
  else openWorkArea(channelId);
}

export function watchLatestBrowserActivity(channelId: string) {
  watchBrowserActivity(channelId, getBrowserActivityForChannel(channelId));
}

/** The channel header's button: the way to watch an agent that is working. */
export function ChannelBrowserActivityButton({
  channelId,
}: {
  channelId: string;
}) {
  const activities = useBrowserActivity(channelId);
  if (activities.length === 0) return null;
  return (
    <ChannelBrowserActivityButtonBody
      activities={activities}
      channelId={channelId}
    />
  );
}

function ChannelBrowserActivityButtonBody({
  channelId,
  activities,
}: {
  channelId: string;
  activities: readonly BrowserActivity[];
}) {
  const label = useBrowserActivityLabel(activities);
  const asking = activities.some((item) => item.state === "needs-you");
  return (
    <button
      aria-label={`${label}. View`}
      className="c3c-icon-button relative"
      data-state={asking ? "needs-you" : "working"}
      data-testid="channel-browser-activity"
      onClick={() => watchBrowserActivity(channelId, activities)}
      title={`${label}. Click to view`}
      type="button"
    >
      <Globe aria-hidden="true" className="size-[18px]" strokeWidth={2.2} />
      <span
        aria-hidden="true"
        className={cn(
          "absolute right-1.5 top-1.5 size-2 rounded-full ring-2 ring-background",
          asking ? "bg-amber-500" : "bg-emerald-500 motion-safe:animate-pulse",
        )}
      />
    </button>
  );
}

/** The sidebar's mark beside a channel whose agents are using the browser. */
export function ChannelBrowserBadge({
  channelId,
  channelName,
  isActive,
}: {
  channelId: string;
  channelName: string;
  isActive: boolean;
}) {
  const activities = useBrowserActivity(channelId);
  if (activities.length === 0) return null;
  return (
    <ChannelBrowserBadgeBody
      activities={activities}
      channelName={channelName}
      isActive={isActive}
    />
  );
}

function ChannelBrowserBadgeBody({
  activities,
  channelName,
  isActive,
}: {
  activities: readonly BrowserActivity[];
  channelName: string;
  isActive: boolean;
}) {
  const label = useBrowserActivityLabel(activities);
  const asking = activities.some((item) => item.state === "needs-you");
  return (
    <span
      aria-label={label}
      className={cn(
        "ml-auto inline-flex shrink-0 items-center group-data-[collapsible=icon]:hidden",
        asking ? "text-amber-500" : "motion-safe:animate-pulse",
        !asking &&
          (isActive ? "text-sidebar-active-foreground" : "text-primary"),
      )}
      data-state={asking ? "needs-you" : "working"}
      data-testid={`channel-browser-${channelName}`}
      role="img"
      title={`${label}. Click this conversation to view`}
    >
      <Globe aria-hidden="true" className="size-3.5" strokeWidth={2.4} />
    </span>
  );
}
