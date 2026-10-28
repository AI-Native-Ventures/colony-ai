import assert from "node:assert/strict";
import test from "node:test";

import {
  DELIVERABLE_MESSAGES,
  OWNER_MESSAGES,
  TARGET,
  analyzeReply,
  buildPrompt,
  chatTextOf,
  median,
  replyFromChatCompletion,
  replyFromEvents,
  summarize,
} from "./eval-reply-length.mjs";

test("analyzeReply counts words and spots report formatting", () => {
  assert.deepEqual(analyzeReply("Yes, I'm here."), {
    words: 3,
    fenced: false,
    docFence: false,
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

test("words inside a fenced block are not chat words", () => {
  const body = Array(300).fill("word").join(" ");
  const post = `Here's the blog post.\n\`\`\`doc\n# Our launch\n${body}\n\`\`\``;
  const analyzed = analyzeReply(post);
  assert.equal(analyzed.words, 4);
  assert.equal(analyzed.fenced, true);
  assert.equal(analyzed.docFence, true);
  assert.equal(chatTextOf(post).trim(), "Here's the blog post.");

  const code = `Here is the script.\n\`\`\`python\n${body}\n\`\`\``;
  assert.equal(analyzeReply(code).words, 4);
  assert.equal(analyzeReply(code).docFence, false);

  // A fence that is never closed hides nothing, as in the CLI.
  const open = `Here it is.\n\`\`\`doc\n# T\n${body}`;
  assert.equal(analyzeReply(open).fenced, false);
  assert.ok(analyzeReply(open).words > 300);

  // Bullets inside a fence are the deliverable's formatting, not the chat's.
  assert.equal(
    analyzeReply("Done.\n```doc\n- one\n- two\n```").formatted,
    false,
  );
});

test("summarize holds every reply to the chat limit and checks deliverables for a fence", () => {
  const [blog] = [...DELIVERABLE_MESSAGES];
  const summary = summarize([
    { message: "thanks", words: 2, formatted: false, silent: false },
    {
      message: blog,
      words: 4,
      docFence: true,
      formatted: false,
      silent: false,
    },
    {
      message: "write a short Instagram post about our launch",
      words: 130,
      docFence: false,
      formatted: false,
      silent: false,
    },
    { message: "help me find customers", words: 125, formatted: true },
  ]);
  assert.equal(TARGET.maxWords, 60);
  assert.equal(summary.maxWords, 130);
  assert.equal(summary.overLimit, 2, "the Instagram post is no longer excused");
  assert.equal(summary.formatted, 1);
  assert.equal(summary.deliverables, 2);
  assert.equal(summary.deliverablesInDocFence, 1);
});

test("the eval asks for a lead search, a blog post and a draft", () => {
  for (const message of DELIVERABLE_MESSAGES) {
    assert.ok(OWNER_MESSAGES.includes(message), message);
  }
  assert.ok(OWNER_MESSAGES.some((message) => message.includes("guest houses")));
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

test("replyFromChatCompletion reads the first choice and tolerates silence", () => {
  assert.equal(
    replyFromChatCompletion({
      choices: [{ message: { role: "assistant", content: "  Hi there.\n" } }],
    }),
    "Hi there.",
  );
  assert.equal(replyFromChatCompletion({ choices: [] }), "");
  assert.equal(replyFromChatCompletion({ choices: [{ message: {} }] }), "");
  assert.equal(replyFromChatCompletion(null), "");
});
