import { requestWorkAreaTab } from "@/features/workarea/dock/workAreaRequests";
import { showWorkspaceFiles } from "@/features/workarea/workspaceFiles";

const TAB_BUTTON_CLASS =
  "text-sm text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring";

/** Visible channel sections in the reference workspace shell. */
export function ChannelWorkspaceTabs() {
  return (
    <section
      aria-label="Channel views"
      className="colony-channel-view-tabs"
      data-testid="channel-view-tabs"
    >
      <span aria-current="page" className="text-sm">
        Discussion
      </span>
      <button
        type="button"
        className={TAB_BUTTON_CLASS}
        data-testid="channel-view-tab-work"
        onClick={() => requestWorkAreaTab("work")}
      >
        Work
      </button>
      <button
        type="button"
        className={TAB_BUTTON_CLASS}
        data-testid="channel-view-tab-knowledge"
        onClick={() => requestWorkAreaTab("knowledge")}
      >
        Knowledge
      </button>
      <button
        type="button"
        className={TAB_BUTTON_CLASS}
        data-testid="channel-view-tab-canvas"
        onClick={() => requestWorkAreaTab("canvas")}
      >
        Canvas
      </button>
      <button
        type="button"
        className={TAB_BUTTON_CLASS}
        data-testid="channel-view-tab-files"
        onClick={showWorkspaceFiles}
      >
        Files
      </button>
    </section>
  );
}
