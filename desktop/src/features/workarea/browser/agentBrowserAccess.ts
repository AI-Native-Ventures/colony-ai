import { openWorkArea } from "@/features/workarea/dock/workAreaStore";
import {
  type BrowserBrokerEvent,
  browserBroker,
} from "@/shared/api/browserBroker";

import { browserTabId } from "./browserTabId";
import {
  createBrowserPage,
  ensureBrowserHostTab,
  getBrowserPage,
} from "./browserTabsStore";

/**
 * Default browser access for the owner's own AI employees. An agent that makes
 * its first browser call has no browser yet; the app answers by opening the
 * channel's work area on a Colony browser page and giving the agent that page.
 * The person did not have to open anything first, and watches the agent work.
 *
 * The grant is the ordinary `agent-grant` request, made here, in the trusted
 * app window, never by the agent or by a page. It starts with no sites: the
 * broker approves the addresses the agent itself asks for, and still stops a
 * page that sends the browser somewhere else. Stop and Take over end it.
 *
 * After the person ended a grant, the agent's next call arrives as a `resume`
 * request. The app opens the panel again but does not grant: it shows one
 * Allow card, and only the person's click brings the browser back.
 *
 * Community scoped: `resetAgentBrowserAccess` is wired into
 * `resetWorkAreaState()` and so `resetCommunityState()`.
 */

/** The longest a grant may last; the agent's next call renews it. */
export const DEFAULT_ACCESS_TTL_MS = 60 * 60_000;
/** How long an Allow card waits for the person. */
export const ALLOW_CARD_MS = 10 * 60_000;

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const AGENT = /^[0-9a-f]{64}$/u;
const TASK = new RegExp(
  `^(?:conversation:(${UUID})|thread:(${UUID}):[0-9a-f]{64})$`,
  "u",
);

export type AgentAccessRequest = {
  agentId: string;
  taskId: string;
  communityOrigin: string;
  channelId: string;
  /** The page the agent would work in. */
  hostId: string;
};

type Running = {
  businessId: string;
  communityOrigin: string;
  api: Pick<typeof browserBroker, "grant" | "onEvent">;
  unsubscribe: () => void;
};

let running: Running | null = null;
/** Bumped by every start and reset; a late result checks it (rule 2). */
let generation = 0;
const pageByTask = new Map<string, string>();
const serving = new Map<string, Promise<void>>();
const cardTimers = new Map<string, ReturnType<typeof setTimeout>>();
let waiting: readonly AgentAccessRequest[] = Object.freeze([]);
const listeners = new Set<() => void>();

const taskKey = (request: { agentId: string; taskId: string }) =>
  `${request.agentId}|${request.taskId}`;

function publish(next: readonly AgentAccessRequest[]) {
  waiting = Object.freeze(next);
  for (const listener of listeners) listener();
}

export function subscribeAgentAccess(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Requests waiting for the person's Allow. Stable between changes. */
export function getWaitingAgentAccess(): readonly AgentAccessRequest[] {
  return waiting;
}

function forgetCard(key: string) {
  const timer = cardTimers.get(key);
  if (timer !== undefined) clearTimeout(timer);
  cardTimers.delete(key);
  if (waiting.some((entry) => taskKey(entry) === key))
    publish(waiting.filter((entry) => taskKey(entry) !== key));
}

function showCard(request: AgentAccessRequest) {
  const key = taskKey(request);
  forgetCard(key);
  publish([...waiting, request].slice(-4));
  cardTimers.set(
    key,
    setTimeout(() => forgetCard(key), ALLOW_CARD_MS),
  );
}

/** The person chose not to let the agent continue. */
export function dismissAgentAccessRequest(request: {
  agentId: string;
  taskId: string;
}) {
  forgetCard(taskKey(request));
}

async function pageFor(
  request: { agentId: string; taskId: string },
  channelId: string,
  fresh: boolean,
): Promise<{ key: string; hostId: string; reused: boolean } | null> {
  const known = pageByTask.get(taskKey(request));
  let key = !fresh && known && getBrowserPage(known)?.hostId ? known : null;
  const reused = key !== null;
  if (!key) {
    const created = createBrowserPage(channelId);
    if (!created.ok) return null;
    key = created.key;
    pageByTask.set(taskKey(request), key);
  }
  // The panel appears at once; the page behind it is made while it does.
  openWorkArea(channelId, "browser", browserTabId(key));
  const hostId = await ensureBrowserHostTab(key);
  return hostId ? { key, hostId, reused } : null;
}

async function grantOn(
  current: Running,
  request: { agentId: string; taskId: string; communityOrigin: string },
  hostId: string,
) {
  await current.api.grant({
    agentId: request.agentId,
    taskId: request.taskId,
    communityOrigin: request.communityOrigin,
    businessId: current.businessId,
    tabId: hostId,
    allowedOrigins: [],
    defaultAccess: true,
    ttlMs: DEFAULT_ACCESS_TTL_MS,
  });
}

/** Open the browser for a task and give the agent that page. */
async function open(
  current: Running,
  mine: number,
  request: {
    agentId: string;
    taskId: string;
    communityOrigin: string;
    resume: boolean;
  },
  channelId: string,
) {
  let page = await pageFor(request, channelId, false);
  if (mine !== generation || !page) return;
  if (request.resume) {
    showCard({
      agentId: request.agentId,
      taskId: request.taskId,
      communityOrigin: request.communityOrigin,
      channelId,
      hostId: page.hostId,
    });
    return;
  }
  try {
    await grantOn(current, request, page.hostId);
    return;
  } catch (error) {
    // A reused page can be busy with another agent's task: one fresh page.
    // Otherwise the agent hears the approval guidance when its wait ends, and
    // the person can still allow it by hand in the browser panel.
    if (!page.reused) throw error;
  }
  page = await pageFor(request, channelId, true);
  if (mine !== generation || !page) return;
  await grantOn(current, request, page.hostId);
}

/**
 * The person allows an agent that asked to continue. Opens the page again when
 * it was closed meanwhile.
 */
export async function allowAgentAccess(request: AgentAccessRequest) {
  const current = running;
  if (!current) return;
  const mine = generation;
  let hostId = request.hostId;
  if (!pageHost(hostId)) {
    const page = await pageFor(request, request.channelId, true);
    if (mine !== generation || !page) return;
    hostId = page.hostId;
  }
  await grantOn(current, request, hostId);
  if (mine === generation) forgetCard(taskKey(request));
}

function pageHost(hostId: string): boolean {
  for (const key of pageByTask.values())
    if (getBrowserPage(key)?.hostId === hostId) return true;
  return false;
}

function handle(current: Running, mine: number, event: BrowserBrokerEvent) {
  if (event.type !== "access-requested" || mine !== generation) return;
  // Only this community's own agents, and only a well formed task.
  if (event.communityOrigin !== current.communityOrigin) return;
  if (!AGENT.test(event.agentId)) return;
  const match = TASK.exec(event.taskId);
  const channelId = match?.[1] ?? match?.[2];
  if (!channelId) return;
  const key = taskKey(event);
  if (serving.has(key)) return;
  const job = open(
    current,
    mine,
    {
      agentId: event.agentId,
      taskId: event.taskId,
      communityOrigin: event.communityOrigin,
      resume: event.resume === true,
    },
    channelId.toLowerCase(),
  )
    .catch(() => {})
    .finally(() => {
      if (serving.get(key) === job) serving.delete(key);
    });
  serving.set(key, job);
}

/**
 * Start answering `access-requested` for the active community. Call once per
 * community, after `resetAgentBrowserAccess`.
 */
export function startAgentBrowserAccess({
  businessId,
  communityOrigin,
  api = browserBroker,
}: {
  businessId: string;
  communityOrigin: string;
  api?: Pick<typeof browserBroker, "grant" | "onEvent">;
}) {
  resetAgentBrowserAccess();
  const mine = generation;
  const current: Running = {
    businessId,
    communityOrigin,
    api,
    unsubscribe: () => {},
  };
  running = current;
  current.unsubscribe = api.onEvent((event) => {
    if (running === current) handle(current, mine, event);
  });
}

export function resetAgentBrowserAccess() {
  generation += 1;
  running?.unsubscribe();
  running = null;
  pageByTask.clear();
  serving.clear();
  for (const timer of cardTimers.values()) clearTimeout(timer);
  cardTimers.clear();
  if (waiting.length > 0) publish([]);
}
