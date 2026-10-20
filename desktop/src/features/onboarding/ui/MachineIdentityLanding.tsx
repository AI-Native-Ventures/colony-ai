import * as React from "react";

import { Button } from "@/shared/ui/button";
import { StartupWindowDragRegion } from "@/shared/ui/StartupWindowDragRegion";
import { IdentityKeyHelpDialog } from "./IdentityKeyHelpDialog";
import {
  ONBOARDING_LANDING_CTA_CLASS,
  ONBOARDING_SECONDARY_CTA_CLASS,
} from "./OnboardingChrome";
import { OnboardingFooterProvider } from "./OnboardingFooter";
import {
  OnboardingSlideTransition,
  type OnboardingTransitionDirection,
} from "./OnboardingSlideTransition";
import { Brand } from "./OnboardingScenePrimitives";

export function MachineIdentityLanding({
  error,
  hasSelectedIdentity,
  isPending,
  onBack,
  onContinue,
  onOpenHelp,
  onUseExistingKey,
  transitionDirection,
}: {
  error: string | null;
  hasSelectedIdentity: boolean;
  isPending: boolean;
  onBack: () => void;
  onContinue: () => void;
  onOpenHelp: () => void;
  onUseExistingKey: () => void;
  transitionDirection: OnboardingTransitionDirection;
}) {
  const [showTechnicalDetails, setShowTechnicalDetails] = React.useState(false);

  return (
    <div
      className="flex max-h-dvh items-start justify-center overflow-x-hidden overflow-y-auto bg-background px-4 py-8 text-foreground"
      data-testid="machine-onboarding-gate"
    >
      <StartupWindowDragRegion />
      <OnboardingFooterProvider>
        <div className="relative my-auto flex w-full max-w-[1040px] flex-col items-center text-center">
          <OnboardingSlideTransition
            className="flex w-full max-w-[720px] flex-col items-center text-center"
            direction={transitionDirection}
            transitionKey={`machine-identity-${transitionDirection}`}
          >
            <div className="text-4xl">
              <Brand />
            </div>
            <p className="mt-2 max-w-[560px] text-center text-2xl font-normal leading-none text-foreground">
              Your people, your agents, your projects,
              <br />
              all in one place.
            </p>
            {error ? (
              <div className="mt-4 text-sm">
                <p className="text-destructive">
                  We couldn’t open your sign-in. Try again.
                </p>
                <Button
                  aria-controls="machine-identity-technical-details"
                  aria-expanded={showTechnicalDetails}
                  className="mt-2 h-auto px-0 py-1"
                  onClick={() => setShowTechnicalDetails((visible) => !visible)}
                  type="button"
                  variant="link"
                >
                  Technical details
                </Button>
                {showTechnicalDetails ? (
                  <section
                    aria-label="Technical details"
                    className="mt-2 break-all text-left text-xs text-muted-foreground"
                    id="machine-identity-technical-details"
                  >
                    {error}
                  </section>
                ) : null}
              </div>
            ) : null}
            <div className="mt-10 flex flex-col items-center gap-3">
              <Button
                className={ONBOARDING_LANDING_CTA_CLASS}
                disabled={isPending}
                onClick={onContinue}
                type="button"
              >
                {isPending
                  ? "Loading your sign-in…"
                  : hasSelectedIdentity
                    ? "Continue setup"
                    : "Create a Colony sign-in"}
              </Button>
              <Button
                className={`${ONBOARDING_SECONDARY_CTA_CLASS} px-5`}
                disabled={isPending}
                onClick={onUseExistingKey}
                type="button"
                variant="ghost"
              >
                {hasSelectedIdentity
                  ? "Use a different sign-in"
                  : "Use a sign-in I already have"}
              </Button>
            </div>
            <IdentityKeyHelpDialog onOpen={onOpenHelp} />
            <button
              className="mt-2 rounded-sm px-2 py-1 text-sm text-muted-foreground underline decoration-muted-foreground/50 underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              data-testid="account-auth-back-from-advanced"
              onClick={onBack}
              type="button"
            >
              Back to account options
            </button>
          </OnboardingSlideTransition>
        </div>
      </OnboardingFooterProvider>
    </div>
  );
}
