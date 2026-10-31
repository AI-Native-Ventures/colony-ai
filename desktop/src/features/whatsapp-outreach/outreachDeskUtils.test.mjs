import assert from "node:assert/strict";
import test from "node:test";

import { resolveOutreachContactIdentity } from "./outreachDeskUtils.ts";

test("unlinked contacts never use business fields without an active lead", () => {
  const identity = resolveOutreachContactIdentity(
    {
      e164: "+27 68 373 5905",
      displayName: "Owner label from a stale view",
      profileName: "Thandeka",
      businessName: "Stale business name",
      website: "https://stale-business.example",
      label: null,
      leadId: null,
    },
    {
      prospects: [],
    },
  );

  assert.equal(identity.displayName, "+27 68 373 5905");
  assert.equal(identity.businessName, null);
  assert.equal(identity.website, null);
  assert.equal(identity.personName, "Thandeka");
  assert.equal(identity.isLinked, false);
});

test("linked contacts use the active lead's business identity", () => {
  const identity = resolveOutreachContactIdentity(
    {
      e164: "+27 82 123 7135",
      displayName: "Thandeka",
      profileName: "Thandeka",
      businessName: "Plane Tree Guesthouse",
      website: "https://form-field.example",
      label: null,
      leadId: "lead-id",
    },
    {
      prospects: [
        {
          record: {
            prospectId: "lead-id",
            prospect: {
              party: {
                partyId: "party-id",
                displayName: "Plane Tree Guesthouse",
              },
              contactName: "Thandeka",
              location: "Parkhurst, Johannesburg",
              website: "https://form-field.example",
            },
          },
        },
      ],
    },
  );

  assert.equal(identity.displayName, "Plane Tree Guesthouse");
  assert.equal(identity.businessName, "Plane Tree Guesthouse");
  assert.equal(identity.website, "https://form-field.example");
  assert.equal(identity.personName, "Thandeka");
  assert.equal(identity.partyId, "party-id");
  assert.equal(identity.isLinked, true);
});
