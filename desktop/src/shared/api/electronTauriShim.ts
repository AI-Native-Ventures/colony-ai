/**
 * Electron implementation of Tauri's renderer IPC contract.
 *
 * Under Electron the existing Tauri app runs as a hidden headless host and the
 * preload exposes a generic `window.colonyDesktop` bridge. This module installs
 * `window.__TAURI_INTERNALS__` on top of it so every `@tauri-apps/api` import
 * in the app keeps working unchanged: invokes are forwarded to the Electron
 * main process (which answers window/app calls itself and forwards the rest to
 * the host), `plugin:event|*` subscriptions become host subscriptions, and
 * `Channel` messages are routed to their registered callbacks.
 *
 * It is a no-op outside Electron (Tauri, browser, e2e mock bridge).
 */

type DesktopMessage =
  | { type: "event"; id: number; payload: unknown }
  | { type: "channel"; id: number; sequence: number; payload: unknown }
  | { type: "shell-event"; event: string; payload: unknown }
  | { type: "shell"; name: string; payload?: unknown };

/** Bridge exposed by `electron/preload.cjs`. */
export type ColonyDesktopBridge = {
  platform: string;
  request: (type: string, payload: unknown) => Promise<unknown>;
  subscribe: (callback: (message: DesktopMessage) => void) => () => void;
};

type Listener = {
  event: string;
  handler: number;
  /** Host subscription id; absent for shell (`tauri://`) events. */
  subscription?: number;
};

type Callback = (data: unknown) => void;

declare global {
  interface Window {
    colonyDesktop?: ColonyDesktopBridge;
  }
}

const BINARY_KEY = "__colony_binary";

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
}

function fromBase64(encoded: string): ArrayBuffer {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

function decodeResult(value: unknown): unknown {
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    typeof (value as Record<string, unknown>)[BINARY_KEY] === "string"
  ) {
    return fromBase64((value as Record<string, string>)[BINARY_KEY]);
  }
  return value;
}

function binaryBody(args: unknown): Uint8Array | null {
  if (args instanceof ArrayBuffer) return new Uint8Array(args);
  if (ArrayBuffer.isView(args)) {
    return new Uint8Array(args.buffer, args.byteOffset, args.byteLength);
  }
  if (Array.isArray(args) && args.every((item) => typeof item === "number")) {
    return Uint8Array.from(args);
  }
  return null;
}

function serializeArgs(args: unknown): unknown {
  // Tauri serializes class instances (e.g. `Channel`) through toJSON.
  return args === undefined ? {} : JSON.parse(JSON.stringify(args));
}

/** @internal Exported for tests; `install` wires it to `window`. */
export function createElectronTauriInternals(desktop: ColonyDesktopBridge) {
  const callbacks = new Map<number, Callback>();
  const listeners = new Map<number, Listener>();
  let nextEventId = 1;

  function transformCallback(callback?: Callback, once = false): number {
    const id = crypto.getRandomValues(new Uint32Array(1))[0];
    callbacks.set(id, (data) => {
      if (once) callbacks.delete(id);
      callback?.(data);
    });
    return id;
  }

  function unregisterCallback(id: number) {
    callbacks.delete(id);
  }

  function runCallback(id: number, data: unknown) {
    callbacks.get(id)?.(data);
  }

  function dispatch(eventId: number, event: string, payload: unknown) {
    const listener = listeners.get(eventId);
    if (listener)
      runCallback(listener.handler, { event, id: eventId, payload });
  }

  function forget(eventId: number) {
    const listener = listeners.get(eventId);
    if (!listener) return;
    listeners.delete(eventId);
    if (listener.subscription !== undefined) {
      void desktop
        .request("unlisten", { subscription: listener.subscription })
        .catch(() => {});
    }
  }

  async function listen(args: Record<string, unknown>): Promise<number> {
    const event = String(args.event);
    const handler = Number(args.handler);
    const eventId = nextEventId++;
    const listener: Listener = { event, handler };
    listeners.set(eventId, listener);
    if (!event.startsWith("tauri://")) {
      try {
        listener.subscription = Number(
          await desktop.request("listen", { event }),
        );
      } catch (error) {
        listeners.delete(eventId);
        throw error;
      }
      // Unlistened while the subscription was being established.
      if (!listeners.has(eventId)) {
        void desktop
          .request("unlisten", { subscription: listener.subscription })
          .catch(() => {});
      }
    }
    return eventId;
  }

  desktop.subscribe((message) => {
    if (message.type === "event") {
      for (const [eventId, listener] of listeners) {
        if (listener.subscription === message.id) {
          dispatch(eventId, listener.event, message.payload);
        }
      }
    } else if (message.type === "channel") {
      runCallback(message.id, {
        index: message.sequence,
        message: decodeResult(message.payload),
      });
    } else if (message.type === "shell-event") {
      for (const [eventId, listener] of listeners) {
        if (listener.event === message.event) {
          dispatch(eventId, message.event, message.payload);
        }
      }
    }
  });

  async function invoke(
    command: string,
    args: unknown = {},
    options?: { headers?: HeadersInit },
  ): Promise<unknown> {
    const record = (args ?? {}) as Record<string, unknown>;
    switch (command) {
      case "plugin:event|listen":
        return listen(record);
      case "plugin:event|unlisten":
        forget(Number(record.eventId));
        return null;
      case "plugin:event|emit":
      case "plugin:event|emit_to":
        return desktop.request("emit", {
          event: String(record.event),
          payload: record.payload ?? null,
        });
    }
    const headers: Record<string, string> = {};
    if (options?.headers) {
      new Headers(options.headers).forEach((value, name) => {
        headers[name] = value;
      });
    }
    const bytes = binaryBody(args);
    const payload =
      bytes && !(Array.isArray(args) && args.length === 0)
        ? { command, args: {}, binary: toBase64(bytes), headers }
        : { command, args: serializeArgs(args), headers };
    return decodeResult(await desktop.request("invoke", payload));
  }

  const internals = {
    invoke,
    transformCallback,
    unregisterCallback,
    runCallback,
    callbacks,
    convertFileSrc(filePath: string, protocol = "asset") {
      return `${protocol}://localhost/${encodeURIComponent(filePath)}`;
    },
    metadata: {
      currentWindow: { label: "main" },
      currentWebview: { windowLabel: "main", label: "main" },
    },
    plugins: {
      path: {
        sep: desktop.platform === "win32" ? "\\" : "/",
        delimiter: desktop.platform === "win32" ? ";" : ":",
      },
    },
  };
  const eventInternals = {
    unregisterListener(_event: string, eventId: number) {
      forget(eventId);
    },
  };
  return { internals, eventInternals };
}

/** Install the shim when running inside the Electron shell. */
export function installElectronTauriShim(): boolean {
  const target = window as unknown as Record<string, unknown>;
  const desktop = window.colonyDesktop;
  if (!desktop || target.__TAURI_INTERNALS__) return false;
  const { internals, eventInternals } = createElectronTauriInternals(desktop);
  target.__TAURI_INTERNALS__ = internals;
  target.__TAURI_EVENT_PLUGIN_INTERNALS__ = eventInternals;
  target.isTauri = true;
  return true;
}

installElectronTauriShim();
