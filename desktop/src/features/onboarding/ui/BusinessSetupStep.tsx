import * as React from "react";

import {
  communityCreateErrorMessage,
  communityProvisioningFromConfig,
  communityRelayUrl,
  validateCommunitySlug,
} from "@/features/communities/selfProvisioning";
import {
  checkCommunityAvailability,
  CommunityProvisioningRequestError,
  createSelfServeCommunity,
  fetchCommunityProvisioningConfig,
  getSelfProvisioningHttpBase,
  listMyCommunities,
  type SelfServeCommunity,
} from "@/features/communities/selfProvisioningApi";
import type { OnboardingSceneData } from "./OnboardingScenePresentation";
import { OnboardingScenePresentation } from "./OnboardingScenePresentation";
import { resolveBusinessLogoUrl, websiteFaviconUrl } from "./businessProfile";

const PROFILE_STORAGE_KEY = "colony-business-profile.v1";

export type OnboardingBusinessProfile = {
  name: string;
  website: string;
  description: string;
  logoDataUrl: string | null;
  logoUrl: string | null;
};

type BusinessSetupStepProps = {
  pubkey: string;
  additional?: boolean;
  onBack: () => void;
  onCreated: (
    community: SelfServeCommunity,
    profile: OnboardingBusinessProfile,
  ) => void;
};

function businessSlug(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function profileKey(communityId: string) {
  return `${PROFILE_STORAGE_KEY}:${communityId}`;
}

export function readOnboardingBusinessProfile(
  communityId: string,
): OnboardingBusinessProfile | null {
  try {
    const raw = localStorage.getItem(profileKey(communityId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const profile = parsed as Partial<OnboardingBusinessProfile>;
    if (
      typeof profile.name !== "string" ||
      typeof profile.website !== "string" ||
      typeof profile.description !== "string" ||
      (profile.logoDataUrl !== null &&
        typeof profile.logoDataUrl !== "string") ||
      (profile.logoUrl != null && typeof profile.logoUrl !== "string")
    ) {
      return null;
    }
    return {
      name: profile.name,
      website: profile.website,
      description: profile.description,
      logoDataUrl: profile.logoDataUrl,
      logoUrl: profile.logoUrl ?? null,
    };
  } catch {
    return null;
  }
}

export function BusinessSetupStep({
  additional = false,
  onBack,
  onCreated,
  pubkey,
}: BusinessSetupStepProps) {
  const [name, setName] = React.useState("");
  const [website, setWebsite] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [uploadedLogo, setUploadedLogo] = React.useState<string | null>(null);
  const [faviconUrl, setFaviconUrl] = React.useState<string | null>(null);
  const [faviconFailed, setFaviconFailed] = React.useState(false);
  const [httpBase, setHttpBase] = React.useState<string | null>(null);
  const [provisioning, setProvisioning] = React.useState<ReturnType<
    typeof communityProvisioningFromConfig
  > | null>(null);
  const [configLoading, setConfigLoading] = React.useState(true);
  const [configError, setConfigError] = React.useState<string | null>(null);
  const [availability, setAvailability] = React.useState<boolean | null>(null);
  const [availabilityError, setAvailabilityError] = React.useState<
    string | null
  >(null);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const configGeneration = React.useRef(0);
  const availabilityGeneration = React.useRef(0);
  const logoGeneration = React.useRef(0);

  const slug = businessSlug(name);
  const validation = validateCommunitySlug(slug);
  const logoUrl = resolveBusinessLogoUrl({
    uploadedLogo,
    faviconFailed,
    faviconUrl,
  });
  const profile = React.useMemo<OnboardingBusinessProfile>(
    () => ({
      name: name.trim(),
      website: website.trim(),
      description: description.trim(),
      logoDataUrl: uploadedLogo,
      logoUrl,
    }),
    [description, logoUrl, name, uploadedLogo, website],
  );
  const data: OnboardingSceneData = {
    name: "",
    email: "",
    business: name,
    website,
    description,
    logoUrl,
    pending,
  };

  React.useEffect(() => {
    const generation = ++configGeneration.current;
    setConfigLoading(true);
    setConfigError(null);
    void getSelfProvisioningHttpBase()
      .then(async (base) => {
        const config = await fetchCommunityProvisioningConfig(base);
        if (generation !== configGeneration.current) return;
        setHttpBase(base);
        setProvisioning(communityProvisioningFromConfig(config));
      })
      .catch(() => {
        if (generation !== configGeneration.current) return;
        setHttpBase(null);
        setProvisioning(null);
        setConfigError(
          "Could not check whether this relay can create communities.",
        );
      })
      .finally(() => {
        if (generation === configGeneration.current) setConfigLoading(false);
      });
    return () => {
      configGeneration.current += 1;
    };
  }, []);

  React.useEffect(() => {
    const generation = ++availabilityGeneration.current;
    setAvailability(null);
    setAvailabilityError(null);
    if (
      !httpBase ||
      !provisioning?.selfServe ||
      !provisioning.domain ||
      validation.error
    ) {
      setAvailability(null);
      setAvailabilityError(null);
      return;
    }

    const timer = window.setTimeout(() => {
      void checkCommunityAvailability(httpBase, validation.slug)
        .then((result) => {
          if (generation !== availabilityGeneration.current) return;
          setAvailability(result.available);
          setAvailabilityError(
            result.available
              ? null
              : (result.reason ?? "That community address is already in use."),
          );
        })
        .catch(() => {
          if (generation !== availabilityGeneration.current) return;
          setAvailability(null);
          setAvailabilityError("Could not check that address. Try again.");
        });
    }, 250);

    return () => {
      window.clearTimeout(timer);
      availabilityGeneration.current += 1;
    };
  }, [
    httpBase,
    provisioning?.domain,
    provisioning?.selfServe,
    validation.error,
    validation.slug,
  ]);

  const readWebsite = React.useCallback(() => {
    if (!website.trim()) return;
    const favicon = websiteFaviconUrl(website);
    if (!favicon) {
      setError("Add a valid website address, or continue without one.");
      return;
    }
    setFaviconUrl(favicon);
    setError(null);
  }, [website]);

  const chooseLogo = React.useCallback((file: File | null) => {
    if (!file) return;
    const generation = ++logoGeneration.current;
    if (
      !["image/png", "image/jpeg", "image/webp", "image/svg+xml"].includes(
        file.type,
      )
    ) {
      setError("Choose a PNG, JPG, WebP or SVG image.");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setError("Choose an image smaller than 2 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => {
      if (generation === logoGeneration.current)
        setError("This image couldn’t be opened. Try another file.");
    };
    reader.onload = async () => {
      if (generation !== logoGeneration.current) return;
      if (
        typeof reader.result !== "string" ||
        !reader.result.startsWith("data:image/")
      ) {
        setError("This image couldn’t be opened. Try another file.");
        return;
      }
      try {
        const image = new Image();
        image.src = reader.result;
        await image.decode();
        if (generation !== logoGeneration.current) return;
        if (!image.naturalWidth || !image.naturalHeight) {
          throw new Error("image_dimensions_missing");
        }
        setUploadedLogo(reader.result);
        setError(null);
      } catch {
        if (generation === logoGeneration.current) {
          setError("This image couldn’t be opened. Try another file.");
        }
      }
    };
    reader.readAsDataURL(file);
  }, []);

  const submit = React.useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (
        pending ||
        configLoading ||
        configError ||
        !httpBase ||
        !provisioning?.selfServe ||
        !provisioning.domain ||
        !pubkey ||
        validation.error ||
        availability !== true
      ) {
        return;
      }

      const expectedHost =
        `${validation.slug}.${provisioning.domain}`.toLowerCase();
      const saveProfile = (key: string) => {
        try {
          localStorage.setItem(key, JSON.stringify(profile));
          return true;
        } catch {
          setError(
            "Your business details could not be saved on this device. Free up storage and try again.",
          );
          return false;
        }
      };

      if (!saveProfile(`${PROFILE_STORAGE_KEY}:draft:${validation.slug}`))
        return;
      setPending(true);
      setError(null);
      try {
        const result = await createSelfServeCommunity(
          httpBase,
          validation.slug,
        );
        const community = result.community;
        if (
          community.normalized_host.toLowerCase() !== expectedHost ||
          community.owner_pubkey.toLowerCase() !== pubkey.toLowerCase()
        ) {
          throw new Error("community_response_identity_mismatch");
        }
        if (!saveProfile(profileKey(community.id))) return;
        onCreated(community, profile);
      } catch (cause) {
        const code =
          cause instanceof CommunityProvisioningRequestError
            ? cause.code
            : cause instanceof Error &&
                cause.message === "community_response_identity_mismatch"
              ? cause.message
              : "request_failed";
        try {
          const mine = await listMyCommunities(httpBase);
          const existing = mine.communities.find(
            (community) =>
              community.normalized_host.toLowerCase() === expectedHost &&
              community.owner_pubkey.toLowerCase() === pubkey.toLowerCase(),
          );
          if (existing) {
            if (!saveProfile(profileKey(existing.id))) return;
            onCreated(existing, profile);
            return;
          }
        } catch {
          // Preserve the create error if the recovery read also fails.
        }
        setError(
          code === "community_response_identity_mismatch"
            ? "Could not verify that community belongs to your account."
            : communityCreateErrorMessage(code),
        );
      } finally {
        setPending(false);
      }
    },
    [
      availability,
      configError,
      configLoading,
      httpBase,
      onCreated,
      pending,
      profile,
      provisioning?.domain,
      provisioning?.selfServe,
      pubkey,
      validation.error,
      validation.slug,
    ],
  );

  const unavailableMessage = configError
    ? configError
    : configLoading
      ? null
      : !provisioning?.selfServe
        ? "Community creation is not enabled on this relay."
        : name.trim() && validation.error
          ? validation.error
          : availabilityError;

  return (
    <OnboardingScenePresentation
      data={data}
      canSubmit={
        !configLoading &&
        !configError &&
        provisioning?.selfServe === true &&
        Boolean(provisioning.domain) &&
        !validation.error &&
        availability === true
      }
      error={error ?? unavailableMessage}
      onBusinessChange={(value) => {
        setName(value);
        setError(null);
      }}
      onDescriptionChange={setDescription}
      onLogoChange={chooseLogo}
      onLogoError={() => {
        if (uploadedLogo) setUploadedLogo(null);
        else setFaviconFailed(true);
      }}
      onNavigate={() => onBack()}
      onReadWebsite={readWebsite}
      onSubmit={submit}
      onWebsiteChange={(value) => {
        setFaviconUrl(null);
        setFaviconFailed(false);
        setWebsite(value);
        setError(null);
      }}
      pending={pending || configLoading}
      scene={additional ? "additional" : "business"}
    />
  );
}

export function businessCommunityRelayUrl(community: SelfServeCommunity) {
  return communityRelayUrl(community.normalized_host);
}
