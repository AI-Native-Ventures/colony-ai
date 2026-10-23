import type { AcpRuntimeCatalogEntry, ManagedAgent } from "@/shared/api/types";
import {
  PERSONA_LLM_PROVIDER_OPTIONS,
  providerDisplayLabel,
} from "./agentConfigOptions";

/** "openai" reads "OpenAI"; an id nobody has named reads as typed. */
export function providerName(providerId: string): string {
  const id = providerId.trim().toLowerCase();
  return (
    PERSONA_LLM_PROVIDER_OPTIONS.find((option) => option.id === id)?.label ??
    providerDisplayLabel(providerId)
  );
}

/** The five status chips of the Agents and Agent profile boards. */
export type AgentChipTone =
  | "ready"
  | "working"
  | "offline"
  | "needs"
  | "archived"
  | "plain";

/** Maps a runtime label ("Ready", "Working", ...) to a chip tone. */
export function agentChipTone(label: string): AgentChipTone {
  switch (label) {
    case "Ready":
    case "Active":
      return "ready";
    case "Working":
      return "working";
    case "Archived":
      return "archived";
    case "Offline":
    case "Loading":
      return "offline";
    default:
      return "needs";
  }
}

function clock(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

function sameDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

/** "Today, 13:20", "Yesterday, 09:05" or "Wed 21 Oct, 16:40". */
export function formatLastActivity(
  value: string | null | undefined,
  now: Date = new Date(),
): string {
  if (!value) return "Not reported";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not reported";
  if (sameDay(date, now)) return `Today, ${clock(date)}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(date, yesterday)) return `Yesterday, ${clock(date)}`;
  const day = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  })
    .format(date)
    .replace(",", "");
  return `${day}, ${clock(date)}`;
}

/** "13:02" for the start time of a piece of current work. */
export function formatStartedAt(anchorAt: number): string {
  return clock(new Date(anchorAt));
}

export function requestedSourceLabel(
  source: ManagedAgent["modelSource"],
): string {
  switch (source) {
    case "definition":
      return "Agent definition";
    case "global":
      return "Global defaults";
    case "instance_legacy":
      return "Agent record";
    default:
      return "Not reported";
  }
}

export function harnessAvailabilityLabel(
  state: "loading" | "error" | "unknown" | AcpRuntimeCatalogEntry["availability"],
  local: boolean,
): { label: string; ok: boolean } {
  if (state === "loading") return { label: "Loading", ok: false };
  if (state === "available") {
    return { label: local ? "Installed on this Mac" : "Available", ok: true };
  }
  if (state === "error" || state === "unknown") {
    return { label: "Not reported", ok: false };
  }
  return { label: "Not installed", ok: false };
}

export function authStatusLabel(status: string): {
  label: string;
  tone: "ok" | "bad" | "none";
} {
  switch (status) {
    case "logged_in":
      return { label: "Signed in", tone: "ok" };
    case "logged_out":
      return { label: "Sign-in needed", tone: "bad" };
    case "config_invalid":
      return { label: "Configuration issue", tone: "bad" };
    case "not_applicable":
      return { label: "Not checked for this harness", tone: "none" };
    default:
      return { label: "Unknown", tone: "none" };
  }
}

/** The person-chip initials for "Who can give instructions". */
export function personInitials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return `${first}${last}`.toUpperCase();
}
