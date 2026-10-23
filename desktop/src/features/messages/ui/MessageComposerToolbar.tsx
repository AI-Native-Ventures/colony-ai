import * as React from "react";
import type { Editor } from "@tiptap/react";

import type { MediaUploadController } from "@/features/messages/lib/useMediaUpload";
import { cn } from "@/shared/lib/cn";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";
import {
  type ComposerAddressAgent,
  ComposerMentionButton,
  ComposerSendButton,
} from "./ComposerAddressControls";
import { ComposerEmojiPicker } from "./ComposerEmojiPicker";
import { AttachGlyph, EmojiGlyph, MicGlyph } from "./ComposerIcons";
import { FormattingToolbar } from "./FormattingToolbar";
import { SelectionFormattingTray } from "./SelectionFormattingTray";

/**
 * Which tools a conversation's composer offers, as the Colony 3.0 boards draw
 * them: a channel has mention, attach, emoji, formatting and voice; a direct
 * message drops the mention button; a thread reply keeps attach, formatting
 * and mention; a new message has no voice note.
 */
export type ComposerToolbarLayout = "channel" | "dm" | "thread" | "new-message";

const NO_ADDRESSED_AGENTS: readonly ComposerAddressAgent[] = [];
const ignoreAddressRemoval = () => {};

const TOOL_BUTTON_CLASS = "c3c-tool";

export const MessageComposerToolbar = React.memo(
  function MessageComposerToolbar({
    addressedAgents = NO_ADDRESSED_AGENTS,
    askAction,
    autoPinConfirmationTitle,
    composerDisabled,
    editor,
    extraActions,
    formattingDisabled = false,
    gifMediaController,
    isEmojiPickerOpen,
    isFormattingOpen,
    isSending,
    isUploading,
    isVoiceNoteProcessing = false,
    isVoiceNoteRecording = false,
    hasVoiceNoteAttachment = false,
    layout = "channel",
    referenceSlot,
    voiceNoteRecorder,
    onCaptureSelection,
    onAutoPinConfirmationDismiss,
    onAutoPinConfirmationHoverChange,
    onAutoPinConfirmationTurnOff,
    onEmojiPickerOpenChange,
    onEmojiSelect,
    onFormattingToggle,
    onLinkButton,
    onOpenMentionPicker,
    onPaperclip,
    onFinishVoiceNote,
    onVoiceNote,
    onRemoveAddressedAgent = ignoreAddressRemoval,
    pulseVersionByPubkey,
    sendDisabled,
    shakeVersionByPubkey,
  }: {
    addressedAgents?: readonly ComposerAddressAgent[];
    /** "Raise an ask" pill that follows the formatting button in a channel. */
    askAction?: React.ReactNode;
    autoPinConfirmationTitle?: string | null;
    composerDisabled: boolean;
    editor: Editor | null;
    extraActions?: React.ReactNode;
    /**
     * Only for composers that keep the formatting row inside the toolbar
     * (the forum composer): the message composer draws it above the editor.
     */
    formattingDisabled?: boolean;
    gifMediaController: Pick<MediaUploadController, "setPendingImeta">;
    isEmojiPickerOpen: boolean;
    isFormattingOpen: boolean;
    isSending: boolean;
    isUploading: boolean;
    isVoiceNoteProcessing?: boolean;
    isVoiceNoteRecording?: boolean;
    hasVoiceNoteAttachment?: boolean;
    layout?: ComposerToolbarLayout;
    /** The slot where a "Reference lead" button sits (see ComposerReferenceSlot). */
    referenceSlot?: React.ReactNode;
    voiceNoteRecorder?: React.ReactNode;
    onCaptureSelection: () => void;
    onAutoPinConfirmationDismiss?: () => void;
    onAutoPinConfirmationHoverChange?: (hovered: boolean) => void;
    onAutoPinConfirmationTurnOff?: () => void;
    onEmojiPickerOpenChange: (open: boolean) => void;
    onEmojiSelect: (emoji: string) => void;
    onFormattingToggle: (pressed: boolean) => void;
    onLinkButton?: () => void;
    onOpenMentionPicker: () => void;
    onPaperclip: () => void;
    onFinishVoiceNote?: () => void;
    onVoiceNote?: () => void;
    onRemoveAddressedAgent?: (pubkey: string) => void;
    pulseVersionByPubkey?: Readonly<Record<string, number>>;
    sendDisabled: boolean;
    shakeVersionByPubkey?: Readonly<Record<string, number>>;
  }) {
    const attachDisabled =
      composerDisabled ||
      isUploading ||
      isVoiceNoteRecording ||
      hasVoiceNoteAttachment;
    const showMention = layout !== "dm";
    const showEmoji = layout !== "thread";
    const showVoice = Boolean(onVoiceNote) && layout !== "new-message";

    const mentionButton = showMention ? (
      <ComposerMentionButton
        agents={addressedAgents}
        confirmationTitle={autoPinConfirmationTitle}
        disabled={composerDisabled}
        onConfirmationDismiss={onAutoPinConfirmationDismiss}
        onConfirmationHoverChange={onAutoPinConfirmationHoverChange}
        onConfirmationTurnOff={onAutoPinConfirmationTurnOff}
        onCaptureSelection={onCaptureSelection}
        onOpen={onOpenMentionPicker}
        onRemove={onRemoveAddressedAgent}
        pulseVersionByPubkey={pulseVersionByPubkey}
        shakeVersionByPubkey={shakeVersionByPubkey}
        showAgents
      />
    ) : null;
    const attachButton = (
      <Tooltip disableHoverableContent>
        <TooltipTrigger asChild>
          <button
            aria-label="Attach file"
            className={TOOL_BUTTON_CLASS}
            disabled={attachDisabled}
            onClick={onPaperclip}
            onMouseDown={onCaptureSelection}
            type="button"
          >
            <AttachGlyph />
          </button>
        </TooltipTrigger>
        <TooltipContent>Attach file</TooltipContent>
      </Tooltip>
    );
    const emojiPicker = showEmoji ? (
      <ComposerEmojiPicker
        disabled={composerDisabled || isVoiceNoteRecording}
        gifsDisabled={hasVoiceNoteAttachment}
        gifMediaController={gifMediaController}
        onClose={() => editor?.commands.focus()}
        onEmojiSelect={onEmojiSelect}
        onOpenChange={onEmojiPickerOpenChange}
        onTriggerMouseDown={onCaptureSelection}
        open={isEmojiPickerOpen}
        triggerClassName={TOOL_BUTTON_CLASS}
        triggerIcon={<EmojiGlyph />}
      />
    ) : null;
    const formattingButton = (
      <Tooltip disableHoverableContent>
        <TooltipTrigger asChild>
          <button
            aria-label="Toggle formatting"
            aria-pressed={isFormattingOpen}
            className={cn(TOOL_BUTTON_CLASS, "c3c-tool-text")}
            disabled={composerDisabled}
            onClick={() => onFormattingToggle(!isFormattingOpen)}
            onMouseDown={onCaptureSelection}
            type="button"
          >
            Aa
          </button>
        </TooltipTrigger>
        <TooltipContent>Formatting</TooltipContent>
      </Tooltip>
    );

    return (
      <div className="c3c-toolbar" data-testid="message-composer-toolbar">
        {onLinkButton ? (
          <SelectionFormattingTray
            disabled={formattingDisabled}
            editor={editor}
            onLinkButton={onLinkButton}
          />
        ) : null}
        <div className="c3c-tools" data-testid="message-composer-tools">
          {onLinkButton && isFormattingOpen && !voiceNoteRecorder ? (
            <div className="c3c-fmt-row c3c-fmt-row-inline">
              <button
                aria-label="Toggle formatting"
                aria-pressed="true"
                className="c3c-fmt-btn c3c-fmt-toggle"
                disabled={composerDisabled}
                onClick={() => onFormattingToggle(false)}
                type="button"
              >
                Aa
              </button>
              <FormattingToolbar
                disabled={formattingDisabled}
                editor={editor}
                onLinkButton={onLinkButton}
              />
            </div>
          ) : voiceNoteRecorder ? (
            <div
              className="c3c-voice-controls"
              data-testid="voice-note-controls"
            >
              {voiceNoteRecorder}
            </div>
          ) : (
            <div
              className="c3c-ingress"
              data-layout={layout}
              data-testid="composer-ingress-controls"
            >
              {layout === "thread" ? (
                addressedAgents.length > 0 ? (
                  // With agents addressed, the mention group (button and
                  // chips) leads, as the Composer states board draws it.
                  <>
                    {mentionButton}
                    {attachButton}
                    {formattingButton}
                  </>
                ) : (
                  <>
                    {attachButton}
                    {formattingButton}
                    {mentionButton}
                  </>
                )
              ) : (
                <>
                  {mentionButton}
                  {attachButton}
                  {emojiPicker}
                  {formattingButton}
                </>
              )}
              {/* The reference slot sits where "Reference goal" used to; the
                  ask pill follows it. Both are optional per conversation. */}
              {referenceSlot}
              {askAction}
              {extraActions}
            </div>
          )}
        </div>
        <div className="c3c-send-group">
          {showVoice && !voiceNoteRecorder ? (
            <Tooltip disableHoverableContent>
              <TooltipTrigger asChild>
                <button
                  aria-label="Record voice note"
                  className={TOOL_BUTTON_CLASS}
                  disabled={composerDisabled || isUploading}
                  onClick={onVoiceNote}
                  onMouseDown={onCaptureSelection}
                  type="button"
                >
                  <MicGlyph />
                </button>
              </TooltipTrigger>
              <TooltipContent>Record voice note</TooltipContent>
            </Tooltip>
          ) : null}
          <ComposerSendButton
            isSending={isSending}
            onFinishVoiceNote={
              isVoiceNoteRecording ? onFinishVoiceNote : undefined
            }
            sendDisabled={
              isVoiceNoteRecording ? isVoiceNoteProcessing : sendDisabled
            }
          />
        </div>
      </div>
    );
  },
);
