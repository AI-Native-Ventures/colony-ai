import assert from "node:assert/strict";
import test from "node:test";

const { buildOutreachBatchPlan, normalizeOutreachPhone } = await import(
  "./outreachBatch.ts"
);

test("phone normalization accepts explicit international and South African local numbers", () => {
  assert.equal(normalizeOutreachPhone("+27 82 555 4410"), "+27825554410");
  assert.equal(normalizeOutreachPhone("082 555 4410"), "+27825554410");
  assert.equal(normalizeOutreachPhone("555"), null);
});

test("batch plan keeps only eligible leads and explains every skipped row", () => {
  const leads = [
    {
      leadId: "a",
      name: "Jacaranda",
      contactName: "Nomsa",
      phone: "082 555 4410",
    },
    { leadId: "b", name: "Koppie", contactName: null, phone: "" },
    {
      leadId: "c",
      name: "Bramble",
      contactName: null,
      phone: "+27 71 555 2286",
    },
    {
      leadId: "d",
      name: "Hillside",
      contactName: null,
      phone: "+27 84 555 1173",
    },
    {
      leadId: "e",
      name: "Duplicate",
      contactName: null,
      phone: "+27 82 555 4410",
    },
  ];
  const contacts = [
    {
      leadId: "c",
      e164: "+27715552286",
      stage: "none",
      optedOut: true,
      paused: false,
    },
  ];
  const result = buildOutreachBatchPlan({
    batchId: "batch-id",
    listName: "Melville guesthouses",
    leads,
    contacts,
    inBatchLeadIds: new Set(["d"]),
    template: {
      name: "welcome_note",
      language: "en",
      slots: 2,
    },
  });
  assert.deepEqual(result.content.rows, [
    {
      to: "+27825554410",
      leadId: "a",
      name: "Nomsa",
      params: ["Nomsa", ""],
    },
  ]);
  assert.deepEqual(result.skipped, {
    noPhone: 1,
    notOnWhatsApp: 0,
    optedOut: 1,
    paused: 0,
    inBatch: 1,
    alreadyContacted: 0,
    invalidPhone: 0,
    duplicate: 1,
  });
  assert.deepEqual(result.notContacted, []);
  assert.equal(result.content.template, "welcome_note");
  assert.equal(result.content.note, "List Melville guesthouses.");
});

test("a saved WhatsApp number takes precedence over the business phone", () => {
  const result = buildOutreachBatchPlan({
    batchId: "override-batch",
    listName: "Melville guesthouses",
    leads: [
      {
        leadId: "a",
        name: "Jacaranda",
        contactName: "Nomsa",
        phone: "+27 82 555 4410",
        whatsappPhone: "+27 82 555 4499",
      },
    ],
    contacts: [],
    inBatchLeadIds: new Set(),
    template: { name: "welcome_note", language: "en", slots: 1 },
  });

  assert.equal(result.content.rows[0]?.to, "+27825554499");
});

test("the business phone stays the default when a linked WhatsApp contact differs", () => {
  const result = buildOutreachBatchPlan({
    batchId: "business-phone-batch",
    listName: "Melville guesthouses",
    leads: [
      {
        leadId: "a",
        name: "Jacaranda",
        contactName: "Nomsa",
        phone: "+27 82 555 4410",
      },
    ],
    contacts: [
      {
        leadId: "a",
        e164: "+27 82 555 9900",
        stage: "none",
        optedOut: false,
        paused: false,
      },
    ],
    inBatchLeadIds: new Set(),
    template: { name: "welcome_note", language: "en", slots: 1 },
  });

  assert.equal(result.content.rows[0]?.to, "+27825554410");
});

test("minimum fit keeps below-threshold, phone-less, and unchecked leads out of the batch", () => {
  const result = buildOutreachBatchPlan({
    batchId: "fit-batch",
    listName: "Fit review",
    minimumFit: 60,
    leads: [
      {
        leadId: "low-fit",
        name: "Low fit",
        contactName: null,
        phone: "+27 82 555 4401",
        fit: { score: 48, parts: [] },
      },
      {
        leadId: "no-whatsapp",
        name: "No WhatsApp",
        contactName: null,
        phone: null,
        fit: { score: 82, parts: [] },
      },
      {
        leadId: "not-checked",
        name: "Not checked",
        contactName: null,
        phone: "+27 82 555 4402",
        fit: null,
      },
      {
        leadId: "ready",
        name: "Ready",
        contactName: "Nandi",
        phone: "+27 82 555 4403",
        fit: { score: 82, parts: [] },
      },
    ],
    contacts: [],
    inBatchLeadIds: new Set(),
    template: { name: "welcome_note", language: "en", slots: 1 },
  });

  assert.deepEqual(
    result.notContacted.map((item) => item.reason.code),
    ["below_minimum_fit", "no_whatsapp_number", "not_checked"],
  );
  assert.deepEqual(
    result.content.rows.map((row) => row.leadId),
    ["ready"],
  );
});
