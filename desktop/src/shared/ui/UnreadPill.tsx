import { ArrowDown, ArrowUp } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";

const UNREAD_PILL_COMPOSITION_CLASS =
  "pointer-events-auto h-7 min-h-7 gap-1.5 rounded-full border px-2 py-1 text-2xs font-medium tracking-[0.02em] shadow-xs [&_svg]:size-4";
const DEFAULT_UNREAD_PILL_TREATMENT_CLASS =
  "border-border/70 bg-background/95 text-muted-foreground/70 backdrop-blur-sm hover:bg-muted/70 hover:text-foreground";
const PRIMARY_UNREAD_PILL_TREATMENT_CLASS =
  "border-primary bg-primary text-primary-foreground hover:bg-primary/90";

/** The Colony 3.0 conversation pills: "N new messages" and "Jump to latest". */
const CONVERSATION_PILL_CLASS =
  "pointer-events-auto h-10 min-h-10 gap-2 rounded-full border-0 px-4 py-0 text-[length:calc(14.5*var(--colony-px))] font-extrabold tracking-normal [&_svg]:size-[calc(16*var(--colony-px))]";
const CONVERSATION_PILL_PRIMARY_CLASS =
  "bg-colony-accent text-white shadow-[0_12px_26px_-12px_rgba(60,40,140,0.7)] hover:bg-colony-accent hover:opacity-90";
const CONVERSATION_PILL_DEFAULT_CLASS =
  "bg-white text-colony-fg shadow-[0_0_0_1px_hsl(var(--colony-border-strong)),0_12px_26px_-14px_rgba(40,20,60,0.45)] hover:bg-white hover:opacity-90";

export function unreadCountLabel(count: number) {
  return `${count} new message${count === 1 ? "" : "s"}`;
}

export function UnreadPill({
  accessibleLabel,
  className,
  direction,
  emphasis = "default",
  label,
  leading,
  onClick,
  testId,
  variant = "legacy",
}: {
  accessibleLabel?: string;
  className?: string;
  direction: "up" | "down";
  emphasis?: "default" | "primary";
  label: string;
  leading?: ReactNode;
  onClick: () => void;
  testId: string;
  variant?: "legacy" | "conversation";
}) {
  const Arrow = direction === "up" ? ArrowUp : ArrowDown;
  return (
    <Button
      aria-label={accessibleLabel}
      className={cn(
        variant === "conversation"
          ? cn(
              CONVERSATION_PILL_CLASS,
              emphasis === "primary"
                ? CONVERSATION_PILL_PRIMARY_CLASS
                : CONVERSATION_PILL_DEFAULT_CLASS,
            )
          : cn(
              UNREAD_PILL_COMPOSITION_CLASS,
              emphasis === "primary"
                ? PRIMARY_UNREAD_PILL_TREATMENT_CLASS
                : DEFAULT_UNREAD_PILL_TREATMENT_CLASS,
            ),
        className,
      )}
      data-testid={testId}
      onClick={onClick}
      size="sm"
      type="button"
      variant={emphasis === "primary" ? "default" : "outline"}
    >
      <Arrow aria-hidden />
      {leading}
      <span className="min-w-0 truncate">{label}</span>
    </Button>
  );
}
