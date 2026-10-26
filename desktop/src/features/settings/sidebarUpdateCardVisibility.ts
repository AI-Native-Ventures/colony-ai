/**
 * The card shows when the person has something to do (update now, download by
 * hand) or something to know (installing, or an update that was refused and
 * has a manual download link). Other errors, such as a failed background check,
 * stay quiet and are retried on the next interval.
 */
export function shouldShowSidebarUpdateCard(status: {
  state: string;
  releaseUrl?: string;
}) {
  return (
    status.state === "ready" ||
    status.state === "installing" ||
    status.state === "manual-required" ||
    (status.state === "error" && Boolean(status.releaseUrl))
  );
}
