/**
 * Inline "New" divider rendered directly above the oldest unread top-level
 * message, mirroring Slack's read/unread boundary. Computed from the
 * channel's read frontier as it stood when the channel was opened.
 */
export function UnreadDivider() {
  return (
    <section
      aria-label="New messages"
      className="relative flex items-center gap-2.5 pb-6"
      data-testid="message-unread-divider"
    >
      <div className="h-[1.5px] flex-1 bg-[var(--colony-focus-soft)]" />
      <span className="c3c-new-label shrink-0">New</span>
      <div className="h-[1.5px] flex-1 bg-[var(--colony-focus-soft)]" />
    </section>
  );
}
