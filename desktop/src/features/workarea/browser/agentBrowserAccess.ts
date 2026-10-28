import {
  addWorkAreaTab,
  getWorkAreaState,
  openWorkArea,
  subscribeWorkArea,
} from "@/features/workarea/dock/workAreaStore";
import {
  type BrowserBrokerEvent,
  browserBroker,
} from "@/shared/api/browserBroker";

import {
  answerBrowserContinue,
  askBrowserContinue,
  noteBrowserEvent,
  noteBrowserGrant,
  resetBrowserActivity,
} from "./agentBrowserActivity";
import { browserTabId } from "./browserTabId";
import {
  decideAgentBrowserPresentation,
  isAgentBrowserTaskInView,
  isColonyWindowVisible,
  isPersonActiveInWorkArea,
} from "./agentBrowserPresentation";
import {
  createBrowserPage,
  ensureBrowserHostTab,
  getBrowserPage,
} from "./browserTabsStore";

/**
 * Default browser access for the owner's own AI employees. An agent that makes
 * its first browser call has no browser yet; the app answers by making a Colony
 * browser page in the channel's work area and giving the agent that page. When
 * the person is watching the same conversation, the dock opens on that page
 * without moving keyboard or window focus. Otherwise the page joins the strip
 * quietly and a small activity mark lets the person open it when they choose.
 *
 * The grant is the ordinary `agent-grant` request, made here, in the trusted
 * app window, never by the agent or by a page. It starts with no sites: the
 * broker approves the addresses the agent itself asks for, and still stops a
 * page that sends the browser somewhere else. Stop and Take over end it.
 *
 * After the person ended a grant, the agent's next call arrives as a `resume`
 * request. The app does not grant: it shows one Allow card on the agent's page
 * and marks the agent as waiting for the person, and only the person's click
 * brings the browser back.
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
  unsubscribeWorkArea: () => void;
};

let running: Running | null = null;
/** Bumped by every start and reset; a late result checks it (rule 2). */
let generation = 0;
const pageByTask = new Map<string, string>();
const serving = new Map<string, Promise<void>>();
const cardTimers = new Map<string, ReturnType<typeof setTimeout>>();
const taskChannels = new Map<string, string>();
const dockWasOpenByTask = new Map<string, boolean>();
const dismissedTasks = new Set<string>();
const taskByGrant = new Map<string, string>();
const latestRequestByChannel = new Map<string, number>();
let requestSequence = 0;
const MAX_TRACKED_TASKS = 256;
const MAX_DISMISSED_TASKS = 256;
let waiting: readonly AgentAccessRequest[] = Object.freeze([]);
const listeners = new Set<() => void>();

const taskKey = (request: { agentId: string; taskId: string }) =>
  `${request.agentId}|${request.taskId}`;

function rememberDismissedTask(key: string) {
  dismissedTasks.delete(key);
  dismissedTasks.add(key);
  while (dismissedTasks.size > MAX_DISMISSED_TASKS) {
    const oldest = dismissedTasks.values().next().value;
    if (oldest === undefined) break;
    dismissedTasks.delete(oldest);
  }
}

function trackTask(key: string, channelId: string) {
  const wasTracked = taskChannels.has(key);
  const previousChannel = taskChannels.get(key);
  if (previousChannel && previousChannel !== channelId)
    dockWasOpenByTask.delete(key);
  taskChannels.delete(key);
  taskChannels.set(key, channelId);
  if (!wasTracked || previousChannel !== channelId)
    dockWasOpenByTask.set(key, getWorkAreaState(channelId).open);
  while (taskChannels.size > MAX_TRACKED_TASKS) {
    const oldest = taskChannels.keys().next().value;
    if (oldest === undefined) break;
    taskChannels.delete(oldest);
    dockWasOpenByTask.delete(oldest);
  }
}

function observeWorkAreaState() {
  for (const [key, channelId] of taskChannels) {
    const wasOpen = dockWasOpenByTask.get(key) === true;
    const isOpen = getWorkAreaState(channelId).open;
    if (wasOpen && !isOpen) rememberDismissedTask(key);
    dockWasOpenByTask.set(key, isOpen);
  }
}

function trackGrant(grantId: string, key: string) {
  taskByGrant.set(grantId, key);
  if (taskByGrant.size > MAX_TRACKED_TASKS) {
    const oldest = taskByGrant.keys().next().value;
    if (oldest !== undefined) taskByGrant.delete(oldest);
  }
}

function forgetEndedGrant(event: BrowserBrokerEvent) {
  if (event.type !== "grant-changed" || event.state === "active") return;
  const key = taskByGrant.get(event.grantId);
  taskByGrant.delete(event.grantId);
  if (!key || [...taskByGrant.values()].includes(key)) return;
  taskChannels.delete(key);
  dockWasOpenByTask.delete(key);
  // A channel's conversation is one task for as long as the agent lives, so a
  // dock the person closed once must not silence every later request: the next
  // request is a new run of the task.
  dismissedTasks.delete(key);
}

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
  const card = waiting.find((entry) => taskKey(entry) === key);
  if (card) {
    answerBrowserContinue(card.agentId, card.hostId);
    publish(waiting.filter((entry) => taskKey(entry) !== key));
  }
}

function showCard(request: AgentAccessRequest) {
  const key = taskKey(request);
  forgetCard(key);
  publish([...waiting, request].slice(-4));
  askBrowserContinue(request.agentId, request.channelId, request.hostId);
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
  // The page joins the tab strip. The caller may open it after the grant if
  // the person is watching this conversation.
  addWorkAreaTab(channelId, "browser", browserTabId(key));
  const hostId = await ensureBrowserHostTab(key);
  return hostId ? { key, hostId, reused } : null;
}

async function grantOn(
  current: Running,
  request: { agentId: string; taskId: string; communityOrigin: string },
  hostId: string,
) {
  const grant = await current.api.grant({
    agentId: request.agentId,
    taskId: request.taskId,
    communityOrigin: request.communityOrigin,
    businessId: current.businessId,
    tabId: hostId,
    allowedOrigins: [],
    defaultAccess: true,
    ttlMs: DEFAULT_ACCESS_TTL_MS,
  });
  noteBrowserGrant(grant);
  trackGrant(grant.id, taskKey(request));
  return grant;
}

function maybeShowAgentBrowserPage(
  channelId: string,
  taskId: string,
  agentTaskKey: string,
  pageKey: string,
  sequence: number | null,
  asking = false,
) {
  if (sequence === null || latestRequestByChannel.get(channelId) !== sequence) {
    return;
  }
  const state = getWorkAreaState(channelId);
  const decision = decideAgentBrowserPresentation({
    viewingX: isAgentBrowserTaskInView(taskId, channelId),
    windowVisible: isColonyWindowVisible(),
    dockOpen: state.open,
    personActive: isPersonActiveInWorkArea(channelId, state.activeTabId),
    // A closed dock mutes a run that was going on, not a question the agent
    // cannot go on without: the Allow card lives in the dock.
    dismissedForTask: !asking && dismissedTasks.has(agentTaskKey),
  });
  if (decision === "show")
    openWorkArea(channelId, "browser", browserTabId(pageKey));
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
  sequence: number | null,
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
    // The card is inside the browser panel: when the person is watching this
    // conversation the panel opens on it, so the question is seen, not only
    // marked. The agent's wait for it ends in 30 s, but the person's Allow still
    // brings the browser back for the next message.
    maybeShowAgentBrowserPage(
      channelId,
      request.taskId,
      taskKey(request),
      page.key,
      sequence,
      true,
    );
    return;
  }
  try {
    await grantOn(current, request, page.hostId);
    if (mine === generation)
      maybeShowAgentBrowserPage(
        channelId,
        request.taskId,
        taskKey(request),
        page.key,
        sequence,
      );
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
  if (mine === generation)
    maybeShowAgentBrowserPage(
      channelId,
      request.taskId,
      taskKey(request),
      page.key,
      sequence,
    );
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
  const normalizedChannelId = channelId.toLowerCase();
  trackTask(key, normalizedChannelId);
  const sequence = ++requestSequence;
  latestRequestByChannel.set(normalizedChannelId, sequence);
  while (latestRequestByChannel.size > MAX_TRACKED_TASKS) {
    const oldest = latestRequestByChannel.keys().next().value;
    if (oldest === undefined) break;
    latestRequestByChannel.delete(oldest);
  }
  const job = open(
    current,
    mine,
    {
      agentId: event.agentId,
      taskId: event.taskId,
      communityOrigin: event.communityOrigin,
      resume: event.resume === true,
    },
    normalizedChannelId,
    sequence,
  )
    .catch(() => {
      if (![...taskByGrant.values()].includes(key)) {
        taskChannels.delete(key);
        dockWasOpenByTask.delete(key);
      }
    })
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
    unsubscribeWorkArea: () => {},
  };
  running = current;
  current.unsubscribeWorkArea = subscribeWorkArea(observeWorkAreaState);
  current.unsubscribe = api.onEvent((event) => {
    if (running !== current) return;
    noteBrowserEvent(event);
    forgetEndedGrant(event);
    handle(current, mine, event);
  });
}

export function resetAgentBrowserAccess() {
  generation += 1;
  running?.unsubscribe();
  running?.unsubscribeWorkArea();
  running = null;
  pageByTask.clear();
  serving.clear();
  taskChannels.clear();
  dockWasOpenByTask.clear();
  dismissedTasks.clear();
  taskByGrant.clear();
  latestRequestByChannel.clear();
  requestSequence = 0;
  for (const timer of cardTimers.values()) clearTimeout(timer);
  cardTimers.clear();
  resetBrowserActivity();
  if (waiting.length > 0) publish([]);
}
