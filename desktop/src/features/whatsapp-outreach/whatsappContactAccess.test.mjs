import assert from "node:assert/strict";
import test from "node:test";

import { canManageWhatsAppContact } from "./whatsappContactAccess.ts";

test("contact changes are hidden from plain members outside Outreach", () => {
  assert.equal(
    canManageWhatsAppContact({
      role: "member",
      isOutreachMember: false,
      isManagedAgent: false,
      ownerPubkey: null,
    }),
    false,
  );
});

test("owner, admin, Outreach members, and owner-managed agents can change contacts", () => {
  for (const input of [
    {
      role: "owner",
      isOutreachMember: false,
      isManagedAgent: false,
      ownerPubkey: null,
    },
    {
      role: "admin",
      isOutreachMember: false,
      isManagedAgent: false,
      ownerPubkey: null,
    },
    {
      role: "member",
      isOutreachMember: true,
      isManagedAgent: false,
      ownerPubkey: null,
    },
    {
      role: "member",
      isOutreachMember: false,
      isManagedAgent: true,
      ownerPubkey: "owner-pubkey",
    },
  ]) {
    assert.equal(canManageWhatsAppContact(input), true);
  }
});
