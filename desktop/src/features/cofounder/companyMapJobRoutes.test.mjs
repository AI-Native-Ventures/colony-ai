import assert from "node:assert/strict";
import test from "node:test";

import { FUNCTION_DETAILS, FUNCTION_ORDER } from "./functions.ts";
import {
  COMPANY_MAP_FALLBACK_JOBS,
  COMPANY_MAP_PROPOSAL_JOBS,
  companyMapJobKey,
  getCompanyMapJobRoute,
  hasRouteForEveryCompanyMapJob,
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
    kind: "app",
    to: "/leads",
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

test("unbuilt proposal jobs fall back to their owning function page", () => {
  assert.deepEqual(COMPANY_MAP_PROPOSAL_JOBS, [
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
  }
});
