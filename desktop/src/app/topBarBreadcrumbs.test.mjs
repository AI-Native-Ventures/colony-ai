import assert from "node:assert/strict";
import test from "node:test";

import { mapShellTrailForPath } from "./topBarBreadcrumbs.ts";

test("map shell omits the trail on both company-map home routes", () => {
  assert.equal(mapShellTrailForPath("/"), null);
  assert.equal(mapShellTrailForPath("/company/map"), null);
});

test("map shell maps screens to the company part and job from funcs.js", () => {
  assert.deepEqual(mapShellTrailForPath("/discovery"), {
    part: "Sales",
    job: "Lead finding",
  });
  assert.deepEqual(mapShellTrailForPath("/leads"), {
    part: "Sales",
    job: "Outreach",
  });
  assert.deepEqual(mapShellTrailForPath("/pipeline"), {
    part: "Sales",
    job: "Closing",
  });
  assert.deepEqual(mapShellTrailForPath("/money/invoices"), {
    part: "Finance",
    job: "Invoices",
  });
  assert.deepEqual(mapShellTrailForPath("/company/access"), {
    part: "Finance",
    job: "Costs",
  });
  assert.deepEqual(mapShellTrailForPath("/work/brief-1"), {
    part: "Operations",
    job: "Revisions",
  });
  assert.deepEqual(mapShellTrailForPath("/company/function/operations"), {
    part: "Operations",
    job: "Delivery",
  });
  assert.deepEqual(mapShellTrailForPath("/company/function/sales"), {
    part: "Sales",
    job: "All of Sales",
  });
  assert.deepEqual(mapShellTrailForPath("/campaign"), {
    part: "Sales",
    job: "Lead finding",
  });
  assert.deepEqual(mapShellTrailForPath("/discovery/campaigns"), {
    part: "Sales",
    job: "Lead finding",
  });
  assert.deepEqual(mapShellTrailForPath("/lists/list-1"), {
    part: "Sales",
    job: "Outreach",
  });
  assert.deepEqual(mapShellTrailForPath("/money/revenue/invoice-1"), {
    part: "Finance",
    job: "Chasing payments",
  });
  assert.deepEqual(mapShellTrailForPath("/money/invoice/invoice-1"), {
    part: "Finance",
    job: "Invoices",
  });
  assert.deepEqual(mapShellTrailForPath("/clients"), {
    part: "Customer Success",
    job: "Client chats",
  });
  assert.deepEqual(mapShellTrailForPath("/clients/client-1"), {
    part: "Customer Success",
    job: "Client chats",
  });
  assert.deepEqual(mapShellTrailForPath("/clients/record/client-1"), {
    part: "Finance",
    job: "Deposits",
  });
  assert.deepEqual(mapShellTrailForPath("/money"), {
    part: "Finance",
    job: "Chasing payments",
  });
  assert.deepEqual(mapShellTrailForPath("/messages/new"), {
    screen: "New message",
  });
  assert.deepEqual(
    mapShellTrailForPath("/channels/outreach-id", { channelName: "Outreach" }),
    { part: "Sales", job: "Outreach" },
  );
  assert.deepEqual(
    mapShellTrailForPath("/channels/marketing-id", {
      channelName: "Marketing",
    }),
    { part: "Brand", job: "Marketing" },
  );
});

test("map shell gives independent routes their own screen label", () => {
  assert.deepEqual(mapShellTrailForPath("/today/needs-you"), {
    screen: "Needs you",
  });
  assert.deepEqual(mapShellTrailForPath("/today"), { screen: "Today" });
  assert.deepEqual(mapShellTrailForPath("/settings"), {
    screen: "Settings",
  });
  assert.deepEqual(mapShellTrailForPath("/activity"), {
    screen: "Activity",
  });
  assert.deepEqual(mapShellTrailForPath("/channels/team-room"), {
    screen: "Chat",
  });
  assert.deepEqual(
    mapShellTrailForPath("/channels/team-room", { channelName: "Watercooler" }),
    { screen: "Watercooler" },
  );
});
