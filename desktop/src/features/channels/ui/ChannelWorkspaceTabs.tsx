import { useChannelWorkCount } from "@/features/channels/lib/useChannelWorkCount";
import { requestWorkAreaTab } from "@/features/workarea/dock/workAreaRequests";
import { showWorkspaceFiles } from "@/features/workarea/workspaceFiles";
import { cn } from "@/shared/lib/cn";

const TAB_CLASS =
  "c3c-tab flex h-[calc(42*var(--colony-px))] items-center gap-1.5 border-b-[2.5px] border-transparent px-3.5 text-colony-fg-secondary transition-colors hover:text-colony-fg focus-visible:outline-2 focus-visible:outline-ring";

/** The channel's views, as in the Colony 3.0 header: Discussion is this screen. */
export function ChannelWorkspaceTabs({
  channelId = null,
}: {
  channelId?: string | null;
}) {
  const workCount = useChannelWorkCount(channelId);
  return (
    <nav
      aria-label="Channel views"
      className="flex gap-1 overflow-x-auto"
      data-testid="channel-view-tabs"
    >
      <span
        aria-current="page"
        className={cn(
          TAB_CLASS,
          "border-colony-fg text-colony-fg",
          "cursor-default",
        )}
      >
        Discussion
      </span>
      <button
        className={TAB_CLASS}
        data-testid="channel-view-tab-work"
        onClick={() => requestWorkAreaTab("work")}
        type="button"
      >
        Work
        {workCount ? (
          <span
            className="c3c-tab-count text-colony-accent-ink"
            data-testid="channel-view-tab-work-count"
          >
            {workCount}
          </span>
        ) : null}
      </button>
      <button
        className={TAB_CLASS}
        data-testid="channel-view-tab-knowledge"
        onClick={() => requestWorkAreaTab("knowledge")}
        type="button"
      >
        Knowledge
      </button>
      <button
        className={TAB_CLASS}
        data-testid="channel-view-tab-canvas"
        onClick={() => requestWorkAreaTab("canvas")}
        type="button"
      >
        Canvas
      </button>
      <button
        className={TAB_CLASS}
        data-testid="channel-view-tab-files"
        onClick={showWorkspaceFiles}
        type="button"
      >
        Files
      </button>
    </nav>
  );
}
