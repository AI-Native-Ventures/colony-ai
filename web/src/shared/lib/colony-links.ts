/**
 * Deep-link scheme the Colony desktop app registers with the OS. The app also
 * still answers its legacy scheme for links minted before this one existed, but
 * that scheme can open an unrelated app, so the web pages only ever mint
 * `colony://`.
 */
export const COLONY_DEEP_LINK_SCHEME = "colony";

/** `colony://join` link that accepts a relay invite in the desktop app. */
export function colonyJoinLink(
  relay: string,
  code: string,
  policyReceipt?: string,
): string {
  const query = new URLSearchParams({ relay, code });
  if (policyReceipt) query.set("policy_receipt", policyReceipt);
  return `${COLONY_DEEP_LINK_SCHEME}://join?${query.toString()}`;
}

/** `colony://connect` link that adds this relay's community to the app. */
export function colonyConnectLink(relay: string): string {
  return `${COLONY_DEEP_LINK_SCHEME}://connect?relay=${encodeURIComponent(relay)}`;
}
