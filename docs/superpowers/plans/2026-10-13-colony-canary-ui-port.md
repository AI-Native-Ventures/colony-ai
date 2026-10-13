# Colony canary UI port implementation plan

**Goal:** Make the approved Colony screen pack the user-facing UI of the existing Colony 2.0 desktop app, using its real relay and native capabilities.

**Base:** `origin/develop` at `79411cda0`, in the isolated `colony/canary-ui-port` worktree. Do not work on `develop`, push, merge, or deploy as part of this local plan.

**Design authority:** `design/colony-os/` on `design/colony-os` at `44971c3b4` and the screen contract in `docs/superpowers/specs/2026-10-11-colony-os-screens/`. The owner's white workspace, rose/lilac/blue gradient sidebar, Manrope, simple words, side-panel threads and ant employees are fixed. The prototype's mock store is a visual reference, never a production data source.

**Architecture:** Keep the current Tauri desktop, React router, relay hooks and native bridge. Replace the user-facing shell and screens in bounded slices, using thin adapters from existing production queries to presentational components. Retain underlying Buzz capabilities while removing extra navigation from the canary. A route or action is only marked ported after it reads or writes real state, handles failures, and passes its workflow check. The older Buzz vision describes seven surfaces, while the owner's approved Colony design deliberately exposes Today, Conversations, Team and Settings. This canary is a product-specific presentation over shared capabilities.

## Phase 1: shell and navigation

**Files:**

- Create `desktop/src/features/sidebar/ui/ColonyCanarySidebar.tsx`: four primary destinations, Needs you, new conversation, search, live conversation list, team link and account controls. Props come from `AppSidebarProps`; data is the app's real `Channel[]` and existing callbacks.
- Create `desktop/src/shared/styles/globals/colony-canary.css`: scoped white content area, approved gradient sidebar, clear active and focus states at normal and small window widths.
- Modify `desktop/src/app/AppShell.tsx`: mount the new sidebar at the production seam while retaining the current query, notification, search, navigation and native providers.
- Modify `desktop/src/shared/styles/globals.css`: import the new scoped stylesheet after the legacy Colony styles.
- Add a focused E2E smoke spec under `desktop/tests/e2e/`, registered in `desktop/playwright.config.ts`, exercising `/today`, Team, Settings, a real channel route, search, keyboard focus, and the absence of extra product destinations.

**Gate:** E2E mock-bridge actions reach the real production routes; the visible shell has only approved destinations; no fabricated status or mock card is rendered; 1440 x 900 and 1024 x 700 screenshots match the approved composition in light and dark; typecheck and focused smoke pass. This is a shell gate, not proof of all 128 screens.

**Gate evidence, 13 October:** The real `AppShell` renders the canary sidebar on Today, channel, Team and Settings routes. A focused Playwright spec passed both navigation tests, including creation dialog and the mobile menu. TypeScript, E2E build and the text-size check passed. Mock-bridge screenshots at 1440 x 900 (light and dark) and 1024 x 700 (light) show the white work area and approved 216px gradient sidebar. The E2E fixture's relay lacks an identity for ask records, so its Today error is expected fixture evidence, not a successful live Needs you proof. Native runtime, relay write, CI, packaged and live behavior remain unverified.

## Phase 2: Today and Needs you

Refactor `desktop/src/features/home/ui/TodayScreen.tsx` and its scoped styles against T-01 and T-05. Adapt `useHomeFeedQuery`, `useNeedsMeQuery`, the company ask records, identity and team queries. Show a brief only when an actual Scout brief exists; otherwise use the pack's honest first-day or empty state. Preserve permissions and decision history. Check opening an ask in its source conversation, an offline/error retry, partner billing limits and the smallest window.

**Local slice evidence, 13 October:** Today now reads the existing feed, ask, identity and team queries. It shows an ant Scout and an honest pending-brief state until a real brief exists; employee rows render ant portraits. Needs you has its own route and the real ask card opens its source tool-consent discussion. TypeScript/E2E build and five focused shell/Today smoke cases pass. This is a partial phase gate: offline/retry, partner billing, narrow-window, native runtime and relay integration remain unverified.

## Phase 3: Conversations and workspace

Port T-02 to T-08 over the existing stream channel, message and thread APIs. Keep a channel-like conversation timeline with a message or card thread in a side panel. The conversation workspace indexes real files, media, links and browser references with a source-thread relationship. Test read/write, reconnect, search, attachment failure, keyboard navigation and permission boundaries. No session-only mock records in the product path.

**Local slice evidence, 13 October:** Stream conversations now use the approved title, real member identities, description and Workspace entry. The old duplicate header, tab strip and intro action cards are absent for joined stream channels. Existing messages show agent ants, and a focused E2E case opens a real message thread beside the conversation and toggles the existing work area. A second case verifies the quiet empty state. TypeScript/E2E build and two focused conversation smoke cases pass. The workspace's file/browser/media tabs remain backed by existing product code, but a unified asset index linked to source threads, message send/attachment failure, reconnect and permission paths remain to be implemented and proven.

## Phase 4: Team and employee desks

Port M-01 to M-08 and D-01 to D-06c over the company-role, hire and managed-agent runtime contracts. Bundle only ant portraits for the six starter employees. Use real lifecycle and budget state, not fixture counters. Keep owner and partner permissions at the mutation boundary. The unmerged account/host-run gates must pass before claiming real hire, pause, move or execution behavior.

**Local slice evidence, 13 October:** The main Team route now lists signed employee records with ant portraits, actual lifecycle labels and owner-only hiring. Its decision total comes from the existing Needs you query; unavailable decision data is omitted. An employee opens a desk with Desk, Plan, Schedule, Activity and Settings tabs. Schedule reads signed duties, Message opens the product's direct conversation, and that conversation's agent header uses an ant. During identity loading or failure the header shows a neutral placeholder rather than a human portrait. The legacy technical controls remain reachable under employee Settings. A focused mock-bridge E2E run passed all 10 canary shell, Today, conversation and Team cases; typecheck/E2E build, Biome, the text-size guard and a 700px keyboard and overflow check passed. Screenshots at 1280px and 700px were reviewed. This remains a partial phase gate: hire, pause, move, spend and runtime mutations have not been exercised against a relay/native host, and the other Team/desk states in the pack are not yet ported or proven. Existing non-canary E2E expectations still need migration before a PR.

## Phase 5: result cards, Settings and first run

Port C-00 to C-20, S-01 to S-09, O-01 to O-10, P-01/P-01a and N-01/N-02 in independent reviewable slices. Each card must bind its visible state and action to the matching production event and durable result, with source conversation, actor and time. Payment, provider and external-send pages must distinguish a browser return from server confirmation. Exercise the actual role, failure and recovery paths.

## Phase 6: native, outside pages and cleanup

Port G-02 to G-08 and X-01 to X-22 through Tauri/native capabilities; port W-01 to W-09 to the appropriate site/email/payment delivery surface. Supply approved legal copy, actual installer assets and owner product photography before publication. When all replacement routes pass, remove surplus user-facing entry points and unused presentation code. Delete backend capabilities or stored data only after a separate dependency audit and migration proof.

## Proof ledger

Track each ID as design present, production UI ported, local workflow verified, native/relay integrated, CI green at exact SHA, packaged, deployed and live-proven. These are separate states. Record the gate evidence in this file after each phase. The design prototype's 3,860 exports and checks prove only its static local design.
