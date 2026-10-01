import { KIND_ASK_ACTION } from "@/shared/constants/kinds";
import type { RelayEvent } from "@/shared/api/types";

export function recipientDescription(isAgent: boolean) {
  return isAgent ? "AI employee" : "Person";
}

export function threadLabel(event: RelayEvent | undefined) {
  if (!event) return "Discussion";
  if (event.kind === KIND_ASK_ACTION) {
    try {
      const action = JSON.parse(event.content) as {
        ask?: { title?: unknown; threadStart?: { title?: unknown } };
      };
      const title = action.ask?.threadStart?.title ?? action.ask?.title;
      if (typeof title === "string" && title.trim()) return title.trim();
    } catch {
      return "Ask discussion";
    }
  }
  const heading = event.content.match(/^\s{0,3}#{1,6}\s+([^\r\n]+)(?:\r?\n|$)/);
  if (heading?.[1]) return heading[1].replace(/\s+#+\s*$/, "").trim();
  const content = event.content.replace(/\s+/g, " ").trim();
  return content.slice(0, 140) || "Discussion";
}
