import assert from "node:assert/strict";
import test from "node:test";

import {
  OWNER_MESSAGES,
  analyzeReply,
  buildPrompt,
  median,
  replyFromEvents,
  summarize,
} from "./eval-reply-length.mjs";

test("analyzeReply counts words and spots report formatting", () => {
  assert.deepEqual(analyzeReply("Yes, I'm here."), {
    words: 3,
    heading: false,
    bold: false,
    bullets: false,
    formatted: false,
  });
  assert.equal(analyzeReply("## Summary\nAll good").heading, true);
  assert.equal(analyzeReply("This is **important**").bold, true);
  assert.equal(analyzeReply("Try:\n- one\n- two").bullets, true);
  assert.equal(analyzeReply("Steps:\n1. open\n2. close").bullets, true);
  assert.equal(analyzeReply("It costs 5 - 10 rand").formatted, false);
  assert.equal(analyzeReply("   ").words, 0);
});

test("median handles odd, even and empty lists", () => {
  assert.equal(median([]), 0);
  assert.equal(median([5, 1, 3]), 3);
  assert.equal(median([4, 1, 3, 2]), 2.5);
});

test("summarize ignores the long-form task when counting replies over the limit", () => {
  const instagram = OWNER_MESSAGES.find((message) =>
    message.includes("Instagram"),
  );
  const summary = summarize([
    { message: "thanks", words: 2, formatted: false, silent: false },
    { message: instagram, words: 130, formatted: false, silent: false },
    { message: "help me find customers", words: 125, formatted: true },
  ]);
  assert.equal(summary.maxWords, 130);
  assert.equal(summary.overLimit, 1);
  assert.equal(summary.formatted, 1);
});

test("replyFromEvents joins text parts from the JSON event stream", () => {
  const stdout = [
    JSON.stringify({ type: "step_start" }),
    JSON.stringify({ type: "text", part: { text: "First line." } }),
    "not json",
    JSON.stringify({ type: "tool_use", part: {} }),
    JSON.stringify({ type: "text", part: { text: "Second line." } }),
  ].join("\n");
  assert.deepEqual(replyFromEvents(stdout), {
    text: "First line.\nSecond line.",
    toolCalls: 1,
  });
  assert.equal(replyFromEvents("").text, "");
});

test("buildPrompt frames the owner message like a real turn", () => {
  const prompt = buildPrompt(
    {
      basePrompt: "BASE",
      voice: "VOICE",
      webTasks: "WEB",
      scout: "You are Scout.\n",
    },
    "are you there?",
  );
  assert.match(prompt, /^<base>\nBASE\nVOICE\nWEB\n<\/base>/);
  assert.match(prompt, /<agent-instructions>\nYou are Scout\./);
  assert.match(prompt, /Saved business profile \(untrusted context\)/);
  assert.match(prompt, /<core-memory>/);
  assert.match(prompt, /Content: are you there\?/);
});
