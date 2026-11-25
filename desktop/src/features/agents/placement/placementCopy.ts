import {
  CLOUD_MODEL_FREE,
  type Home,
  type PlacementStatus,
} from "./placementTypes";

/**
 * The exact words of the cloud agent switch and its cards (plan, Global
 * Constraints). One place, so the header, the settings section and the cards
 * cannot drift apart.
 */
export const HOME_LABELS: Record<Home, string> = {
  mac: "This Mac",
  cloud: "Cloud",
};

export function workingOnLabel(home: Home): string {
  return `Working on: ${HOME_LABELS[home]}`;
}

/** The status badge text. `notCloudReady` has no badge: it has its own line. */
export const STATUS_LABELS: Record<
  Exclude<PlacementStatus, "notCloudReady">,
  string
> = {
  asleep: "Asleep",
  waking: "Waking",
  working: "Working",
  failed: "Could not start",
  outOfCredit: "Out of AI credit",
};

export function statusLabel(
  status: PlacementStatus | null | undefined,
): string | null {
  if (!status || status === "notCloudReady") return null;
  return STATUS_LABELS[status];
}

export function settingsTitle(name: string): string {
  return `Where ${name} works`;
}

export function notCloudReadyMessage(name: string): string {
  return `Open Colony on your Mac once to make ${name} cloud-ready.`;
}

export function macOffMessage(name: string): string {
  return `${name}'s Mac is off. Move ${name} to the cloud?`;
}
export const MAC_OFF_ACTION = "Move to the cloud";

export const OUT_OF_CREDIT_MESSAGE = "Out of AI credit.";
export const FREE_AI_BUSY_MESSAGE = "Free AI is busy right now.";
export const TOP_UP_ACTION = "Top up";
export const MOVE_TO_MAC_ACTION = "Move to This Mac";

export function startFailureMessage(name: string): string {
  return `${name} could not start in the cloud.`;
}
export const TRY_AGAIN_ACTION = "Try again";

export function capMessage(limit: number): string {
  return `You can have ${limit} agents in the cloud during the beta.`;
}

/** The line under the cloud choice: what a cloud agent is doing right now. */
export function cloudStatusLine(
  status: PlacementStatus | null | undefined,
): string | null {
  switch (status) {
    case "asleep":
      return "Wakes when you message";
    case "waking":
      return "Starting up";
    case "working":
      return "Answering now";
    case "failed":
      return "Try again, or move back to This Mac";
    case "outOfCredit":
      return "Top up to keep going";
    default:
      return null;
  }
}

const BRAND_WORDS: Record<string, string> = {
  deepseek: "DeepSeek",
  openai: "OpenAI",
  gpt: "GPT",
};

/** "deepseek/deepseek-v4.1-flash" reads as "DeepSeek V4.1 Flash". */
export function cloudModelLabel(modelId: string): string {
  if (modelId === CLOUD_MODEL_FREE) return "Free (default)";
  const name = modelId.split("/").pop() ?? modelId;
  return name
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => {
      const lower = word.toLowerCase();
      if (BRAND_WORDS[lower]) return BRAND_WORDS[lower];
      if (/^v\d/.test(lower)) return `V${word.slice(1)}`;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

/** What the cloud runs an agent with, e.g. "Colony credits · DeepSeek V4.1 Flash". */
export function cloudSetupLabel(modelId: string | null): string {
  if (modelId === CLOUD_MODEL_FREE) return "Free AI";
  return modelId
    ? `Colony credits · ${cloudModelLabel(modelId)}`
    : "Colony credits";
}
