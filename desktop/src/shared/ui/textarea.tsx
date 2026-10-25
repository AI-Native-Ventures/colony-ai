import * as React from "react";

import { cn } from "@/shared/lib/cn";

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<"textarea">
>(({ className, ...props }, ref) => {
  return (
    <textarea
      autoCapitalize="none"
      autoCorrect="off"
      spellCheck={false}
      className={cn(
        "flex min-h-20 w-full rounded-colony-control-lg border border-colony-border-strong bg-colony-pop px-3.5 py-3 text-control font-medium leading-normal text-colony-fg transition-colors placeholder:text-[#757575] focus-visible:border-colony-accent focus-visible:outline-hidden focus-visible:ring-[0.5px] focus-visible:ring-colony-accent disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});
Textarea.displayName = "Textarea";

export { Textarea };
