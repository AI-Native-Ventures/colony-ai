import * as React from "react";
import { Check, Copy } from "lucide-react";

import { SelfServeCommunityCreateFlow } from "@/features/communities/ui/SelfServeCommunityCreateFlow";
import {
  listOwnedBusinesses,
  type SelfServeCommunity,
} from "@/features/communities/selfProvisioningApi";
import { useCommunityOnboarding } from "@/features/onboarding/communityOnboarding";
import { useDeviceAiConnectionCheck } from "@/features/onboarding/deviceAiConnection";
import { OnboardingScenePresentation } from "@/features/onboarding/ui/OnboardingScenePresentation";
import {
  businessCommunityRelayUrl,
  ownedBusinessProfile,
  readOnboardingBusinessProfile,
  type OnboardingBusinessProfile,
} from "@/features/onboarding/ui/BusinessSetupStep";
import { ConnectSetupStep } from "@/features/onboarding/ui/ConnectSetupStep";
import { InviteRedeemForm } from "@/features/onboarding/ui/InviteRedeemForm";
import { OnboardingFooterProvider } from "@/features/onboarding/ui/OnboardingFooter";
import {
  type OnboardingTransitionDirection,
  OnboardingSlideTransition,
} from "@/features/onboarding/ui/OnboardingSlideTransition";
import { useIdentityQuery } from "@/shared/api/hooks";
import { writeTextToClipboard } from "@/shared/lib/clipboard";
import { pubkeyToNpub } from "@/shared/lib/nostrUtils";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";

type WelcomeSetupPage =
  | "welcome"
  | "existing"
  | "join"
  | "member"
  | "owned"
  | "connect"
  | "create";
type WelcomeTransitionMode = "initial" | OnboardingTransitionDirection;

type WelcomeSetupProps = {
  initialPage?: WelcomeSetupPage;
  initialTransitionMode?: WelcomeTransitionMode;
  onBack?: () => void;
};

const COMMUNITY_OPTION_CARD_CLASS =
  "w-full max-w-[320px] items-center rounded-2xl border border-border bg-card px-6 py-4 text-center text-sm font-normal leading-6 text-foreground shadow-sm transition-colors hover:bg-muted/40 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-foreground/35";

export function WelcomeSetup({
  initialPage = "welcome",
  initialTransitionMode = "initial",
  onBack,
}: WelcomeSetupProps) {
  const [page, setPage] = React.useState<WelcomeSetupPage>(initialPage);
  const [transitionMode, setTransitionMode] =
    React.useState<WelcomeTransitionMode>(initialTransitionMode);
  const [ownedBusinesses, setOwnedBusinesses] = React.useState<
    SelfServeCommunity[]
  >([]);
  const [businessListLoading, setBusinessListLoading] = React.useState(false);
  const [businessListError, setBusinessListError] = React.useState<
    string | null
  >(null);
  const [showJoinTechnicalDetails, setShowJoinTechnicalDetails] =
    React.useState(false);
  const [copiedNpub, setCopiedNpub] = React.useState(false);
  const [connectTarget, setConnectTarget] = React.useState<{
    business: SelfServeCommunity;
    profile: OnboardingBusinessProfile;
  } | null>(null);
  const [connectError, setConnectError] = React.useState<string | null>(null);
  const communityOnboarding = useCommunityOnboarding();
  // Opening an owned business on a device with no working AI goes through
  // Connect first, the same as the first-run business chooser.
  const deviceConnection = useDeviceAiConnectionCheck(page === "owned");
  const identityQuery = useIdentityQuery();
  const npub = identityQuery.data?.pubkey
    ? pubkeyToNpub(identityQuery.data.pubkey)
    : "";
  const npubError = identityQuery.error
    ? "Could not load your account code."
    : null;

  const showPage = React.useCallback(
    (nextPage: WelcomeSetupPage, direction?: OnboardingTransitionDirection) => {
      setTransitionMode(
        direction ?? (nextPage === "welcome" ? "backward" : "forward"),
      );
      setPage(nextPage);
    },
    [],
  );

  const startConnection = React.useCallback(
    (relayUrl: string) => {
      communityOnboarding.start({
        source: "first-community",
        firstCommunityPage: page === "member" ? "member" : "join",
        relayUrl,
      });
    },
    [communityOnboarding, page],
  );

  const redeemInvite = React.useCallback(
    (relayUrl: string, code: string, policyReceipt?: string) => {
      communityOnboarding.start({
        source: "first-community",
        firstCommunityPage: page === "member" ? "member" : "join",
        relayUrl,
        inviteCode: code,
        policyReceipt,
      });
    },
    [communityOnboarding, page],
  );

  const loadOwnedBusinesses = React.useCallback(async () => {
    const pubkey = identityQuery.data?.pubkey;
    if (!pubkey) {
      setBusinessListError("Could not load your businesses. Try again.");
      return;
    }
    setBusinessListLoading(true);
    setBusinessListError(null);
    try {
      setOwnedBusinesses(
        await listOwnedBusinesses(
          pubkey,
          (id) => readOnboardingBusinessProfile(id)?.name ?? null,
        ),
      );
    } catch {
      setBusinessListError("Could not load your businesses. Try again.");
    } finally {
      setBusinessListLoading(false);
    }
  }, [identityQuery.data?.pubkey]);

  const beginOwnedBusinesses = React.useCallback(() => {
    showPage("owned");
    void loadOwnedBusinesses();
  }, [loadOwnedBusinesses, showPage]);

  const openOwnedBusiness = (business: SelfServeCommunity) =>
    communityOnboarding.start({
      source: "first-community",
      firstCommunityPage: "owned",
      relayUrl: businessCommunityRelayUrl(business),
      businessCommunityId: business.id,
      communityName:
        readOnboardingBusinessProfile(business.id)?.name ||
        business.name ||
        business.slug,
    });

  const selectOwnedBusiness = (business: SelfServeCommunity) => {
    if (deviceConnection.checking) return;
    void deviceConnection.resolve().then((connected) => {
      if (connected === null) return;
      if (!connected) {
        setConnectTarget({ business, profile: ownedBusinessProfile(business) });
        setConnectError(null);
        showPage("connect");
        return;
      }
      if (!openOwnedBusiness(business)) {
        setBusinessListError(
          "Finish the business setup already in progress before opening this business.",
        );
      }
    });
  };

  if (page === "connect" && connectTarget) {
    return (
      <ConnectSetupStep
        business={connectTarget.profile}
        communityId={connectTarget.business.id}
        error={connectError}
        onBack={() => {
          setConnectError(null);
          showPage("owned", "backward");
        }}
        onContinue={() => {
          if (!openOwnedBusiness(connectTarget.business)) {
            setConnectError(
              "Finish the business setup already in progress before opening this business.",
            );
          }
        }}
      />
    );
  }

  const transitionDirection =
    transitionMode === "backward" ? "backward" : "forward";
  const backAction =
    page === "welcome" && onBack
      ? { onClick: onBack, testId: "welcome-setup-back" }
      : page === "existing"
        ? {
            onClick: () => showPage("welcome"),
            testId: "existing-back",
          }
        : page === "join"
          ? {
              onClick: () => showPage("welcome"),
              testId: "welcome-join-back",
            }
          : page === "create"
            ? {
                onClick: () => showPage("welcome"),
                testId: "welcome-create-back",
              }
            : page === "member"
              ? {
                  onClick: () => showPage("existing"),
                  testId: "welcome-member-back",
                }
              : page === "owned"
                ? {
                    onClick: () => showPage("existing"),
                    testId: "welcome-owned-back",
                  }
                : undefined;

  const onboardingScene =
    page === "join" || page === "member"
      ? "invite"
      : page === "create"
        ? "business"
        : page === "owned" || page === "existing"
          ? "businesses"
          : "community-entry";

  return (
    <OnboardingFooterProvider backAction={backAction}>
      <OnboardingScenePresentation
        data={{
          name: "",
          email: "",
          business: "",
          website: "",
          description: "",
          hideProgress: true,
        }}
        scene={onboardingScene}
        contentOverride={
          <div
            className="relative flex min-h-0 w-full max-w-[920px] flex-1 flex-col items-center text-center"
            data-testid="welcome-setup"
          >
            {page === "welcome" ? (
              <OnboardingSlideTransition
                className="flex h-full min-h-0 w-full flex-col items-center text-center"
                containerClassName="h-full min-h-0 [&>.buzz-onboarding-transition-line]:h-full"
                direction={transitionDirection}
                transitionKey={`welcome-${transitionDirection}`}
              >
                <div className="w-full max-w-[760px]">
                  <h1 className="text-title font-normal">
                    Join or create a community
                  </h1>
                  <p className="mt-3 text-sm leading-6 text-foreground/80">
                    Join with an invite, create your own community, or reconnect
                    one you already have.
                  </p>
                </div>
                <div className="flex w-full flex-1 flex-col items-center justify-center gap-3 py-8">
                  <Card asChild className={COMMUNITY_OPTION_CARD_CLASS}>
                    <button
                      data-testid="community-choice-join"
                      onClick={() => showPage("join")}
                      type="button"
                    >
                      Join a community
                    </button>
                  </Card>
                  <Card asChild className={COMMUNITY_OPTION_CARD_CLASS}>
                    <button
                      data-testid="community-choice-create"
                      onClick={() => showPage("create")}
                      type="button"
                    >
                      Create a community
                    </button>
                  </Card>
                  <Card asChild className={COMMUNITY_OPTION_CARD_CLASS}>
                    <button
                      data-testid="community-choice-existing"
                      onClick={() => showPage("existing")}
                      type="button"
                    >
                      I already have a community
                    </button>
                  </Card>
                </div>
              </OnboardingSlideTransition>
            ) : page === "existing" ? (
              <OnboardingSlideTransition
                className="flex h-full min-h-0 w-full flex-col items-center text-center"
                containerClassName="h-full min-h-0 [&>.buzz-onboarding-transition-line]:h-full"
                direction={transitionDirection}
                transitionKey={`existing-${transitionDirection}`}
              >
                <div className="w-full max-w-[760px]">
                  <h1 className="text-title font-normal">
                    Reconnect to your community
                  </h1>
                  <p className="mt-3 text-sm leading-6 text-foreground/80">
                    Tell us your role so we can find the fastest way back in.
                  </p>
                </div>
                <div className="flex w-full flex-1 flex-col items-center justify-center gap-3 py-8">
                  <Card asChild className={COMMUNITY_OPTION_CARD_CLASS}>
                    <button
                      data-testid="existing-choice-owner"
                      onClick={beginOwnedBusinesses}
                      type="button"
                    >
                      I own the business
                    </button>
                  </Card>
                  <Card asChild className={COMMUNITY_OPTION_CARD_CLASS}>
                    <button
                      data-testid="existing-choice-member"
                      onClick={() => showPage("member")}
                      type="button"
                    >
                      I’m a member or admin
                    </button>
                  </Card>
                </div>
              </OnboardingSlideTransition>
            ) : page === "create" ? (
              <OnboardingSlideTransition
                className="flex w-full flex-col items-center text-center"
                direction={transitionDirection}
                transitionKey={`create-${transitionDirection}`}
              >
                <SelfServeCommunityCreateFlow
                  onBack={() => showPage("welcome")}
                  showBackButton={false}
                />
              </OnboardingSlideTransition>
            ) : page === "owned" ? (
              <OnboardingSlideTransition
                className="flex min-h-[calc(100dvh-15.625rem)] w-full flex-col items-center text-center"
                direction={transitionDirection}
                transitionKey={`owned-${transitionDirection}`}
              >
                <div className="w-full max-w-[620px]">
                  <h1 className="text-title font-normal">Your businesses</h1>
                  <p className="mt-3 text-sm leading-6 text-foreground/80">
                    Choose the business you want to open.
                  </p>
                </div>
                <div className="mt-8 flex w-full max-w-[560px] flex-col gap-3">
                  {businessListLoading ? (
                    <p
                      role="status"
                      className="py-8 text-sm text-muted-foreground"
                    >
                      Loading your businesses…
                    </p>
                  ) : businessListError ? (
                    <div className="space-y-3" role="alert">
                      <p className="text-sm text-destructive">
                        {businessListError}
                      </p>
                      <Button
                        onClick={() => void loadOwnedBusinesses()}
                        type="button"
                      >
                        Try again
                      </Button>
                    </div>
                  ) : ownedBusinesses.length === 0 ? (
                    <div className="space-y-4 py-4">
                      <p className="text-sm text-muted-foreground">
                        This account doesn’t own a business yet.
                      </p>
                      <Button onClick={() => showPage("create")} type="button">
                        Create a business
                      </Button>
                    </div>
                  ) : (
                    ownedBusinesses.map((business) => (
                      <Button
                        className="h-auto justify-start rounded-2xl border border-border bg-card px-5 py-4 text-left shadow-sm dark:border-white/20 dark:bg-white/5 dark:hover:bg-white/10"
                        data-testid={`welcome-owned-business-${business.id}`}
                        disabled={deviceConnection.checking}
                        key={business.id}
                        onClick={() => selectOwnedBusiness(business)}
                        type="button"
                        variant="outline"
                      >
                        {business.name || business.slug}
                      </Button>
                    ))
                  )}
                  {deviceConnection.checking ? (
                    <p
                      role="status"
                      className="py-2 text-sm text-muted-foreground"
                      data-testid="welcome-owned-business-checking"
                    >
                      Checking your AI connection
                    </p>
                  ) : null}
                </div>
              </OnboardingSlideTransition>
            ) : (
              <OnboardingSlideTransition
                className="flex min-h-[calc(100dvh-15.625rem)] w-full flex-col items-center text-center"
                direction={transitionDirection}
                transitionKey={`${page}-${transitionDirection}`}
              >
                <div className="w-full max-w-[620px]">
                  <h1 className="text-title font-normal">
                    {page === "member"
                      ? "Reconnect to your community"
                      : "Join a community"}
                  </h1>
                  <p className="mt-3 text-sm leading-6 text-foreground/80">
                    {page === "member"
                      ? "Enter your community link or an invite from the owner. We’ll restore your access when you connect."
                      : "Enter the invite link or community link you received."}
                  </p>
                </div>
                <div className="flex w-full flex-1 flex-col items-center justify-center gap-16">
                  <InviteRedeemForm
                    error={null}
                    isRedeeming={false}
                    onCancel={() =>
                      showPage(page === "member" ? "existing" : "welcome")
                    }
                    onConnect={startConnection}
                    onRedeem={redeemInvite}
                    placeholder="Paste your invite link or community link"
                    variant="onboarding-spotlight"
                  />
                  {page === "join" ? (
                    <div className="w-full max-w-[560px] text-left">
                      <p className="text-sm font-medium text-foreground">
                        Joining a private community?
                      </p>
                      <p className="mt-2 text-sm leading-6 text-foreground/75">
                        Some communities need the owner to add you before you
                        can join. You can send the owner your account code so
                        they can add you.
                      </p>
                      <Button
                        aria-controls="welcome-join-technical-details"
                        aria-expanded={showJoinTechnicalDetails}
                        className="mt-3 h-auto px-0 py-1 text-sm"
                        onClick={() =>
                          setShowJoinTechnicalDetails((visible) => !visible)
                        }
                        type="button"
                        variant="link"
                      >
                        Technical details
                      </Button>
                      {showJoinTechnicalDetails ? (
                        <section
                          aria-label="Account code"
                          className="mt-2"
                          id="welcome-join-technical-details"
                        >
                          <div className="flex items-center gap-3 rounded-xl border border-foreground/10 bg-background/35 px-4 py-3">
                            <code
                              className="min-w-0 flex-1 truncate font-mono text-xs text-foreground/80"
                              data-testid="welcome-join-npub"
                            >
                              {npub || "Loading…"}
                            </code>
                            <Button
                              aria-label="Copy account code"
                              className="h-9 shrink-0 rounded-full px-3"
                              disabled={!npub}
                              onClick={() => {
                                void writeTextToClipboard(npub).then(() => {
                                  setCopiedNpub(true);
                                  window.setTimeout(
                                    () => setCopiedNpub(false),
                                    1500,
                                  );
                                });
                              }}
                              size="sm"
                              type="button"
                              variant="outline"
                            >
                              {copiedNpub ? (
                                <Check className="h-4 w-4" aria-hidden="true" />
                              ) : (
                                <Copy className="h-4 w-4" aria-hidden="true" />
                              )}
                              <span>{copiedNpub ? "Copied" : "Copy"}</span>
                            </Button>
                          </div>
                          {npubError ? (
                            <p className="mt-3 text-sm text-destructive">
                              {npubError}
                            </p>
                          ) : null}
                        </section>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </OnboardingSlideTransition>
            )}
          </div>
        }
      />
    </OnboardingFooterProvider>
  );
}
