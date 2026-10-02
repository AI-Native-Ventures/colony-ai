import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import net, { type Socket } from "node:net";
import os from "node:os";
import path from "node:path";

import {
  _electron as electron,
  type ElectronApplication,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { finalizeEvent, generateSecretKey } from "nostr-tools";

export const DEFAULT_RELAY_URL = "ws://localhost:3000";
export const PROXY_RELAY_URL = "ws://localhost:3001";
export const GENERAL_CHANNEL_ID = "9f28288a-d724-587a-9709-92dc7f967110";

const MAX_LOG_LINES = 250;
const MAX_PROXY_LOG_LINES = 2_500;
const MAX_DIAGNOSTIC_BYTES = 2 * 1024 * 1024;

export type TestIdentity = {
  secretKey: Uint8Array;
  publicKey: string;
  nsec: string;
};

export type RunningElectron = {
  application: ElectronApplication;
  page: Page;
  userDataDir: string;
  nativeHostLogPath: string;
  logs: string[];
  closed: boolean;
};

export type RelayEvent = {
  id: string;
  pubkey: string;
  kind: number;
  content: string;
  tags: string[][];
};

type RelayFrameHandler = (frame: unknown[]) => void;

type RelaySocketSession = {
  socket: WebSocket;
  setFrameHandler(handler: RelayFrameHandler): void;
  close(): void;
};

type ProxySocketTrace = {
  id: number;
  buffer: Buffer;
  upstreamBuffer: Buffer;
  requestHeader: Buffer;
  requestHeaderParsed: boolean;
  upgraded: boolean;
  upgradedUpstream: boolean;
  owner: string;
  messageOpcode: number | null;
  messageParts: Buffer[];
  pendingSkipBytes: number;
  upstreamMessageOpcode: number | null;
  upstreamMessageParts: Buffer[];
  upstreamPendingSkipBytes: number;
  subscriptions: Map<string, string>;
};

export type TcpRelayProxy = {
  relayUrl: string;
  logs: string[];
  timelinePath?: string;
  snapshot(): {
    acceptedConnections: number;
    upstreamConnections: number;
    refusedConnections: number;
    activeConnections: number;
    outageCount: number;
    acceptingConnections: boolean;
  };
  dropAndBlock(blockMs: number): Promise<{ droppedConnections: number }>;
  close(): Promise<void>;
};

function appendLog(logs: string[], message: string) {
  logs.push(message.slice(0, 700));
  if (logs.length > MAX_LOG_LINES) logs.splice(0, logs.length - MAX_LOG_LINES);
}

export function readDiagnosticTail(filePath: string) {
  if (!existsSync(filePath)) return Buffer.alloc(0);
  const content = readFileSync(filePath);
  return content.length <= MAX_DIAGNOSTIC_BYTES
    ? content
    : Buffer.concat([
        Buffer.from(`[truncated to last ${MAX_DIAGNOSTIC_BYTES} bytes]\n`),
        content.subarray(-MAX_DIAGNOSTIC_BYTES),
      ]);
}

async function installRelaySocketTrace(page: Page) {
  await page.evaluate(() => {
    const internals = (
      window as typeof window & {
        __TAURI_INTERNALS__?: {
          invoke: (
            command: string,
            args?: unknown,
            options?: unknown,
          ) => Promise<unknown>;
        };
      }
    ).__TAURI_INTERNALS__;
    if (!internals?.invoke || internals.invoke.__electronE2eTrace) return;

    const original = internals.invoke.bind(internals);
    let callSequence = 0;
    const summarizeWebSocketMessage = (raw: unknown) => {
      let frame: unknown;
      try {
        frame = typeof raw === "string" ? JSON.parse(raw) : raw;
      } catch {
        return { frameType: "non-json" };
      }
      if (!Array.isArray(frame) || typeof frame[0] !== "string")
        return { frameType: "unknown" };
      const [frameType, id, payload] = frame;
      const event = frameType === "EVENT" ? id : payload;
      const filter = frameType === "REQ" ? payload : undefined;
      return {
        frameType,
        subscriptionId:
          frameType === "REQ" || frameType === "CLOSE" ? id : undefined,
        eventId:
          frameType === "EVENT" && event && typeof event === "object"
            ? (event as { id?: unknown }).id
            : undefined,
        kind:
          frameType === "EVENT" && event && typeof event === "object"
            ? (event as { kind?: unknown }).kind
            : undefined,
        hCount:
          frameType === "EVENT" && event && typeof event === "object"
            ? Array.isArray((event as { tags?: unknown }).tags)
              ? (event as { tags: unknown[][] }).tags.filter(
                  (tag) => tag[0] === "h",
                ).length
              : undefined
            : filter && typeof filter === "object"
              ? Array.isArray((filter as Record<string, unknown>)["#h"])
                ? ((filter as Record<string, unknown>)["#h"] as unknown[])
                    .length
                : 0
              : undefined,
        kinds:
          filter &&
          typeof filter === "object" &&
          Array.isArray((filter as { kinds?: unknown }).kinds)
            ? (filter as { kinds: number[] }).kinds.join(",")
            : undefined,
        since:
          filter && typeof filter === "object"
            ? (filter as { since?: unknown }).since
            : undefined,
      };
    };
    window.colonyDesktop?.subscribe((message) => {
      if (message.type !== "channel") return;
      const payload = message.payload as
        | { type?: unknown; data?: unknown }
        | undefined;
      if (payload?.type === "Text") {
        const summary = summarizeWebSocketMessage(payload.data);
        if (
          ["AUTH", "OK", "EVENT", "EOSE", "CLOSED", "NOTICE"].includes(
            String(summary.frameType),
          )
        ) {
          console.warn(
            `[electron-e2e-channel] ${JSON.stringify({ timestamp: Date.now(), channelId: message.id, sequence: message.sequence, ...summary })}`,
          );
        }
      } else if (payload?.type === "Error" || payload?.type === "Close") {
        console.warn(
          `[electron-e2e-channel] ${JSON.stringify({ timestamp: Date.now(), channelId: message.id, sequence: message.sequence, type: payload.type, data: payload.data })}`,
        );
      }
    });
    const tracedInvoke = async (
      command: string,
      args?: unknown,
      options?: unknown,
    ) => {
      const tracedCommands = new Set([
        "plugin:websocket|connect",
        "plugin:websocket|disconnect",
        "plugin:websocket|send",
        "get_channel_reconnect_repair",
      ]);
      if (!tracedCommands.has(command)) {
        return original(command, args, options);
      }

      const sequence = ++callSequence;
      const timestamp = Date.now();
      const stack = new Error().stack?.split("\n").slice(1, 8).join(" <- ");
      const owner = stack?.includes("readOnlyRelayClient")
        ? "ReadOnlyRelayClient"
        : stack?.includes("relayClientSession")
          ? "RelayClient"
          : "other";
      const details =
        command === "plugin:websocket|connect"
          ? { url: (args as { url?: string } | undefined)?.url }
          : command === "plugin:websocket|send"
            ? {
                id: (args as { id?: number } | undefined)?.id,
                ...summarizeWebSocketMessage(
                  (() => {
                    const message = (
                      args as
                        | { message?: { type?: unknown; data?: unknown } }
                        | undefined
                    )?.message;
                    return message?.type === "Text" ? message.data : message;
                  })(),
                ),
              }
            : command === "get_channel_reconnect_repair"
              ? {
                  channelId: (args as { channelId?: string } | undefined)
                    ?.channelId,
                  since: (args as { since?: number } | undefined)?.since,
                }
              : { id: (args as { id?: number } | undefined)?.id };
      console.warn(
        `[electron-e2e-ws] ${JSON.stringify({ timestamp, phase: "start", sequence, owner, command, ...details, stack })}`,
      );
      try {
        const result = await original(command, args, options);
        const resultSummary =
          command === "get_channel_reconnect_repair"
            ? { repairCount: Array.isArray(result) ? result.length : null }
            : { result };
        console.warn(
          `[electron-e2e-ws] ${JSON.stringify({ timestamp: Date.now(), phase: "ok", sequence, owner, command, ...resultSummary })}`,
        );
        return result;
      } catch (error) {
        console.warn(
          `[electron-e2e-ws] ${JSON.stringify({ timestamp: Date.now(), phase: "error", sequence, owner, command, error: String(error) })}`,
        );
        throw error;
      }
    };
    Object.assign(tracedInvoke, { __electronE2eTrace: true });
    internals.invoke = tracedInvoke;
  });
}

export function fixtureIdentity(name: string): TestIdentity {
  const fixtureFile = process.env.COLONY_ELECTRON_FIXTURE_FILE;
  if (!fixtureFile || !existsSync(fixtureFile)) {
    throw new Error(
      `COLONY_ELECTRON_FIXTURE_FILE must point to pre-seeded relay identities, got ${fixtureFile ?? "unset"}`,
    );
  }
  const document = JSON.parse(readFileSync(fixtureFile, "utf8")) as {
    identities?: Record<
      string,
      { publicKey?: string; nsec?: string; secretKeyHex?: string }
    >;
  };
  const identity = document.identities?.[name];
  if (
    !identity ||
    !/^[0-9a-f]{64}$/u.test(identity.publicKey ?? "") ||
    !/^[0-9a-f]{64}$/u.test(identity.secretKeyHex ?? "") ||
    !identity.nsec
  ) {
    throw new Error(
      `Missing or invalid generated relay fixture identity: ${name}`,
    );
  }
  return {
    secretKey: Uint8Array.from(Buffer.from(identity.secretKeyHex, "hex")),
    publicKey: identity.publicKey,
    nsec: identity.nsec,
  };
}

export function createUserDataDir(testInfo: TestInfo) {
  const label = testInfo.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "")
    .slice(0, 36);
  return mkdtempSync(path.join(os.tmpdir(), `colony-electron-${label}-`));
}

export async function launchElectron(
  userDataDir: string,
  relayUrl = DEFAULT_RELAY_URL,
): Promise<RunningElectron> {
  const desktopRoot = path.resolve(import.meta.dirname, "../..");
  const nativeHost = process.env.COLONY_NATIVE_HOST;
  if (!nativeHost || !existsSync(nativeHost)) {
    throw new Error(
      `COLONY_NATIVE_HOST must point to the built colony-native-host binary, got ${nativeHost ?? "unset"}`,
    );
  }
  if (!existsSync(path.join(desktopRoot, "dist", "index.html"))) {
    throw new Error(
      `Electron renderer build is missing under ${desktopRoot}/dist`,
    );
  }

  const logs: string[] = [];
  const nativeHostLogPath = path.join(userDataDir, "native-host.stderr.log");
  const application = await electron.launch({
    cwd: desktopRoot,
    args: [path.join(desktopRoot, "electron", "main.mjs")],
    env: {
      ...process.env,
      BUZZ_RELAY_URL: relayUrl,
      COLONY_ELECTRON_BACKGROUND: "1",
      COLONY_ELECTRON_USER_DATA: userDataDir,
      COLONY_NATIVE_HOST: nativeHost,
      COLONY_NATIVE_HOST_LOG: nativeHostLogPath,
    },
    timeout: 120_000,
  });

  for (const [name, stream] of [
    ["main", application.process().stdout],
    ["main-err", application.process().stderr],
  ] as const) {
    stream?.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString().split(/\r?\n/u).filter(Boolean)) {
        appendLog(logs, `[${name}] ${line}`);
      }
    });
  }

  const tracedPages = new WeakSet<Page>();
  const tracePage = (page: Page) => {
    if (tracedPages.has(page)) return;
    tracedPages.add(page);
    page.on("console", (message) => {
      if (
        message.type() === "error" ||
        message.type() === "warning" ||
        message.text().includes("[electron-e2e-ws]") ||
        message.text().includes("[electron-e2e-channel]")
      ) {
        appendLog(logs, `[renderer-${message.type()}] ${message.text()}`);
      }
    });
    page.on("pageerror", (error) =>
      appendLog(logs, `[pageerror] ${error.message}`),
    );
    void page
      .waitForLoadState("domcontentloaded", { timeout: 60_000 })
      .then(() => installRelaySocketTrace(page))
      .catch((error) =>
        appendLog(logs, `[window-trace-error] ${String(error)}`),
      );
  };
  application.on("window", (page) => {
    appendLog(logs, `[electron-window] opened url=${page.url()}`);
    tracePage(page);
  });
  for (const currentPage of application.windows()) tracePage(currentPage);
  const page = await application.firstWindow();
  await page.waitForLoadState("domcontentloaded", { timeout: 60_000 });
  await installRelaySocketTrace(page);

  return {
    application,
    page,
    userDataDir,
    nativeHostLogPath,
    logs,
    closed: false,
  };
}

export async function closeElectron(running: RunningElectron) {
  if (running.closed) return;
  await running.application.close();
  running.closed = true;
}

export async function cleanupElectronTest(
  testInfo: TestInfo,
  userDataDir: string,
  applications: RunningElectron[],
  proxy?: TcpRelayProxy,
) {
  for (const running of applications) await closeElectron(running);
  if (proxy) await proxy.close();

  const appLog = applications
    .flatMap((running, index) =>
      running.logs.map((line) => `[app ${index + 1}] ${line}`),
    )
    .join("\n");
  await testInfo.attach("electron-runtime.log", {
    body: Buffer.from(`${appLog}\n`),
    contentType: "text/plain",
  });
  for (const [index, running] of applications.entries()) {
    const nativeHostLog = readDiagnosticTail(running.nativeHostLogPath);
    if (nativeHostLog.length > 0) {
      await testInfo.attach(`native-host-${index + 1}.stderr.log`, {
        body: nativeHostLog,
        contentType: "text/plain",
      });
    }
  }
  const relayLogPath = process.env.COLONY_ELECTRON_RELAY_LOG;
  if (relayLogPath) {
    const relayLog = readDiagnosticTail(relayLogPath);
    if (relayLog.length > 0) {
      await testInfo.attach("relay.log", {
        body: relayLog,
        contentType: "text/plain",
      });
    }
  }
  if (proxy) {
    await testInfo.attach("relay-proxy.log", {
      body: Buffer.from(`${proxy.logs.join("\n")}\n`),
      contentType: "text/plain",
    });
    if (proxy.timelinePath) {
      const timeline = readDiagnosticTail(proxy.timelinePath);
      if (timeline.length > 0) {
        await testInfo.attach("relay-proxy.timeline.log", {
          body: timeline,
          contentType: "text/plain",
        });
      }
    }
  }
  rmSync(userDataDir, { recursive: true, force: true });
}

function timeoutError(label: string) {
  return new Error(`Timed out waiting for relay: ${label}`);
}

async function connectNostrClient(
  relayUrl: string,
  secretKey: Uint8Array,
): Promise<RelaySocketSession> {
  const socket = new WebSocket(relayUrl);
  let settled = false;
  let authEventId: string | null = null;
  let noAuthTimer: ReturnType<typeof setTimeout> | null = null;
  let connectionTimer: ReturnType<typeof setTimeout> | null = null;
  let frameHandler: RelayFrameHandler = () => {};
  const earlyFrames: unknown[][] = [];

  const session: RelaySocketSession = {
    socket,
    setFrameHandler(handler) {
      frameHandler = handler;
      for (const frame of earlyFrames.splice(0)) frameHandler(frame);
    },
    close() {
      if (
        socket.readyState === WebSocket.OPEN ||
        socket.readyState === WebSocket.CONNECTING
      ) {
        socket.close();
      }
    },
  };

  return new Promise<RelaySocketSession>((resolve, reject) => {
    const clearTimers = () => {
      if (noAuthTimer) clearTimeout(noAuthTimer);
      if (connectionTimer) clearTimeout(connectionTimer);
      noAuthTimer = null;
      connectionTimer = null;
    };
    const failBeforeReady = (error: Error) => {
      if (settled) {
        frameHandler(["SOCKET_ERROR", error.message]);
        return;
      }
      settled = true;
      clearTimers();
      socket.close();
      reject(error);
    };
    const finishReady = () => {
      if (settled) return;
      settled = true;
      clearTimers();
      resolve(session);
    };

    connectionTimer = setTimeout(() => {
      failBeforeReady(
        timeoutError(`connection and authentication at ${relayUrl}`),
      );
    }, 12_000);

    socket.addEventListener("open", () => {
      noAuthTimer = setTimeout(finishReady, 500);
    });
    socket.addEventListener("message", (message) => {
      let frame: unknown;
      try {
        frame = JSON.parse(String(message.data));
      } catch {
        failBeforeReady(new Error("Relay sent malformed JSON"));
        return;
      }

      if (Array.isArray(frame) && frame[0] === "AUTH") {
        if (noAuthTimer) clearTimeout(noAuthTimer);
        noAuthTimer = null;
        try {
          const authEvent = finalizeEvent(
            {
              kind: 22242,
              created_at: Math.floor(Date.now() / 1000),
              tags: [
                ["relay", relayUrl],
                ["challenge", String(frame[1] ?? "")],
              ],
              content: "",
            },
            secretKey,
          );
          authEventId = authEvent.id;
          socket.send(JSON.stringify(["AUTH", authEvent]));
        } catch (error) {
          failBeforeReady(
            error instanceof Error ? error : new Error(String(error)),
          );
        }
        return;
      }

      if (
        Array.isArray(frame) &&
        frame[0] === "OK" &&
        typeof authEventId === "string" &&
        frame[1] === authEventId
      ) {
        if (!frame[2]) {
          failBeforeReady(
            new Error(
              `Relay rejected NIP-42 authentication: ${String(frame[3] ?? "")}`,
            ),
          );
          return;
        }
        finishReady();
        return;
      }

      if (Array.isArray(frame)) {
        if (settled) frameHandler(frame);
        else earlyFrames.push(frame);
      }
    });
    socket.addEventListener("error", () => {
      failBeforeReady(new Error(`WebSocket error at ${relayUrl}`));
    });
    socket.addEventListener("close", (event) => {
      failBeforeReady(
        new Error(`WebSocket closed at ${relayUrl} with code ${event.code}`),
      );
    });
  });
}

export async function publishChannelMessage(
  relayUrl: string,
  identity: TestIdentity,
  content: string,
  channelId = GENERAL_CHANNEL_ID,
) {
  const event = finalizeEvent(
    {
      kind: 9,
      created_at: Math.floor(Date.now() / 1000),
      tags: [["h", channelId]],
      content,
    },
    identity.secretKey,
  );
  const session = await connectNostrClient(relayUrl, identity.secretKey);

  try {
    return await new Promise<typeof event>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(timeoutError("message publish response")),
        12_000,
      );
      session.setFrameHandler((frame) => {
        if (frame[0] === "SOCKET_ERROR" || frame[0] === "SOCKET_CLOSED") {
          clearTimeout(timer);
          reject(new Error(String(frame[1] ?? "relay socket closed")));
          return;
        }
        if (frame[0] !== "OK" || frame[1] !== event.id) return;
        clearTimeout(timer);
        if (frame[2]) resolve(event);
        else
          reject(
            new Error(
              `Relay rejected event ${event.id}: ${String(frame[3] ?? "")}`,
            ),
          );
      });
      session.socket.send(JSON.stringify(["EVENT", event]));
    });
  } finally {
    session.close();
  }
}

export async function readChannelEvents(
  relayUrl: string,
  authorPublicKey: string,
  channelId = GENERAL_CHANNEL_ID,
  authIdentity?: TestIdentity,
): Promise<RelayEvent[]> {
  const session = await connectNostrClient(
    relayUrl,
    authIdentity?.secretKey ?? generateSecretKey(),
  );
  const subscriptionId = `electron-e2e-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const events: RelayEvent[] = [];

  try {
    return await new Promise<RelayEvent[]>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(timeoutError("channel history response")),
        12_000,
      );
      session.setFrameHandler((frame) => {
        if (frame[0] === "SOCKET_ERROR" || frame[0] === "SOCKET_CLOSED") {
          clearTimeout(timer);
          reject(new Error(String(frame[1] ?? "relay socket closed")));
          return;
        }
        if (frame[0] === "EVENT" && frame[1] === subscriptionId) {
          const event = frame[2] as RelayEvent | undefined;
          if (event && event.kind === 9) events.push(event);
        }
        if (frame[0] === "CLOSED" && frame[1] === subscriptionId) {
          clearTimeout(timer);
          reject(
            new Error(`Relay closed history query: ${String(frame[2] ?? "")}`),
          );
        }
        if (frame[0] === "EOSE" && frame[1] === subscriptionId) {
          clearTimeout(timer);
          resolve(events);
        }
      });
      session.socket.send(
        JSON.stringify([
          "REQ",
          subscriptionId,
          {
            kinds: [9],
            authors: [authorPublicKey],
            "#h": [channelId],
            limit: 50,
          },
        ]),
      );
    });
  } finally {
    session.close();
  }
}

export async function waitForRelayMessage(
  relayUrl: string,
  authorPublicKey: string,
  content: string,
  timeoutMs = 15_000,
  channelId = GENERAL_CHANNEL_ID,
  authIdentity?: TestIdentity,
): Promise<RelayEvent | undefined> {
  const deadline = Date.now() + timeoutMs;
  do {
    const events = await readChannelEvents(
      relayUrl,
      authorPublicKey,
      channelId,
      authIdentity,
    );
    const match = events.find((event) => event.content === content);
    if (match) return match;
    if (Date.now() >= deadline) return undefined;
    await new Promise((resolve) => setTimeout(resolve, 500));
  } while (Date.now() < deadline);
  return undefined;
}

export async function startTcpRelayProxy({
  listenPort = 3001,
  targetPort = 3000,
  timelinePath,
}: {
  listenPort?: number;
  targetPort?: number;
  timelinePath?: string;
} = {}): Promise<TcpRelayProxy> {
  let acceptingConnections = true;
  let acceptedConnections = 0;
  let upstreamConnections = 0;
  let refusedConnections = 0;
  let outageCount = 0;
  const connections = new Map<Socket, Socket>();
  const sockets = new Set<Socket>();
  const logs: string[] = [];
  let timelineBytes = 0;
  if (timelinePath) writeFileSync(timelinePath, "", { mode: 0o600 });
  const appendTimeline = (message: string) => {
    const line = `[${Date.now()}] ${message.slice(0, 700)}`;
    logs.push(line);
    if (logs.length > MAX_PROXY_LOG_LINES)
      logs.splice(0, logs.length - MAX_PROXY_LOG_LINES);
    if (!timelinePath || timelineBytes >= MAX_DIAGNOSTIC_BYTES) return;
    const remaining = MAX_DIAGNOSTIC_BYTES - timelineBytes;
    const bytes = Buffer.from(`${line}\n`);
    const bounded =
      bytes.length <= remaining ? bytes : bytes.subarray(0, remaining);
    appendFileSync(timelinePath, bounded);
    timelineBytes += bounded.length;
  };

  const track = (socket: Socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  };

  const socketTraces = new Map<Socket, ProxySocketTrace>();
  const classifyRequest = (subscriptionId: string) => {
    if (subscriptionId.startsWith("observer-history-"))
      return "readOnlyRelayClient";
    if (
      subscriptionId.startsWith("live-") ||
      subscriptionId.startsWith("history-")
    )
      return "RelayClient";
    if (subscriptionId.startsWith("electron-e2e-"))
      return "independent Nostr test client";
    return "other Nostr client";
  };

  const captureRequest = (trace: ProxySocketTrace, chunk: Buffer) => {
    if (trace.requestHeaderParsed) return;
    const remainingHeaderBytes = 16_384 - trace.requestHeader.length;
    if (remainingHeaderBytes > 0) {
      trace.requestHeader = Buffer.concat([
        trace.requestHeader,
        chunk.subarray(0, remainingHeaderBytes),
      ]);
    }
    const headerEnd = trace.requestHeader.indexOf("\r\n\r\n");
    if (headerEnd < 0 && trace.requestHeader.length < 16_384) return;
    const headerBlock = trace.requestHeader
      .subarray(0, headerEnd < 0 ? undefined : headerEnd)
      .toString("latin1");
    const requestLine = headerBlock.split("\r\n", 1)[0] ?? "no request line";
    const [, requestPath = "/"] = requestLine.split(" ");
    const pathname = requestPath.split("?", 1)[0];
    const isWebSocket = /\r\nupgrade:\s*websocket/iu.test(headerBlock);
    const owner = isWebSocket
      ? "WebSocket pending REQ classification"
      : pathname === "/query"
        ? "relay HTTP query"
        : pathname === "/events"
          ? "relay HTTP event submit"
          : pathname === "/count"
            ? "relay HTTP count"
            : pathname === "/upload"
              ? "relay media upload"
              : pathname === "/info"
                ? "relay HTTP metadata"
                : `other HTTP ${pathname}`;
    const userAgent =
      headerBlock.match(/\r\nuser-agent:\s*([^\r\n]+)/iu)?.[1] ?? "unknown";
    const origin =
      headerBlock.match(/\r\norigin:\s*([^\r\n]+)/iu)?.[1] ?? "unknown";
    trace.owner = owner;
    trace.requestHeaderParsed = true;
    appendTimeline(
      `[proxy] socket=${trace.id} owner=${owner} request=${requestLine.slice(0, 120)} client=${userAgent.slice(0, 60)} origin=${origin.slice(0, 80)}`,
    );
  };

  const recordFrame = (
    trace: ProxySocketTrace,
    frame: Buffer,
    direction: "client" | "upstream",
  ) => {
    let data: unknown;
    try {
      data = JSON.parse(frame.toString("utf8"));
    } catch {
      appendTimeline(
        `[proxy] socket=${trace.id} owner=${trace.owner} sent non-JSON WebSocket text`,
      );
      return;
    }
    if (!Array.isArray(data) || typeof data[0] !== "string") return;
    const [type, id, payload] = data;
    if (direction === "client" && type === "REQ" && typeof id === "string") {
      trace.owner = classifyRequest(id);
      trace.subscriptions.set(id, trace.owner);
      const kinds = Array.isArray(payload?.kinds)
        ? payload.kinds.join(",")
        : "unspecified";
      const channels = Array.isArray(payload?.["#h"])
        ? payload["#h"].length
        : 0;
      const channelIds = Array.isArray(payload?.["#h"])
        ? payload["#h"].slice(0, 3).join(",")
        : "none";
      const since = typeof payload?.since === "number" ? payload.since : "none";
      appendTimeline(
        `[proxy] socket=${trace.id} owner=${trace.owner} -> REQ sub=${id} kinds=${kinds} h-count=${channels} h-values=${channelIds} since=${since}`,
      );
      return;
    }
    if (direction === "client" && type === "AUTH") {
      appendTimeline(`[proxy] socket=${trace.id} owner=${trace.owner} -> AUTH`);
      return;
    }
    if (direction === "client" && type === "EVENT") {
      if (trace.owner === "unclassified")
        trace.owner = "independent Nostr test client";
      const event = id && typeof id === "object" ? id : payload;
      const kind = event && typeof event.kind === "number" ? event.kind : "?";
      const hCount = Array.isArray(event?.tags)
        ? event.tags.filter((tag: unknown[]) => tag[0] === "h").length
        : 0;
      const channelIds = Array.isArray(event?.tags)
        ? event.tags
            .filter((tag: unknown[]) => tag[0] === "h")
            .map((tag: unknown[]) => String(tag[1] ?? ""))
            .slice(0, 3)
            .join(",")
        : "none";
      appendTimeline(
        `[proxy] socket=${trace.id} owner=${trace.owner} -> EVENT kind=${kind} h-count=${hCount} h-values=${channelIds} event=${typeof event?.id === "string" ? event.id : "unknown"}`,
      );
      return;
    }
    if (direction === "client" && type === "CLOSE" && typeof id === "string") {
      appendTimeline(
        `[proxy] socket=${trace.id} owner=${trace.owner} -> CLOSE sub=${id}`,
      );
      trace.subscriptions.delete(id);
      return;
    }
    if (direction === "upstream" && type === "AUTH") {
      appendTimeline(`[proxy] socket=${trace.id} <- AUTH challenge`);
      return;
    }
    if (direction === "upstream" && type === "OK") {
      appendTimeline(
        `[proxy] socket=${trace.id} <- OK id=${typeof id === "string" ? id : "unknown"} accepted=${Boolean(payload)} reason=${String(data[3] ?? "").slice(0, 120)}`,
      );
      return;
    }
    if (direction === "upstream" && type === "EVENT") {
      const event = payload && typeof payload === "object" ? payload : {};
      const owner =
        typeof id === "string"
          ? (trace.subscriptions.get(id) ?? trace.owner)
          : trace.owner;
      const kind = typeof event.kind === "number" ? event.kind : "?";
      const hCount = Array.isArray(event.tags)
        ? event.tags.filter((tag: unknown[]) => tag[0] === "h").length
        : 0;
      const channelIds = Array.isArray(event.tags)
        ? event.tags
            .filter((tag: unknown[]) => tag[0] === "h")
            .map((tag: unknown[]) => String(tag[1] ?? ""))
            .slice(0, 3)
            .join(",")
        : "none";
      appendTimeline(
        `[proxy] socket=${trace.id} owner=${owner} <- EVENT sub=${String(id)} kind=${kind} h-count=${hCount} h-values=${channelIds} event=${typeof event.id === "string" ? event.id : "unknown"}`,
      );
      return;
    }
    if (direction === "upstream" && type === "CLOSED") {
      appendTimeline(
        `[proxy] socket=${trace.id} <- CLOSED sub=${String(id)} reason=${String(payload ?? "").slice(0, 120)}`,
      );
      return;
    }
    if (direction === "upstream" && (type === "NOTICE" || type === "AUTH")) {
      appendTimeline(
        `[proxy] socket=${trace.id} <- ${type} ${String(id ?? "").slice(0, 120)}`,
      );
      return;
    }
    if (direction === "upstream" && type === "EOSE") {
      appendTimeline(`[proxy] socket=${trace.id} <- EOSE sub=${String(id)}`);
    }
  };

  const readWebSocketFrames = (
    trace: ProxySocketTrace,
    chunk: Buffer,
    direction: "client" | "upstream",
  ) => {
    const isClient = direction === "client";
    let buffer = Buffer.concat([
      isClient ? trace.buffer : trace.upstreamBuffer,
      chunk,
    ]);
    let messageOpcode = isClient
      ? trace.messageOpcode
      : trace.upstreamMessageOpcode;
    let messageParts = isClient
      ? trace.messageParts
      : trace.upstreamMessageParts;
    let pendingSkipBytes = isClient
      ? trace.pendingSkipBytes
      : trace.upstreamPendingSkipBytes;
    const saveState = () => {
      if (isClient) {
        trace.buffer = buffer;
        trace.messageOpcode = messageOpcode;
        trace.messageParts = messageParts;
        trace.pendingSkipBytes = pendingSkipBytes;
      } else {
        trace.upstreamBuffer = buffer;
        trace.upstreamMessageOpcode = messageOpcode;
        trace.upstreamMessageParts = messageParts;
        trace.upstreamPendingSkipBytes = pendingSkipBytes;
      }
    };
    if (isClient && !trace.upgraded) {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) {
        saveState();
        return;
      }
      buffer = buffer.subarray(headerEnd + 4);
      trace.upgraded = true;
    } else if (!isClient && !trace.upgradedUpstream) {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) {
        saveState();
        return;
      }
      buffer = buffer.subarray(headerEnd + 4);
      trace.upgradedUpstream = true;
    }
    while (buffer.length >= 2) {
      if (pendingSkipBytes > 0) {
        const skippedBytes = Math.min(pendingSkipBytes, buffer.length);
        pendingSkipBytes -= skippedBytes;
        buffer = buffer.subarray(skippedBytes);
        if (pendingSkipBytes > 0) {
          saveState();
          return;
        }
      }
      const first = buffer[0];
      const second = buffer[1];
      const fin = (first & 0x80) !== 0;
      const opcode = first & 0x0f;
      const masked = (second & 0x80) !== 0;
      let length = second & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (buffer.length < 4) {
          saveState();
          return;
        }
        length = buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (buffer.length < 10) {
          saveState();
          return;
        }
        const largeLength = buffer.readBigUInt64BE(2);
        if (largeLength > BigInt(Number.MAX_SAFE_INTEGER)) {
          buffer = Buffer.alloc(0);
          saveState();
          return;
        }
        length = Number(largeLength);
        offset = 10;
      }
      if (masked !== isClient || length > MAX_DIAGNOSTIC_BYTES) {
        const frameBytes = offset + (masked ? 4 : 0) + length;
        const skippedBytes = Math.min(frameBytes, buffer.length);
        buffer = buffer.subarray(skippedBytes);
        pendingSkipBytes = frameBytes - skippedBytes;
        if (pendingSkipBytes > 0) break;
        continue;
      }
      const maskLength = masked ? 4 : 0;
      if (buffer.length < offset + maskLength + length) {
        saveState();
        return;
      }
      const mask = masked ? buffer.subarray(offset, offset + 4) : null;
      const payload = Buffer.from(
        buffer.subarray(offset + maskLength, offset + maskLength + length),
      );
      buffer = buffer.subarray(offset + maskLength + length);
      if (mask) {
        for (let index = 0; index < payload.length; index += 1)
          payload[index] ^= mask[index & 3];
      }
      if (opcode === 1 || opcode === 2) {
        messageOpcode = opcode;
        messageParts = [payload];
      } else if (opcode === 0 && messageOpcode !== null) {
        messageParts.push(payload);
      } else {
        continue;
      }
      if (fin && messageOpcode === 1) {
        recordFrame(trace, Buffer.concat(messageParts), direction);
        messageOpcode = null;
        messageParts = [];
      }
    }
    saveState();
  };

  const server = net.createServer((client) => {
    acceptedConnections += 1;
    track(client);
    const socketTrace: ProxySocketTrace = {
      id: acceptedConnections,
      buffer: Buffer.alloc(0),
      upstreamBuffer: Buffer.alloc(0),
      requestHeader: Buffer.alloc(0),
      requestHeaderParsed: false,
      upgraded: false,
      upgradedUpstream: false,
      owner: "unclassified",
      messageOpcode: null,
      messageParts: [],
      pendingSkipBytes: 0,
      upstreamMessageOpcode: null,
      upstreamMessageParts: [],
      upstreamPendingSkipBytes: 0,
      subscriptions: new Map(),
    };
    socketTraces.set(client, socketTrace);
    appendTimeline(
      `[proxy] socket=${acceptedConnections} accepted from ${client.remoteAddress}:${client.remotePort}; accepting=${acceptingConnections}`,
    );
    client.on("data", (chunk) => {
      captureRequest(socketTrace, chunk);
      readWebSocketFrames(socketTrace, chunk, "client");
    });
    client.once("close", () => {
      appendTimeline(
        `[proxy] socket=${socketTrace.id} owner=${socketTrace.owner} closed`,
      );
      socketTraces.delete(client);
    });
    if (!acceptingConnections) {
      refusedConnections += 1;
      appendTimeline(
        `[proxy] socket=${socketTrace.id} refused during outage; awaiting handshake owner`,
      );
      let handshake = Buffer.alloc(0);
      const closeRefused = () => {
        const headerEnd = handshake.indexOf("\r\n\r\n");
        const headerBlock =
          headerEnd < 0
            ? handshake.toString("latin1")
            : handshake.subarray(0, headerEnd).toString("latin1");
        const requestLine =
          headerBlock.split("\r\n", 1)[0] ?? "no request line";
        captureRequest(socketTrace, handshake);
        appendTimeline(
          `[proxy] socket=${socketTrace.id} refused owner=${socketTrace.owner} request=${requestLine.slice(0, 120)}`,
        );
        client.destroy();
      };
      const refusalTimer = setTimeout(closeRefused, 75);
      client.on("data", (chunk) => {
        if (handshake.length < 16_384)
          handshake = Buffer.concat([
            handshake,
            chunk.subarray(0, 16_384 - handshake.length),
          ]);
        if (handshake.includes("\r\n\r\n")) {
          clearTimeout(refusalTimer);
          closeRefused();
        }
      });
      return;
    }

    const upstream = net.createConnection({
      host: "127.0.0.1",
      port: targetPort,
    });
    upstreamConnections += 1;
    track(upstream);
    connections.set(client, upstream);
    upstream.once("connect", () => {
      appendTimeline(`[proxy] socket=${socketTrace.id} upstream connected`);
    });
    client.pipe(upstream);
    upstream.pipe(client);
    upstream.on("data", (chunk) =>
      readWebSocketFrames(socketTrace, chunk, "upstream"),
    );
    client.once("close", () => {
      connections.delete(client);
      upstream.destroy();
    });
    upstream.once("close", () => client.destroy());
    client.on("error", (error) => {
      appendTimeline(
        `[proxy] socket=${socketTrace.id} client error: ${error.message}`,
      );
      upstream.destroy();
    });
    upstream.on("error", (error) => {
      appendTimeline(
        `[proxy] socket=${socketTrace.id} upstream error: ${error.message}`,
      );
      client.destroy();
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(listenPort, "0.0.0.0", () => {
      server.removeListener("error", reject);
      server.on("error", (error) => {
        appendLog(logs, `[proxy] server error: ${error.message}`);
      });
      resolve();
    });
  });
  appendTimeline(
    `[proxy] listening on localhost:${listenPort} -> 127.0.0.1:${targetPort}`,
  );

  return {
    relayUrl: `ws://localhost:${listenPort}`,
    logs,
    timelinePath,
    snapshot() {
      return {
        acceptedConnections,
        upstreamConnections,
        refusedConnections,
        activeConnections: connections.size,
        outageCount,
        acceptingConnections,
      };
    },
    async dropAndBlock(blockMs) {
      const active = [...connections.entries()];
      outageCount += 1;
      acceptingConnections = false;
      appendLog(
        logs,
        `[proxy] outage ${outageCount} started; dropped=${active.length}; refusing new TCP connections for ${blockMs}ms`,
      );
      for (const [client, upstream] of active) {
        const trace = socketTraces.get(client);
        appendTimeline(
          `[proxy] outage ${outageCount} dropped socket=${trace?.id ?? "unknown"} owner=${trace?.owner ?? "unclassified"}`,
        );
        client.destroy();
        upstream.destroy();
      }
      await new Promise((resolve) => setTimeout(resolve, blockMs));
      acceptingConnections = true;
      appendTimeline(
        `[proxy] outage ${outageCount} ended; refused=${refusedConnections}; accepting new TCP connections`,
      );
      return { droppedConnections: active.length };
    },
    async close() {
      acceptingConnections = false;
      for (const socket of sockets) socket.destroy();
      if (!server.listening) return;
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

export async function finishElectronTest(
  testInfo: TestInfo,
  userDataDir: string,
  applications: RunningElectron[],
  proxy?: TcpRelayProxy,
) {
  try {
    await cleanupElectronTest(testInfo, userDataDir, applications, proxy);
  } finally {
    rmSync(userDataDir, { recursive: true, force: true });
  }
}
