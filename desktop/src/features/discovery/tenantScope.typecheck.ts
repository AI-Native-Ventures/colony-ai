/**
 * Compile-time guard, never imported at runtime: a business record coordinate
 * must be built from the relay's tenant community id, never from a local
 * community id. If the `TenantCommunityId` brand is ever loosened to `string`,
 * the `@ts-expect-error` lines below stop erroring and `tsc` fails.
 */

import type { TenantCommunityId } from "@/features/communities/tenantCommunity";
import type { Community } from "@/features/communities/types";

import { businessDTag, proposalVersionDTag } from "./businessRecordContract";
import type {
  publishProposalAcceptance,
  publishProposalVersion,
  publishProspectAction,
  publishServiceAction,
} from "./businessRecordMutations";

export function businessCoordinatesNeedTheTenantId(
  local: Community,
  tenant: TenantCommunityId,
  input: never,
): void {
  businessDTag(tenant, "prospect", "p");
  proposalVersionDTag(tenant, "p", 1);

  // @ts-expect-error a local community id is not the relay's business id
  businessDTag(local.id, "prospect", "p");
  // @ts-expect-error a local community id is not the relay's business id
  proposalVersionDTag(local.id, "p", 1);
  // @ts-expect-error a saved business id is a hint, not the relay's answer
  businessDTag(local.businessCommunityId ?? "", "prospect", "p");

  // Every publisher takes the branded id in its input.
  type Inputs = [
    Parameters<typeof publishServiceAction>[0],
    Parameters<typeof publishProspectAction>[0],
    Parameters<typeof publishProposalVersion>[0],
    Parameters<typeof publishProposalAcceptance>[0],
  ];
  const ids: Array<Inputs[number]["communityId"]> = [tenant];
  // @ts-expect-error publishers refuse a plain string community id
  const refused: Array<Inputs[number]["communityId"]> = [local.id];
  void ids;
  void refused;
  void input;
}
