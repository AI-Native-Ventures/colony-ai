/**
 * Who a new Sales channel starts with. Pure, so the production wiring in
 * `salesChannelRuntime.ts` and the unit tests share one rule.
 */

import type { TeamMember } from "@/features/company-team/teamModels";
import type { RelayMember } from "@/shared/api/types";

import type { SalesChannelPeople } from "./salesChannel";

/**
 * The business's owners and admins, and the AI employees this Mac runs.
 *
 * A business can hold many agents under one name: every reinstall, new Mac or
 * reset makes a new agent key and the old ones stay on the relay. Adding every
 * employee the relay lists filled the channel with Scouts nobody can reach, so
 * only the employees with an agent record on this Mac are added. The person
 * setting the channel up is left out; the relay adds its creator itself.
 */
export function pickSalesChannelPeople(input: {
  selfPubkey: string;
  relayMembers: readonly Pick<RelayMember, "pubkey" | "role">[];
  teamMembers: readonly Pick<
    TeamMember,
    "pubkey" | "kind" | "managedAgent" | "position"
  >[];
}): SalesChannelPeople {
  const me = input.selfPubkey.toLowerCase();
  const others = (pubkeys: string[]) =>
    pubkeys.filter((pubkey) => pubkey.toLowerCase() !== me);
  return {
    leaders: others(
      input.relayMembers
        .filter(({ role }) => role === "owner" || role === "admin")
        .map(({ pubkey }) => pubkey),
    ),
    employees: others(
      input.teamMembers
        .filter(
          (member) =>
            member.kind === "employee" &&
            member.managedAgent !== null &&
            member.position?.head.status !== "terminated",
        )
        .map((member) => member.pubkey),
    ),
  };
}
