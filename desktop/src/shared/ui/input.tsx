import * as React from "react";

import { cn } from "@/shared/lib/cn";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        type={type}
        className={cn(
          "flex h-11.5 w-full rounded-colony-control-lg border border-colony-border-strong bg-colony-pop px-3.5 py-1 text-sm font-medium text-colony-fg transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-[#757575] focus-visible:border-colony-accent focus-visible:outline-hidden focus-visible:ring-[0.5px] focus-visible:ring-colony-accent disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
