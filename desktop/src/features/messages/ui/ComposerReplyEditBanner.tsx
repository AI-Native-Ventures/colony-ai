import { CloseGlyph, EditGlyph, ReplyGlyph } from "./ComposerIcons";

/**
 * The "Editing message" / "Replying to ..." header that sits at the top of the
 * composer card. Edit takes precedence over reply (matching the composer's own
 * `editTarget ? ... : replyTarget ? ...` ordering). Rendered inside the card,
 * so the composer's rounded corners clip it; purely presentational.
 */
export function ComposerReplyEditBanner({
  isEditing,
  isEditCancelDisabled = false,
  replyTarget,
  onCancelEdit,
  onCancelReply,
}: {
  isEditing: boolean;
  isEditCancelDisabled?: boolean;
  replyTarget?: { author: string; body: string; id: string } | null;
  onCancelEdit?: () => void;
  onCancelReply?: () => void;
}) {
  if (isEditing) {
    return (
      <div className="c3c-banner" data-kind="edit" data-testid="edit-target">
        <EditGlyph className="c3c-banner-icon" />
        <span className="c3c-banner-text">
          <span className="c3c-banner-title">Editing message</span>
        </span>
        {onCancelEdit ? (
          <button
            aria-label="Cancel edit"
            className="c3c-banner-close"
            disabled={isEditCancelDisabled}
            onClick={onCancelEdit}
            type="button"
          >
            <CloseGlyph />
          </button>
        ) : null}
      </div>
    );
  }

  if (replyTarget) {
    return (
      <div className="c3c-banner" data-kind="reply" data-testid="reply-target">
        <ReplyGlyph className="c3c-banner-icon" />
        <span className="c3c-banner-text">
          <span className="c3c-banner-title">
            Replying to {replyTarget.author}
          </span>
          {replyTarget.body ? (
            <span className="c3c-banner-sub">{replyTarget.body}</span>
          ) : null}
        </span>
        {onCancelReply ? (
          <button
            aria-label="Cancel reply"
            className="c3c-banner-close"
            onClick={onCancelReply}
            type="button"
          >
            <CloseGlyph />
          </button>
        ) : null}
      </div>
    );
  }

  return null;
}
