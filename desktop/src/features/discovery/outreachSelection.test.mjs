import assert from "node:assert/strict";
import test from "node:test";

const {
  filterOutreachRows,
  outreachFilterCounts,
  selectAllMatching,
  toggleOutreachSelection,
} = await import("./outreachSelection.ts");

const rows = [
  {
    id: "a",
    searchableText: "Jacaranda Lane Guesthouse Melville",
    hasPhone: true,
    whatsappStatus: "not-contacted",
    stage: "new",
  },
  {
    id: "b",
    searchableText: "Koppie View Lodge Melville",
    hasPhone: true,
    whatsappStatus: "replied",
    stage: "new",
  },
  {
    id: "c",
    searchableText: "Bramble and Brick Westdene",
    hasPhone: false,
    whatsappStatus: "no-number",
    stage: "qualified",
  },
];

test("outreach filters combine with AND across phone, WhatsApp, stage and search", () => {
  const filters = {
    hasPhone: true,
    whatsappStatuses: new Set(["not-contacted"]),
    stages: new Set(["new"]),
  };
  assert.deepEqual(
    filterOutreachRows(rows, filters, "melville").map((row) => row.id),
    ["a"],
  );
});

test("filter counts stay independent while the result set combines selections", () => {
  const filters = {
    hasPhone: true,
    whatsappStatuses: new Set(["not-contacted"]),
    stages: new Set(["new"]),
  };
  const counts = outreachFilterCounts(rows, filters);
  assert.equal(counts.hasPhone, 2);
  assert.equal(counts.whatsapp["not-contacted"], 1);
  assert.equal(counts.whatsapp.replied, 1);
  assert.equal(counts.stages.new, 2);
});

test("shift selection applies an inclusive range and select all keeps existing ids", () => {
  const result = toggleOutreachSelection({
    selected: new Set(["outside"]),
    visibleIds: ["a", "b", "c", "d"],
    id: "d",
    checked: true,
    shiftKey: true,
    anchorId: "b",
  });
  assert.deepEqual([...result.selected], ["outside", "b", "c", "d"]);
  assert.deepEqual(
    [...selectAllMatching(result.selected, ["e", "f"])],
    ["outside", "b", "c", "d", "e", "f"],
  );
});
