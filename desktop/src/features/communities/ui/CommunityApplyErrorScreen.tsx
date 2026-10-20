import * as React from "react";

import { Button } from "@/shared/ui/button";
import { OnboardingScenePresentation } from "@/features/onboarding/ui/OnboardingScenePresentation";

import { describeCommunityApplyError } from "../lib/communityApplyError";
import {
  RemoveCommunityControl,
  SwitchCommunityList,
  useCommunityEscape,
} from "./CommunityEscapeActions";

type CommunityApplyErrorScreenProps = {
  error: string;
  onEditCommunity: () => void;
  /** Points the router at the target community before the app leaves this one. */
  onPrepareLanding?: (communityId: string) => void;
  onRetry: () => void;
};

export function CommunityApplyErrorScreen({
  error,
  onEditCommunity,
  onPrepareLanding,
  onRetry,
}: CommunityApplyErrorScreenProps) {
  const [technicalDetailsOpen, setTechnicalDetailsOpen] = React.useState(false);
  const exit = useCommunityEscape({ onPrepareLanding });
  const copy = describeCommunityApplyError({
    communityName: exit.failing?.name ?? null,
    error,
    hasOtherCommunities: exit.others.length > 0,
  });
  const firstSwitchRef = React.useRef<HTMLButtonElement>(null);
  const retryRef = React.useRef<HTMLButtonElement>(null);

  // The first action takes focus so a keyboard user can act without hunting.
  React.useEffect(() => {
    (firstSwitchRef.current ?? retryRef.current)?.focus();
  }, []);

  return (
    <OnboardingScenePresentation
      data={{
        name: "",
        email: "",
        business: "",
        website: "",
        description: "",
        error: copy.message,
        hideProgress: true,
      }}
      scene="community-entry-error"
      contentOverride={
        <div
          className="relative flex w-full max-w-[500px] flex-col items-center text-center"
          data-testid="community-apply-error"
        >
          <h1 className="text-3xl font-semibold tracking-tight">
            Community connection failed
          </h1>
          <p
            className="mt-3 text-sm leading-6 text-muted-foreground"
            data-testid="community-apply-error-message"
          >
            {copy.message}
          </p>
          {copy.detail ? (
            <div className="mt-3 w-full text-left text-xs text-muted-foreground">
              <button
                aria-expanded={technicalDetailsOpen}
                className="w-fit rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => setTechnicalDetailsOpen((isOpen) => !isOpen)}
                type="button"
              >
                Technical details
              </button>
              {technicalDetailsOpen ? (
                <p
                  className="mt-2 break-words leading-5 text-muted-foreground/80"
                  data-testid="community-apply-error-details"
                >
                  {copy.detail}
                </p>
              ) : null}
            </div>
          ) : null}
          {exit.leaving ? (
            <p
              className="mt-8 text-sm text-muted-foreground"
              data-testid="community-apply-error-leaving"
              role="status"
            >
              {exit.leaving === "switching"
                ? "Switching community…"
                : "Removing community…"}
            </p>
          ) : (
            <div className="mt-8 flex w-full max-w-[300px] flex-col gap-3">
              <SwitchCommunityList
                exit={exit}
                firstActionRef={firstSwitchRef}
                primary={copy.isMembershipError}
              />
              <Button
                className="h-10 w-full"
                data-testid="community-apply-error-retry"
                onClick={onRetry}
                ref={retryRef}
                type="button"
                variant={
                  copy.isMembershipError && exit.others.length > 0
                    ? "secondary"
                    : "default"
                }
              >
                Retry
              </Button>
              {exit.failing ? (
                <Button
                  className="h-10 w-full"
                  data-testid="community-apply-error-edit"
                  onClick={onEditCommunity}
                  type="button"
                  variant="secondary"
                >
                  Edit this community
                  <span className="sr-only"> ({exit.failing.name})</span>
                </Button>
              ) : null}
              <RemoveCommunityControl exit={exit} />
            </div>
          )}
        </div>
      }
    />
  );
}
