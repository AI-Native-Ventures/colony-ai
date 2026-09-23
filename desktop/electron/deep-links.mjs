const ELECTRON_DEEP_LINK_COMMAND = "handle_electron_deep_link";
const MAX_DEEP_LINK_URL_LENGTH = 4096;
const MAX_PENDING_DEEP_LINKS = 64;
const DEDUPE_WINDOW_MS = 1500;

export function deepLinkSchemesFromConfig(config) {
  const configured = config?.plugins?.["deep-link"]?.desktop?.schemes;
  if (!Array.isArray(configured)) return [];

  return [
    ...new Set(
      configured
        .filter(
          (scheme) =>
            typeof scheme === "string" && /^[a-z][a-z0-9+.-]*$/i.test(scheme),
        )
        .map((scheme) => scheme.toLowerCase()),
    ),
  ];
}

export function isDeepLinkUrl(value, schemes) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_DEEP_LINK_URL_LENGTH
  ) {
    return false;
  }

  const schemeMatch = /^([a-z][a-z0-9+.-]*):\/\//i.exec(value);
  if (!schemeMatch || !schemes.includes(schemeMatch[1].toLowerCase())) {
    return false;
  }

  let protocol;
  try {
    protocol = new URL(value).protocol.slice(0, -1).toLowerCase();
  } catch {
    return false;
  }
  return schemes.includes(protocol);
}

export function registerDeepLinkSchemes(
  app,
  schemes,
  { isDefaultApp = false, executablePath, appPath } = {},
) {
  return schemes.map((scheme) => {
    if (isDefaultApp) {
      if (!executablePath || !appPath) {
        throw new Error("Development deep-link registration needs an app path");
      }
      return app.setAsDefaultProtocolClient(scheme, executablePath, [appPath]);
    }
    return app.setAsDefaultProtocolClient(scheme);
  });
}

export function createDeepLinkRouter({
  host = null,
  schemes,
  revealWindow,
  now = Date.now,
  onError = (error) => console.error("Colony deep-link routing failed", error),
}) {
  const pending = [];
  const recentlySeen = new Map();
  let nativeHost = host;

  function markSeen(url) {
    const currentTime = now();
    for (const [candidate, timestamp] of recentlySeen) {
      if (currentTime - timestamp >= DEDUPE_WINDOW_MS) {
        recentlySeen.delete(candidate);
      }
    }
    const previousTime = recentlySeen.get(url);
    if (
      previousTime !== undefined &&
      currentTime - previousTime < DEDUPE_WINDOW_MS
    ) {
      return false;
    }
    recentlySeen.set(url, currentTime);
    return true;
  }

  function queue(url) {
    if (pending.includes(url)) return;
    if (pending.length >= MAX_PENDING_DEEP_LINKS) {
      throw new Error(
        "Too many deep links arrived before the native host was ready",
      );
    }
    pending.push(url);
  }

  async function deliver(url) {
    try {
      await nativeHost.request("invoke", {
        command: ELECTRON_DEEP_LINK_COMMAND,
        args: { url },
      });
    } catch (error) {
      if (pending.length < MAX_PENDING_DEEP_LINKS && !pending.includes(url)) {
        pending.unshift(url);
      }
      throw error;
    }
  }

  async function receive(url) {
    if (!isDeepLinkUrl(url, schemes)) return false;
    if (!markSeen(url)) return true;
    revealWindow();
    if (!nativeHost) {
      queue(url);
      return true;
    }
    await deliver(url);
    return true;
  }

  async function retryPending() {
    while (nativeHost && pending.length > 0) {
      const url = pending[0];
      await deliver(url);
      if (pending[0] === url) pending.shift();
    }
  }

  async function setHost(nextHost) {
    if (!nextHost || typeof nextHost.request !== "function") {
      throw new Error("A ready native host is required for deep links");
    }
    nativeHost = nextHost;
    await retryPending();
  }

  function handleOpenUrl(event, url) {
    if (!isDeepLinkUrl(url, schemes)) return;
    event?.preventDefault?.();
    void receive(url).catch(onError);
  }

  function handleSecondInstance(commandLine) {
    const links = Array.isArray(commandLine)
      ? commandLine.filter((value) => isDeepLinkUrl(value, schemes))
      : [];
    if (links.length === 0) {
      revealWindow();
      return;
    }
    for (const url of links) void receive(url).catch(onError);
  }

  function handleInitialArgv(argv) {
    const links = Array.isArray(argv)
      ? argv.filter((value) => isDeepLinkUrl(value, schemes))
      : [];
    for (const url of links) void receive(url).catch(onError);
  }

  return {
    handleInitialArgv,
    handleOpenUrl,
    handleSecondInstance,
    retryPending,
    setHost,
  };
}
