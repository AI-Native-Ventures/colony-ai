import { relayHttpFromWs } from "@/shared/api/inviteHelpers";
import { relayClient } from "@/shared/api/relayClient";
import { signRelayEvent } from "@/shared/api/tauri";
import {
  KIND_WHATSAPP_BATCH,
  KIND_WHATSAPP_BATCH_DECISION,
  KIND_WHATSAPP_SEND_REQUEST,
  KIND_WHATSAPP_SETTINGS,
} from "@/shared/constants/kinds";
import {
  parseWhatsAppBatchDetail,
  parseWhatsAppBatchSummary,
  parseWhatsAppContact,
  parseWhatsAppDraft,
  parseWhatsAppStatus,
  parseWhatsAppTemplate,
  parseWhatsAppThread,
  type WhatsAppBatchDetail,
  type WhatsAppBatchSummary,
  type WhatsAppContact,
  type WhatsAppDraft,
  type WhatsAppStatus,
  type WhatsAppTemplate,
  type WhatsAppThread,
} from "./whatsappOutreachModels";

const NIP98_KIND = 27235;
const REQUEST_TIMEOUT_MS = 20_000;
const QUERY_PATH = "/api/whatsapp/query";
const CONNECT_PATH = "/api/whatsapp/connect";
const DISCONNECT_PATH = "/api/whatsapp/disconnect";

export type WhatsAppCommandKind =
  | typeof KIND_WHATSAPP_BATCH
  | typeof KIND_WHATSAPP_BATCH_DECISION
  | typeof KIND_WHATSAPP_SEND_REQUEST
  | typeof KIND_WHATSAPP_SETTINGS;

type WhatsAppQuery =
  | { what: "status" }
  | { what: "templates"; refresh?: boolean }
  | { what: "batches"; state?: string; limit?: number }
  | { what: "batch"; batchId: string }
  | { what: "drafts"; limit?: number }
  | { what: "contacts"; limit?: number }
  | { what: "inbox"; limit?: number }
  | { what: "thread"; waId: string; limit?: number };

export type WhatsAppApiTestRequest = Readonly<{
  action: "post" | "command";
  path?: string;
  body?: Record<string, unknown>;
  kind?: WhatsAppCommandKind;
}>;

declare global {
  interface Window {
    /** Test build only. A mocked relay response; never enabled in production. */
    __BUZZ_E2E_WHATSAPP__?: (
      request: WhatsAppApiTestRequest,
    ) => Promise<unknown>;
  }
}

type ApiDependencies = {
  fetcher?: typeof fetch;
  signer?: typeof signRelayEvent;
  testHook?: Window["__BUZZ_E2E_WHATSAPP__"];
  nonce?: () => string;
};

function testHookFromWindow(): Window["__BUZZ_E2E_WHATSAPP__"] {
  return import.meta.env?.MODE === "e2e" && typeof window !== "undefined"
    ? window.__BUZZ_E2E_WHATSAPP__
    : undefined;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function buildWhatsAppNip98Header(
  url: string,
  body: string,
  dependencies: Pick<ApiDependencies, "signer" | "nonce"> = {},
): Promise<string> {
  const signer = dependencies.signer ?? signRelayEvent;
  const nonce = dependencies.nonce ?? (() => crypto.randomUUID());
  const event = await signer({
    kind: NIP98_KIND,
    content: "",
    tags: [
      ["u", url],
      ["method", "POST"],
      ["payload", await sha256Hex(body)],
      ["nonce", nonce()],
    ],
  });
  return `Nostr ${btoa(JSON.stringify(event))}`;
}

function safeErrorText(body: unknown, status: number): string {
  if (typeof body === "object" && body !== null) {
    const value = body as Record<string, unknown>;
    if (typeof value.error === "string" && value.error.trim()) {
      return value.error.trim();
    }
    if (typeof value.message === "string" && value.message.trim()) {
      return value.message.trim();
    }
  }
  return `WhatsApp request failed (${status}).`;
}

function testHook(
  dependencies: ApiDependencies,
): Window["__BUZZ_E2E_WHATSAPP__"] {
  return dependencies.testHook ?? testHookFromWindow();
}

/** One authenticated JSON POST. The request body is never persisted or logged. */
export async function postWhatsAppJson<T>(
  relayUrl: string,
  path: string,
  body: Record<string, unknown>,
  dependencies: ApiDependencies = {},
): Promise<T> {
  const hook = testHook(dependencies);
  if (hook) {
    return (await hook({ action: "post", path, body })) as T;
  }

  const url = `${relayHttpFromWs(relayUrl).replace(/\/+$/u, "")}${path}`;
  const jsonBody = JSON.stringify(body);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const fetcher = dependencies.fetcher ?? fetch;
    const authorization = await buildWhatsAppNip98Header(url, jsonBody, {
      signer: dependencies.signer,
      nonce: dependencies.nonce,
    });
    let response: Response;
    try {
      response = await fetcher(url, {
        method: "POST",
        headers: {
          Authorization: authorization,
          "Content-Type": "application/json",
        },
        body: jsonBody,
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error("WhatsApp took too long to respond. Try again.");
      }
      throw new Error(
        error instanceof Error && error.message
          ? error.message
          : "Could not reach the WhatsApp relay. Check your connection and retry.",
      );
    }
    const responseBody: unknown = await response.json().catch(() => null);
    if (!response.ok)
      throw new Error(safeErrorText(responseBody, response.status));
    if (responseBody === null || typeof responseBody !== "object") {
      throw new Error("The WhatsApp relay returned an unreadable response.");
    }
    return responseBody as T;
  } finally {
    clearTimeout(timeout);
  }
}

export async function queryWhatsApp<T>(
  relayUrl: string,
  query: WhatsAppQuery,
  dependencies?: ApiDependencies,
): Promise<T> {
  return postWhatsAppJson<T>(relayUrl, QUERY_PATH, query, dependencies);
}

export async function loadWhatsAppStatus(
  relayUrl: string,
  dependencies?: ApiDependencies,
): Promise<WhatsAppStatus> {
  return parseWhatsAppStatus(
    await queryWhatsApp(relayUrl, { what: "status" }, dependencies),
  );
}

export async function loadWhatsAppTemplates(
  relayUrl: string,
  refresh = false,
  dependencies?: ApiDependencies,
): Promise<readonly WhatsAppTemplate[]> {
  const response = await queryWhatsApp<{ templates?: unknown }>(
    relayUrl,
    { what: "templates", ...(refresh ? { refresh: true } : {}) },
    dependencies,
  );
  if (!Array.isArray(response.templates)) {
    throw new Error("The WhatsApp relay returned an invalid template list.");
  }
  return response.templates.map(parseWhatsAppTemplate);
}

export async function loadWhatsAppContacts(
  relayUrl: string,
  dependencies?: ApiDependencies,
): Promise<readonly WhatsAppContact[]> {
  const response = await queryWhatsApp<{ contacts?: unknown }>(
    relayUrl,
    { what: "contacts", limit: 200 },
    dependencies,
  );
  if (!Array.isArray(response.contacts)) {
    throw new Error("The WhatsApp relay returned an invalid contact list.");
  }
  return response.contacts.map(parseWhatsAppContact);
}

export async function loadWhatsAppBatches(
  relayUrl: string,
  state?: string,
  dependencies?: ApiDependencies,
): Promise<readonly WhatsAppBatchSummary[]> {
  const response = await queryWhatsApp<{ batches?: unknown }>(
    relayUrl,
    { what: "batches", limit: 100, ...(state ? { state } : {}) },
    dependencies,
  );
  if (!Array.isArray(response.batches)) {
    throw new Error("The WhatsApp relay returned an invalid batch list.");
  }
  return response.batches.map(parseWhatsAppBatchSummary);
}

/** Loads a bounded set of pending batch cards for inbox preview and review links. */
export async function loadWhatsAppPendingBatchDetails(
  relayUrl: string,
  dependencies?: ApiDependencies,
): Promise<readonly WhatsAppBatchDetail[]> {
  const summaries = (
    await loadWhatsAppBatches(relayUrl, "pending", dependencies)
  ).slice(0, 20);
  const details: WhatsAppBatchDetail[] = [];
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < summaries.length) {
      const summary = summaries[nextIndex++];
      const detail = await loadWhatsAppBatch(
        relayUrl,
        summary.batchId,
        dependencies,
      );
      if (detail.status === "pending") details.push(detail);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(3, summaries.length) }, () => worker()),
  );
  return details;
}

/** Loads a bounded set of small approved batches for queued-message actions. */
export async function loadWhatsAppApprovedBatchDetails(
  relayUrl: string,
  dependencies?: ApiDependencies,
): Promise<readonly WhatsAppBatchDetail[]> {
  const summaries = (
    await loadWhatsAppBatches(relayUrl, "approved", dependencies)
  )
    .filter(
      (summary) => summary.status === "approved" && summary.rows.total <= 3,
    )
    .slice(0, 20);
  const details: WhatsAppBatchDetail[] = [];
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < summaries.length) {
      const summary = summaries[nextIndex++];
      const detail = await loadWhatsAppBatch(
        relayUrl,
        summary.batchId,
        dependencies,
      );
      if (detail.status === "approved" && detail.rows.length <= 3) {
        details.push(detail);
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(3, summaries.length) }, () => worker()),
  );
  return details;
}

export async function loadWhatsAppBatch(
  relayUrl: string,
  batchId: string,
  dependencies?: ApiDependencies,
): Promise<WhatsAppBatchDetail> {
  return parseWhatsAppBatchDetail(
    await queryWhatsApp(relayUrl, { what: "batch", batchId }, dependencies),
  );
}

export async function loadWhatsAppDrafts(
  relayUrl: string,
  dependencies?: ApiDependencies,
): Promise<readonly WhatsAppDraft[]> {
  const response = await queryWhatsApp<{ drafts?: unknown }>(
    relayUrl,
    { what: "drafts", limit: 100 },
    dependencies,
  );
  if (!Array.isArray(response.drafts)) {
    throw new Error("The WhatsApp relay returned an invalid draft list.");
  }
  return response.drafts.map(parseWhatsAppDraft);
}

export async function loadWhatsAppThread(
  relayUrl: string,
  waId: string,
  dependencies?: ApiDependencies,
): Promise<WhatsAppThread> {
  return parseWhatsAppThread(
    await queryWhatsApp(
      relayUrl,
      { what: "thread", waId, limit: 100 },
      dependencies,
    ),
  );
}

export async function connectWhatsApp(
  relayUrl: string,
  credentials: {
    accessToken: string;
    phoneNumberId: string;
    wabaId: string;
    appSecret: string;
  },
  dependencies?: ApiDependencies,
): Promise<WhatsAppStatus> {
  const result = await postWhatsAppJson(
    relayUrl,
    CONNECT_PATH,
    credentials,
    dependencies,
  );
  return parseWhatsAppStatus(result);
}

export async function disconnectWhatsApp(
  relayUrl: string,
  dependencies?: ApiDependencies,
): Promise<WhatsAppStatus> {
  return parseWhatsAppStatus(
    await postWhatsAppJson(relayUrl, DISCONNECT_PATH, {}, dependencies),
  );
}

export async function publishWhatsAppCommand(
  kind: WhatsAppCommandKind,
  payload: Record<string, unknown>,
  dependencies: {
    signer?: typeof signRelayEvent;
    publisher?: typeof relayClient.publishEvent;
    testHook?: Window["__BUZZ_E2E_WHATSAPP__"];
  } = {},
): Promise<void> {
  const hook = dependencies.testHook ?? testHookFromWindow();
  if (hook) {
    await hook({ action: "command", kind, body: payload });
    return;
  }
  const event = await (dependencies.signer ?? signRelayEvent)({
    kind,
    content: JSON.stringify(payload),
    tags: [],
  });
  // Call through the client: passing relayClient.publishEvent bare drops `this`,
  // so every approve, reject and send failed on "reading 'pendingEvents'".
  const publish =
    dependencies.publisher ??
    ((relayEvent, timeoutMessage, sendErrorMessage) =>
      relayClient.publishEvent(relayEvent, timeoutMessage, sendErrorMessage));
  await publish(
    event,
    "Timed out sending the WhatsApp request.",
    "The WhatsApp relay refused the request.",
  );
}

export function makeWhatsAppCommand(
  kind: WhatsAppCommandKind,
  payload: Record<string, unknown>,
): { kind: WhatsAppCommandKind; content: string; tags: string[][] } {
  return { kind, content: JSON.stringify(payload), tags: [] };
}

export const whatsappCommandKinds = {
  batch: KIND_WHATSAPP_BATCH,
  decision: KIND_WHATSAPP_BATCH_DECISION,
  send: KIND_WHATSAPP_SEND_REQUEST,
  settings: KIND_WHATSAPP_SETTINGS,
} as const;
