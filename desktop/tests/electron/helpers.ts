import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
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

export type TestIdentity = {
  secretKey: Uint8Array;
  publicKey: string;
  nsec: string;
};

export type RunningElectron = {
  application: ElectronApplication;
  page: Page;
  userDataDir: string;
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

export type TcpRelayProxy = {
  relayUrl: string;
  logs: string[];
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
  const application = await electron.launch({
    cwd: desktopRoot,
    args: [path.join(desktopRoot, "electron", "main.mjs")],
    env: {
      ...process.env,
      BUZZ_RELAY_URL: relayUrl,
      COLONY_ELECTRON_BACKGROUND: "1",
      COLONY_ELECTRON_USER_DATA: userDataDir,
      COLONY_NATIVE_HOST: nativeHost,
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

  const page = await application.firstWindow();
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      appendLog(logs, `[renderer-${message.type()}] ${message.text()}`);
    }
  });
  page.on("pageerror", (error) =>
    appendLog(logs, `[pageerror] ${error.message}`),
  );
  await page.waitForLoadState("domcontentloaded", { timeout: 60_000 });

  return { application, page, userDataDir, logs, closed: false };
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
  if (proxy) {
    await testInfo.attach("relay-proxy.log", {
      body: Buffer.from(`${proxy.logs.join("\n")}\n`),
      contentType: "text/plain",
    });
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
) {
  const event = finalizeEvent(
    {
      kind: 9,
      created_at: Math.floor(Date.now() / 1000),
      tags: [["h", GENERAL_CHANNEL_ID]],
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
): Promise<RelayEvent[]> {
  const session = await connectNostrClient(relayUrl, generateSecretKey());
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
            "#h": [GENERAL_CHANNEL_ID],
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
): Promise<RelayEvent | undefined> {
  const deadline = Date.now() + timeoutMs;
  do {
    const events = await readChannelEvents(relayUrl, authorPublicKey);
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
}: {
  listenPort?: number;
  targetPort?: number;
} = {}): Promise<TcpRelayProxy> {
  let acceptingConnections = true;
  let acceptedConnections = 0;
  let upstreamConnections = 0;
  let refusedConnections = 0;
  let outageCount = 0;
  const connections = new Map<Socket, Socket>();
  const sockets = new Set<Socket>();
  const logs: string[] = [];

  const track = (socket: Socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  };

  const server = net.createServer((client) => {
    acceptedConnections += 1;
    track(client);
    appendLog(
      logs,
      `[proxy] accepted client ${acceptedConnections} from ${client.remoteAddress}:${client.remotePort}; accepting=${acceptingConnections}`,
    );
    if (!acceptingConnections) {
      refusedConnections += 1;
      appendLog(
        logs,
        `[proxy] refused client ${refusedConnections} during outage`,
      );
      client.destroy();
      return;
    }

    const upstream = net.createConnection({
      host: "127.0.0.1",
      port: targetPort,
    });
    upstreamConnections += 1;
    track(upstream);
    connections.set(client, upstream);
    client.pipe(upstream);
    upstream.pipe(client);
    client.once("close", () => {
      connections.delete(client);
      upstream.destroy();
    });
    upstream.once("close", () => client.destroy());
    client.on("error", (error) => {
      appendLog(logs, `[proxy] client socket error: ${error.message}`);
      upstream.destroy();
    });
    upstream.on("error", (error) => {
      appendLog(logs, `[proxy] upstream socket error: ${error.message}`);
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
  appendLog(
    logs,
    `[proxy] listening on localhost:${listenPort} -> 127.0.0.1:${targetPort}`,
  );

  return {
    relayUrl: `ws://localhost:${listenPort}`,
    logs,
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
        client.destroy();
        upstream.destroy();
      }
      await new Promise((resolve) => setTimeout(resolve, blockMs));
      acceptingConnections = true;
      appendLog(
        logs,
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
