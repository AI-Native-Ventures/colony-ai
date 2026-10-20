import * as React from "react";

import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/shared/ui/dialog";
import { ONBOARDING_INK_ICON_CLASS } from "./OnboardingChrome";
import { OnboardingFooter } from "./OnboardingFooter";

const IDENTITY_KEY_HELP_SEEN_STORAGE_KEY =
  "buzz.machine-onboarding.identity-key-help-seen.v1";
const IDENTITY_KEY_HELP_DELAY_MS = 2_000;

function hasSeenIdentityKeyHelp(): boolean {
  try {
    return (
      window.localStorage.getItem(IDENTITY_KEY_HELP_SEEN_STORAGE_KEY) === "true"
    );
  } catch {
    return false;
  }
}

function rememberIdentityKeyHelpSeen() {
  try {
    window.localStorage.setItem(IDENTITY_KEY_HELP_SEEN_STORAGE_KEY, "true");
  } catch {
    // The help remains available for this visit if storage is unavailable.
  }
}

export function IdentityKeyHelpDialog({
  inline = false,
  onOpen,
}: {
  inline?: boolean;
  onOpen?: () => void;
}) {
  const [isVisible, setIsVisible] = React.useState(
    inline ? true : hasSeenIdentityKeyHelp,
  );

  React.useEffect(() => {
    if (inline || isVisible) return;

    const timeout = window.setTimeout(() => {
      rememberIdentityKeyHelpSeen();
      setIsVisible(true);
    }, IDENTITY_KEY_HELP_DELAY_MS);

    return () => window.clearTimeout(timeout);
  }, [inline, isVisible]);

  const triggerButton = (
    <Button
      className={cn(
        inline
          ? "h-auto justify-start p-0 text-left text-foreground underline decoration-foreground/45 underline-offset-4 hover:decoration-foreground"
          : "text-foreground/70 hover:text-foreground",
        "transition-opacity duration-300 motion-reduce:transition-none",
        isVisible ? "opacity-100" : "pointer-events-none opacity-0",
      )}
      data-testid="identity-key-help-trigger"
      onClick={onOpen}
      tabIndex={isVisible ? 0 : -1}
      type="button"
      variant="link"
    >
      {inline ? "How your sign-in stays safe" : "How your account stays yours"}
    </Button>
  );

  if (onOpen) {
    return inline ? (
      triggerButton
    ) : (
      <OnboardingFooter className="max-w-none">
        {triggerButton}
      </OnboardingFooter>
    );
  }

  const trigger = <DialogTrigger asChild>{triggerButton}</DialogTrigger>;

  return (
    <Dialog>
      {inline ? (
        trigger
      ) : (
        <OnboardingFooter className="max-w-none">{trigger}</OnboardingFooter>
      )}
      <DialogContent
        className="max-w-[47.5rem] -translate-y-5"
        closeButtonClassName={ONBOARDING_INK_ICON_CLASS}
        data-testid="identity-key-help-dialog"
        overlayVariant="transparent"
        surface="default"
      >
        <div className="mx-auto w-full max-w-[35rem] py-14 text-left max-sm:py-6">
          <DialogTitle className="text-balance pr-8 text-3xl font-normal text-foreground">
            How your account stays yours
          </DialogTitle>
          <DialogDescription
            asChild
            className="mt-6 space-y-4 text-pretty text-base leading-7 text-[color:var(--buzz-onboarding-backup-ink)]"
          >
            <div>
              <IdentityKeyHelpBody />
            </div>
          </DialogDescription>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function IdentityKeyHelpBody() {
  return (
    <>
      <p>
        Colony gives you a sign-in that belongs to you. You can use it on
        another device and in compatible apps. Find the code you can share in
        Colony settings.
      </p>
      <p>
        Only you can restore this sign-in. Keep its recovery details somewhere
        safe, and never share them. If you lose them, Colony can’t get them back
        for you.
      </p>
    </>
  );
}

/** Identity-key explainer content for the onboarding card sheet. */
export function IdentityKeyHelpContent() {
  return (
    <div className="w-full" data-testid="identity-key-help-dialog">
      <h1 className="text-title font-normal text-foreground">
        How your account stays yours
      </h1>
      <div
        className="mt-2 w-full space-y-4 text-pretty text-base leading-7 text-foreground/80"
        data-testid="identity-key-help-body"
      >
        <IdentityKeyHelpBody />
      </div>
    </div>
  );
}
