import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/shared/lib/cn";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-colony-control-lg text-sm font-bold transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-colony-accent/40 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        // Primary is ink on warm white; the agent action is the accent.
        default: "bg-colony-fg text-colony-surface hover:bg-colony-fg/90",
        agent: "bg-colony-accent text-white hover:bg-colony-accent-ink",
        destructive: "bg-colony-danger text-white hover:bg-colony-danger/90",
        outline:
          "border border-colony-border-strong bg-colony-pop font-semibold text-colony-fg hover:bg-colony-track",
        secondary:
          "border border-colony-border-strong bg-colony-pop font-semibold text-colony-fg hover:bg-colony-track",
        ghost:
          "text-colony-fg-secondary hover:bg-colony-track hover:text-colony-fg",
        link: "text-colony-accent-ink underline-offset-4 hover:underline",
      },
      size: {
        default: "h-11.5 px-5.5",
        dialog: "h-11 px-5 text-control",
        sm: "h-10 rounded-colony-menu-item px-4 text-menu",
        xs: "h-8 rounded-colony-menu-item px-3 text-xs",
        lg: "h-12 px-8",
        icon: "size-9 rounded-colony-menu-item",
        "icon-xs": "size-6 rounded-lg [&_svg]:size-3.5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        data-button-variant={variant ?? "default"}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
