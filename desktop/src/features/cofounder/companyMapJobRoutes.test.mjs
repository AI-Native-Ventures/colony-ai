import assert from "node:assert/strict";
import test from "node:test";

import { FUNCTION_DETAILS, FUNCTION_ORDER } from "./functions.ts";
import {
  COMPANY_MAP_FALLBACK_JOBS,
  COMPANY_MAP_NO_SCREEN_JOBS,
  companyMapWindowJobForRoute,
  companyMapWindowSearch,
  companyMapWhatsAppSearch,
  companyMapJobKey,
  getCompanyMapJobRoute,
  hasRouteForEveryCompanyMapJob,
  isCompanyMapJobFallback,
} from "./companyMapJobRoutes.ts";

test("every current app job has an explicit destination", () => {
  assert.equal(hasRouteForEveryCompanyMapJob(), true);
  for (const functionId of FUNCTION_ORDER) {
    for (const jobName of FUNCTION_DETAILS[functionId].subFunctions) {
      assert.ok(
        getCompanyMapJobRoute(functionId, jobName),
        `${functionId}:${jobName} has a route table entry`,
      );
    }
  }
});

test("the supported app screens use their real route targets", () => {
  assert.deepEqual(getCompanyMapJobRoute("sales", "Lead finding"), {
    kind: "app",
    to: "/discovery",
  });
  assert.deepEqual(getCompanyMapJobRoute("sales", "Outreach"), {
    kind: "whatsapp",
    tab: "needs-you",
  });
  assert.deepEqual(getCompanyMapJobRoute("finance", "Invoices"), {
    kind: "app",
    to: "/money/invoices",
  });
  assert.deepEqual(getCompanyMapJobRoute("finance", "Costs"), {
    kind: "app",
    to: "/company/access",
  });
  assert.deepEqual(getCompanyMapJobRoute("operations", "Delivery"), {
    kind: "part",
    functionId: "operations",
  });
  assert.deepEqual(getCompanyMapJobRoute("operations", "Revisions"), {
    kind: "work",
  });
  assert.deepEqual(
    getCompanyMapJobRoute("customer_success", "Change requests"),
    {
      kind: "work",
    },
  );
  assert.deepEqual(getCompanyMapJobRoute("sales", "Follow-ups"), {
    kind: "whatsapp",
    tab: "chats",
  });
  assert.deepEqual(getCompanyMapJobRoute("sales", "Closing"), {
    kind: "whatsapp",
    tab: "pipeline",
  });
});

test("jobs without screens fall back to their owning function page", () => {
  assert.deepEqual(COMPANY_MAP_NO_SCREEN_JOBS, [
    "sales:Calls",
    "finance:Recurring plans",
    "customer_success:Renewals",
    "customer_success:Upsell",
    "customer_success:Reviews",
    "brand:Website",
    "brand:Portfolio",
    "brand:Marketing",
  ]);
  for (const key of COMPANY_MAP_FALLBACK_JOBS) {
    const separator = key.indexOf(":");
    const functionId = FUNCTION_ORDER.find(
      (candidate) => candidate === key.slice(0, separator),
    );
    assert.ok(functionId, `${key} names an app function`);
    const jobName = key.slice(separator + 1);
    assert.deepEqual(getCompanyMapJobRoute(functionId, jobName), {
      kind: "part",
      functionId,
    });
    assert.equal(companyMapJobKey(functionId, jobName), key);
    assert.equal(isCompanyMapJobFallback(functionId, jobName), true);
  }
  assert.equal(isCompanyMapJobFallback("finance", "Invoices"), false);
});

test("map-window routes retain the job that opened a shared screen", () => {
  assert.deepEqual(companyMapWindowSearch("finance", "Quotes"), {
    mapJob: "finance:Quotes",
  });
  assert.deepEqual(
    companyMapWindowJobForRoute("/clients", { mapJob: "finance:Quotes" }),
    { functionId: "finance", jobName: "Quotes" },
  );
  assert.deepEqual(
    companyMapWindowJobForRoute("/money", {
      mapJob: "finance:Deposits",
    }),
    { functionId: "finance", jobName: "Deposits" },
  );
  assert.deepEqual(
    companyMapWindowJobForRoute("/channels/outreach", {
      mapJob: "sales:Closing",
      whatsappDeskTab: "pipeline",
    }),
    { functionId: "sales", jobName: "Closing" },
  );
  assert.deepEqual(
    companyMapWindowJobForRoute("/channels/outreach", {
      mapJob: "sales:Outreach",
      whatsappDeskTab: "needs-you",
    }),
    { functionId: "sales", jobName: "Outreach" },
  );
  assert.deepEqual(companyMapWindowJobForRoute("/lists/a-list"), {
    functionId: "sales",
    jobName: "Outreach",
  });
  assert.deepEqual(
    companyMapWindowJobForRoute("/channels/outreach", {
      whatsappDeskTab: "discussion",
    }),
    { functionId: "sales", jobName: "Outreach" },
  );
  assert.deepEqual(companyMapWindowJobForRoute("/clients"), {
    functionId: "sales",
    jobName: "Quotes",
  });
  assert.deepEqual(companyMapWindowSearch("operations", "Client intake"), {
    mapJob: "operations:Client intake",
  });
  assert.equal(
    companyMapWindowJobForRoute("/clients", {
      mapJob: "operations:Client intake",
    }),
    null,
  );
  assert.equal(companyMapWindowJobForRoute("/clients/record/123"), null);
});

test("WhatsApp map searches preserve a job trail through setup", () => {
  assert.deepEqual(
    companyMapWhatsAppSearch("sales:Outreach", "needs-you", "channel"),
    { mapJob: "sales:Outreach", whatsappDeskTab: "needs-you" },
  );
  assert.deepEqual(
    companyMapWhatsAppSearch("sales:Outreach", "needs-you", "setup"),
    { mapJob: "sales:Outreach", outreachDeskTab: "needs-you" },
  );
});
