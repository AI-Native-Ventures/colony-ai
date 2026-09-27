# Full App Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Execute this plan inline in the active worktree, with local commits after each completed sub-slice.

**Goal:** Replace the r19 sidebar hierarchy with the approved C1 full-app navigation while preserving all existing conversation, unread, sort, drag, community, and route behavior.

**Architecture:** Keep the current app shell, navigation callbacks, feature gates, and channel section components. Compose them under reusable, keyboard-operable disclosure groups in `AppSidebar`, move Activity children and Software Factory destinations to their approved groups, and style the shell from the approved snapshot without editing that snapshot.

**Tech Stack:** React 19, TypeScript, Tailwind, Radix sidebar primitives, TanStack Router, Playwright, Biome.

---

## Files and responsibilities

- Modify `desktop/src/features/sidebar/ui/AppSidebar.tsx` to compose the new ordering around the existing channel, forum, direct-message, profile, unread, and community behavior.
- Modify `desktop/src/features/sidebar/ui/AppSidebarPinnedHeader.tsx` to keep the company switcher and Find anything control while exposing Today and Activity navigation with the preserved Activity badge.
- Modify `desktop/src/features/sidebar/ui/AppSidebar.types.ts` only if selected route states or disclosure keys need shared typing.
- Modify `desktop/src/features/sidebar/ui/SidebarProjectsSection.tsx` and `desktop/src/features/factory/ui/FactoryNavigator.tsx` only as needed to move Projects and Shared compute entry points under Software Factory without duplicating routes.
- Modify `desktop/src/shared/styles/globals/colony-workspace.css` and, if needed, `desktop/src/shared/styles/globals/scrollbars.css` for the approved 244px shell, category labels, collapsed sidebar, footer, and hidden scroll tracks.
- Update every E2E spec found to depend on the changed sidebar labels, roles, IDs, or hierarchy. Start with `desktop/tests/e2e/sidebar.spec.ts`, `navigation.spec.ts`, `badge.spec.ts`, `channel-star.spec.ts`, `channel-sort.spec.ts`, and `community-rail.spec.ts`, then include all matches from the required repository-wide label and test ID searches.

## Task 1: Record the new navigation contract in E2E coverage

- [ ] Inventory sidebar-specific selectors in `desktop/tests/e2e`, `desktop/src/**/*.test.*`, and `mobile/test` for Inbox, Projects, Work, Agent work, Channels, Forums, Direct messages, Software Factory, Saved for later, Settings, AI spend & power, and the sidebar test IDs.
- [ ] Update the sidebar smoke expectations to assert the approved visible order, Activity label, Saved for later placement, hidden unavailable routes, and nested Software Factory destinations.
- [ ] Add assertions for independent disclosure state, `aria-expanded`, keyboard activation, and collapsed whole-sidebar state. Keep existing unread, starring, custom-section, sorting, drag, mark-read, and community-rail assertions intact.
- [ ] Run the affected test once to confirm the new expectations fail against the old hierarchy.

## Task 2: Compose the approved full-app navigation

- [ ] Add a reusable disclosure group in `desktop/src/features/sidebar/ui/SidebarNavigationGroup.tsx` with props `{ label: string; testId: string; defaultExpanded: boolean; children: React.ReactNode }`. Render a native button with `aria-expanded`, a stable `data-testid`, a chevron, and a controlled region. Toggle on click, Enter, and Space through native button semantics.
- [ ] Reorder `AppSidebar.tsx` to render Today, Activity and its Inbox/Saved for later children, Conversations with the existing Channels, Forums, and Direct messages sections, Company with only routes that currently exist, Business collapsed with unavailable destinations omitted, Software Factory with its existing Projects and Shared compute destinations, Library collapsed with only existing routes, then the existing footer.
- [ ] Keep the Activity row connected to `onSelectHome` and `homeBadgeCount`; keep Inbox filters and feed data unchanged. Connect Saved for later to the existing reminders route.
- [ ] Keep channels, forums, and DMs rendered from current queries and user-defined state. Preserve each section's current callbacks and data test IDs.
- [ ] Keep missing Company and Business destinations absent until their route lands. Keep agent directory, profile tabs, create-agent, teams, and Power/usage surfaces outside this slice.

## Task 3: Move existing destinations under their approved groups

- [ ] Remove the standalone Projects section from the primary app navigation and expose the existing Projects destination from the Software Factory group. Retain project feature gating and project item navigation.
- [ ] Expose Shared compute from Software Factory through the existing compute settings section. Do not change compute settings behavior or content.
- [ ] Keep Software Factory's existing workbench route and Settings route reachable through their visible shell entries.

## Task 4: Match shell layout and disclosure states

- [ ] Update `colony-workspace.css` so the app sidebar matches the approved 244px shell, compact row and section-label scale, gradient/material frame, footer spacing, and collapsed 64px state at both target sizes.
- [ ] Ensure Conversations and Company are expanded initially; Business and Library are collapsed initially; every disclosure keeps an independent open state.
- [ ] Keep the sidebar scroll container usable with hidden scrollbar tracks. Verify scrolling reaches the footer and all expanded groups without overlaying the footer.
- [ ] Preserve the existing responsive sidebar behavior and its accessible collapse control.

## Task 5: Update dependent tests and verify the slice

- [ ] Repeat the exact-label and test ID searches across `desktop/tests/e2e`, `desktop/src/**/*.test.*`, and `mobile/test`; update every sidebar-dependent assertion without weakening product behavior coverage.
- [ ] Run Biome on changed files, `pnpm tsc --noEmit`, and `pnpm check:px-text` from `desktop`.
- [ ] Run `pnpm build:e2e`, then the affected Playwright specs one at a time in `mcr.microsoft.com/playwright:v1.60.0-noble` with `--cpus=2`.
- [ ] Capture and compare light and dark sidebar screenshots at 1728x1117 and 1440x900 against the approved company shell snapshot. Record the gallery location and per-capture changed-pixel ratio.
- [ ] Commit each completed sub-slice with `git commit -s`. Push only after all focused local checks and visual comparisons pass, open or update the draft PR against `codex/phase2-integration`, then poll hosted checks until all are green.

## Acceptance gate

The sidebar order, collapse behavior, route reachability, and retained conversation behavior must match C1. The changed test inventory must be complete, required local gates must pass, all four viewport/theme comparisons must be reviewed and reported, and hosted smoke checks must be green before requesting review.
