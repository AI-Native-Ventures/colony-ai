import type { MainTimelineEntry } from "@/features/messages/lib/threadPanel";
import type { TimelineMessage } from "@/features/messages/types";

type WhatsAppActivityItem = NonNullable<
  TimelineMessage["whatsappActivity"]
>["items"][number];

function tagValue(message: TimelineMessage, name: string): string | null {
  return message.tags?.find((tag) => tag[0] === name)?.[1]?.trim() || null;
}

function dayKey(createdAt: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Africa/Johannesburg",
    year: "numeric",
  }).format(new Date(createdAt * 1_000));
}

function noticeLabel(code: string | null, body: string): string {
  if (code === "connected") return "Number connected";
  if (code === "batch_completed") return "Batch sent";
  return body.trim().replace(/\s+/gu, " ") || "WhatsApp update";
}

function isPendingBatch(entry: MainTimelineEntry): boolean {
  return tagValue(entry.message, "wa-notice") === "batch_pending";
}

function activityItem(entry: MainTimelineEntry): WhatsAppActivityItem | null {
  const { message, summary } = entry;
  const noticeCode = tagValue(message, "wa-notice");
  if (noticeCode === "batch_pending") return null;

  const waId = tagValue(message, "wa");
  const contactName = tagValue(message, "wa-name");
  const reply = summary?.latestWhatsAppReply;
  if (noticeCode) {
    const batchId = tagValue(message, "wa-batch");
    return {
      id: message.id,
      label: noticeLabel(noticeCode, message.body),
      detail: message.body,
      waId,
      batchId,
    };
  }
  if (reply) {
    const name = contactName || reply.author || "WhatsApp contact";
    return {
      id: message.id,
      label: `${name} replied`,
      detail: reply.body,
      waId,
      batchId: null,
    };
  }
  if (waId) {
    return {
      id: message.id,
      label: contactName || "WhatsApp conversation",
      detail: message.body,
      waId,
      batchId: null,
    };
  }
  return null;
}

function syntheticActivityEntry(
  day: string,
  entries: readonly MainTimelineEntry[],
  items: readonly WhatsAppActivityItem[],
): MainTimelineEntry {
  const first = entries[0];
  const createdAt = entries.reduce(
    (earliest, entry) => Math.min(earliest, entry.message.createdAt),
    Number.POSITIVE_INFINITY,
  );
  const labels = items.map((item) => item.label);
  const summaryText = `${items.length} ${items.length === 1 ? "update" : "updates"}: ${labels.join(", ")}`;
  return {
    message: {
      id: `whatsapp-activity:${day}`,
      createdAt,
      author: "WhatsApp",
      time: first?.message.time ?? "",
      body: summaryText,
      depth: 0,
      whatsappActivity: { day, summary: summaryText, items },
    },
    summary: null,
  };
}

/** Fold notices and WhatsApp conversation roots into one expandable row per day. */
export function foldWhatsAppActivityEntries(
  entries: readonly MainTimelineEntry[],
): MainTimelineEntry[] {
  const activityEntriesByDay = new Map<string, MainTimelineEntry[]>();
  const activityItemsByDay = new Map<string, WhatsAppActivityItem[]>();
  const entryDays = new Map<string, string>();
  const activityTimesById = new Map<string, number>();

  for (const entry of entries) {
    if (isPendingBatch(entry)) continue;
    const item = activityItem(entry);
    const hasNotice = tagValue(entry.message, "wa-notice") !== null;
    const day = dayKey(entry.message.createdAt);
    if (!item && !hasNotice) continue;
    entryDays.set(entry.message.id, day);
    if (item) {
      const dayEntries = activityEntriesByDay.get(day) ?? [];
      dayEntries.push(entry);
      activityEntriesByDay.set(day, dayEntries);
      activityTimesById.set(entry.message.id, entry.message.createdAt);
      const items = activityItemsByDay.get(day) ?? [];
      items.push(item);
      activityItemsByDay.set(day, items);
    }
  }

  const insertedDays = new Set<string>();
  const result: MainTimelineEntry[] = [];
  for (const entry of entries) {
    if (isPendingBatch(entry)) continue;
    const item = activityItem(entry);
    const isNotice = tagValue(entry.message, "wa-notice") !== null;
    if (!item && !isNotice) {
      result.push(entry);
      continue;
    }
    const day =
      entryDays.get(entry.message.id) ?? dayKey(entry.message.createdAt);
    if (insertedDays.has(day)) continue;
    insertedDays.add(day);
    const dayEntries = activityEntriesByDay.get(day) ?? [];
    const dayItems = (activityItemsByDay.get(day) ?? []).sort((left, right) => {
      const leftAt = activityTimesById.get(left.id) ?? 0;
      const rightAt = activityTimesById.get(right.id) ?? 0;
      return leftAt - rightAt;
    });
    if (dayItems.length > 0) {
      result.push(syntheticActivityEntry(day, dayEntries, dayItems));
    }
  }
  return result;
}
