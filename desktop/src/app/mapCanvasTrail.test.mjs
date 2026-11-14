import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_MAP_CANVAS_TRAIL_ENTRIES,
  createMapCanvasTrail,
  mapCanvasTrailForHref,
  planMapCanvasTrailNavigation,
  truncateMapCanvasTrail,
} from "./mapCanvasTrail.ts";

const root = { functionId: "sales", jobName: "Closing" };
const communityId = "fullmap-workspace-one";

test("appends a deep route with the captured departing screen", () => {
  const trail = createMapCanvasTrail(root, "/discovery", 4, communityId);
  const result = planMapCanvasTrailNavigation({
    historyIndex: 4,
    href: "/discovery/campaigns",
    scroll: [{ index: 3, left: 0, top: 240 }],
    snapshot: { height: 699, html: "<div>pipeline</div>", width: 1204 },
    trail,
  });

  assert.equal(result.kind, "append");
  assert.deepEqual(result.trail.entries, [
    {
      historyIndex: 4,
      href: "/discovery",
      scroll: [{ index: 3, left: 0, top: 240 }],
      snapshot: { height: 699, html: "<div>pipeline</div>", width: 1204 },
    },
    {
      historyIndex: 5,
      href: "/discovery/campaigns",
      scroll: [],
      snapshot: null,
    },
  ]);
});

test("swaps same-route tabs without growing the trail", () => {
  const trail = createMapCanvasTrail(root, "/leads?tab=queue", 2, communityId);
  const result = planMapCanvasTrailNavigation({
    historyIndex: 2,
    href: "/leads?tab=sent",
    scroll: [],
    snapshot: null,
    trail,
  });

  assert.equal(result.kind, "replace");
  assert.equal(result.trail.entries.length, 1);
  assert.equal(result.trail.entries[0]?.href, "/leads?tab=sent");
});

test("swaps a cross-route desk control without retaining a visible trail", () => {
  const trail = createMapCanvasTrail(
    root,
    "/leads?mapJob=sales%3AOutreach",
    2,
    communityId,
  );
  const result = planMapCanvasTrailNavigation({
    historyIndex: 2,
    href: "/pipeline",
    samePathNavigation: "swap",
    scroll: [],
    snapshot: null,
    trail,
  });

  assert.equal(result.kind, "swap");
  assert.deepEqual(result.trail.entries, [
    {
      historyIndex: 3,
      href: "/pipeline",
      scroll: [],
      snapshot: null,
    },
  ]);
});

test("returns to an existing trail screen instead of copying it", () => {
  const first = createMapCanvasTrail(root, "/discovery", 7, communityId);
  const second = planMapCanvasTrailNavigation({
    historyIndex: 7,
    href: "/discovery/campaigns",
    scroll: [],
    snapshot: null,
    trail: first,
  }).trail;
  const result = planMapCanvasTrailNavigation({
    historyIndex: 8,
    href: "/discovery",
    scroll: [],
    snapshot: null,
    trail: second,
  });

  assert.equal(result.kind, "return");
  assert.equal(result.targetIndex, 0);
  assert.deepEqual(truncateMapCanvasTrail(second, result.targetIndex).entries, [
    first.entries[0],
  ]);
});

test("returns through a map-job launch route with its screen identity", () => {
  const trail = createMapCanvasTrail(
    root,
    "/money?mapJob=finance%3AQuotes",
    4,
    communityId,
  );
  const result = planMapCanvasTrailNavigation({
    historyIndex: 5,
    href: "/money",
    scroll: [],
    snapshot: null,
    trail: {
      ...trail,
      entries: [
        trail.entries[0],
        {
          historyIndex: 5,
          href: "/money/invoices",
          scroll: [],
          snapshot: null,
        },
      ],
    },
  });

  assert.equal(result.kind, "return");
  assert.equal(result.targetIndex, 0);
});

test("rejects mismatched or unbounded persisted trails", () => {
  const trail = createMapCanvasTrail(root, "/pipeline", 1, communityId);
  assert.equal(
    mapCanvasTrailForHref({ mapCanvasTrail: trail }, "/leads", communityId),
    null,
  );
  assert.equal(
    mapCanvasTrailForHref(
      {
        mapCanvasTrail: {
          ...trail,
          entries: Array.from(
            { length: MAX_MAP_CANVAS_TRAIL_ENTRIES + 1 },
            () => trail.entries[0],
          ),
        },
      },
      "/pipeline",
      communityId,
    ),
    null,
  );
});

test("rejects a persisted trail owned by another community", () => {
  const trail = createMapCanvasTrail(root, "/pipeline", 1, communityId);
  assert.equal(
    mapCanvasTrailForHref(
      { mapCanvasTrail: trail },
      "/pipeline",
      "fullmap-workspace-two",
    ),
    null,
  );
});
