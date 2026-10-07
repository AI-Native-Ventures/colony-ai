import type {
  BrowserDownloadBlockReason,
  BrowserNavigationBlockReason,
} from "@/shared/api/browserHost";

/**
 * Plain-language text for what the browser host reports. The host sends short
 * technical strings ("Navigation failed (ERR_NAME_NOT_RESOLVED)"); the person
 * sees a sentence about what happened and what to try, with the code kept as a
 * small detail so a support conversation can still name it.
 */

export type DescribedPageError = {
  title: string;
  hint: string;
  /** The technical code, when the host gave one. */
  detail: string | null;
};

const CODE_PATTERN = /ERR_[A-Z0-9_]+/;

const KNOWN: ReadonlyArray<{
  test: RegExp;
  title: string;
  hint: string;
}> = [
  {
    test: /ERR_NAME_NOT_RESOLVED|ERR_NAME_RESOLUTION_FAILED/,
    title: "This site can't be found",
    hint: "Check the address for typing mistakes, then try again.",
  },
  {
    test: /ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED|ERR_PROXY_CONNECTION_FAILED/,
    title: "You're offline",
    hint: "Check your internet connection, then try again.",
  },
  {
    test: /ERR_CONNECTION_REFUSED/,
    title: "The site refused the connection",
    hint: "The site may be down, or nothing is running at that address.",
  },
  {
    test: /ERR_CONNECTION_TIMED_OUT|ERR_TIMED_OUT/,
    title: "The site took too long to respond",
    hint: "Try again in a moment.",
  },
  {
    test: /ERR_CONNECTION_RESET|ERR_CONNECTION_CLOSED|ERR_EMPTY_RESPONSE/,
    title: "The connection was interrupted",
    hint: "Try again. Your other tabs are not affected.",
  },
  {
    test: /ERR_CERT_|ERR_SSL_|ERR_BAD_SSL/,
    title: "This site's security certificate is not trusted",
    hint: "Colony did not open the page because the connection may not be private.",
  },
  {
    test: /ERR_BLOCKED_BY|ERR_UNSAFE_PORT|ERR_ADDRESS_INVALID|ERR_INVALID_URL/,
    title: "This address can't be opened here",
    hint: "Only ordinary web pages open in this browser.",
  },
  {
    test: /metadata addresses/,
    title: "This address can't be opened here",
    hint: "Colony does not open link-local or cloud metadata addresses.",
  },
  {
    test: /Page process stopped/,
    title: "This page stopped working",
    hint: "Reload it to try again. Your other tabs are not affected.",
  },
  {
    test: /Page is not responding/,
    title: "This page is not responding",
    hint: "Wait a moment, or reload it.",
  },
];

export function describePageError(error: string): DescribedPageError {
  const detail = error.match(CODE_PATTERN)?.[0] ?? null;
  const known = KNOWN.find((entry) => entry.test.test(error));
  if (known) return { title: known.title, hint: known.hint, detail };
  return {
    title: "This page could not be opened",
    hint: "Try again, or open a different address.",
    detail,
  };
}

/** A host error that refused a link but left the current page on screen. */
export function isBlockedNavigationError(error: string | null): boolean {
  return (
    error !== null &&
    (error.startsWith("Navigation to an unsupported URL") ||
      error.startsWith("Navigation redirected to an unsupported URL"))
  );
}

export const BLOCKED_ADDRESS_NOTICE =
  "A page tried to open an address Colony does not open. Only web pages (http or https) open here.";

export function describeNavigationBlock(
  reason: BrowserNavigationBlockReason,
): string {
  switch (reason) {
    case "tab-limit":
      return "Too many browser tabs are open. Close one to open another.";
    case "tab-open-failed":
      return "A link tried to open a new tab, but it could not be opened.";
    default:
      return BLOCKED_ADDRESS_NOTICE;
  }
}

export function describeDownloadBlock(
  reason: BrowserDownloadBlockReason,
): string {
  switch (reason) {
    case "download-limit":
      return "Too many downloads at once. Wait for one to finish, then try again.";
    case "download-size-limit":
      return "That file is larger than the 256 MB download limit, so it was not saved.";
    default:
      return "That file could not be saved to your Downloads folder.";
  }
}

/** A failure creating or driving a tab, as a sentence. */
export function describeHostFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/tab limit/i.test(message))
    return "Too many browser tabs are open. Close one to open another.";
  if (/profile limit|session limit/i.test(message))
    return "This browser has reached its limit of saved profiles. Restart Colony and try again.";
  if (/turned off/i.test(message))
    return "The browser is turned off in this copy of Colony.";
  if (/metadata addresses/i.test(message))
    return "Colony does not open link-local or cloud metadata addresses.";
  if (/unavailable|not available/i.test(message))
    return "The browser is not available in this window.";
  return "The browser could not do that. Try again.";
}
