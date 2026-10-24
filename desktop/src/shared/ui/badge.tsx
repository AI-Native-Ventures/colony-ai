import type * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/shared/lib/cn";

const badgeVariants = cva(
  "inline-flex h-7.5 items-center gap-2 rounded-full px-3 text-xs font-bold",
  {
    variants: {
      variant: {
        // The five work states: Working, Needs you, Done, Blocked, Idle.
        default: "bg-colony-accent-soft text-colony-accent-ink",
        working: "bg-colony-accent-soft text-colony-accent-ink",
        secondary: "bg-colony-idle text-colony-fg-secondary",
        idle: "bg-colony-idle text-colony-fg-secondary",
        outline:
          "bg-colony-pop text-colony-fg-secondary shadow-[inset_0_0_0_1px_hsl(var(--colony-border-strong))]",
        destructive: "bg-colony-danger-bg text-colony-danger",
        blocked: "bg-colony-danger-bg text-colony-danger",
        warning: "bg-colony-need-bg text-colony-need",
        needs: "bg-colony-need-bg text-colony-need",
        success: "bg-colony-success-bg text-colony-success",
        done: "bg-colony-success-bg text-colony-success",
        info: "bg-colony-info-bg text-colony-info",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
