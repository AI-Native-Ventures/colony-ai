import * as React from "react";
import { AlertCircle, Check, LoaderCircle } from "lucide-react";

import { useCommunityOnboarding } from "@/features/onboarding/communityOnboarding";
import { useIdentityQuery } from "@/shared/api/hooks";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { Input } from "@/shared/ui/input";

import {
  communityCreateErrorMessage,
  communityProvisioningFromConfig,
  communityRelayUrl,
  validateCommunitySlug,
} from "../selfProvisioning";
import {
  checkCommunityAvailability,
  CommunityProvisioningRequestError,
  createSelfServeCommunity,
  fetchCommunityProvisioningConfig,
  getSelfProvisioningHttpBase,
  listMyCommunities,
  type SelfServeCommunity,
} from "../selfProvisioningApi";

type SelfServeCommunityCreateFlowProps = {
  onBack: () => void;
};

export function SelfServeCommunityCreateFlow({
  onBack,
}: SelfServeCommunityCreateFlowProps) {
  const onboarding = useCommunityOnboarding();
  const identityQuery = useIdentityQuery();
  const [httpBase, setHttpBase] = React.useState<string | null>(null);
  const [provisioning, setProvisioning] = React.useState<ReturnType<
    typeof communityProvisioningFromConfig
  > | null>(null);
  const [configLoading, setConfigLoading] = React.useState(true);
  const [configError, setConfigError] = React.useState<string | null>(null);
  const [name, setName] = React.useState("");
  const [availability, setAvailability] = React.useState<boolean | null>(null);
  const [availabilityMessage, setAvailabilityMessage] = React.useState("");
  const [checking, setChecking] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [feedback, setFeedback] = React.useState("");
  const [createdCommunity, setCreatedCommunity] =
    React.useState<SelfServeCommunity | null>(null);
  const [retryable, setRetryable] = React.useState(false);

  const validation = validateCommunitySlug(name);
  const localPubkey = identityQuery.data?.pubkey ?? null;
  const configRequestGeneration = React.useRef(0);

  const loadConfig = React.useCallback(() => {
    const generation = ++configRequestGeneration.current;
    setConfigLoading(true);
    setConfigError(null);
    void getSelfProvisioningHttpBase()
      .then(async (base) => {
        const config = await fetchCommunityProvisioningConfig(base);
        if (generation !== configRequestGeneration.current) return;
        setHttpBase(base);
        setProvisioning(communityProvisioningFromConfig(config));
      })
      .catch(() => {
        if (generation !== configRequestGeneration.current) return;
        setHttpBase(null);
        setProvisioning(null);
        setConfigError(
          "Could not check whether this relay can create communities.",
        );
      })
      .finally(() => {
        if (generation === configRequestGeneration.current)
          setConfigLoading(false);
      });
  }, []);

  React.useEffect(() => {
    loadConfig();
    return () => {
      configRequestGeneration.current += 1;
    };
  }, [loadConfig]);

  React.useEffect(() => {
    if (
      !httpBase ||
      !provisioning?.selfServe ||
      !provisioning.domain ||
      validation.error
    ) {
      setAvailability(null);
      setAvailabilityMessage(validation.error ?? "");
      setChecking(false);
      return;
    }

    let active = true;
    setAvailability(null);
    setAvailabilityMessage("");
    const timer = window.setTimeout(() => {
      setChecking(true);
      void checkCommunityAvailability(httpBase, validation.slug)
        .then((result) => {
          if (!active) return;
          setAvailability(result.available);
          setAvailabilityMessage(
            result.available
              ? "That address is available."
              : (result.reason ?? "That address is already in use."),
          );
        })
        .catch(() => {
          if (active) {
            setAvailability(null);
            setAvailabilityMessage("Could not check that address. Try again.");
          }
        })
        .finally(() => {
          if (active) setChecking(false);
        });
    }, 250);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [
    httpBase,
    provisioning?.domain,
    provisioning?.selfServe,
    validation.error,
    validation.slug,
  ]);

  const connect = React.useCallback(
    (community: SelfServeCommunity) => {
      const expectedHost = provisioning?.domain
        ? `${validation.slug}.${provisioning.domain}`.toLowerCase()
        : null;
      if (
        !expectedHost ||
        community.normalized_host.toLowerCase() !== expectedHost ||
        community.owner_pubkey.toLowerCase() !== localPubkey?.toLowerCase()
      ) {
        setFeedback("Could not verify that community belongs to your account.");
        return false;
      }
      setCreatedCommunity(community);
      setRetryable(false);
      setFeedback("");
      const started = onboarding.start({
        source: "first-community",
        firstCommunityPage: "create",
        relayUrl: communityRelayUrl(expectedHost),
        communityName: community.slug,
      });
      if (!started) {
        setFeedback(
          "Your community is ready. Finish the community connection already in progress, then connect here.",
        );
      }
      return true;
    },
    [localPubkey, onboarding, provisioning?.domain, validation.slug],
  );

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || !httpBase || !provisioning?.domain || !localPubkey) return;

    if (createdCommunity && !retryable) {
      connect(createdCommunity);
      return;
    }
    if (!validation.error && availability !== true && !retryable) return;

    setBusy(true);
    setFeedback("");
    const expectedHost = `${validation.slug}.${provisioning.domain}`;
    try {
      const result = await createSelfServeCommunity(httpBase, validation.slug);
      if (!connect(result.community)) {
        throw new Error("community_response_identity_mismatch");
      }
    } catch (cause) {
      const code =
        cause instanceof CommunityProvisioningRequestError
          ? cause.code
          : "request_failed";
      try {
        const mine = await listMyCommunities(httpBase);
        const existing = mine.communities.find(
          (community) =>
            community.normalized_host.toLowerCase() === expectedHost &&
            community.owner_pubkey.toLowerCase() === localPubkey.toLowerCase(),
        );
        if (existing) {
          setCreatedCommunity(existing);
          setRetryable(true);
          setFeedback(
            "Your community is already created. Retry setup to finish connecting it.",
          );
          return;
        }
      } catch {
        // Keep the original create failure visible when the recovery read also fails.
      }
      setFeedback(communityCreateErrorMessage(code));
    } finally {
      setBusy(false);
    }
  };

  const selfServeDisabled = !configLoading && provisioning?.selfServe !== true;
  const identityUnavailable = !identityQuery.isLoading && !localPubkey;
  const canSubmit =
    !busy &&
    !configLoading &&
    !configError &&
    provisioning?.selfServe === true &&
    Boolean(provisioning.domain) &&
    Boolean(localPubkey) &&
    ((!validation.error && availability === true) ||
      retryable ||
      Boolean(createdCommunity));
  const availabilityState = checking
    ? "Checking address…"
    : availabilityMessage;

  return (
    <section
      aria-labelledby="self-serve-community-title"
      className="flex w-full max-w-[620px] flex-col items-center text-center"
      data-testid="self-serve-community-create"
    >
      <div className="w-full">
        <h1 className="text-title font-normal" id="self-serve-community-title">
          Create a community
        </h1>
        <p className="mt-3 text-sm leading-6 text-foreground/80">
          Choose an address for your community. You’ll be its owner when you
          connect.
        </p>
      </div>

      <Card className="mt-8 w-full p-6 text-left" variant="textured">
        {configLoading ? (
          <p
            className="flex items-center gap-2 text-sm text-foreground/75"
            role="status"
          >
            <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" />
            Checking community creation availability…
          </p>
        ) : configError ? (
          <div aria-live="polite" className="space-y-4" role="status">
            <p className="flex items-start gap-2 text-sm text-destructive">
              <AlertCircle
                aria-hidden="true"
                className="mt-0.5 h-4 w-4 shrink-0"
              />
              {configError}
            </p>
            <Button onClick={loadConfig} type="button" variant="outline">
              Try again
            </Button>
          </div>
        ) : selfServeDisabled ? (
          <div aria-live="polite" className="space-y-3" role="status">
            <p className="text-sm text-foreground/75">
              Community creation is not enabled on this relay.
            </p>
            <Button onClick={onBack} type="button" variant="outline">
              Back
            </Button>
          </div>
        ) : (
          <form className="space-y-5" onSubmit={submit}>
            <div className="space-y-2">
              <label
                className="text-sm font-medium text-foreground"
                htmlFor="self-serve-community-name"
              >
                Community address
              </label>
              <div className="flex min-w-0 items-center gap-2">
                <Input
                  aria-describedby="self-serve-community-availability"
                  aria-invalid={Boolean(
                    validation.error || availability === false,
                  )}
                  autoComplete="off"
                  autoCapitalize="none"
                  className="min-w-0 flex-1"
                  data-testid="self-serve-community-name"
                  id="self-serve-community-name"
                  maxLength={63}
                  onChange={(event) => {
                    setName(event.currentTarget.value);
                    setCreatedCommunity(null);
                    setRetryable(false);
                    setFeedback("");
                  }}
                  placeholder="north-star"
                  value={name}
                />
                <span
                  className="max-w-[48%] shrink truncate text-sm text-foreground/65"
                  data-testid="self-serve-community-domain"
                >
                  .{provisioning?.domain}
                </span>
              </div>
              <p
                aria-live="polite"
                className={
                  availability === false || validation.error
                    ? "min-h-5 text-sm text-destructive"
                    : "min-h-5 text-sm text-foreground/65"
                }
                data-testid="self-serve-community-availability"
                id="self-serve-community-availability"
                role="status"
              >
                {availabilityState ||
                  "Use lowercase letters, numbers, and single hyphens."}
              </p>
            </div>

            {identityUnavailable ? (
              <p className="text-sm text-destructive" role="alert">
                Sign in to your account before creating a community.
              </p>
            ) : null}
            {provisioning?.maxPerOwner ? (
              <p className="text-xs text-foreground/60">
                Your account can own up to {provisioning.maxPerOwner}{" "}
                communities.
              </p>
            ) : null}
            {feedback ? (
              <p
                aria-live="polite"
                className="text-sm text-destructive"
                data-testid="self-serve-community-feedback"
                role="status"
              >
                {feedback}
              </p>
            ) : null}

            <div className="flex flex-wrap justify-between gap-3">
              <Button onClick={onBack} type="button" variant="outline">
                Back
              </Button>
              <Button
                data-testid="self-serve-community-submit"
                disabled={!canSubmit}
                type="submit"
              >
                {busy ? (
                  <>
                    <LoaderCircle
                      aria-hidden="true"
                      className="mr-2 h-4 w-4 animate-spin"
                    />
                    Creating…
                  </>
                ) : createdCommunity && !retryable ? (
                  <>
                    <Check aria-hidden="true" className="mr-2 h-4 w-4" />
                    Connect to community
                  </>
                ) : retryable ? (
                  "Retry setup"
                ) : (
                  "Create community"
                )}
              </Button>
            </div>
          </form>
        )}
      </Card>
    </section>
  );
}
