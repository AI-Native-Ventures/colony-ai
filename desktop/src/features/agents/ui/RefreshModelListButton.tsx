import { RefreshCw } from "lucide-react";

import { Button } from "@/shared/ui/button";

export function RefreshModelListButton({
  disabled,
  onClick,
  refreshing,
  testId,
}: {
  disabled: boolean;
  onClick: () => void;
  refreshing: boolean;
  testId?: string;
}) {
  return (
    <Button
      aria-label="Refresh models"
      data-testid={testId}
      disabled={disabled || refreshing}
      onClick={onClick}
      size="xs"
      type="button"
      variant="ghost"
    >
      <RefreshCw
        aria-hidden="true"
        className={refreshing ? "animate-spin" : undefined}
      />
      Refresh models
    </Button>
  );
}
