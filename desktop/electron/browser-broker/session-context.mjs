const PUBLIC_KEY = /^[0-9a-f]{64}$/u;
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const TASK = new RegExp(
  `^(?:thread:${UUID}:[0-9a-f]{64}|conversation:${UUID})$`,
  "u",
);

/**
 * Runtime community identity is the HTTP(S) origin of its relay. It is separate
 * from the persisted business UUID that owns the browser's storage profile.
 * Paths and relay tokens are excluded from identity and from socket messages.
 */
export function browserCommunityOrigin(relay) {
  if (
    typeof relay !== "string" ||
    relay.length === 0 ||
    relay.length > 2048 ||
    [...relay].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 0x20 || code === 0x7f;
    })
  )
    throw new Error("Invalid browser community");
  let url;
  try {
    url = new URL(relay);
  } catch {
    throw new Error("Invalid browser community");
  }
  if (
    !["http:", "https:", "ws:", "wss:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    !url.hostname
  )
    throw new Error("Invalid browser community");
  if (url.protocol === "ws:") url.protocol = "http:";
  if (url.protocol === "wss:") url.protocol = "https:";
  return url.origin;
}

/** Validate and normalize the immutable identity of one browser MCP session. */
export function checkedBrowserSession({
  agentId,
  taskId,
  communityOrigin,
} = {}) {
  if (
    typeof agentId !== "string" ||
    agentId.length !== 64 ||
    !PUBLIC_KEY.test(agentId)
  )
    throw new Error("Invalid browser agent");
  if (
    typeof taskId !== "string" ||
    ![49, 108].includes(taskId.length) ||
    !TASK.test(taskId)
  )
    throw new Error("Invalid browser task");
  return {
    agentId,
    taskId,
    communityOrigin: browserCommunityOrigin(communityOrigin),
  };
}

/** Unambiguous, canonical map key and HMAC payload for the full identity tuple. */
export function browserSessionKey(context) {
  const { agentId, taskId, communityOrigin } = checkedBrowserSession(context);
  return JSON.stringify([agentId, taskId, communityOrigin]);
}
