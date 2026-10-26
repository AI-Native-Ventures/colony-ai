import type { TenantCommunityId } from "@/features/communities/tenantCommunity";

/**
 * The mock relay's tenant community UUID: what the real relay resolves from the
 * connection host (`communities.id`) and uses to namespace business record
 * d-tags. It must never equal the desktop's local community id (a random id
 * stored in localStorage), so a client that builds d-tags from the local id is
 * refused by the mock exactly as the real relay refuses it.
 */
export const MOCK_TENANT_COMMUNITY_ID =
  "7c1f3a4e-0d2b-4c58-9a6e-5b8d2f1e9a03" as TenantCommunityId;

/** The refusal text the real relay sends for a d-tag outside the tenant namespace. */
export const BUSINESS_SCOPE_REFUSAL =
  "business command scope: business record d-tag does not match its namespace";

declare global {
  interface Window {
    /** Every business command the mock relay saw, with its verdict (tests read it). */
    __BUZZ_E2E_BUSINESS_COMMANDS__?: Array<{
      kind: number;
      dTag: string;
      accepted: boolean;
    }>;
  }
}
