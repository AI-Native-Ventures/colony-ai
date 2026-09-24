export const MAX_COMMUNITY_SLUG_LENGTH = 63;
export const DEFAULT_MAX_COMMUNITIES_PER_OWNER = 3;

const RESERVED_COMMUNITY_SLUGS = new Set([
  "admin",
  "api",
  "app",
  "assets",
  "help",
  "imap",
  "mail",
  "media",
  "mx",
  "ns1",
  "ns2",
  "relay",
  "smtp",
  "static",
  "status",
  "support",
  "www",
]);

export type RawCommunityProvisioningConfig = {
  self_serve?: boolean;
  domain?: string | null;
  public?: boolean;
  max_per_owner?: number;
};

export type CommunityProvisioningConfig = {
  domain: string | null;
  selfServe: boolean;
  public: boolean;
  maxPerOwner: number;
};

export type CommunitySlugValidation = {
  slug: string;
  error: string | null;
};

export function communityProvisioningFromConfig(
  config: RawCommunityProvisioningConfig,
): CommunityProvisioningConfig {
  const domain = config.domain?.trim().toLowerCase() || null;
  return {
    domain,
    selfServe: Boolean(config.self_serve) && domain !== null,
    public: Boolean(config.public),
    maxPerOwner:
      typeof config.max_per_owner === "number" && config.max_per_owner > 0
        ? config.max_per_owner
        : DEFAULT_MAX_COMMUNITIES_PER_OWNER,
  };
}

export function validateCommunitySlug(raw: string): CommunitySlugValidation {
  const slug = raw.trim().toLowerCase();
  if (!slug) return { slug, error: "Enter a community name." };
  if (slug.length > MAX_COMMUNITY_SLUG_LENGTH) {
    return {
      slug,
      error: `Use ${MAX_COMMUNITY_SLUG_LENGTH} characters or fewer.`,
    };
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    return {
      slug,
      error: "Use lowercase letters, numbers, and single hyphens.",
    };
  }
  if (RESERVED_COMMUNITY_SLUGS.has(slug)) {
    return { slug, error: "That community name is reserved." };
  }
  return { slug, error: null };
}

export function communityRelayUrl(host: string): string {
  return `wss://${host}`;
}

export function communityCreateErrorMessage(code: string): string {
  if (code === "taken: that community name is already in use") {
    return "That address is already in use. Choose another name.";
  }
  if (code.startsWith("limit_reached:")) {
    return "You have reached the community limit for this account.";
  }
  if (code === "community_created_retryable") {
    return "Your community was created, but setup needs another try. Retry to finish.";
  }
  if (code === "only members of this community can create new communities") {
    return "This relay requires an existing community membership before you can create one.";
  }
  if (
    code ===
    "this relay has reached its hourly limit for new communities; try again later"
  ) {
    return "This relay has reached its hourly creation limit. Try again later.";
  }
  if (
    code === "too many communities created from this network; try again later"
  ) {
    return "Too many communities were created from this network. Try again later.";
  }
  return "Could not create the community. Try again.";
}
