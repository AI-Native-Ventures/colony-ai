const CHANNEL_SEARCH_EVENT = "colony:search-current-channel";

/**
 * Ask the app shell to open search scoped to the conversation on screen, the
 * same action as the Search this channel shortcut. The header's search button
 * is one tap to a scoped search.
 */
export function requestChannelSearch() {
  window.dispatchEvent(new Event(CHANNEL_SEARCH_EVENT));
}

export function listenForChannelSearchRequests(listener: () => void) {
  window.addEventListener(CHANNEL_SEARCH_EVENT, listener);
  return () => window.removeEventListener(CHANNEL_SEARCH_EVENT, listener);
}
