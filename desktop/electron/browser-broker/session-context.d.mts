export type BrowserSessionContext = {
  agentId: string;
  taskId: string;
  communityOrigin: string;
};
/** Canonical HTTP origin of the relay, without credentials, paths or tokens. */
export function browserCommunityOrigin(relay: string): string;
/** Validate and normalize one immutable browser identity tuple. */
export function checkedBrowserSession(
  context?: Partial<BrowserSessionContext>,
): BrowserSessionContext;
/** Compact canonical JSON tuple used by trusted runtime credentials. */
export function browserSessionKey(context: BrowserSessionContext): string;
