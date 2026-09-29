"use client";

import * as React from "react";
import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";

import { cn } from "@/shared/lib/cn";
import {
  MODAL_CONTENT_MOTION_CLASS,
  MODAL_OVERLAY_MOTION_CLASS,
} from "@/shared/ui/modalMotion";

type SettingsAlertDialogContentProps = React.ComponentPropsWithoutRef<
  typeof AlertDialogPrimitive.Content
>;

const SettingsAlertDialogContent = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Content>,
  SettingsAlertDialogContentProps
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Portal>
    <AlertDialogPrimitive.Overlay
      className={cn(
        "fixed inset-0 z-50 bg-[#2825323b] backdrop-blur-[3px]",
        MODAL_OVERLAY_MOTION_CLASS,
      )}
    />
    <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center overflow-y-auto p-4">
      <AlertDialogPrimitive.Content
        className={cn(
          "pointer-events-auto grid w-[calc(100vw-2rem)] max-w-md gap-4 outline-hidden",
          "rounded-3xl bg-background p-6 shadow-2xl",
          MODAL_CONTENT_MOTION_CLASS,
          className,
        )}
        ref={ref}
        {...props}
      />
    </div>
  </AlertDialogPrimitive.Portal>
));
SettingsAlertDialogContent.displayName =
  AlertDialogPrimitive.Content.displayName;

export { SettingsAlertDialogContent };
