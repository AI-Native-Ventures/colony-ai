const PREFIX = "browser:";

/** The dock tab id for a browser page. Pages are the one kind opened often. */
export function browserTabId(pageKey: string): string {
  return `${PREFIX}${pageKey}`;
}

/** The page key a browser dock tab stands for. */
export function browserPageKeyOf(tabId: string): string {
  return tabId.startsWith(PREFIX) ? tabId.slice(PREFIX.length) : tabId;
}
