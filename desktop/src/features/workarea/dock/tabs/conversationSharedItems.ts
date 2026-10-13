import { find as findLinks } from "linkifyjs";

import type { TimelineMessage } from "@/features/messages/types";
import { parseImetaTags } from "@/shared/ui/markdown/parseImeta";

export type ConversationSharedItem = {
  key: string;
  kind: "media" | "file" | "link";
  messageId: string;
  threadRootId: string;
  author: string;
  createdAt: number;
  title: string;
  url: string;
  mime?: string;
  count: number;
  previewUrl?: string;
  media?: Array<{ url: string; mime: string; previewUrl?: string }>;
};

/** Recent items from the message rows already loaded for this conversation. */
export function conversationSharedItems(
  messages: readonly TimelineMessage[],
): ConversationSharedItem[] {
  const items: ConversationSharedItem[] = [];
  for (const message of messages.slice(-300)) {
    if (message.pending) continue;
    const base = {
      messageId: message.id,
      threadRootId: message.rootId ?? message.id,
      author: message.author,
      createdAt: message.createdAt,
    };
    const attachments = [...parseImetaTags(message.tags ?? []).values()].slice(
      0,
      32,
    );
    const media = attachments.filter((entry) =>
      /^(image|video|audio)\//i.test(entry.m ?? ""),
    );
    const files = attachments.filter(
      (entry) => !/^(image|video|audio)\//i.test(entry.m ?? ""),
    );
    if (media.length > 0) {
      const first = media[0];
      items.push({
        ...base,
        key: `${message.id}:media`,
        kind: "media",
        title:
          first.filename ??
          (media.length > 1
            ? "Media carousel"
            : first.m?.startsWith("video/")
              ? "Video"
              : first.m?.startsWith("audio/")
                ? "Audio"
                : "Image"),
        url: first.url,
        mime: first.m,
        count: media.length,
        previewUrl: first.m?.startsWith("image/")
          ? (first.thumb ?? first.url)
          : first.thumb,
        media: media.map((entry) => ({
          url: entry.url,
          mime: entry.m ?? "",
          previewUrl: entry.m?.startsWith("image/")
            ? (entry.thumb ?? entry.url)
            : entry.thumb,
        })),
      });
    }
    for (const file of files) {
      items.push({
        ...base,
        key: `${message.id}:file:${file.url}`,
        kind: "file",
        title: file.filename ?? file.url.split("/").pop() ?? "File",
        url: file.url,
        mime: file.m,
        count: 1,
      });
    }
    const attachmentUrls = new Set(attachments.map((entry) => entry.url));
    const links = new Set<string>();
    for (const match of findLinks(message.body)) {
      if (match.type !== "url") continue;
      try {
        const parsed = new URL(match.href);
        if (
          (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
          parsed.username ||
          parsed.password ||
          attachmentUrls.has(parsed.href)
        )
          continue;
        links.add(parsed.href);
      } catch {
        continue;
      }
      if (links.size >= 12) break;
    }
    for (const url of links) {
      items.push({
        ...base,
        key: `${message.id}:link:${url}`,
        kind: "link",
        title: new URL(url).hostname,
        url,
        count: 1,
      });
    }
  }
  return items
    .sort((a, b) => b.createdAt - a.createdAt || a.key.localeCompare(b.key))
    .slice(0, 120);
}
