import * as React from "react";
import * as SwitchPrimitives from "@radix-ui/react-switch";

import { cn } from "@/shared/lib/cn";

const Switch = React.forwardRef<
  React.ComponentRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    className={cn(
      "peer inline-flex h-6.5 w-11 shrink-0 cursor-pointer items-center rounded-full p-[3px] shadow-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-colony-accent disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-colony-accent data-[state=unchecked]:bg-colony-border-strong",
      className,
    )}
    {...props}
    ref={ref}
  >
    <SwitchPrimitives.Thumb
      className={cn(
        "pointer-events-none block size-5 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.2)] ring-0 transition-transform data-[state=checked]:translate-x-[18px] data-[state=unchecked]:translate-x-0",
      )}
    />
  </SwitchPrimitives.Root>
));
Switch.displayName = SwitchPrimitives.Root.displayName;

export { Switch };
