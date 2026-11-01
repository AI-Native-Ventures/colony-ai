import assert from "node:assert/strict";
import test from "node:test";

import { foldWhatsAppActivityEntries } from "./whatsappDiscussionActivity.ts";

function entry(id, createdAt, tags = [], summary = null) {
  return {
    message: {
      id,
      createdAt,
      author: "Basheer",
      time: "09:00",
      body: id,
      depth: 0,
      tags,
    },
    summary,
  };
}

test("Discussion folds WhatsApp activity per day and removes pending batch cards", () => {
  const folded = foldWhatsAppActivityEntries([
    entry("connected", 1793343600, [["wa-notice", "connected"]]),
    entry("pending", 1793343660, [["wa-notice", "batch_pending"]]),
    entry(
      "plane-tree",
      1793343720,
      [
        ["wa", "27821237135"],
        ["wa-name", "Plane Tree Guesthouse"],
      ],
      {
        latestWhatsAppReply: {
          id: "reply",
          body: "Could we talk tomorrow?",
        },
      },
    ),
    entry("human-note", 1793343780),
  ]);

  assert.equal(folded.length, 2);
  assert.match(folded[0].message.whatsappActivity.summary, /2 updates/u);
  assert.match(folded[0].message.whatsappActivity.summary, /Number connected/u);
  assert.match(
    folded[0].message.whatsappActivity.summary,
    /Plane Tree Guesthouse replied/u,
  );
  assert.equal(folded[0].message.whatsappActivity.items[1].waId, "27821237135");
  assert.equal(folded[1].message.id, "human-note");
});
