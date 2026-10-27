import { browserTaskScope } from "./browserTaskScope";

export type AgentBrowserPresentationDecision = "show" | "marker";

export type AgentBrowserPresentationInput = {
  viewingX: boolean;
  windowVisible: boolean;
  dockOpen: boolean;
  personActive: boolean;
  dismissedForTask: boolean;
};

export type AgentBrowserConversationView = {
  channelId: string;
  channelType: string;
  threadRootId?: string | null;
};

type ActiveConversation = {
  owner: object;
  channelId: string;
  taskId: string | null;
};

type PersonActivity = {
  tabId: string;
  at: number;
};

/** PR 359 treats a tab as person-active for four seconds after input. */
export const WORK_AREA_PERSON_ACTIVE_MS = 4_000;
const MAX_PERSON_ACTIVITY_CHANNELS = 200;

let activeConversation: ActiveConversation | null = null;
const personActivityByChannel = new Map<string, PersonActivity>();

/** Pure decision used by the agent-browser access path. */
export function decideAgentBrowserPresentation(
  input: AgentBrowserPresentationInput,
): AgentBrowserPresentationDecision {
  if (
    !input.viewingX ||
    !input.windowVisible ||
    input.dismissedForTask ||
    (input.dockOpen && input.personActive)
  ) {
    return "marker";
  }
  return "show";
}

/**
 * Record the conversation currently mounted beside the work area. The owner
 * token prevents a late unmount from clearing a newer conversation.
 */
export function setAgentBrowserConversationView(
  owner: object,
  view: AgentBrowserConversationView | null,
) {
  activeConversation = view
    ? {
        owner,
        channelId: view.channelId.toLowerCase(),
        taskId: browserTaskScope(
          view.channelId,
          view.channelType,
          view.threadRootId,
        ),
      }
    : null;
}

export function clearAgentBrowserConversationView(owner: object) {
  if (activeConversation?.owner === owner) activeConversation = null;
}

/** Channel tasks match any view of that channel; thread tasks match that thread. */
export function isAgentBrowserTaskInView(
  taskId: string,
  channelId: string,
): boolean {
  const current = activeConversation;
  if (!current || current.channelId !== channelId.toLowerCase()) return false;
  return taskId.startsWith("conversation:") || current.taskId === taskId;
}

/** The Colony window must be both visible and focused to count as being watched. */
export function isColonyWindowVisible(): boolean {
  if (typeof document === "undefined") return false;
  return (
    document.visibilityState === "visible" &&
    typeof document.hasFocus === "function" &&
    document.hasFocus()
  );
}

/** Record a person input in the dock or its native browser page. */
export function noteWorkAreaPersonActivity(
  channelId: string,
  tabId: string,
  at = Date.now(),
) {
  if (!channelId || !tabId) return;
  personActivityByChannel.delete(channelId);
  personActivityByChannel.set(channelId, { tabId, at });
  while (personActivityByChannel.size > MAX_PERSON_ACTIVITY_CHANNELS) {
    const oldest = personActivityByChannel.keys().next().value;
    if (oldest === undefined) break;
    personActivityByChannel.delete(oldest);
  }
}

export function isPersonActiveInWorkArea(
  channelId: string,
  activeTabId: string | null,
  now = Date.now(),
): boolean {
  const activity = personActivityByChannel.get(channelId);
  if (!activity || activity.tabId !== activeTabId) return false;
  if (now < activity.at || now - activity.at >= WORK_AREA_PERSON_ACTIVE_MS) {
    personActivityByChannel.delete(channelId);
    return false;
  }
  return true;
}

export function resetAgentBrowserPresentation() {
  activeConversation = null;
  personActivityByChannel.clear();
}
