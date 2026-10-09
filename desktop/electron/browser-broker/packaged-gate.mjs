import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const GATE_MARKER = ".colony-browser-packaged-gate.json";
export const GATE_HOME_PREFIX = "colony-browser-gate-";
export const GATE_TTL_MS = 10 * 60_000;

/** Exact literal loopback origin, never a host alias, path or default port. */
export function gateOrigin(value) {
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    !url.port ||
    url.username ||
    url.password ||
    value !== url.origin
  )
    throw new Error("Invalid packaged gate fixture origin");
  return url.origin;
}

/** Default-off packaged test seam. An environment variable alone grants nothing. */
export async function readPackagedGate(env = process.env) {
  const nonce = env.COLONY_BROWSER_PACKAGED_GATE;
  if (nonce === undefined) return null;
  if (!/^[a-f0-9]{64}$/u.test(nonce))
    throw new Error("Invalid packaged gate opt-in");
  const home = env.HOME;
  if (!home || !path.isAbsolute(home))
    throw new Error("Packaged gate needs a throwaway HOME");
  const temporary = await realpath(os.tmpdir());
  const resolved = await realpath(home);
  const info = await lstat(home);
  if (
    info.isSymbolicLink() ||
    !info.isDirectory() ||
    (info.mode & 0o777) !== 0o700 ||
    path.dirname(resolved) !== temporary ||
    !path.basename(resolved).startsWith(GATE_HOME_PREFIX) ||
    resolved === os.userInfo().homedir ||
    (process.getuid && info.uid !== process.getuid())
  )
    throw new Error("Packaged gate needs a private temporary HOME");
  const marker = path.join(resolved, GATE_MARKER);
  const entry = await lstat(marker);
  if (
    !entry.isFile() ||
    entry.isSymbolicLink() ||
    (entry.mode & 0o777) !== 0o600 ||
    entry.size > 4096
  )
    throw new Error("Invalid packaged gate marker");
  const file = await open(
    marker,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  let config;
  try {
    const opened = await file.stat();
    if (
      opened.ino !== entry.ino ||
      opened.dev !== entry.dev ||
      opened.size > 4096
    )
      throw new Error("Packaged gate marker changed");
    const buffer = Buffer.alloc(4097);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead > 4096) throw new Error("Packaged gate marker is too large");
    config = JSON.parse(buffer.subarray(0, bytesRead).toString("utf8"));
  } finally {
    await file.close();
  }
  const now = Date.now();
  if (
    config.schema !== 1 ||
    config.nonce !== nonce ||
    config.provider !== "FAKE" ||
    !Number.isSafeInteger(config.expiresAt) ||
    config.expiresAt <= now ||
    config.expiresAt > now + GATE_TTL_MS ||
    !/^[a-f0-9]{64}$/u.test(config.agentId ?? "") ||
    !/^(conversation:[a-f0-9-]{36}|thread:[a-f0-9-]{36}:[a-f0-9]{64})$/u.test(
      config.taskId ?? "",
    ) ||
    typeof config.businessId !== "string" ||
    !config.businessId ||
    typeof config.communityOrigin !== "string" ||
    (config.clientId !== null && typeof config.clientId !== "string")
  )
    throw new Error("Invalid packaged gate task marker");
  gateOrigin(config.origin);
  const community = new URL(config.communityOrigin);
  if (
    !["http:", "https:"].includes(community.protocol) ||
    community.origin !== config.communityOrigin
  )
    throw new Error("Invalid packaged gate community");
  let consumed = false;
  return {
    exceptionsFor(payload) {
      if (
        consumed ||
        Date.now() >= config.expiresAt ||
        ["agentId", "taskId", "businessId", "communityOrigin"].some(
          (key) => payload[key] !== config[key],
        ) ||
        (payload.clientId ?? null) !== config.clientId ||
        !Array.isArray(payload.allowedOrigins) ||
        payload.allowedOrigins.length !== 1 ||
        payload.allowedOrigins[0] !== config.origin
      )
        throw new Error(
          "Packaged gate permits one exact fixture task and origin",
        );
      return [new URL(config.origin).host];
    },
    consume() {
      consumed = true;
    },
  };
}
