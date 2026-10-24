import * as React from "react";

import { useCommunityOnboarding } from "@/features/onboarding/communityOnboarding";
import { FirstRunButton } from "@/features/onboarding/ui/firstRunControls";
import { CheckIcon, PlusIcon } from "@/features/onboarding/ui/firstRunIcons";
import "@/features/onboarding/ui/firstRun.css";
import { useIdentityQuery } from "@/shared/api/hooks";

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
  onComplete?: () => void;
  /** "Cancel": leave without creating anything. */
  onBack: () => void;
};

/** Create a new community: claim a Colony address for the team. */
export function SelfServeCommunityCreateFlow({
  onComplete,
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
  const visibleValidationError = name.trim() ? validation.error : null;
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
          "Could not check whether communities can be created right now.",
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
      visibleValidationError
    ) {
      setAvailability(null);
      setAvailabilityMessage(visibleValidationError ?? "");
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
    visibleValidationError,
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
      } else {
        onComplete?.();
      }
      return true;
    },
    [
      localPubkey,
      onComplete,
      onboarding,
      provisioning?.domain,
      validation.slug,
    ],
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
  const bad = availability === false || Boolean(visibleValidationError);

  return (
    <section
      aria-labelledby="self-serve-community-title"
      className="c3fr-pane"
      data-testid="self-serve-community-create"
    >
      <div className="c3fr-pane-head">
        <span aria-hidden="true" className="c3fr-tile" data-tone="dark">
          <PlusIcon size={20} strokeWidth={2.4} />
        </span>
        <div className="c3fr-pane-head-text">
          <h2 className="c3fr-pane-title" id="self-serve-community-title">
            Create a new community
          </h2>
          <span className="c3fr-pane-desc">
            Claim a Colony address for your team.
          </span>
        </div>
      </div>
      {configLoading ? (
        <p className="c3fr-note" role="status">
          <span aria-hidden="true" className="c3fr-spinner" /> Checking
          community creation availability…
        </p>
      ) : configError ? (
        <div aria-live="polite" className="c3fr-pane-body" role="status">
          <p className="c3fr-error">{configError}</p>
          <FirstRunButton fit="content" onClick={loadConfig}>
            Try again
          </FirstRunButton>
        </div>
      ) : selfServeDisabled ? (
        <div aria-live="polite" className="c3fr-pane-body" role="status">
          <p className="c3fr-note">
            Community creation is not available right now.
          </p>
          <FirstRunButton fit="content" onClick={onBack}>
            Cancel
          </FirstRunButton>
        </div>
      ) : (
        <form className="c3fr-pane-body c3fr-pane-form" onSubmit={submit}>
          <div className="c3fr-field-group" style={{ gap: 6 }}>
            <label className="c3fr-label" htmlFor="self-serve-community-name">
              Community address
            </label>
            <span
              className="c3fr-address"
              data-state={
                bad ? "bad" : availability === true ? "ok" : undefined
              }
            >
              <input
                aria-describedby="self-serve-community-availability"
                aria-invalid={bad}
                autoCapitalize="none"
                autoComplete="off"
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
                className="c3fr-address-suffix"
                data-testid="self-serve-community-domain"
              >
                .{provisioning?.domain}
              </span>
            </span>
            <span
              aria-live="polite"
              className="c3fr-address-status"
              data-state={
                bad ? "bad" : availability === true ? "ok" : undefined
              }
              data-testid="self-serve-community-availability"
              id="self-serve-community-availability"
              role="status"
            >
              {availability === true && !checking ? (
                <CheckIcon size={14} strokeWidth={3} />
              ) : null}
              {availabilityState ||
                "Use lowercase letters, numbers, and single hyphens."}
            </span>
            {availabilityState ? (
              <span className="c3fr-help">
                Use lowercase letters, numbers, and single hyphens.
              </span>
            ) : null}
          </div>

          {identityUnavailable ? (
            <p className="c3fr-error" role="alert">
              Sign in to your account before creating a community.
            </p>
          ) : null}
          {provisioning?.maxPerOwner ? (
            <p className="c3fr-help">
              Your account can own up to {provisioning.maxPerOwner} communities.
            </p>
          ) : null}
          {feedback ? (
            <p
              aria-live="polite"
              className="c3fr-error"
              data-testid="self-serve-community-feedback"
              role="status"
            >
              {feedback}
            </p>
          ) : null}

          <div className="c3fr-pane-actions">
            <button
              className="c3fr-pane-primary"
              data-testid="self-serve-community-submit"
              disabled={!canSubmit}
              type="submit"
            >
              {busy ? (
                "Creating…"
              ) : createdCommunity && !retryable ? (
                <>
                  <CheckIcon size={16} strokeWidth={3} />
                  Connect to community
                </>
              ) : retryable ? (
                "Retry setup"
              ) : (
                "Create community"
              )}
            </button>
            <FirstRunButton className="c3fr-pane-cancel" onClick={onBack}>
              Cancel
            </FirstRunButton>
          </div>
        </form>
      )}
    </section>
  );
}
