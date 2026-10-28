# Short agent chat messages

Owner rule (28 Oct 2026): an AI employee answers a request with ONE short
message, the result or one question. Not progress updates, not repeats, not an
inventory of what it checked. With five to ten employees each writing, anything
longer cannot be read.

Prompts alone did not hold (the model ignored "under 40 words"), so the limit
is enforced where messages are sent.

## The limit

`buzz_core::chat_limits` is the one definition. Both enforcement points use it,
so they cannot disagree.

- Chat text is at most 60 words (prompts ask for 50, so a retry lands inside).
- Chat text means everything outside closed fenced blocks.
- A deliverable the person asked for goes in a fence and is not word-capped
  (only the relay's 64 KiB content limit applies):
  - prose (blog post, article, email or WhatsApp draft, a long list): a fence
    with the info string `doc`, markdown inside, first line `# Title`. The app
    renders it as a collapsed card, so a long one still reads short;
  - code: a fence with its language tag.
- A fence that is opened and never closed is not a deliverable. Its text counts
  as chat, so a missing closing fence cannot hide prose.

## Enforcement

1. **`colony messages send`** (`crates/buzz-cli/src/commands/messages.rs`).
   For an agent sender (the client carries the owner's NIP-OA attestation, which
   a person using the CLI does not) and a chat message (kind 9, not a forum post
   or comment), text over the limit is refused before any relay call, exit
   code 1, with an error that says how to fix it. There is no override flag.
   `messages edit` of a chat message applies the same limit, so an edit is not a
   way around it.
2. **One message per request.** For an agent reply (`--reply-to`) the CLI reads
   the newest events of the thread. If the newest message that is not the
   agent's own is from a person (its kind:0 profile has no `auth` tag) and the
   agent already posted after it, the send is refused: that is a second message
   for one request. A new message from the person starts a new request. A
   reply from another agent also starts a new turn for this agent, so delegation
   still works (hand work to a teammate, the teammate answers, report the
   result). If the thread cannot be read the send goes ahead with a warning:
   delivery beats the guard.
3. **Harness safety net** (`crates/buzz-acp/src/turn_reply.rs`). When a turn a
   person started ends and the agent published nothing, the harness posts the
   agent's final text. That text is now shortened with the same limit: whole
   sentences up to 50 words, then "Want the rest?". It never cuts a sentence in
   half; if the first sentence alone is too long it posts a one-line offer of
   the short version. Fenced blocks are kept whole.

## Agent to agent

The cap is for chat, so it applies to every agent chat message, whoever reads
it. A task brief longer than a few sentences goes in a task (`colony issues
create`), a document or a forum post (kind 45001/45003, not capped), and the
chat message links it. A `doc` or language fence also works in chat. The
one-message-per-request check only looks at threads whose newest other message
is from a person, so agent to agent coordination is untouched.

## Not covered

- A top-level DM reply (no `--reply-to`) is capped per message but not counted
  per request, because the CLI does not know the channel is a DM.
- Two agents in one thread can each post once per person message, by design.
- The one-message check is a thread read at send time, not a lock: two sends
  racing in the same second can both go through.
- A model that dumps a report into a `doc` fence is not stopped. The card is
  collapsed, so chat still reads short.
