import type { InboxItem } from "@/features/home/lib/inbox";

export type InboxListRow = {
  key: string;
  kind: "inbox";
  item: InboxItem;
  sortAt: number;
};

export function buildInboxListRows({
  items,
}: {
  items: readonly InboxItem[];
}): InboxListRow[] {
  return items
    .map(
      (item): InboxListRow => ({
        key: `inbox:${item.conversationId}`,
        kind: "inbox",
        item,
        sortAt: item.latestActivityAt,
      }),
    )
    .sort((left, right) => right.sortAt - left.sortAt);
}
