function safeMentionDisplayLabel(
  label: string,
  _pubkey: string | undefined,
): string {
  const rawIdentity =
    /(?:[0-9a-f]{40,}|[0-9a-f]{6,}(?:\.\.\.|\u2026)[0-9a-f]{2,}|npub1[0-9a-z.\u2026-]*)/i;
  const qualified = label.match(
    /^(.*) \((?:[0-9a-f]{40,}|[0-9a-f]{6,}(?:\.\.\.|\u2026)[0-9a-f]{2,}|npub1[0-9a-z.\u2026-]*)\)((?: (?:[2-9]|[1-9][0-9]+))?)$/i,
  );
  if (
    label.match(
      /^\s*(?:[0-9a-f]{40,}|[0-9a-f]{6,}(?:\.\.\.|\u2026)[0-9a-f]{2,}|npub1[0-9a-z.\u2026-]*)\s*$/i,
    )
  ) {
    return "AI employee";
  }
  if (!qualified) return label.replace(rawIdentity, "AI employee");
  // Older clients stored the routing key in the visible mention label. It is
  // never a presentable name, even when the tag is stale or malformed.
  return `${qualified[1]} (teammate)${qualified[2]}`;
}

/** A mention's routing key must never become visible identity text. */
export function formatMentionDisplayLabel(
  label: string,
  pubkey: string | undefined,
): string {
  return safeMentionDisplayLabel(label, pubkey);
}

/**
 * The pre-npub key compaction a chip rendered before keys displayed as npub.
 * Retired from rendering; kept byte-exact so clipboard validation can still
 * recognize whole chips copied by an older Buzz, re-binding them to the exact
 * identity their record declares instead of degrading them to plain text.
 */
export function formatLegacyMentionDisplayLabel(
  label: string,
  pubkey: string | undefined,
): string {
  return safeMentionDisplayLabel(label, pubkey);
}
