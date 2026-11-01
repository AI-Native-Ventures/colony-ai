import * as React from "react";

import { useCommunityOnboarding } from "@/features/onboarding/communityOnboarding";
import { FirstRunButton } from "@/features/onboarding/ui/firstRunControls";
import { CheckIcon, PlusIcon } from "@/features/onboarding/ui/firstRunIcons";
import {
  businessLogoUrl,
  buildTimeLogoToken,
} from "@/features/discovery/businessLogo";
import {
  saveOnboardingBusinessProfile,
  type OnboardingBusinessProfile,
} from "@/features/communities/businessProfileStorage";
import { WorkspaceMark } from "@/features/communities/ui/WorkspaceMark";
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
  onJoin?: () => void;
  variant?: "first-run" | "workspace";
};

function workspaceSlugFromName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63)
    .replace(/-+$/g, "");
}

/** Claim a self-serve Colony address, either from first run or the workspace menu. */
export function SelfServeCommunityCreateFlow({
  onComplete,
  onBack,
  onJoin,
  variant = "first-run",
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
  const [workspaceName, setWorkspaceName] = React.useState("");
  const [website, setWebsite] = React.useState("");
  const [availability, setAvailability] = React.useState<boolean | null>(null);
  const [availabilitySlug, setAvailabilitySlug] = React.useState<string | null>(
    null,
  );
  const [availabilityMessage, setAvailabilityMessage] = React.useState("");
  const [checking, setChecking] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [feedback, setFeedback] = React.useState("");
  const [createdCommunity, setCreatedCommunity] =
    React.useState<SelfServeCommunity | null>(null);
  const [retryable, setRetryable] = React.useState(false);
  const isWorkspaceCreate = variant === "workspace";

  const validation = validateCommunitySlug(name);
  const visibleValidationError = name.trim()
    ? isWorkspaceCreate
      ? (validation.error?.replace(/community/gi, "workspace") ?? null)
      : validation.error
    : null;
  const localPubkey = identityQuery.data?.pubkey ?? null;
  const profileLogoUrl = businessLogoUrl(website, buildTimeLogoToken());
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
          isWorkspaceCreate
            ? "Could not check whether workspaces can be created right now."
            : "Could not check whether communities can be created right now.",
        );
      })
      .finally(() => {
        if (generation === configRequestGeneration.current)
          setConfigLoading(false);
      });
  }, [isWorkspaceCreate]);

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
      !validation.slug ||
      visibleValidationError
    ) {
      setAvailability(null);
      setAvailabilitySlug(null);
      setAvailabilityMessage(visibleValidationError ?? "");
      setChecking(false);
      return;
    }

    let active = true;
    setAvailability(null);
    setAvailabilitySlug(null);
    setAvailabilityMessage("");
    const timer = window.setTimeout(() => {
      setChecking(true);
      void checkCommunityAvailability(httpBase, validation.slug)
        .then((result) => {
          if (!active) return;
          setAvailability(result.available);
          setAvailabilitySlug(validation.slug);
          setAvailabilityMessage(
            result.available
              ? "That address is available."
              : (result.reason ?? "That address is already in use."),
          );
        })
        .catch(() => {
          if (active) {
            setAvailability(null);
            setAvailabilitySlug(null);
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
        setFeedback(
          isWorkspaceCreate
            ? "Could not verify that workspace belongs to your account."
            : "Could not verify that community belongs to your account.",
        );
        return false;
      }
      if (isWorkspaceCreate) {
        const profile: OnboardingBusinessProfile = {
          name: workspaceName.trim() || community.slug,
          website: website.trim(),
          description: "",
          logoDataUrl: null,
          logoUrl: profileLogoUrl,
        };
        try {
          saveOnboardingBusinessProfile(community.id, profile);
        } catch {
          setFeedback(
            "Workspace created, but its logo could not be saved. Try again.",
          );
          return false;
        }
      }
      setCreatedCommunity(community);
      setRetryable(false);
      setFeedback("");
      const started = onboarding.start({
        source: isWorkspaceCreate ? "add-community" : "first-community",
        firstCommunityPage: isWorkspaceCreate ? undefined : "create",
        relayUrl: communityRelayUrl(expectedHost),
        communityName: isWorkspaceCreate
          ? workspaceName.trim() || community.slug
          : community.slug,
        businessCommunityId: isWorkspaceCreate ? community.id : undefined,
      });
      if (!started) {
        setFeedback(
          isWorkspaceCreate
            ? "Your workspace is ready. Finish the workspace connection already in progress, then connect here."
            : "Your community is ready. Finish the community connection already in progress, then connect here.",
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
      isWorkspaceCreate,
      profileLogoUrl,
      provisioning?.domain,
      validation.slug,
      website,
      workspaceName,
    ],
  );

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || !httpBase || !provisioning?.domain || !localPubkey) return;

    if (createdCommunity && !retryable) {
      connect(createdCommunity);
      return;
    }
    if (
      !validation.error &&
      (availability !== true || availabilitySlug !== validation.slug) &&
      !retryable
    ) {
      return;
    }

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
            isWorkspaceCreate
              ? "Your workspace is already created. Retry setup to finish connecting it."
              : "Your community is already created. Retry setup to finish connecting it.",
          );
          return;
        }
      } catch {
        // Keep the original create failure visible when the recovery read also fails.
      }
      setFeedback(
        isWorkspaceCreate
          ? communityCreateErrorMessage(code).replace(
              /community/gi,
              "workspace",
            )
          : communityCreateErrorMessage(code),
      );
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
    ((!validation.error &&
      availability === true &&
      availabilitySlug === validation.slug) ||
      retryable ||
      Boolean(createdCommunity));
  const availabilityState = checking
    ? "Checking address…"
    : availabilityMessage;
  const bad = availability === false || Boolean(visibleValidationError);

  if (isWorkspaceCreate) {
    const displayName = workspaceName.trim() || "New workspace";
    const initial = displayName.trim().slice(0, 1).toUpperCase() || "W";
    return (
      <section
        aria-labelledby="workspace-create-title"
        className="c3fr-pane gap-0"
        data-testid="workspace-create-form"
      >
        <div className="c3fr-pane-head mb-5">
          <div className="c3fr-pane-head-text">
            <h2
              className="c3fr-pane-title c3fr-edit-title"
              id="workspace-create-title"
            >
              Create a workspace
            </h2>
            <span className="c3fr-pane-desc">
              A separate space with its own channels, agents and people. Switch
              any time from the workspace menu.
            </span>
          </div>
        </div>
        {configLoading ? (
          <p className="c3fr-note" role="status">
            <span aria-hidden="true" className="c3fr-spinner" /> Checking
            workspace creation availability…
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
              Workspace creation is not available right now.
            </p>
            <FirstRunButton fit="content" onClick={onBack}>
              Cancel
            </FirstRunButton>
          </div>
        ) : (
          <form
            className="c3fr-pane-body c3fr-pane-form gap-4"
            onSubmit={submit}
          >
            <div className="c3fr-field-group" style={{ gap: 6 }}>
              <label className="c3fr-label" htmlFor="workspace-create-name">
                Workspace name
              </label>
              <input
                autoComplete="organization"
                className="c3fr-input"
                data-testid="workspace-create-name"
                id="workspace-create-name"
                maxLength={80}
                onChange={(event) => {
                  const nextName = event.currentTarget.value;
                  setWorkspaceName(nextName);
                  setName(workspaceSlugFromName(nextName));
                  setCreatedCommunity(null);
                  setRetryable(false);
                  setFeedback("");
                }}
                placeholder="North Star"
                value={workspaceName}
              />
            </div>

            <div className="flex items-end gap-3">
              <div
                className="c3fr-field-group min-w-0 flex-1"
                style={{ gap: 6 }}
              >
                <label
                  className="c3fr-label"
                  htmlFor="workspace-create-website"
                >
                  Website{" "}
                  <span className="font-normal text-muted-foreground">
                    (optional)
                  </span>
                </label>
                <input
                  autoCapitalize="none"
                  autoComplete="url"
                  className="c3fr-input"
                  id="workspace-create-website"
                  onChange={(event) => setWebsite(event.currentTarget.value)}
                  placeholder="yourbusiness.co.za"
                  spellCheck={false}
                  type="url"
                  value={website}
                />
              </div>
              <div
                aria-hidden="true"
                className="flex w-12 shrink-0 flex-col items-center gap-1"
                data-testid="workspace-create-icon-preview"
              >
                <span
                  aria-hidden="true"
                  className="relative grid size-12 place-items-center overflow-hidden rounded-xl border border-border bg-muted text-base font-semibold text-muted-foreground"
                >
                  {initial}
                  <WorkspaceMark
                    businessLogoUrl={profileLogoUrl}
                    className="absolute inset-0 grid place-items-center overflow-hidden rounded-xl bg-transparent text-transparent"
                    fallbackText={initial}
                    imageFit="contain"
                    name={displayName}
                  />
                </span>
                <span
                  aria-hidden="true"
                  className="text-xs text-muted-foreground"
                >
                  Icon
                </span>
              </div>
            </div>
            <p className="c3fr-help">
              We use the logo from your website when we find one. Until then,
              the first letter. You can upload one any time.
            </p>

            <div className="c3fr-field-group" style={{ gap: 6 }}>
              <label className="c3fr-label" htmlFor="workspace-create-address">
                Workspace address
              </label>
              <span
                className="c3fr-address"
                data-state={
                  bad ? "bad" : availability === true ? "ok" : undefined
                }
              >
                <input
                  aria-describedby="workspace-create-availability"
                  aria-invalid={bad}
                  autoCapitalize="none"
                  autoComplete="off"
                  data-testid="workspace-create-address"
                  id="workspace-create-address"
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
                <span className="c3fr-address-suffix">
                  .{provisioning?.domain}
                </span>
              </span>
              <span
                aria-live="polite"
                className="c3fr-address-status"
                data-state={
                  bad ? "bad" : availability === true ? "ok" : undefined
                }
                data-testid="workspace-create-availability"
                id="workspace-create-availability"
                role="status"
              >
                {availability === true && !checking ? (
                  <CheckIcon size={14} strokeWidth={3} />
                ) : null}
                {availabilityState}
              </span>
              <p className="c3fr-help">
                Made from the name. Lowercase letters, numbers and single
                hyphens.
              </p>
            </div>

            {identityUnavailable ? (
              <p className="c3fr-error" role="alert">
                Sign in to your account before creating a workspace.
              </p>
            ) : null}
            {feedback ? (
              <p
                aria-live="polite"
                className="c3fr-error"
                data-testid="workspace-create-feedback"
                role="status"
              >
                {feedback}
              </p>
            ) : null}

            <div className="c3fr-pane-actions items-center justify-between">
              <div className="flex flex-wrap gap-2">
                <button
                  className="c3fr-pane-primary"
                  data-testid="workspace-create-submit"
                  disabled={!canSubmit}
                  type="submit"
                >
                  {busy
                    ? "Creating…"
                    : createdCommunity && !retryable
                      ? "Connect to workspace"
                      : retryable
                        ? "Retry setup"
                        : "Create workspace"}
                </button>
                <FirstRunButton className="c3fr-pane-cancel" onClick={onBack}>
                  Cancel
                </FirstRunButton>
              </div>
              {onJoin ? (
                <button
                  className="ml-auto text-sm font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  data-testid="workspace-create-join"
                  onClick={onJoin}
                  type="button"
                >
                  Join with an invite link instead
                </button>
              ) : null}
            </div>
          </form>
        )}
      </section>
    );
  }

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
            {isWorkspaceCreate
              ? "Create a workspace"
              : "Create a new community"}
          </h2>
          <span className="c3fr-pane-desc">
            {isWorkspaceCreate
              ? "Choose a Colony address for your workspace."
              : "Claim a Colony address for your team."}
          </span>
        </div>
      </div>
      {configLoading ? (
        <p className="c3fr-note" role="status">
          <span aria-hidden="true" className="c3fr-spinner" /> Checking
          {isWorkspaceCreate
            ? " workspace creation availability…"
            : " community creation availability…"}
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
            {isWorkspaceCreate
              ? "Workspace creation is not available right now."
              : "Community creation is not available right now."}
          </p>
          <FirstRunButton fit="content" onClick={onBack}>
            Cancel
          </FirstRunButton>
        </div>
      ) : (
        <form className="c3fr-pane-body c3fr-pane-form" onSubmit={submit}>
          <div className="c3fr-field-group" style={{ gap: 6 }}>
            <label className="c3fr-label" htmlFor="self-serve-community-name">
              {isWorkspaceCreate ? "Workspace address" : "Community address"}
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
              {isWorkspaceCreate
                ? "Sign in to your account before creating a workspace."
                : "Sign in to your account before creating a community."}
            </p>
          ) : null}
          {provisioning?.maxPerOwner ? (
            <p className="c3fr-help">
              Your account can own up to {provisioning.maxPerOwner}{" "}
              {isWorkspaceCreate ? "workspaces." : "communities."}
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
                  {isWorkspaceCreate
                    ? "Connect to workspace"
                    : "Connect to community"}
                </>
              ) : retryable ? (
                "Retry setup"
              ) : isWorkspaceCreate ? (
                "Create workspace"
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
