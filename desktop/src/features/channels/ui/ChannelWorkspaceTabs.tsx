import { showWorkspaceFiles } from "@/features/workarea/workspaceFiles";

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
      <span className="text-sm">Work</span>
      <span className="text-sm">Knowledge</span>
      <span className="text-sm">Canvas</span>
      <button
        type="button"
        className="text-sm text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
        onClick={showWorkspaceFiles}
      >
        Files
      </button>
    </section>
  );
}
