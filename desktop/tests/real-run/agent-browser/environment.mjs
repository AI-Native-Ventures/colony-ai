import path from "node:path";
import { assertFreshHome, freshHomeEnvironment } from "../fresh-home.mjs";

/** Only literal IPv4 loopback fixture/provider endpoints are accepted. */
export function loopbackOrigin(value) {
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    !url.port ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error(
      "Use a literal HTTP loopback origin with an explicit fixture port",
    );
  return url.origin;
}

/** Prepare launch and managed-agent settings; never launches or sets private exceptions. */
export function prepareEnvironment(
  source,
  { home, realHome, userDataDir, fixtureOrigin, providerOrigin, relayOrigin },
) {
  const safeHome = assertFreshHome({ home, realHome });
  if (
    !path.isAbsolute(userDataDir) ||
    !path.resolve(userDataDir).startsWith(`${safeHome}${path.sep}`)
  )
    throw new Error("The isolated profile must be inside the throwaway HOME");
  const fixture = loopbackOrigin(fixtureOrigin);
  const provider = loopbackOrigin(providerOrigin);
  const relay = new URL(relayOrigin);
  if (
    !["ws:", "http:"].includes(relay.protocol) ||
    relay.hostname !== "127.0.0.1" ||
    !relay.port ||
    relay.username ||
    relay.password
  )
    throw new Error("Use an isolated loopback test relay");
  return {
    environment: {
      ...freshHomeEnvironment(source, {
        home: safeHome,
        userDataDir,
        relayUrl: relayOrigin,
      }),
      COLONY_BROWSER_AGENT: "1",
    },
    agentEnvironment: {
      BUZZ_AGENT_PROVIDER: "openai",
      OPENAI_COMPAT_API: "chat",
      OPENAI_COMPAT_BASE_URL: `${provider}/v1`,
      OPENAI_COMPAT_MODEL: "colony-browser-fake",
      OPENAI_COMPAT_API_KEY: "fixture-only-never-real",
    },
    fixtureOrigin: fixture,
    modelProvider: "FAKE local OpenAI-compatible responder; no real model",
    status: "PREPARED_NOT_RUN",
  };
}
