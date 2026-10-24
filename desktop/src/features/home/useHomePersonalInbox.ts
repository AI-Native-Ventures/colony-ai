import { useHomeDrafts } from "@/features/home/useHomeDrafts";

type UseHomePersonalInboxOptions = {
  isDrafts: boolean;
  isNarrowHomeViewport: boolean;
  viewportWidthPx: number;
};

export function useHomePersonalInbox({
  isDrafts,
  isNarrowHomeViewport,
  viewportWidthPx,
}: UseHomePersonalInboxOptions) {
  // Drafts are only listed (and selectable) under the dedicated Drafts
  // filter - they never appear in the mixed All view.
  const drafts = useHomeDrafts({
    autoSelect: isDrafts,
    isNarrowHomeViewport,
    selectionEnabled: isDrafts,
    viewportWidthPx,
  });

  return { drafts };
}
