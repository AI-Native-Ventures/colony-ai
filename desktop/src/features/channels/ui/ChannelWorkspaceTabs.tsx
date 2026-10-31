import { requestWorkAreaTab } from "@/features/workarea/dock/workAreaRequests";
import { showWorkspaceFiles } from "@/features/workarea/workspaceFiles";
import {
  useWhatsAppContactsQuery,
  useWhatsAppDraftsQuery,
  useWhatsAppPendingBatchDetailsQuery,
} from "@/features/whatsapp-outreach/whatsappOutreachQueries";
import { getWhatsAppNeedsYouItems } from "@/features/whatsapp-outreach/whatsappOutreachStages";
import { cn } from "@/shared/lib/cn";

const TAB_CLASS =
  "c3c-tab flex h-[calc(42*var(--colony-px))] items-center gap-1.5 border-b-[2.5px] border-transparent px-3.5 text-colony-fg-secondary transition-colors hover:text-colony-fg focus-visible:outline-2 focus-visible:outline-ring";

/** The channel's views, as in the Colony 3.0 header: Discussion is this screen. */
export type OutreachDeskTab =
  | "needs-you"
  | "pipeline"
  | "chats"
  | "discussion"
  | "knowledge"
  | "canvas"
  | "files";

type ChannelWorkspaceTabsProps = {
  isOutreach?: boolean;
  outreachTab?: OutreachDeskTab;
  onOutreachTabChange?: (tab: OutreachDeskTab) => void;
};

export function ChannelWorkspaceTabs({
  isOutreach = false,
  outreachTab = "discussion",
  onOutreachTabChange,
}: ChannelWorkspaceTabsProps) {
  const contactsQuery = useWhatsAppContactsQuery(isOutreach);
  const draftsQuery = useWhatsAppDraftsQuery(isOutreach);
  const batchesQuery = useWhatsAppPendingBatchDetailsQuery(isOutreach);
  const needsYouCount =
    getWhatsAppNeedsYouItems(contactsQuery.data ?? [], draftsQuery.data ?? [])
      .length + (batchesQuery.data?.length ?? 0);
  const chatsNeedingReplyCount = new Set([
    ...(contactsQuery.data ?? [])
      .filter((contact) => contact.unanswered)
      .map((contact) => contact.waId),
    ...(draftsQuery.data ?? []).map((draft) => draft.waId),
  ]).size;
  const current = (tab: OutreachDeskTab) => outreachTab === tab;
  const select = (tab: OutreachDeskTab) => onOutreachTabChange?.(tab);

  if (isOutreach) {
    return (
      <nav
        aria-label="Channel views"
        className="flex gap-1 overflow-x-auto"
        data-testid="channel-view-tabs"
      >
        <button
          aria-current={current("needs-you") ? "page" : undefined}
          aria-label={`Needs you, ${needsYouCount} items need attention`}
          className={cn(
            TAB_CLASS,
            current("needs-you") && "border-colony-fg text-colony-fg",
          )}
          data-testid="channel-view-tab-needs-you"
          onClick={() => select("needs-you")}
          type="button"
        >
          Needs you
          <span
            aria-hidden="true"
            className="ml-0.5 rounded-full bg-colony-need-bg px-1.5 py-0.5 text-2xs font-bold text-colony-need"
            data-testid="outreach-needs-you-count"
          >
            {needsYouCount}
          </span>
        </button>
        <OutreachTab
          label="Pipeline"
          onClick={() => select("pipeline")}
          selected={current("pipeline")}
          testId="pipeline"
        />
        <OutreachTab
          ariaLabel={`Chats, ${chatsNeedingReplyCount} chats need a reply`}
          badge={chatsNeedingReplyCount}
          label="Chats"
          onClick={() => select("chats")}
          selected={current("chats")}
          testId="chats"
        />
        <OutreachTab
          label="Discussion"
          onClick={() => select("discussion")}
          selected={current("discussion")}
          testId="discussion"
        />
        <button
          className={TAB_CLASS}
          data-testid="channel-view-tab-knowledge"
          onClick={() => {
            select("discussion");
            requestWorkAreaTab("knowledge");
          }}
          type="button"
        >
          Knowledge
        </button>
        <button
          className={TAB_CLASS}
          data-testid="channel-view-tab-canvas"
          onClick={() => {
            select("discussion");
            requestWorkAreaTab("canvas");
          }}
          type="button"
        >
          Canvas
        </button>
        <button
          className={TAB_CLASS}
          data-testid="channel-view-tab-files"
          onClick={() => {
            select("discussion");
            showWorkspaceFiles();
          }}
          type="button"
        >
          Files
        </button>
      </nav>
    );
  }

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

function OutreachTab({
  ariaLabel,
  badge,
  label,
  onClick,
  selected,
  testId,
}: {
  ariaLabel?: string;
  badge?: number;
  label: string;
  onClick: () => void;
  selected: boolean;
  testId: string;
}) {
  return (
    <button
      aria-current={selected ? "page" : undefined}
      aria-label={ariaLabel}
      className={cn(TAB_CLASS, selected && "border-colony-fg text-colony-fg")}
      data-testid={`channel-view-tab-${testId}`}
      onClick={onClick}
      type="button"
    >
      {label}
      {badge !== undefined ? (
        <span
          aria-hidden="true"
          className="ml-0.5 rounded-full bg-colony-need-bg px-1.5 py-0.5 text-2xs font-bold text-colony-need"
        >
          {badge}
        </span>
      ) : null}
    </button>
  );
}
