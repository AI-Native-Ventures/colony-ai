import type { DraftViewItem } from "@/features/messages/ui/DraftsPanel";
import { DraftDetailPane } from "@/features/messages/ui/DraftDetailPane";

type HomePersonalInboxDetailProps = {
  draftItem: DraftViewItem | null;
  onBack?: () => void;
  onDeleteDraft: (draftKey: string) => void;
};

export function HomePersonalInboxDetail({
  draftItem,
  onBack,
  onDeleteDraft,
}: HomePersonalInboxDetailProps) {
  return (
    <DraftDetailPane
      item={draftItem}
      key={draftItem?.entry.key ?? "empty"}
      onBack={onBack}
      onDelete={onDeleteDraft}
    />
  );
}
