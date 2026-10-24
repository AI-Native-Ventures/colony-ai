import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/ui/alert-dialog";
import { TrashGlyph } from "@/features/channels/ui/dialogIcons";
import { buttonVariants } from "@/shared/ui/button";

/**
 * The "Delete message?" confirmation. Single definition shared by every
 * surface that deletes a message — the message action menu (MessageActionBar)
 * and the empty-edit delete path (clearing an edit to empty and hitting accept
 * routes here, so it prompts exactly like the menu's Delete does). `onConfirm`
 * fires when the user presses Delete; the caller owns the actual deletion.
 */
export function DeleteMessageConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog onOpenChange={onOpenChange} open={open}>
      <AlertDialogContent className="max-w-[400px] gap-4.5">
        <span className="flex size-11 items-center justify-center rounded-[0.8125rem] bg-colony-danger-bg text-colony-danger">
          <TrashGlyph size={20} />
        </span>
        <AlertDialogHeader>
          <AlertDialogTitle className="leading-[normal]">
            Delete message?
          </AlertDialogTitle>
          <AlertDialogDescription className="text-sm leading-[1.55]">
            This will permanently delete this message and cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="pt-0">
          <AlertDialogCancel className="px-4.5" type="button">
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            className={buttonVariants({
              variant: "destructive",
              size: "dialog",
            })}
            onClick={onConfirm}
            type="button"
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
