/** Visible channel sections in the reference workspace shell. */
export function ChannelWorkspaceTabs() {
  return (
    <section
      aria-label="Channel views"
      className="colony-channel-view-tabs"
      data-testid="channel-view-tabs"
    >
      <span aria-current="page" className="text-2xs">
        Discussion
      </span>
      <span className="text-2xs">Work</span>
      <span className="text-2xs">Knowledge</span>
      <span className="text-2xs">Canvas</span>
      <span className="text-2xs">Files</span>
    </section>
  );
}
