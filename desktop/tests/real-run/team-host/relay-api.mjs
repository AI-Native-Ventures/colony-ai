// Relay calls for the team host gate: email code sign-in, company creation,
// and signed events and queries with NIP-98 auth. Never logs a key.
import { finalizeEvent, getPublicKey, nip19 } from "nostr-tools";
import { getToken } from "nostr-tools/nip98";

/** Keys from the `nsec` the code sign-in returns. */
export function keysFromNsec(nsec) {
  const decoded = nip19.decode(nsec);
  if (decoded.type !== "nsec")
    throw new Error("the sign-in returned no private key");
  return { secret: decoded.data, pubkey: getPublicKey(decoded.data), nsec };
}

/** `wss://host` to `https://host`. */
export const httpBase = (relayUrl) =>
  relayUrl
    .replace(/^wss:\/\//, "https://")
    .replace(/^ws:\/\//, "http://")
    .replace(/\/+$/, "");

async function send(url, method, body, keys) {
  const headers = { "content-type": "application/json" };
  if (keys) {
    headers.authorization = await getToken(
      url,
      method,
      (template) => finalizeEvent(template, keys.secret),
      true,
      body,
    );
  }
  const response = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!response.ok) {
    throw new Error(
      `${method} ${new URL(url).pathname} answered ${response.status}: ${text.slice(0, 300)}`,
    );
  }
  return json;
}

/** Ask the relay to email a sign-in code. */
export const startEmailCode = (base, email) =>
  send(`${base}/api/accounts/code/start`, "POST", { email });

/** Exchange the code for the session (`{ account, nsec, created }`). */
export const verifyEmailCode = (base, input) =>
  send(`${base}/api/accounts/code/verify`, "POST", input);

/** Create a company (self-serve account mode). */
export async function createCompany(base, keys, slug) {
  const result = await send(
    `${base}/api/communities`,
    "POST",
    { name: slug },
    keys,
  );
  const host = result?.community?.normalized_host;
  if (!host) throw new Error("company creation returned no host");
  return { host, relayUrl: `wss://${host}` };
}

/** The relay's own key (NIP-11 `self`). */
export async function relaySelf(relayUrl) {
  const response = await fetch(httpBase(relayUrl), {
    headers: { accept: "application/nostr+json" },
  });
  const document = await response.json();
  if (!document?.self) throw new Error("the relay did not name its own key");
  return document.self;
}

/** Sign and submit one event as `keys`. */
export async function publish(relayUrl, keys, template) {
  const event = finalizeEvent(
    { created_at: Math.floor(Date.now() / 1000), ...template },
    keys.secret,
  );
  const result = await send(
    `${httpBase(relayUrl)}/events`,
    "POST",
    event,
    keys,
  );
  if (!result?.accepted)
    throw new Error(`relay rejected event: ${result?.message}`);
  return { event, message: result.message };
}

/** NIP-01 filters over HTTP. */
export const query = (relayUrl, keys, filters) =>
  send(`${httpBase(relayUrl)}/query`, "POST", filters, keys);
