import { relayHttpFromWs } from "@/shared/api/inviteHelpers";
import { relayClient } from "@/shared/api/relayClient";
import {
  acquireRelayHttpRequest,
  fetchRelayHttp,
  relayHttpRateLimitError,
  shouldPaceRelayHttpRequests,
} from "@/shared/api/relayHttpRequestGate";
import { signRelayEvent } from "@/shared/api/tauri";
import {
  KIND_WHATSAPP_BATCH,
  KIND_WHATSAPP_BATCH_DECISION,
  KIND_WHATSAPP_CONTACT_UPDATE,
  KIND_WHATSAPP_SEND_REQUEST,
  KIND_WHATSAPP_SAFETY_ACTION,
  KIND_WHATSAPP_SETTINGS,
  KIND_WHATSAPP_UNKNOWN_SEND_RECOVERY,
} from "@/shared/constants/kinds";
import {
  parseWhatsAppCallClosers,
  type WhatsAppCallCloser,
} from "./whatsappCallBrief";
import {
  parseWhatsAppBatchDetail,
  parseWhatsAppBatchSummary,
  parseWhatsAppContact,
  parseWhatsAppDraft,
  parseWhatsAppMessage,
  parseWhatsAppStageCounts,
  parseWhatsAppStatus,
  parseWhatsAppTemplate,
  parseWhatsAppThread,
  type WhatsAppBatchDetail,
  type WhatsAppBatchSummary,
  type WhatsAppContact,
  type WhatsAppDraft,
  type WhatsAppMessage,
  type WhatsAppStageCounts,
  type WhatsAppStatus,
  type WhatsAppTemplate,
  type WhatsAppThread,
} from "./whatsappOutreachModels";
import {
  parseWhatsAppSafetyLedger,
  type WhatsAppSafetyLedger,
} from "./whatsappOutreachSafety";

const NIP98_KIND = 27235;
const REQUEST_TIMEOUT_MS = 20_000;
const QUERY_PATH = "/api/whatsapp/query";
const CONNECT_PATH = "/api/whatsapp/connect";
const DISCONNECT_PATH = "/api/whatsapp/disconnect";
/**
 * Opt in to the stage names introduced after desktop-v3.0.37 (`queued`) and after
 * desktop-v3.0.78 (`ready_to_call`). Older apps omit a marker and are answered with a stage
 * they can show.
 */
const RELAY_CAPABILITIES = [
  "whatsapp-outreach-stage-queued",
  "whatsapp-outreach-stage-ready-to-call",
] as const;
/** Current relay query cap. The drafting runtime has its own, separate context boundary. */
export const WHATSAPP_THREAD_VISIBLE_LIMIT = 200;
/** Contacts per page; the relay clamps a page to 200. */
const CONTACT_PAGE_LIMIT = 200;
/** Pages one contact load follows (5,000 contacts), so a relay fault cannot loop for ever. */
export const WHATSAPP_CONTACT_MAX_PAGES = 25;

const contactLoadOwners = new WeakMap<
  object,
  Map<string, Promise<WhatsAppContactLoad>>
>();
const defaultContactLoadOwner = {};

/** A paged contact result that keeps consumers honest when the bounded load stops early. */
export type WhatsAppContactLoad = readonly WhatsAppContact[] &
  Readonly<{ truncated: boolean }>;

export type WhatsAppCommandKind =
  | typeof KIND_WHATSAPP_BATCH
  | typeof KIND_WHATSAPP_BATCH_DECISION
  | typeof KIND_WHATSAPP_CONTACT_UPDATE
  | typeof KIND_WHATSAPP_SEND_REQUEST
  | typeof KIND_WHATSAPP_SAFETY_ACTION
  | typeof KIND_WHATSAPP_SETTINGS
  | typeof KIND_WHATSAPP_UNKNOWN_SEND_RECOVERY;

type WhatsAppQuery =
  | { what: "status" }
  | { what: "templates"; refresh?: boolean }
  | { what: "batches"; state?: string; limit?: number }
  | { what: "batch"; batchId: string }
  | { what: "drafts"; limit?: number }
  | { what: "contacts"; limit?: number; before?: string; counts?: boolean }
  | { what: "inbox"; limit?: number }
  | { what: "call_closers" }
  | { what: "suppressions"; limit?: number }
  | { what: "unknown_sends"; limit?: number }
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

/** Matches the relay's accepted WhatsApp phone input before requesting a thread. */
function normalizeWhatsAppWaId(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 40) return null;
  let digits = "";
  for (const [index, character] of [...trimmed].entries()) {
    if (/^\d$/u.test(character)) {
      digits += character;
      continue;
    }
    if (character === "+" && index === 0) continue;
    if (" -().\u00a0".includes(character)) continue;
    return null;
  }
  const explicitInternational = trimmed.startsWith("+");
  if (digits.startsWith("00")) digits = digits.slice(2);
  else if (!explicitInternational && digits.startsWith("0")) {
    digits = `27${digits.slice(1)}`;
  }
  return /^\d{8,15}$/u.test(digits) && !digits.startsWith("0") ? digits : null;
}

function testHook(
  dependencies: ApiDependencies,
): Window["__BUZZ_E2E_WHATSAPP__"] {
  return dependencies.testHook ?? testHookFromWindow();
}

function shouldPaceWindowTestHook(dependencies: ApiDependencies): boolean {
  return dependencies.testHook === undefined && shouldPaceRelayHttpRequests();
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
    // Ordinary E2E mocks are zero-latency transport stubs. The dedicated
    // rate-limit proof opts in to the shared gate so it exercises the same
    // scheduling and 429 recovery seams as production.
    const useSharedBudget = shouldPaceWindowTestHook(dependencies);
    if (useSharedBudget) await acquireRelayHttpRequest();
    try {
      return (await hook({ action: "post", path, body })) as T;
    } catch (error) {
      if (
        useSharedBudget &&
        (error as { status?: unknown } | null)?.status === 429
      ) {
        const message =
          error instanceof Error && error.message.trim()
            ? error.message
            : "rate-limited: quota exceeded";
        throw relayHttpRateLimitError(
          new Response(null, { status: 429 }),
          message,
        );
      }
      throw error;
    }
  }

  const url = `${relayHttpFromWs(relayUrl).replace(/\/+$/u, "")}${path}`;
  const jsonBody = JSON.stringify(body);
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    const requestInit = async () => {
      const authorization = await buildWhatsAppNip98Header(url, jsonBody, {
        signer: dependencies.signer,
        nonce: dependencies.nonce,
      });
      timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      return {
        body: jsonBody,
        headers: {
          Authorization: authorization,
          "Content-Type": "application/json",
        },
        method: "POST",
        signal: controller.signal,
      };
    };
    let response: Response;
    try {
      response = dependencies.fetcher
        ? await dependencies.fetcher(url, await requestInit())
        : await fetchRelayHttp(url, requestInit);
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
    if (!response.ok) {
      const message = safeErrorText(responseBody, response.status);
      if (response.status === 429) {
        throw relayHttpRateLimitError(response, message);
      }
      throw new Error(message);
    }
    if (responseBody === null || typeof responseBody !== "object") {
      throw new Error("The WhatsApp relay returned an unreadable response.");
    }
    return responseBody as T;
  } finally {
    if (timeout !== null) clearTimeout(timeout);
  }
}

export async function queryWhatsApp<T>(
  relayUrl: string,
  query: WhatsAppQuery,
  dependencies?: ApiDependencies,
): Promise<T> {
  return postWhatsAppJson<T>(
    relayUrl,
    QUERY_PATH,
    { ...query, capabilities: RELAY_CAPABILITIES },
    dependencies,
  );
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

/**
 * Every contact, newest activity first. Follows the relay's `nextCursor` page by page; an
 * answer without one (an older relay) is the whole list in one request, returned exactly as
 * sent. A contact is skipped only when an EARLIER page of this load already returned its
 * `waId` (it moved between pages while loading); contacts inside one page are all kept, in
 * order, even with equal `waId`s.
 */
function contactLoad(
  contacts: WhatsAppContact[],
  truncated: boolean,
): WhatsAppContactLoad {
  return Object.defineProperty(contacts, "truncated", {
    enumerable: false,
    value: truncated,
    writable: false,
  }) as unknown as WhatsAppContactLoad;
}

async function loadWhatsAppContactsPageByPage(
  relayUrl: string,
  dependencies?: ApiDependencies,
): Promise<WhatsAppContactLoad> {
  const contacts: WhatsAppContact[] = [];
  // `waId`s returned by earlier pages. The current page is added only once it is processed.
  const seenWaIds = new Set<string>();
  const usedCursors = new Set<string>();
  let before: string | undefined;
  let truncated = false;
  for (let page = 0; page < WHATSAPP_CONTACT_MAX_PAGES; page += 1) {
    const response = await queryWhatsApp<{
      contacts?: unknown;
      nextCursor?: unknown;
    }>(
      relayUrl,
      {
        what: "contacts",
        limit: CONTACT_PAGE_LIMIT,
        ...(before ? { before } : {}),
      },
      dependencies,
    );
    if (!Array.isArray(response.contacts)) {
      throw new Error("The WhatsApp relay returned an invalid contact list.");
    }
    const pageContacts = response.contacts.map(parseWhatsAppContact);
    for (const contact of pageContacts) {
      if (!seenWaIds.has(contact.waId)) contacts.push(contact);
    }
    for (const contact of pageContacts) seenWaIds.add(contact.waId);
    const next = response.nextCursor;
    if (next === undefined || next === null || next === "") break;
    if (typeof next !== "string") {
      throw new Error(
        "The WhatsApp relay returned an invalid contact page cursor.",
      );
    }
    if (page === WHATSAPP_CONTACT_MAX_PAGES - 1) {
      truncated = true;
      break;
    }
    if (usedCursors.has(next)) {
      throw new Error("The WhatsApp relay repeated a contact page cursor.");
    }
    usedCursors.add(next);
    before = next;
  }
  return contactLoad(contacts, truncated);
}

/**
 * Shares one in-flight paged contact read between every active Outreach view.
 * React Query normally provides this sharing, but this seam keeps the same
 * invariant when a route transition briefly mounts two consumers at once.
 */
export function loadWhatsAppContacts(
  relayUrl: string,
  dependencies?: ApiDependencies,
): Promise<WhatsAppContactLoad> {
  const owner = dependencies ?? defaultContactLoadOwner;
  let loads = contactLoadOwners.get(owner);
  if (!loads) {
    loads = new Map();
    contactLoadOwners.set(owner, loads);
  }
  const existing = loads.get(relayUrl);
  if (existing) return existing;
  const load = loadWhatsAppContactsPageByPage(relayUrl, dependencies).finally(
    () => {
      if (loads?.get(relayUrl) !== load) return;
      loads.delete(relayUrl);
      if (loads.size === 0) contactLoadOwners.delete(owner);
    },
  );
  loads.set(relayUrl, load);
  return load;
}

/** Clears relay-scoped in-flight contact ownership on a community switch. */
export function resetWhatsAppContactLoads(): void {
  contactLoadOwners.delete(defaultContactLoadOwner);
}

/** The people a lead can be given to for its call. Never an agent. */
export async function loadWhatsAppCallClosers(
  relayUrl: string,
  dependencies?: ApiDependencies,
): Promise<WhatsAppCallCloser[]> {
  return parseWhatsAppCallClosers(
    await queryWhatsApp(relayUrl, { what: "call_closers" }, dependencies),
  );
}

/**
 * True stage counts over every contact, or `null` when the relay is too old to count. Reads
 * the whole contact list on the relay, so poll it slowly.
 */
export async function loadWhatsAppStageCounts(
  relayUrl: string,
  dependencies?: ApiDependencies,
): Promise<WhatsAppStageCounts | null> {
  return parseWhatsAppStageCounts(
    await queryWhatsApp(
      relayUrl,
      { what: "contacts", limit: 1, counts: true },
      dependencies,
    ),
  );
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
  const normalizedWaId = normalizeWhatsAppWaId(waId);
  if (!normalizedWaId) {
    throw new Error("This WhatsApp contact has an invalid phone number.");
  }
  return parseWhatsAppThread(
    await queryWhatsApp(
      relayUrl,
      {
        what: "thread",
        waId: normalizedWaId,
        limit: WHATSAPP_THREAD_VISIBLE_LIMIT,
      },
      dependencies,
    ),
  );
}

/**
 * Loads the owner-only safety ledger. Relays before outreach safety reject this query, which the
 * caller presents as unavailable instead of treating as an empty safety ledger.
 */
export async function loadWhatsAppSafetyLedger(
  relayUrl: string,
  dependencies?: ApiDependencies,
): Promise<WhatsAppSafetyLedger> {
  return parseWhatsAppSafetyLedger(
    await queryWhatsApp(
      relayUrl,
      { what: "suppressions", limit: 200 },
      dependencies,
    ),
  );
}

/** Loads owner-only unresolved send outcomes that require an explicit recovery decision. */
export async function loadWhatsAppUnknownSends(
  relayUrl: string,
  dependencies?: ApiDependencies,
): Promise<readonly WhatsAppMessage[]> {
  const response = await queryWhatsApp<{ unknownSends?: unknown }>(
    relayUrl,
    { what: "unknown_sends", limit: 100 },
    dependencies,
  );
  if (!Array.isArray(response.unknownSends)) {
    throw new Error(
      "The WhatsApp relay returned an invalid unknown-send list.",
    );
  }
  return response.unknownSends.map(parseWhatsAppMessage);
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
  contactUpdate: KIND_WHATSAPP_CONTACT_UPDATE,
  safetyAction: KIND_WHATSAPP_SAFETY_ACTION,
  unknownSendRecovery: KIND_WHATSAPP_UNKNOWN_SEND_RECOVERY,
} as const;
