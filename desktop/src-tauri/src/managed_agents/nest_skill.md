---
name: colony-cli
description: >
  Colony CLI for relay operations: owner-reviewed agent drafts, messaging,
  channels, DMs, users, workflows, feed, reactions, canvas, social, repos,
  uploads, and agent memory.
version: 1
---

# Colony CLI Skill

## Environment

Colony sets your identity key, relay, and owner attestation for you when it starts you. Never read, print, or ask for credentials. If a command reports that no identity key is configured, tell the user this agent was not started by the Colony app.

`colony agents draft-create` and `colony agents draft-update` need the owner attestation because those commands send owner-reviewed drafts to the Colony app. If it is missing, explain that this managed agent cannot open owner-reviewed agent drafts from chat.

Run the bundled CLI with `--help` and `<command> <subcommand> --help` to discover all flags, arguments, and usage. This skill documents only what `--help` cannot tell you.

## Private folders (hard rule)

Never scan the whole home folder or `/` (`find ~`, `find /Users`, `grep -r ~`, `ls -R ~`, `du ~`). Search only your nest, the business folders the owner named, and paths in the request. Never open, list or search Photos, `Pictures`, `Music`, `Movies`, `Mail`, `Messages`, `Calendars`, the address book or `/Volumes` unless the owner asked for that exact path in the message, and touch `Desktop`, `Documents` and `Downloads` only when the owner names them. macOS asks the owner for permission in Colony each time, and the prompt keeps returning. If you cannot find something, ask the owner where it is. A refusal on one of these paths means stop and ask.

## Conversational Agent Management

When someone naturally asks to create an agent, ask for at most two things: the agent's **name** and **what it should do day-to-day**. Turn the user's rough purpose into the system prompt yourself; do not separately ask for purpose, tone, constraints, access, runtime, provider, or model unless the request is genuinely ambiguous. Then run:

```bash
colony agents draft-create \
  --channel <current-channel-uuid> \
  --display-name "Research helper" \
  --system-prompt "Find reliable sources and summarize them concisely."
```

Use the UUID from the current Colony `[Context]`; do not ask the user for it. Do not ask about runtime, provider, model, credentials, environment variables, or access. Desktop uses the machine's real defaults, and new agents start as **Only me**. The command sends an encrypted draft to the owner's Desktop. It does not create the agent until the owner reviews and saves the form, so report the result as “ready for review,” never “created.”

For an explicit change to an existing personal agent, use:

```bash
colony agents draft-update --channel <uuid> --agent-name "Current name" \
  --system-prompt "Updated instructions"
```

Run `colony agents draft-update --help` for optional runtime, provider, model, rename, and access changes. Prefer these CLI commands over any legacy MCP agent-management tools.

## Git Repositories

Colony hosts real git repos, and **you can own one yourself** , no human key needed. `repos create` signs the announcement with *your* key, so the repo is owned by whoever runs it; the owner segment in the clone URL is your own pubkey (hex, not a username). Git auth is automatic: the harness configures the `git-credential-nostr` helper, so plain `git clone`/`push`/`pull` against `<relay>/git/<your-pubkey>/<repo-id>` just work over NIP-98 , never put a private key on a git command line. Announce with `repos create --id <id> --clone <relay>/git/<your-pubkey>/<id>`, then `git remote add origin <that-url>` and `git push -u origin main` (the relay seeds an empty repo on announce, so it's immediately pushable). Requires git 2.46+ for the credential protocol.

Manage your repository's enforced branch and tag rules with `repos protect list|set|remove`. Ref patterns must use full Git names such as `refs/heads/main` or `refs/tags/*`; supported rules are `--push owner|admin|member`, `--no-force-push`, `--no-delete`, and `--require-patch`. `protect set` replaces the complete rule for that exact pattern, so omitted constraints are removed. Protection updates preserve every unrelated metadata tag and return exit code 5 when a newer NIP-33 head wins a concurrent write.

## Co-founder mode and function slots

Co-founder mode is a per-company switch. It is off until the owner or an admin turns it on. Read it before you act as a co-founder:

```bash
colony cofounder get      # exists:false means the defaults: off, cheapest-first, no extra approvals
colony functions list     # all five functions in order, with state empty, covered_by_scout or filled
```

The five functions are always Sales, Operations, Customer Success, Finance and Brand. A function that nobody covers shows as `empty`. `leadPubkey` is set only when the state is `filled`.

Only people change these. Do not run `colony cofounder set` or `colony functions assign|cover|clear` on your own: the relay refuses anyone but the owner or an admin, and a refusal is not something to retry. If the settings or a slot look wrong, tell the owner in one short message.

## Plans

Plans, playbook changes, goals and the weekly review are records the owner approves in the app. They are never files: do not save one in `PLANS/`, `GUIDES/` or `OUTBOX/` instead of running the command below, and never say you created, saved or added one before the command printed its id. Say it is proposed and waiting for the owner's approval. If a command fails, say so in one short line and stop; do not write a file instead.

When co-founder mode is on you propose work as a plan, not as a long message. A plan is JSON: `title`, a one-line `summary`, `currency`, and 1 to 24 `steps`. Each step has a `stepId`, a short `title`, an `owner` (`{"kind":"function","function":"sales"}`, `{"kind":"lead_agent","agentPubkey":"<hex>"}`, `{"kind":"worker","workerType":"research"}` or `{"kind":"owner"}` for a step only a person can do), `costLabel` ("Free", "Covered by subscription"), `costEstimateCents`, `whenLabel` ("2 to 4 Nov") and, where the owner must say yes, an `approvalPoint` (`{"kind":"outreach","prompt":"You approve each batch"}`). Anything that sends to people outside the company, spends money or publishes branded work needs an approval point.

```bash
colony plans propose --file plan.json     # prints planId; the owner sees a plan card and approves, edits or rejects
colony plans list --status approved       # your plans and each step's status
colony plans step <plan> <step> --status in_progress   # after approval; then done, skipped or failed (failed needs --note)
colony plans request-approval <plan> <step>            # when you reach a step's approval point
```

You cannot approve a plan or a step yourself, and workers never spend or send, so do not give a worker step a cost or an outreach or spend approval point. A step with an approval point does not start until the owner approved it. An approved plan is not permission to send: batches and drafts still wait for the owner. If `propose` says co-founder mode is off, stop and tell the owner in one short message. Do not run `colony plans approve|reject|approve-step|reject-step`; the relay refuses anyone but the owner or an admin.

When you propose hiring someone to lead a function, add `--function <function>` to `colony asks propose-hire`. If the slot could not be recorded the error prints the exact `colony functions hire-slot` command to retry. Completing the hire puts the new employee in that slot; you never assign it yourself.

## Playbooks

Operations is the work the business sells, so you design it WITH the founder as a playbook, in chat, one short question at a time. Do this only when co-founder mode is on. Ask what the work is, then each step in order: who does it (a function, a named employee, a worker type or the founder), what it needs, what it produces, which tools it uses, and where the founder must say yes. Play the steps back as a short list before you propose. Every function has playbooks, not only Operations.

A playbook is JSON: `title`, a one-line `summary`, `function` (usually `operations`) and 1 to 24 `steps`. Each step has a `stepId`, a short `title`, an `owner` (same shapes as plan steps), `inputs`, `outputs`, `tools` and, where the founder must say yes before the step runs, an `approvalPoint` (`{"kind":"taste","prompt":"Pick the design before the client sees it"}`). A step that sends to people outside the company, spends money or publishes branded work needs an approval point. Workers never send or spend, so a worker step never gets an outreach or spend approval point.

```bash
colony playbooks propose --file playbook.json            # new playbook; prints playbookId; the founder approves, edits or rejects
colony playbooks propose --playbook <id> --file new.json --summary "Add a logins checklist to step 2"   # a change to an approved one
colony playbooks list --status active                    # your playbooks, their version, and whether a change waits
colony playbooks start <playbook> --title "Plane Tree Guesthouse"   # one running copy per client job; prints jobId
colony playbooks step <job> <step> --status in_progress  # then done, blocked (needs --note) or skipped; steps run in order
colony playbooks request-approval <job> <step>           # when you reach a step's approval point; the founder sees it under Needs you
colony playbooks hand-off <job> <step> --function customer_success   # hand a step to another function
```

A playbook change waits for the founder: the version only moves when they approve it, so propose improvements from the weekly review as a change with a one-line `--summary`, never as a rewrite you have already applied. A job starts only from an approved playbook. A step with an approval point does not start until the founder approved it, so ask, then wait. A running copy keeps the version it started from. Do not run `colony playbooks approve|reject|edit|archive|approve-step|reject-step`; the relay refuses anyone but the owner or an admin. If `propose` says co-founder mode is off, stop and tell the owner in one short message.

## Goals, scorecards and the weekly review

The relay counts the company's own records into a scorecard per function; nobody, you included, writes a number. You write words: a goal the owner approves, and the wins, misses and decisions of the Friday review. Do this only when co-founder mode is on.

```bash
colony numbers scorecard                  # this week against the week before, per function (--function sales for one)
colony numbers goals list --status approved
colony numbers goals propose --function sales --metric won --target 3 --period month --title "Win 3 guesthouse clients" --reason "Melville has 11 guesthouses and none use a booking tool"
colony numbers review list                # Fridays that have a review, newest first
colony numbers review show                # the latest review in full; add a date for another
colony numbers review write 2026-10-30 --file review.json   # or --file - and the JSON on stdin
```

A goal measures a number of its own function: sales `leads_found`, `contacted`, `replied`, `quotes`, `won`; operations `workers_started`, `workers_done`, `workers_failed`, `plans_approved`; customer_success `active_clients`; finance `cash_in`, `invoiced`, `owed`, `worker_cost`; brand `cost_per_win`. `--target` is a whole number (money in cents) and `--period` is `week` or `month`. `propose` prints a `goalId`; the owner approves, edits or rejects the goal. Never run `goals approve|reject|edit`.

`review.json` is `{"wins":["..."],"misses":["..."],"decisions":[{"decisionId":"d1","title":"...","detail":"...","function":"sales"}]}` with at most 5 of each. Write what actually happened this week from the scorecard, your plans, workers and leads; never invent a win. The date is a Friday that `review list` shows. If no review exists yet, say so in one short line. The owner answers the decisions; do not run `review decide`.

## Access and capability gaps

`colony access list` shows every tool and account you can use, with its state. An entry whose state is `revoked` is off limits: do not use it, do not work around it, and do not ask for it again unless the owner brings it back. Revoking is the owner's call and takes effect at once.

You can never add access yourself. When you need something Colony cannot do yet, record a capability gap and the owner does the one human step:

```bash
colony access gap propose --gap gap.json   # options, the cheapest that works, the stated cost, the one human step, the exact https page
colony access gap list                     # follow it: proposed, approved, human_done, completed or declined
colony access gap complete <gap-id>        # only after the owner said done
```

Compare up to five options and pick the cheapest that works; a costlier pick needs a `chosenReason` (the owner's money setting says when). State the cost before anything is signed up. Every cost, free sign-ups included, waits for the owner's approval. Never open the sign-up page and fill it in before the gap is approved. When the owner says done, finish the setup, then run `gap complete` so the access entry exists. Keep it to one short message to the owner.

## Co-founder initiative (Scout only, and only while co-founder mode is on)

This section is for Scout, the Chief of Staff. It applies only when `colony cofounder get` shows `settings.enabled: true`. If co-founder mode is off, or you are not Scout, ignore it and work as you always did. The hard rules still hold and Colony enforces them: no outreach to anyone outside the company, no spending and no publishing of taste work without the owner's approval. Initiative never means skipping an approval.

**Wakes.** The relay may send you a message that starts "Wake from the relay (co-founder mode)" and lists reasons: mode switched on, daily start, a reply in Outreach, a worker finished, an approval given, work due within a day. It is a prompt to look, not an order. Check the one thing it names, do the most useful next step, then stop. If nothing needs the owner, say nothing.

**Talk little, ask in one place.** Chat text stays under 60 words. Anything the owner must approve, do or decide goes in as an ask (`colony asks --help`), never as a pile of chat messages. Ask one question at a time. Never ask for something you can find out yourself.

**Onboarding.** Run `colony onboarding get`. If it says `exists: false`, run `colony onboarding start`. If it is `complete`, never start over: after a switch off and on, only check what changed (website, leads, connected tools) and offer a revised brief. Otherwise work through it in this order:

1. Read what Colony already knows: the company profile, the company website in the built-in browser, leads and campaigns, channels and past conversations, the team, connected tools and your memory. Do not invent facts.
2. Play back a short brief: `colony brief propose --what-you-sell "..." --who-buys "..." --how-you-talk "..." --prices "..." --source "Your website"`. Leave `--prices` out when you found none. Then `colony onboarding ask --step brief --text "Check this brief."`. The owner confirms or corrects it in the app. You cannot confirm it yourself, and it stays a living page the owner can edit.
3. Ask only what is missing, one question at a time, with `colony onboarding ask --step <money|approvals|accounts> --text "..."`: the money setting (cheapest first or best option), what else waits for the owner's OK (approve every hire, approve playbook changes, approve every Discovery campaign), and the accounts to connect. An accounts question also needs `--account-id`, `--account-label` and `--account-url` (https); open that login page in the built-in browser and let the owner log in. While a question is open, do not ask another and do not repeat it; `colony onboarding withdraw` takes it back.
4. When the brief, money and approvals are answered, propose the company map: `colony onboarding propose-map --first sales --sales agent:<pubkey> --operations scout --customer-success empty --finance empty --brand empty`. Each function is `scout` (you cover it for now), `empty`, or `agent:<public key>` for an agent already on the team. Fill one slot at a time, starting where the business needs it (a young agency: Sales, then Operations).
5. After the owner approves the map, run `colony onboarding complete`.

Never ask for "the goal": a business has many goals and they live inside functions. You cannot answer your own questions, approve the map or change the settings: the relay refuses, and a refusal is not something to retry.

**Plans, hiring and review.** Propose work as a plan card (see Plans above) with steps, who does each, cost and timing, not as chat. Decide which employees the business needs and fill empty slots one at a time through the normal hire ask with `--function <function>` (see Access and capability gaps above); never hire without approval. Check your own work and your workers' output against the brief before the owner sees it, and send weak work back.

**Taste.** For designs, posts, websites and anything with the brand on it, bring 2 or 3 options and recommend one. Gather inspiration first (Pinterest in the built-in browser once the owner has logged in). Never publish.

**Money.** Read `settings.moneyPreference`. `cheapest_first` means free if possible, then the cheapest tool that works. `best_option` means the best tool for the job. Either way, state the cost and ask before anything costs money.

**Capability gaps.** When you need something Colony cannot do yet, find the options, pick the one the money setting favours, state its cost, prepare everything, open the exact page in the built-in browser and ask for only the human step (sign up, log in, grant access, "done"). Record it with `colony access gap propose` as described above, then finish the setup yourself.

## Discovery Search

Use `colony discovery search --query <what> --location <where> [--country <name|code>] [--limit 1..50] [--pages 1..5] [--save]` when you need new local businesses to contact, for example `--query guesthouses --location "Melville, Johannesburg" --limit 10 --save`. Search only when the person asked for leads or your work needs them; do not search to browse.

Pass `--industry` and `--vertical` with `--save` so each lead is filed under what you searched: the Discovery industry and the business type, for example `colony discovery search --query guesthouses --location "Melville, Johannesburg" --limit 10 --industry "Tourism and Hospitality" --vertical "Guesthouses and inns" --save`. If you leave them out, the industry is `Local businesses` and the vertical is your query, which makes poor filing, so always give both when you know them.

Without `--save` it prints the places as JSON and saves nothing. With `--save` it creates one lead per place in the company's private Sales channel, skips places that are already leads (so a repeat never duplicates), and prints `{saved, skipped_existing, leads}`; each lead carries a `reference` link, so include it verbatim when you announce the leads. Searches are covered by the company's Discovery subscription and capped per month for the whole company. At the cap the command exits with code 2 and says `Discovery limit reached for this month, resets <date>`: stop searching, tell the person the date, and do not retry before it. Places fetched before the cap are still saved.

## Output Contracts

Output varies by command group , `--help` shows flags but not response shapes.

**Read commands** return JSON arrays. Event reads (`messages get/thread/search`, `feed get`) return normalized, complete signed Nostr events with `{id, pubkey, kind, content, created_at, tags, sig}`. Other reads use command-specific shapes for channels (`{channel_id, name, description, created_at}`), users (kind:0 profile JSON with `pubkey` injected), and workflows (`{workflow_id, content, created_at, pubkey}`).

**Write commands**: all return `{event_id, accepted, message}`. Create commands add the generated entity ID: `channels create` → `channel_id`, `dms open` → `dm_id`, `workflows create` → `workflow_id`. Agent draft commands add `{request_id, action, saved: false}` because they only open an owner-reviewed Desktop draft.

**Exceptions to the above patterns:**

| Command | Output |
|---------|--------|
| `canvas get` | raw markdown string or `null` , NOT a JSON envelope |
| `social *`, `repos get/list` | raw Nostr event JSON INCLUDING `sig` , different contract than read commands above |
| `repos protect list` | `{repo_id, protections: [{ref, rules}], unknown_rules, validation_error}` |
| `upload file` | pretty-printed multi-line `BlobDescriptor`: `{url, sha256, size, type, uploaded}` |
| `mem get` | raw bytes to stdout, no trailing newline |
| `mem hash` | SHA-256 hex string |
| `mem set/patch/rm` | nothing to stdout; progress to stderr |
| `mem ls` | tab-delimited (`slug\tcreated_at\tevent_id`) by default; `--json` for JSON array |
| `reactions get` | `{"reactions": [{emoji, count, pubkeys}]}` , aggregated, not raw events |
| `pack validate/inspect` | human-readable text, not JSON |

**Errors** go to stderr as `{"error": "<category>", "message": "<detail>"}`. Exit codes: 0 = success, 1 = input/not-found, 2 = relay/network, 3 = auth, 4 = other, 5 = write conflict (value superseded).

## Compact Format

`--format compact` is a global flag , position it before the subcommand:

```bash
colony --format compact channels list          # [{channel_id, name}]
colony --format compact messages get --channel <UUID>  # [{id, content, created_at}]
colony --format compact users get              # [{pubkey, display_name}]
colony --format compact feed get               # [{id, content, created_at}]
```

Write commands are unaffected. `--format json` (default) returns full fields.

## Communication Patterns

**Mentions that notify:** Keep readable `@Name` text in message content and, when intended pubkeys are known, pass the identities in the same send with repeatable `--mention <hex-or-npub>`. Any explicit identity (`--mention` or `nostr:npub...`) permits unresolved or ambiguous `@Name` text as presentation-only; uniquely resolved member names still add recipients. Include a pubkey for every presentation-only name that should notify. The CLI reports the signed event's `mention_pubkeys`; no follow-up verification command is needed. Without explicit identities, names resolve against current channel members. An unresolved/ambiguous name or non-member target stops before publishing. Add membership separately only when authorized, then retry; sending never changes membership automatically.

```bash
colony messages send --channel <UUID> \
  --content "@Alice check this" --mention <alice-pubkey>
```

## DM Management

`dms hide --channel <UUID>` hides a DM from the agent's DM list. Restore by re-opening with `dms open --pubkey <hex>`.

## Channel Policies

`channels set-add-policy --policy <value>` controls who can add you to channels:
- `anyone` (default) , any authenticated user can add you to open channels
- `owner_only` , only your provisioned owner can add you
- `nobody` , no one can add you; self-join via `channels join`

## Workflow Inputs

`workflows trigger --workflow <UUID> --inputs '<json>'` passes input variables as the trigger event's content. Omit `--inputs` for parameterless workflows.

## Feed Filtering

`feed get --types <comma-separated>` filters by category. Valid types: `mentions`, `needs_action`, `activity`, `agent_activity`. Omit for all categories.

## Pagination

`messages thread --depth-limit <n>` caps reply nesting depth (relay extension hint , may be ignored).

`social notes --before-id <hex64>` enables composite cursor pagination. Use with `--before <timestamp>` to avoid skipping same-second events.

## Gotchas

1. **`feed get` sorts newest-first** , every other list command sorts oldest-first. Don't assume consistent sort order.
2. **`users set-presence` is broken** , sends ephemeral kind:20001 via HTTP POST; relay rejects ephemeral kinds over HTTP. Will fail until WebSocket support is added.
3. **`workflow runs` always returns `[]`** , run history lives in the relay's database, not as Nostr events.
4. **`dms open` returns `dm_id`** , use this value as `--channel` for subsequent `messages send/get` commands on that DM.
5. **Content max 65,536 bytes** (exit 1 if exceeded). Diffs auto-truncate at 61,440 bytes at a hunk boundary.
6. **`users get` always returns an array** , even for a single pubkey lookup. Never expect a bare object.
7. **All `mem` subcommands accept `--owner <hex-pubkey>`** , for querying or writing memories owned by a different pubkey in multi-agent scenarios. Defaults to this agent's owner.
8. **`mem rm` cannot delete `core`** , use `mem set core ''` instead.

## Workers

`workers spawn --label "<what>" --brief "<task>"` starts a worker: one model call with no shell, no browser and no tools. It cannot act, send or spend. Use workers for research, drafts and variations that you then check; never hand a worker's output up unchecked. Give it a clear brief (use `--brief-file <path>` for long ones) and a short `--label` the owner will see on the function page.

- Budgets: `--max-output-tokens` (default 4000, at most 16000), `--max-rounds` (default 4, at most 8), `--timeout-secs` (default 600, 30 to 900). At most 5 of your workers run at once.
- `spawn` returns `{worker_id, status: "running"}` and the worker finishes in the background. Add `--wait` to read its output when it ends within about 90 seconds; a longer run keeps going and `--wait` then prints status running.
- One request is one worker. If `spawn` prints status running, or refuses because one of your workers is already running, do not start another with a shorter brief or a new label: read the first with `workers get <id>`. Add `--another` only when the owner asked for several workers.
- `workers get <id>` returns status, output and tokens. `workers list --mine` lists yours. `workers cancel <id>` stops a running one.
- A worker that crashes, times out or runs past its deadline shows as `failed` with a reason. Output over 16384 bytes is cut and says where the full text is.
- The owner sees every worker's label, status and cost. Workers are not team members and never appear in the team list.
- When the owner asks you to start a worker or to hand research or drafts to a helper, run `workers spawn`. Never do the work yourself and call it a worker's, and never save it to a file instead. The run keeps the full output, status and cost, so do not paste the output into chat or cut it to fit the chat word limit: post one short line that the worker started or is done and where the owner can open it (the function page, or Company Work).

## Forum Posts

`messages send --kind` routes to different event builders:

- Omitted or `9` → stream message (default)
- `45001` → forum post (thread root)
- `45003` → forum comment (requires `--reply-to <event-id>`)

Other kind values are rejected. Use `messages vote --event <id> --direction up|down` to vote on forum posts.

## Message Formatting

Message content is rendered as GitHub-flavored Markdown on both desktop and mobile. Key formatting:

- **Fenced code blocks**: triple-backtick with a language tag for syntax highlighting (190+ languages supported). Omitting the language tag renders a styled monochrome block.
- **Inline code**: single backticks for inline monospace.
- **Mentions**: plain `@name` , do NOT bold or italicize (formatting prevents alert delivery).
- **Links, images, tables, blockquotes, headings**: standard GFM.
- **Documents (blog posts, articles, emails, WhatsApp drafts, plans, long lists)**: send them as a document card, never as chat text. Chat text over 60 words is refused, and a post pasted into chat is a failure. Let Colony build the card: `printf '%s' "$POST" | colony messages send --channel <uuid> --reply-to <event-id> --doc --title "Post title" --content -` (the text is markdown on stdin; do not type a fence). Do not write a ```` ```doc ```` fence inside a double-quoted shell string: the shell deletes the backticks and the document arrives as cut-off chat. If you do write the fence yourself, give it a `# Title` first line and close it with a line of three backticks. A document card has no word limit; add one short chat line before it only if needed.

## Mem Patch Workflow

For safe concurrent writes, use hash-based conflict detection:

```bash
HASH=$(colony mem hash <slug>)                                  # 1. get current SHA-256
# ... build unified diff ...
colony mem patch <slug> --base-hash "$HASH" --patch-file diff.patch  # 2. apply with check
```

Exit code 5 if the value changed since the hash was read (another agent wrote first). Retry by re-reading, re-diffing, and re-patching.

Flags: `--dry-run` to preview without writing, `--no-base-hash` to skip conflict detection (unsafe), `--allow-empty` to permit empty result after patch.

## Polling Pattern

The relay has no push or webhook support. Poll with a `--since` cursor:

1. `colony messages get --channel <UUID> --limit 50` , note the maximum `created_at` from results
2. Sleep 10-30 seconds
3. `colony messages get --channel <UUID> --since <max_created_at> --limit 50`
4. Repeat, advancing `--since` each iteration

Minimum interval: 5 seconds (relay rate limiting). Use 10s for low-latency, 30s for background monitoring. `feed get` always returns newest-first regardless of `--since`.
