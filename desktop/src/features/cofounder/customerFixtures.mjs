import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
} from "nostr-tools/pure";

import { KIND_CUSTOMER_HEAD } from "@/shared/constants/kinds";
import {
  PLANE_TREE_PARTY_ID,
  cedarCafeLeadRecord,
  planeTreeCustomerRecord,
} from "../../testing/cofounderCustomerFixtures.ts";
import { customerDTag } from "./customerRecords.ts";

export { PLANE_TREE_PARTY_ID };
export const RELAY_SECRET = generateSecretKey();
export const RELAY_PUBKEY = getPublicKey(RELAY_SECRET);
export const SCOUT = "a".repeat(64);
export const AYA = "b".repeat(64);
export const OWNER = "c".repeat(64);
/** 3 Nov 2026, 09:33 UTC: when the Plane Tree record was last computed. */
export const COMPUTED_AT = 1_793_000_000 + 8 * 86_400 + 2 * 3_600;

const PEOPLE = { scoutPubkey: SCOUT, ayaPubkey: AYA, ownerPubkey: OWNER };

/** The Plane Tree Guesthouse head content, as the relay writes it. */
export function planeTreeContent(overrides = {}) {
  return { ...planeTreeCustomerRecord(PEOPLE), ...overrides };
}

export function cedarCafeContent(overrides = {}) {
  return { ...cedarCafeLeadRecord(PEOPLE), ...overrides };
}

export function signCustomer(content = planeTreeContent(), overrides = {}) {
  const { secret = RELAY_SECRET, ...rest } = overrides;
  return finalizeEvent(
    {
      kind: KIND_CUSTOMER_HEAD,
      content: JSON.stringify(content),
      tags: [["d", customerDTag(content.partyId ?? PLANE_TREE_PARTY_ID)]],
      created_at: content.updatedAt ?? COMPUTED_AT,
      ...rest,
    },
    secret,
  );
}
