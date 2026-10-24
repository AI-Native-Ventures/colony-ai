import { HighlightedSearchText } from "@/features/search/ui/HighlightedSearchText";
import {
  Attachment,
  AttachmentContent,
  AttachmentMedia,
  AttachmentTitle,
} from "@/shared/ui/attachment";

type WaveMessageAttachmentProps = {
  fallbackText: string;
  searchQuery?: string;
};

export function WaveMessageAttachment({
  fallbackText,
  searchQuery,
}: WaveMessageAttachmentProps) {
  return (
    <Attachment
      className="buzz-wave-hover-trigger mt-1 max-w-md"
      data-testid="message-wave-attachment"
      size="default"
    >
      <AttachmentMedia aria-hidden="true" className="text-lg">
        <span className="buzz-wave-hand">👋</span>
      </AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle>
          <HighlightedSearchText
            query={searchQuery ?? ""}
            text={fallbackText}
          />
        </AttachmentTitle>
      </AttachmentContent>
    </Attachment>
  );
}
