import type {
  BrowserActionEntry,
  BrowserBrokerEvent,
  BrowserGrant,
} from "@/shared/api/browserBroker";

/**
 * Who is using the browser right now, for the small "Scout is using the
 * browser" marks (the channel in the sidebar, the channel header and the page's
 * tab). An AI employee works in a page without the dock open, so these marks
 * are how the person knows, and how they choose to watch: they click one. The
 * dock never opens or switches by itself.
 *
 * Two states per agent and channel. `working`: it did something in the last few
 * seconds. `needs-you`: it is stopped on a question only the person can answer
 * (confirm a send, allow a site, allow it to continue after Stop), which the
 * person finds in the page's own controls.
 *
 * Community scoped: `resetBrowserActivity` is wired into
 * `resetAgentBrowserAccess()` and so `resetCommunityState()`.
 */

/** How long after its last action an agent still counts as using the browser. */
export const BROWSER_ACTIVITY_MS = 12_000;
/** A question nobody answers stops showing after this. */
export const BROWSER_QUESTION_MS = 10 * 60_000;

export type BrowserActivity = {
  agentId: string;
  channelId: string;
  state: "working" | "needs-you";
  /** The live tabs it touched (or is stopped on). */
  hostIds: readonly string[];
};

type Entry = {
  agentId: string;
  channelId: string;
  working: { until: number; hostIds: Set<string> } | null;
  questions: Map<string, { until: number; hostId: string | null }>;
};

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const TASK = new RegExp(`^(?:conversation:(${UUID})|thread:(${UUID}):)`, "u");

let clock: () => number = () => Date.now();
const entries = new Map<string, Entry>();
const grantOwners = new Map<string, { agentId: string; channelId: string }>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const listeners = new Set<() => void>();
let version = 0;
let byChannel = new Map<string, readonly BrowserActivity[]>();
let byHost = new Map<string, readonly BrowserActivity[]>();
const NONE: readonly BrowserActivity[] = Object.freeze([]);

const keyOf = (agentId: string, channelId: string) => `${agentId}|${channelId}`;

/** The channel a task belongs to, or null for text that is not a task. */
export function channelOfTask(taskId: string | undefined): string | null {
  const match = taskId ? TASK.exec(taskId) : null;
  const channel = match?.[1] ?? match?.[2];
  return channel ? channel.toLowerCase() : null;
}

function publish() {
  version += 1;
  byChannel = new Map();
  byHost = new Map();
  for (const listener of listeners) listener();
}

function activitiesOf(entry: Entry): BrowserActivity | null {
  const hostIds = new Set<string>(entry.working?.hostIds ?? []);
  for (const question of entry.questions.values())
    if (question.hostId) hostIds.add(question.hostId);
  if (entry.questions.size > 0)
    return {
      agentId: entry.agentId,
      channelId: entry.channelId,
      state: "needs-you",
      hostIds: [...hostIds],
    };
  if (entry.working)
    return {
      agentId: entry.agentId,
      channelId: entry.channelId,
      state: "working",
      hostIds: [...hostIds],
    };
  return null;
}

function schedule(entry: Entry) {
  const key = keyOf(entry.agentId, entry.channelId);
  const old = timers.get(key);
  if (old !== undefined) clearTimeout(old);
  timers.delete(key);
  const now = clock();
  const dues = [
    ...(entry.working ? [entry.working.until] : []),
    ...[...entry.questions.values()].map((question) => question.until),
  ];
  if (dues.length === 0) return;
  const wait = Math.max(0, Math.min(...dues) - now);
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key);
      expire(entry);
    }, wait),
  );
}

function expire(entry: Entry) {
  const now = clock();
  if (entry.working && entry.working.until <= now) entry.working = null;
  for (const [id, question] of entry.questions)
    if (question.until <= now) entry.questions.delete(id);
  settle(entry);
}

function settle(entry: Entry) {
  const key = keyOf(entry.agentId, entry.channelId);
  if (!entry.working && entry.questions.size === 0) entries.delete(key);
  else schedule(entry);
  publish();
}

function entryFor(agentId: string, channelId: string): Entry {
  const key = keyOf(agentId, channelId);
  let entry = entries.get(key);
  if (!entry) {
    entry = { agentId, channelId, working: null, questions: new Map() };
    entries.set(key, entry);
  }
  return entry;
}

function markWorking(agentId: string, channelId: string, hostId?: string) {
  const entry = entryFor(agentId, channelId);
  const hostIds = entry.working?.hostIds ?? new Set<string>();
  if (hostId) hostIds.add(hostId);
  entry.working = { until: clock() + BROWSER_ACTIVITY_MS, hostIds };
  settle(entry);
}

function ask(
  agentId: string,
  channelId: string,
  questionId: string,
  hostId: string | null,
) {
  const entry = entryFor(agentId, channelId);
  entry.questions.set(questionId, {
    until: clock() + BROWSER_QUESTION_MS,
    hostId,
  });
  settle(entry);
}

function answer(questionId: string) {
  for (const entry of [...entries.values()]) {
    if (entry.questions.delete(questionId)) settle(entry);
  }
}

/** The app made this grant: remember whose it is, for the questions that follow. */
export function noteBrowserGrant(grant: BrowserGrant) {
  const channelId = channelOfTask(grant.taskId);
  if (channelId)
    grantOwners.set(grant.id, { agentId: grant.agentId, channelId });
}

/** An agent who stopped on "may I continue?" after the person pressed Stop. */
export function askBrowserContinue(
  agentId: string,
  channelId: string,
  hostId: string | null,
) {
  ask(agentId, channelId, `continue|${agentId}|${hostId ?? ""}`, hostId);
}

export function answerBrowserContinue(agentId: string, hostId: string | null) {
  answer(`continue|${agentId}|${hostId ?? ""}`);
}

/** Feed one broker event. Everything else is ignored. */
export function noteBrowserEvent(event: BrowserBrokerEvent) {
  switch (event.type) {
    case "agent-action": {
      const entry: BrowserActionEntry = event.entry;
      const channelId = channelOfTask(entry.taskId);
      if (!channelId || !entry.agentId) return;
      markWorking(entry.agentId, channelId, entry.tabId);
      return;
    }
    case "confirmation-requested": {
      const owner = grantOwners.get(event.grantId);
      if (owner)
        ask(owner.agentId, owner.channelId, event.actionId, event.tabId);
      return;
    }
    case "confirmation-resolved":
      answer(event.actionId);
      return;
    case "origin-approval-requested": {
      const owner = grantOwners.get(event.grantId);
      if (owner)
        ask(
          owner.agentId,
          owner.channelId,
          `origin|${event.grantId}|${event.origin}`,
          event.tabId,
        );
      return;
    }
    case "grant-changed": {
      if (event.state !== "active") {
        const owner = grantOwners.get(event.grantId);
        grantOwners.delete(event.grantId);
        if (owner)
          for (const entry of [...entries.values()]) {
            if (entry.agentId !== owner.agentId) continue;
            let changed = false;
            for (const id of [...entry.questions.keys()])
              if (id.startsWith(`origin|${event.grantId}|`)) {
                entry.questions.delete(id);
                changed = true;
              }
            if (changed) settle(entry);
          }
        return;
      }
      if (event.change === "origin-approved") {
        for (const entry of [...entries.values()]) {
          let changed = false;
          for (const id of [...entry.questions.keys()])
            if (id.startsWith(`origin|${event.grantId}|`)) {
              entry.questions.delete(id);
              changed = true;
            }
          if (changed) settle(entry);
        }
      }
      return;
    }
    default:
  }
}

export function subscribeBrowserActivity(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Who is using the browser in this channel. Stable between changes. */
export function getBrowserActivityForChannel(
  channelId: string,
): readonly BrowserActivity[] {
  const cached = byChannel.get(channelId);
  if (cached) return cached;
  const list = [...entries.values()]
    .filter((entry) => entry.channelId === channelId)
    .map(activitiesOf)
    .filter((item): item is BrowserActivity => item !== null);
  const result = list.length === 0 ? NONE : Object.freeze(list);
  byChannel.set(channelId, result);
  return result;
}

/** Who is using this live tab. Stable between changes. */
export function getBrowserActivityForHost(
  hostId: string | null,
): readonly BrowserActivity[] {
  if (!hostId) return NONE;
  const cached = byHost.get(hostId);
  if (cached) return cached;
  const list = [...entries.values()]
    .map(activitiesOf)
    .filter(
      (item): item is BrowserActivity =>
        item?.hostIds.includes(hostId) === true,
    );
  const result = list.length === 0 ? NONE : Object.freeze(list);
  byHost.set(hostId, result);
  return result;
}

export function resetBrowserActivity() {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  const had = entries.size > 0;
  entries.clear();
  grantOwners.clear();
  if (had) publish();
}

export function setBrowserActivityClockForTests(next: () => number) {
  clock = next;
}

export function getBrowserActivityVersionForTests() {
  return version;
}
