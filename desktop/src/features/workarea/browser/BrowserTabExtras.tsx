import { Lock, LockOpen } from "lucide-react";
import * as React from "react";

import {
  useBrowserActivityForHost,
  useBrowserActivityLabel,
} from "./BrowserActivity";
import type { BrowserActivity } from "./agentBrowserActivity";
import { browserPageKeyOf } from "./browserTabId";
import {
  getBrowserPage,
  setBrowserPagePrivate,
  subscribeBrowserTabs,
} from "./browserTabsStore";

/**
 * What a browser page adds to its tab in the dock's tab strip: a dot while an
 * AI employee is using the page, and the one-click "Keep private" switch. AI
 * employees of the business can use every tab the person opens, unless the
 * person keeps it private here.
 */
export function BrowserTabExtras({
  tabId,
  selected,
}: {
  channelId: string;
  tabId: string;
  selected: boolean;
}) {
  const pageKey = browserPageKeyOf(tabId);
  const page = React.useSyncExternalStore(
    subscribeBrowserTabs,
    () => getBrowserPage(pageKey),
    () => null,
  );
  const activities = useBrowserActivityForHost(page?.hostId ?? null);
  if (!page) return null;
  return (
    <>
      {activities.length > 0 ? <AgentDot activities={activities} /> : null}
      <button
        aria-label={
          page.private
            ? "Private tab. Share it with AI employees"
            : "Keep private from AI employees"
        }
        aria-pressed={page.private}
        className="colony-work-area-tab-private"
        data-private={page.private ? "true" : "false"}
        data-testid={`browser-keep-private-${pageKey}`}
        tabIndex={selected ? 0 : -1}
        onClick={() => setBrowserPagePrivate(pageKey, !page.private)}
        title={
          page.private
            ? "Private: AI employees cannot see this tab. Click to share it."
            : "AI employees in this business can use this tab. Click to keep it private."
        }
        type="button"
      >
        {page.private ? (
          <Lock aria-hidden="true" strokeWidth={2.4} />
        ) : (
          <LockOpen aria-hidden="true" strokeWidth={2.4} />
        )}
      </button>
    </>
  );
}

function AgentDot({ activities }: { activities: readonly BrowserActivity[] }) {
  const label = useBrowserActivityLabel(activities);
  const asking = activities.some((item) => item.state === "needs-you");
  return (
    <span
      aria-label={label}
      className="colony-work-area-tab-agent"
      data-state={asking ? "needs-you" : "working"}
      data-testid="browser-tab-agent-mark"
      role="img"
      title={label}
    />
  );
}
