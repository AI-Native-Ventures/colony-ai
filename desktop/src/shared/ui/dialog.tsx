"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { CloseIcon } from "@/shared/ui/colonyIcons";

import { cn } from "@/shared/lib/cn";
import "./card-texture.css";
import { MODAL_BACKDROP_BLUR_CLASS } from "@/shared/ui/modalBackdrop";
import {
  MODAL_CONTENT_MOTION_CLASS,
  MODAL_OVERLAY_MOTION_CLASS,
} from "@/shared/ui/modalMotion";

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogPortal = DialogPrimitive.Portal;
const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    className={cn(
      "fixed inset-0 z-50 bg-colony-scrim",
      MODAL_OVERLAY_MOTION_CLASS,
      MODAL_BACKDROP_BLUR_CLASS,
      className,
    )}
    ref={ref}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

type DialogContentProps = React.ComponentPropsWithoutRef<
  typeof DialogPrimitive.Content
> & {
  /** Extra classes for the built-in close button (e.g. a themed icon color). */
  closeButtonClassName?: string;
  /** Extra classes for this dialog's backdrop. */
  overlayClassName?: string;
  overlayVariant?: "default" | "transparent";
  showCloseButton?: boolean;
  /**
   * - `default`: standard opaque dialog panel (rounded, shadowed).
   * - `none`: no surface — the caller composes its own.
   * - `textured`: the baked nine-slice powder card (`Card variant="textured"`)
   *   IS the dialog surface. Content and the close button are automatically
   *   kept on the solid center of the texture via its safe inset.
   */
  surface?: "default" | "none" | "textured";
};

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(
  (
    {
      className,
      children,
      closeButtonClassName,
      overlayClassName,
      overlayVariant = "default",
      showCloseButton = true,
      surface = "default",
      ...props
    },
    ref,
  ) => (
    <DialogPortal>
      <DialogOverlay
        data-testid="dialog-overlay"
        className={cn(
          overlayVariant === "transparent"
            ? "bg-transparent backdrop-blur-none"
            : undefined,
          overlayClassName,
        )}
      />
      <div
        className={cn(
          "pointer-events-none fixed inset-0 z-50 grid place-items-center overflow-x-hidden overflow-y-auto",
          // The textured surface bleeds a 96px powder band beyond its layout
          // box (see card-texture.css). Give the wrapper enough padding that
          // the bleed isn't clipped by this scroll container; every other
          // surface keeps the standard gutter.
          surface === "textured"
            ? "p-[calc(6rem+1rem)] max-sm:p-[calc(6rem-1.5rem)]"
            : "p-4",
        )}
      >
        <DialogPrimitive.Content
          className={cn(
            "pointer-events-auto relative grid w-[calc(100vw-2rem)] max-w-2xl gap-4 outline-hidden",
            surface === "default" &&
              "gap-4.5 rounded-colony-dialog bg-colony-pop p-7 shadow-colony-dialog",
            surface === "none" && "bg-transparent p-0 shadow-none",
            surface === "textured" &&
              "buzz-card-textured isolate box-border w-full rounded-none border-0 bg-transparent p-[var(--buzz-card-textured-safe-inset)] shadow-none",
            MODAL_CONTENT_MOTION_CLASS,
            className,
          )}
          ref={ref}
          {...props}
        >
          {children}
          {showCloseButton ? (
            <DialogPrimitive.Close
              className={cn(
                "absolute flex size-9 items-center justify-center rounded-colony-menu-item bg-colony-track text-colony-fg-secondary transition-colors duration-150 ease-out hover:bg-colony-border focus:outline-hidden focus-visible:ring-2 focus-visible:ring-colony-accent/40",
                // On the textured surface the layout edge sits in the powder
                // fade; dock the close button at the safe-inset corner so it
                // stays on the solid center of the texture.
                surface === "textured"
                  ? "right-[var(--buzz-card-textured-safe-inset)] top-[var(--buzz-card-textured-safe-inset)] -mr-2 -mt-2"
                  : "right-5 top-5",
                closeButtonClassName,
              )}
            >
              <CloseIcon size={15} strokeWidth={2.4} />
              <span className="sr-only">Close</span>
            </DialogPrimitive.Close>
          ) : null}
        </DialogPrimitive.Content>
      </div>
    </DialogPortal>
  ),
);
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("flex flex-col space-y-2 text-left", className)}
    {...props}
  />
);
DialogHeader.displayName = "DialogHeader";

const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end",
      className,
    )}
    {...props}
  />
);
DialogFooter.displayName = "DialogFooter";

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    className={cn("text-title-md font-extrabold", className)}
    ref={ref}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    className={cn(
      "text-control font-medium text-colony-fg-secondary",
      className,
    )}
    ref={ref}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
