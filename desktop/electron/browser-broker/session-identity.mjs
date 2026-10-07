import { createHmac } from "node:crypto";
import { browserSessionKey } from "./session-context.mjs";
export {
  browserCommunityOrigin,
  browserSessionKey,
  checkedBrowserSession,
} from "./session-context.mjs";

/** Domain separation for browser credentials shared with the ACP runtime. */
export const BROWSER_SESSION_DOMAIN = "colony-browser/session/v1\n";

/**
 * Derive a credential for one session. Only main and the trusted native harness
 * receive the master; the MCP child receives this derived value and its tuple.
 */
export function browserSessionCredential(master, context) {
  if (typeof master !== "string" || master.length < 16 || master.length > 256)
    throw new Error("Invalid browser launch credential");
  return createHmac("sha256", master)
    .update(BROWSER_SESSION_DOMAIN)
    .update(browserSessionKey(context))
    .digest("hex");
}
