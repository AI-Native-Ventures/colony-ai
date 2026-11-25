# Cloud agents: run any agent on This Mac or in the Cloud

Date: 25 November 2026. Status: approved by the owner on 25 Nov 2026 (the builder check raised no question only he could answer; his "happy" covered the key upload, the isolated network and the go-live prerequisites). Facts below were read from `origin/develop` at `1bab91a77`. Section 8 lists the calls made after the builder check.

## 1. Intent

Today every Colony agent runs as a process on the owner's computer. When the computer sleeps, the agent goes silent. The owner wants each agent to have a second home, the cloud, so work continues with no Mac at all. This is the first step towards a Colony mobile app: a phone cannot run agents, so the team must live somewhere that is always on.

The model is Jemma's: Jemma runs a job on the owner's laptop (Claude Code on his plan) when the laptop is on, and in its own cloud runner on open-weights models otherwise. Colony differs in two ways the owner chose: the owner decides where each agent works (no automatic switching), and a cloud agent gets a full computer, not a tool-less cloud brain.

## 2. Owner decisions (25 Nov 2026, question tool)

1. **Who decides.** Per agent. The owner can flip an agent between "This Mac" and "Cloud" at any time, from the chat itself and from the agent's profile/settings.
2. **Machine cost.** Free beta with a cap. Colony pays for the cloud machines. The monthly hiring fee decided on 22 Oct ("Always available" vs "Ready within 30 seconds", paid upfront) comes later and must fit on top of this design without changing the switch.
3. **AI cost.** Users pay for their own AI usage. The owner asked for the best setup; the proposal he was shown is section 5.4 (Colony credits by default, own key optional, $1 starter credit).
4. **What a cloud agent is.** A full computer per agent, with the same kinds of abilities as a Mac agent (shell, files, web), not a Workers-style brain.
5. **Host.** Fly Machines, chosen after a price check on 25 Nov (1 GB agent: Fly $6.70/month 24/7, about $2.90 at 10 h a day, about $0.30 asleep with files kept; Cloudflare Containers about $9.90, $4.10, and $0 asleep but files wiped). The host sits behind one host layer so Cloudflare can be added later.

Earlier decisions that still hold: one machine per agent (22 Oct); agent private keys and users' AI keys may be stored in the cloud, encrypted per business (22 Oct); US or EU region is fine (22 Oct); users bring their own AI and Colony funds no tokens (5 Oct, now via credits they buy); 20% margin on credits and OpenRouter's written OK for in-app credits (9 Oct).

## 3. Goals, non-goals, anti-goals

**Goals (v1)**
- Every managed agent shows where it works and can be flipped in two places: the conversation header and the agent profile.
- A cloud agent answers mentions and DMs with the owner's Mac off, within about 30 seconds of a message when it was asleep.
- Flipping keeps the agent's identity, chat history, memory, canvas and relay files. Flipping back restores the agent's Mac setup untouched.
- Cloud AI is paid from the owner's Colony credit balance (or the owner's own key). Running out of credit is visible and recoverable from the chat.
- Colony's machine spend is capped and can be switched off.

**Non-goals (v1)**
- Mobile app UI. The flip is a relay event, so a phone can flip later with no relay change. (Builder's call to include the mobile switch only if it is trivial; it is not required for v1.)
- Claude Code, Codex or OpenCode inside the cloud machine. Plan sign-ins cannot move to a hosted machine (Anthropic's rules; OpenAI requires approval for hosted apps). The cloud machine runs Colony Agent (`buzz-agent`).
- Paid hosting, "Always available" machines, monthly fees.
- Automatic switching between Mac and cloud.
- Moving files that exist only in folders on the owner's Mac.
- A second cloud host (Cloudflare). Only the seam for it.

**Anti-goals (failure even if it "works")**
- Two copies of one agent answering the same message (Mac and cloud both live).
- A message that is silently lost during a flip, a wake, or a sleep.
- An agent machine that can reach Colony's database or relay internals over a private network.
- Any owner key, OpenRouter master key or payment secret reaching an agent machine.
- An unbounded Fly bill: machines that never sleep, wake loops, or orphaned machines after an agent is deleted.
- Plan logins (Claude, ChatGPT) copied into the cloud.

## 4. How it works today (facts)

- **Launch.** The desktop starts `buzz-acp` (`desktop/src-tauri/src/managed_agents/runtime.rs:470`), which runs the chosen runtime (Claude Code, Codex, Colony Agent `buzz-agent`, OpenCode, goose; catalog `managed_agents/discovery/catalog.rs:12-200`). Env carries `BUZZ_PRIVATE_KEY`, `BUZZ_RELAY_URL`, `BUZZ_AUTH_TAG`, model and provider vars, and a wake-ledger path.
- **Keys and records.** The agent nsec lives in the OS keyring as `agent:<pubkey>` (or a 0600 file on unsigned builds) (`managed_agents/storage.rs:17-21,523-527`). The per-agent record is `ManagedAgentRecord` in `<app_data>/agents/managed-agents.json` (`managed_agents/types.rs:322-580`). There is no `runOn` field; `backend: BackendKind {Local | Provider}` is the closest and is set only at create.
- **Receiving work.** `buzz-acp` dials the relay outbound, subscribes per channel to mentions (`crates/buzz-acp/src/relay.rs:760,3344-3407`), and keeps a wake ledger that replays up to 7 days of unhandled mentions after a restart (`crates/buzz-acp/src/wake_ledger.rs`). "Wake after launch" and the mention reconciler are desktop-only (`desktop/src/features/agents/mentionReconciler.ts`, `useDetachedAgentStart.ts`).
- **Liveness.** The relay knows only presence (Redis, 180 s TTL, `crates/buzz-pubsub/src/presence.rs`). It has no registry of running agents and starts no processes. The only relay-side wake is Scout's co-founder nudge (`crates/buzz-relay/src/cofounder_wake.rs`).
- **Remote agents already exist in a narrow form.** "Where to run" (`desktop/src/features/agents/ui/WhereToRunSection.tsx`) hands the agent to a `buzz-backend-<id>` binary over a stdin/stdout JSON protocol with only `info` and `deploy` ops (`managed_agents/backend.rs`). The reference provider is Kubernetes (`crates/buzz-backend-kubernetes`), which runs the Sprig image (`Dockerfile.sprig`: `buzz-acp`, `buzz-agent`, `buzz-dev-mcp`, `rg`, `git` signing helpers), requires presence, and sets `BUZZ_ACP_EXIT_AFTER_INACTIVITY`. It is desktop-owned (the Mac must deploy), has no stop or status op, and is hidden unless a provider binary is installed.
- **Credits gateway.** Live on prod (`COLONY_CREDITS_GATEWAY` and `OPENROUTER_MASTER_KEY` are Fly secrets on `colony-relay`). Agents call `POST /api/credits-gateway/managed-inference` with a per-request NIP-98 signature by the agent key plus a session id. A session is opened by the owner (owner NIP-98), lasts 2 hours, and is injected by the desktop only at spawn (`desktop/src-tauri/src/managed_agents/credits_gateway.rs:106-240`). Payer = the verified account whose owner pubkey owns the agent; settlement = cost + 20%; refusals map to `OutOfCredits`, `DailyLimit`, `Unauthorized`, and so on (`crates/buzz-agent/src/credits_gateway.rs:29-62`). Prod currently allows the free model chain; any paid default (DeepSeek V4.1 Flash) must be added to `COLONY_CREDITS_ALLOWED_MODELS` after a model-terms review (`docs/credits-gateway-operations.md`).
- **Payments.** PayFast secrets are set on `colony-relay`; Stripe code is merged with no secrets. Not verified: whether PayFast is in live mode and whether a real top-up has completed on prod.
- **Hosting.** Relay apps `colony-relay` (prod) and `colony-relay-canary` on Fly, region `iad`. No code calls the Fly Machines API today. The relay image does not contain `buzz-acp` or `buzz-agent`. The Fly account has an overdue invoice that blocks deploys.
- **UI seams.** Conversation header: `desktop/src/features/channels/ui/ChannelScreenHeader.tsx:336-401` (`AgentRuntimeHeaderStatus` at `:365-367` shows "Runtime not reported" for any non-local agent). Agent settings: `AgentInstanceEditDialog.tsx` (runtime dropdown `:1001-1008`, `AgentCreditsModelField` `:1019-1029`, provider/model fields `:1031-1060`), opened from `UserProfilePanel.tsx` and `AgentPage.tsx`. Mobile DM header: `mobile/lib/features/channels/channel_detail_page/app_bar.dart:175-247` (no runtime control; mobile has no managed-agent store).

## 5. Design

### 5.1 Approaches considered

| Approach | Trade-off | Verdict |
|---|---|---|
| **A. Relay-owned cloud runtime.** The relay keeps a registry of cloud-placed agents, starts and stops one Fly Machine per agent through a host layer, wakes it on a mention, and mints its AI session. | New relay module and secret store. Works with the Mac off and from a future phone, because the always-on relay owns the lifecycle. | **Chosen.** Only option where a phone or a closed Mac can flip and wake agents. |
| B. Reuse the desktop "Where to run" provider protocol with a `buzz-backend-fly` binary. | Smallest change, but the Mac performs every deploy, there is no stop or status op, and nothing wakes a sleeping agent. Fails the mobile goal. | Dropped. Reuse its parts (Sprig image, env tiers, presence rule). |
| C. Workers-style cloud brain (Jemma's hosted runner). | About $0 per agent and instant wake, but no shell, files or programs. | Dropped by owner: a cloud agent is a full computer. A later "computer on demand" step could still borrow this idea. |

Hosts compared: Fly Machines vs Cloudflare Containers (section 2, decision 5). Fly Sprites and Upstash Box were also shortlisted on 22 Oct; Cloud Run instances were dropped (no disk).

### 5.2 Placement: one switch, two homes

- **Placement record.** A new owner-signed addressable Nostr event (new kind in `crates/buzz-core/src/kind.rs`, per the repo rule to prefer events over new HTTP endpoints). `d` = agent pubkey; content says `mac` or `cloud` plus a monotonic generation number. The relay accepts it only when the signer is the agent's owner (the same ownership record the credits gateway uses). Last write wins by generation, not by `created_at`.
- **One live copy at a time (anti-goal 1).**
  - The desktop never starts a local harness for an agent whose placement is `cloud`. This covers every start path: manual start, `useDetachedAgentStart`, `mentionReconciler`, boot auto-start, and team/workspace re-apply.
  - Every harness (local and cloud) learns its placement and generation at start and subscribes to placement changes. When placement moves away from it, it finishes the turn it is on, publishes offline presence, and exits. It does not take new mentions after the change is seen.
  - The relay holds the generation. A cloud machine started for generation N exits if it sees a newer generation, so a slow start can never come back to life after a flip back.
- **Flip semantics.** A flip applies at once. The relay closes every live connection of the agent when its home changes, so a reply in progress at the moment of a flip is dropped, and the new home answers that message through relay catch-up (exactly one answer beats finishing the in-flight reply).
- **"Already answered" lives on the relay, not in a home's ledger.** The wake ledger is a local file per home, so it does not travel: a fresh cloud volume replays nothing older than about 15 minutes, and a Mac coming back would re-answer days of messages the cloud already handled. Rule: a message counts as answered only when the agent has published a reply to it. A 👀 or 💬 reaction is progress, not an answer (GATE-304: a harness reacted, was stopped, and the mention was lost), so a message with only a reaction is picked up again. This is the same test `desktop/src/features/agents/unansweredMentions.ts` already uses. On start, every home asks the relay for its unanswered messages from the **last 24 hours** and handles only those; the local ledger only removes duplicates within one home. Older unanswered messages are not picked up automatically. The builder must show that a mention sent seconds before a flip is answered exactly once, and that a message stalled while the Mac was off is answered after "Move to the cloud".
- **Relay fence (no second copy, even from an old app).** The relay allows many connections per agent key today, so a desktop-only rule would not stop an older app from starting a local copy. When an agent is placed in the cloud, the relay issues that machine a credential bound to the placement generation, and refuses NIP-42 authentication as that agent from any connection that does not present the current credential. When the agent is placed on the Mac, connections presenting an old cloud credential are refused, and Mac connections authenticate as today (backward compatible). The desktop and harness rules above stay, so a correct app never even tries.
- **Two setups per agent.** The Mac setup is today's record, untouched. The cloud setup is stored separately: provider (`colony-credits` by default, or the owner's own key) and model (default DeepSeek V4.1 Flash via the gateway, configurable, never hardcoded). Persona, name, system prompt and team instructions are shared. A Claude Code, Codex or OpenCode agent flipped to the cloud runs Colony Agent there with the cloud setup, and returns to its own runtime when flipped back.
- **What follows the agent:** identity (same pubkey), chat history, memory (agent engrams, kind 30174), canvas and relay files. **What does not:** files that exist only in folders on the Mac, and the Mac harness's own session state. The cloud agent says so plainly when asked for a Mac-only file.
- **Who can flip:** the agent's owner only in v1, enforced by the relay.

### 5.3 Cloud runtime on Fly (relay-owned)

- **Host layer.** A `CloudHost` interface in the relay with operations such as create, start, stop, destroy and status for one agent machine. v1 has one implementation, Fly Machines (Machines REST API, token in a relay Fly secret). Cloudflare can be added behind the same interface later.
- **Fly app and isolation.** Agent machines run in their own Fly app, not the relay's. They must not share a private network with the relay or the databases: an agent has a shell, so the app is created on its own isolated network (or in a separate Fly organisation), and machines reach the relay only through its public `wss://` address. This drops the "private network" benefit mentioned during the host discussion; the price comparison still holds.
- **Machine shape.** One machine per cloud agent, 1 GB RAM, shared CPU, region `iad` (next to the relay). One small Fly volume per agent (1 GB to start) holds the workspace, the wake ledger and the harness state, so files survive sleep and image updates. Builder measures memory with a real agent turn and a browser page open; if 1 GB is not enough, step up and report the new price.
- **Image.** A Colony agent image built from `Dockerfile.sprig` (`buzz-acp`, `buzz-agent`, `buzz-dev-mcp`, `rg`, git signing) plus the `colony` CLI and what the Colony Agent needs to read and act on the web (a headless browser if the agent's browser tools need one). Digest-pinned, pushed to Fly's registry by CI. No Claude Code, Codex, OpenCode or plan credentials in the image.
- **Secrets on the machine.** The agent's nsec and auth tag, the relay URL, and a cloud AI session (5.4). Never the owner's key, the OpenRouter master key or payment secrets. The relay stores each cloud-ready agent's nsec encrypted at rest (envelope encryption with a key held only in relay secrets), and decrypts it only to configure that agent's machine.
- **Getting the key to the relay.** The nsec exists only on the Mac today. The desktop uploads it (encrypted in transit, owner-signed request). **Owner decision (25 Nov, "happy"):** when the cloud beta is on for an account, the desktop makes all of that owner's agents cloud-ready in the background, ahead of any flip, so a later flip from the phone works with the Mac closed. An agent created on another Mac that has not uploaded yet shows "Open Colony on your Mac once to make Scout cloud-ready" when someone tries to flip it from elsewhere.
- **Cloud configuration snapshot.** `buzz-acp` needs more than persona and prompt: respond-to mode and allowlist, subscribe rules, parallelism, timeouts, env vars, tool and MCP permissions, team instructions. These live only in the Mac's `ManagedAgentRecord`. The desktop pushes a signed snapshot of the runnable config together with the key (stored encrypted beside it on the relay) and re-pushes it on every edit of that agent. The cloud machine boots from the latest snapshot. Paid-provider API keys and Mac-only paths are stripped from the snapshot.
- **Sleep.** The harness exits after 10 minutes with no turn (`BUZZ_ACP_EXIT_AFTER_INACTIVITY`, already supported). The machine stops when its process exits; the volume stays. Presence goes offline.
- **Wake (relay doorbell).** When the relay stores a message that could wake a cloud-placed agent (any mention of it, any message in a DM it belongs to, a workflow approval or reminder addressed to it), and the agent has no presence, the relay starts its machine. The doorbell is deliberately a superset of the harness's own subscribe and respond-to rules: a wasted wake costs seconds of machine time, a missed one loses a message. The harness still applies its rules after waking. The harness connects and replays from its ledger, so the waking message is handled through the normal path. Wake is debounced per agent (one start in flight), bounded (no more than a few attempts, with backoff), and ends in a visible state ("Scout could not start in the cloud. Try again or move to This Mac") instead of a retry loop.
- **Lifecycle edges the builder must cover:** flip to cloud (create the machine if needed, start it), flip to Mac (stop the machine, keep the volume for a while), agent deleted or owner account deleted (destroy machine and volume), relay restart (reconcile registry against the Fly app: no orphans, no missing machines), Fly API failure (durable retry record, never a silent success), image update (roll new digest on next start).
- **Status the UI can show:** Asleep, Waking, Working, Could not start, Out of credit. Derived from the relay registry plus presence.

### 5.4 Cloud AI setup (users pay their own usage)

This is the setup proposed to the owner on 25 Nov; it is a proposal he did not object to, and the design doc approval confirms it.

1. The cloud agent never holds a provider key. It calls the relay credits gateway, which is already live on prod.
2. Each owner account has a credit balance, topped up through the existing checkout (PayFast configured on prod; Stripe code merged without secrets). Each reply is charged at model cost plus 20%.
3. Default cloud model: DeepSeek V4.1 Flash (about 1 to 3 US cents a reply). It must be added to `COLONY_CREDITS_ALLOWED_MODELS` with the model-terms review the gateway docs require. The owner can pick another allowed model in the agent's cloud setup.
   - **Gateway change required.** Today an explicit model selection must be free (`ordered_chain(..., require_free = true)` in `crates/buzz-relay/src/api/credits_gateway_upstream.rs:343-372,524`; sessions accept only `selectable_free_models()`). The gateway must accept an allowlisted paid model for a cloud session of a paying account, with the existing balance hold and cost + 20% settlement. The global primary model and the free chain stay as they are, so Mac agents and free or judge accounts are unchanged and Colony pays nothing extra.
4. Starter credit: each account gets $1 once, the first time it puts an agent in the cloud, funded by Colony, recorded as a ledger grant.
5. Own key instead: in the agent's cloud setup the owner can paste an OpenRouter or DeepSeek key. It is stored encrypted per account on the relay. **The key never reaches the machine** (an agent with a shell could be talked into reading it): the gateway uses the stored key upstream for that agent's requests and charges nothing. Own key is a second slice; the acceptance gate does not wait for it.
6. Accounts in `COLONY_FREE_AI_ACCOUNTS` (the owner's own, the judges') stay free.
7. Out of credit (gateway 402) or daily limit: the harness posts one plain system message in the chat with two actions: "Top up" and "Move to This Mac". No retry loop.

**Session gap to close.** Today a gateway session is opened by the owner's NIP-98 signature and expires after 2 hours; the desktop injects it only at spawn. A cloud agent has no owner key at hand and may run for days. The builder designs a cloud session that the relay mints for a cloud-placed agent on the strength of the owner-signed placement and the ownership record, renewed by the relay on each wake, revoked on flip back or deletion, and never usable outside that agent's machine (bound to the agent signer as today).

### 5.5 The switch in the UI

```
Conversation header (agent DM, or an agent's own row in a channel header)
┌────────────────────────────────────────────┐
│ Scout      Working on: This Mac ▾           │
└────────────────────────────────────────────┘
  tap ▾ →  ✓ This Mac   (Claude Code)
             Cloud      (Colony credits · DeepSeek V4.1 Flash)

Agent profile / settings
  Where Scout works
  ( ) This Mac    uses Claude Code
  (•) Cloud       uses Colony credits · DeepSeek V4.1 Flash ▾
                  Asleep · wakes when you message
```

- The header control replaces "Runtime not reported" in `AgentRuntimeHeaderStatus` for cloud agents and shows the status from 5.3.
- **Mac-off recovery card.** If an agent is placed on the Mac, the Mac is not online, and a message to it gets no answer within the existing stalled window, the chat shows "Scout's Mac is off. Move Scout to the cloud?" with one action. This is the recovery path for rule 6 (a guard must not hide the only way back).
- **Out-of-credit card** as in 5.4.
- Visuals must come from the Colony 3.0 design system (owner rule: mockups from the real design, Codex or Claude Design owns the screens). The sketch above fixes content and placement only.
- Accessibility and input rules from `CLAUDE.md` apply: one owner per actionable label, keyboard path for the menu, no duplicate screen-reader stops.

### 5.6 Caps and cost guard (free beta)

- Feature flag on the relay, default OFF (`COLONY_CLOUD_AGENTS`), plus an allowlist so the owner's account goes first; the owner widens it after the proof gate.
- Per account: at most 2 cloud agents at once in the beta (proposal; a setting, not a constant).
- Global: a maximum number of cloud machines (setting) and a kill switch that stops all agent machines.
- Idle sleep 10 minutes; no machine is ever "always on" in v1.
- A daily report line in relay logs: machines created, awake hours, wakes, failures.

### 5.7 Testing and proof

- Follow `TESTING.md` and the review-proven rules in `CLAUDE.md`: every caught failure leaves a durable retry record (Fly calls, key upload, session mint), async results fenced by generation (placement), bounded wake loops, one user action = one atomic persist (a flip is one event), falsifiable tests bound to production seams.
- Fly API behind the host interface with a fake host in tests; one real Fly test path in a manual CI lane.
- **Acceptance gate (owner's ladder: Built, PR open, CI green, Merged, In review, Done):** on the canary relay with the owner's account: flip Scout to Cloud from the chat header, quit Colony on the Mac, send Scout a message from another signed-in device or the CLI, get an answer from the cloud within about 30 seconds of an asleep start (the owner's free account stays untouched; a separate paying test account on DeepSeek V4.1 Flash sees its balance drop by that reply's cost), flip back to This Mac from the profile, get the next answer from the Mac runtime, and confirm exactly one answer per message throughout. Then a test account with zero balance sees the out-of-credit card. Proof page with real screenshots (390 then 1440) and an honest NOT-verified list.

## 6. Constraints and prerequisites

- **Fly invoice** must be paid before anything deploys (relay or agent machines).
- **DeepSeek V4.1 Flash** must be added to the gateway's allowed models (Fly secret change on `colony-relay`, owner sets secrets) after a model-terms review.
- **PayFast live mode** and a real top-up are unverified; credits must actually be buyable before beta users depend on them.
- **Relay deploy order**: ship desktop support before the relay emits anything older desktops cannot read (owner lesson of 5 Nov: a new relay enum broke old clients).
- Production releases follow the Colony release flow; nothing here changes it.

## 7. Left to the builder

- Exact kind numbers, event shapes, registry tables and migrations.
- Fly app setup details (isolated network vs separate org), machine config, volume handling, image build pipeline.
- Envelope encryption scheme for stored agent keys and own AI keys.
- The cloud gateway session design (5.4), within the stated bounds.
- How the harness learns and watches its placement.
- How the desktop gates every local start path, and how the Mac-off card detects "Mac not online".
- Whether a headless browser is needed in the image for the Colony Agent's web tools, and the measured machine size.
- Plan slicing (relay, image, desktop) and PR order.

## 8. Calls made after the builder check (25 Nov, coordinator's calls unless marked)

1. Owner's (already answered by "happy"): every agent of a beta account is made cloud-ready in the background, key and config snapshot uploaded ahead of any flip.
2. "Answered" is decided on the relay (an agent reply only; reactions are progress, per GATE-304), new home picks up unanswered messages from the last 24 hours (section 5.2).
3. Relay fences agent authentication by placement generation, not only the desktop (section 5.2).
4. Cloud config comes from a desktop-pushed snapshot, re-pushed on every edit (section 5.3).
5. Doorbell is a superset of the harness rules (section 5.3).
6. Users-pay needs a gateway change for paid models on cloud sessions; global chain untouched (section 5.4).
7. Own key stays on the relay, used by the gateway, never on the machine, and ships as a second slice (section 5.4).
