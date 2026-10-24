import type { ReactNode } from "react";

import type { ChannelVisibility } from "@/shared/api/types";
import { CloseIcon } from "@/shared/ui/colonyIcons";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/shared/ui/dialog";

import {
  type CreateChannelInput,
  type CreateChannelFormDraft,
  useCreateChannelForm,
} from "@/features/sidebar/lib/useCreateChannelForm";
import {
  CREATE_CHANNEL_FORM_ID,
  CreateChannelFormFields,
  CreateChannelFormFooter,
} from "@/features/sidebar/ui/CreateChannelFormFields";

type ChannelKind = "stream" | "forum";

type CreateChannelDialogProps = {
  /** Which kind of channel to create, or null when closed. */
  channelKind: ChannelKind | null;
  children?: ReactNode;
  description?: string;
  isCreating: boolean;
  initialDraft?: CreateChannelFormDraft | null;
  /** Channel templates are cut. Still accepted so the sidebar compiles; ignored. */
  initialTemplateId?: string | null;
  onOpenChange: (open: boolean) => void;
  /** Channel templates are cut. Still accepted so the sidebar compiles; ignored. */
  onBrowseTemplates?: (draft: CreateChannelFormDraft) => void;
  onCreate: (input: {
    name: string;
    description?: string;
    visibility: ChannelVisibility;
    ttlSeconds?: number;
    templateId?: string;
  }) => Promise<void>;
  testId?: string;
  title?: string;
};

export function CreateChannelDialog({
  channelKind,
  children,
  description,
  isCreating,
  initialDraft,
  onOpenChange,
  onCreate,
  testId = "create-channel-dialog",
  title,
}: CreateChannelDialogProps) {
  const open = channelKind !== null;

  const form = useCreateChannelForm({
    channelKind: channelKind ?? "stream",
    active: open,
    isCreating,
    initialDraft,
    onCreate: onCreate as (input: CreateChannelInput) => Promise<void>,
    onCreated: () => onOpenChange(false),
  });

  const kindLabel = channelKind === "forum" ? "forum" : "channel";

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && isCreating) return;
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent
        className="max-h-[calc(100vh-2rem)] max-w-[560px] gap-5 overflow-y-auto"
        data-testid={testId}
        showCloseButton={false}
      >
        <div className="flex items-start gap-3">
          <div className="flex flex-1 flex-col gap-1.5">
            <DialogTitle className="leading-[normal]">
              {title ?? `Create a new ${kindLabel}`}
            </DialogTitle>
            <DialogDescription className="leading-normal text-colony-muted">
              {description ??
                (channelKind === "forum"
                  ? "Forums organize threaded discussions around a topic."
                  : "Channels are real-time streams for team conversation.")}
            </DialogDescription>
          </div>
          <DialogClose
            aria-label="Close"
            className="flex size-[2.375rem] shrink-0 items-center justify-center rounded-[0.6875rem] text-colony-fg-secondary transition-colors hover:bg-colony-track focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-colony-accent/40"
          >
            <CloseIcon size={17} strokeWidth={2.4} />
          </DialogClose>
        </div>
        <form
          className="flex flex-col gap-5"
          id={CREATE_CHANNEL_FORM_ID}
          onSubmit={form.handleSubmit}
        >
          {children}
          <CreateChannelFormFields form={form} />
        </form>
        <CreateChannelFormFooter
          form={form}
          onCancel={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
