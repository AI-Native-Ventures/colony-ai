import { Button } from "@/shared/ui/button";

type AskCreateSuccessProps = {
  title: string;
  description?: string;
  message: string;
  actionLabel: string;
  onAction: () => void;
};

export function AskCreateSuccess({
  title,
  description,
  message,
  actionLabel,
  onAction,
}: AskCreateSuccessProps) {
  return (
    <div className="colony-ask-create-success" role="status">
      <h1 id="ask-create-title">{title}</h1>
      {description ? <p>{description}</p> : null}
      <p>{message}</p>
      <Button onClick={onAction} type="button">
        {actionLabel}
      </Button>
    </div>
  );
}
