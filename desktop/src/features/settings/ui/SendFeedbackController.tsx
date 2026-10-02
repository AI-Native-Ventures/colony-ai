import { useSendFeedback } from "@/features/settings/hooks/useSendFeedback";
import { SendFeedbackDialog } from "@/features/settings/ui/SendFeedbackDialog";

export function SendFeedbackController({
  onOpenChange,
  open,
}: {
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const sendFeedback = useSendFeedback();
  return (
    <SendFeedbackDialog
      isPending={sendFeedback.isPending}
      onOpenChange={(nextOpen) => {
        onOpenChange(nextOpen);
        if (!nextOpen) sendFeedback.reset();
      }}
      onSubmit={sendFeedback.submit}
      open={open}
    />
  );
}
