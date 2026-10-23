# Plan: restyle the Colony desktop app to the office look

Task RESTYLE-1. Spec: [2026-10-23-app-restyle-design.md](../specs/2026-10-23-app-restyle-design.md)
(owner approved 23 Oct 2026). Branch `feat/app-restyle` from `origin/develop`
62a3d7f64. One draft PR into develop; never marked ready, never merged by the
builder.

## Goal

Every desktop screen after onboarding takes the office reference's type,
sizes, spacing and component shapes, while the Default style keeps today's
pink-to-blue gradient and Custom keeps the user's two colours. Presentation
and layout only: no behaviour, data, relay or Rust changes, and every feature
stays reachable.

Authority: the prototype office (`cf7f4176e`, copies in
`/Users/mac/worktrees/.lanes/restyle/reference/`, screens at 1440x900) and the
owner's screenshot. Onboarding and the gate screens listed in the spec stay as
in 1.0.12.

## Decisions

### D1. Implementation shape

- One token layer plus office stylesheets imported last in
  `desktop/src/shared/styles/globals.css`:
  - `globals/office-tokens.css`: palette, type and space tokens (light and
    dark), the field-tinted card glow, and the conversation type contract.
  - `globals/office-shell.css`: content card, top bar, channel header, tabs.
  - `globals/office-sidebar.css`: company block, nav, sections, rows,
    profile.
  - `globals/office-conversation.css`: timeline, day divider, system rows,
    message rows, action bar, thread summary, thread panel, composer.
  - Phase 2 adds `globals/office-surfaces*.css` for the remaining routes,
    dialogs and menus.
- Rules are scoped to the full app shell
  (`:root:has([data-colony-full-app-shell="true"])`) or to Settings, so
  onboarding and the gate screens (which do not render the shell) keep their
  look by construction.
- Markup changes only where CSS cannot express the reference: the channel
  header kicker ("Private channel", "Channel", "Direct message", "Forum") and
  its larger title block, and small structural hooks (class names) where a
  component has no stable selector. Every existing `data-testid` stays.
- Each new file stays under the repository file-size gate.

### D2. Where the gradient sits

- The field (Default: `--colony-field-*` pink to blue; Custom:
  `--w20-custom-gradient-*`) keeps painting the whole app surface. The sidebar
  stays transparent on it, so the reference's flat lavender sidebar becomes
  the user's gradient.
- The content card stays inset on the field (margin 8px) so the gradient
  frames the office on all four sides, with the reference's paper colour and a
  16px radius.
- The reference's warm top glow inside the main pane becomes a soft glow
  tinted from the active field colours (Default: the pink and blue stops;
  Custom: the two custom stops), so the gradient also carries into the card
  header. Dark mode uses the dark field stops at lower strength.
- Glass background (macOS vibrancy) keeps working: the office rules never
  paint the field layers.

### D3. Palette

- Light: reference ink (`--ink`, `--ink-2`, `--ink-3`), paper, lines, mapped
  onto the existing semantic slots (`--colony-fg`, `--colony-muted`,
  `--colony-faint`, `--colony-border`, `--colony-surface`, and so on) only
  inside the shell, so every existing component inherits the office colours
  without per-component edits.
- Accent: the reference violet is the default accent (`#895AF6` is already
  the app default). Every accent use in the new components reads
  `--primary` / `--colony-accent`, which `applyAccentColor` already rewrites,
  so a new accent recolours the active row icon, unread dots, thread reply
  counts, send button, focus rings, composer focus halo and links.
- Dark (designed here, the reference is light only): deep violet-ink paper
  (`oklch(0.205 0.02 290)` family), raised rows one step lighter, ink
  `oklch(0.94 0.012 300)`, lines at about 12 percent white, the same radii,
  weights and sizes. The field stays the dark gradient.
- Named catalog themes keep their own palettes; the office layout, type and
  shapes apply to them as well.

### D4. Type and space

- Manrope everywhere (already shipped). Office sizes are tokens on a 16px
  "office rem" derived from the virtual typography rem
  (`--office-rem: calc(var(--buzz-type-rem) * 14 / 15)`), so the Font size
  preference and Cmd +/- zoom keep scaling them and no px text is added.
- Reference sizes used as tokens: page title 3rem/800/-0.045em, kicker
  0.875rem/750, channel description 1rem/600, nav 0.9375rem/750, channel rows
  0.9063rem/700, section headings 0.6875rem/800/0.09em uppercase, member
  names 0.875rem/800, roles 0.75rem/650, message author 0.9375rem/800, meta
  0.8125rem/650, message text 1.0625rem/1.55/550, day divider
  0.6875rem/800/0.1em uppercase, system rows 0.8125rem/600, thread title
  1.125rem/800, thread count 0.75rem/800/0.08em, composer input 1rem/550.
- Conversation contract changes (spec Goal 2: "The reference's text size
  becomes the default conversation size; the size preference still adjusts
  it"): message text becomes `text-sm + 2px`, so Font size Smaller / Default
  / Larger give 16 / 17 / 18px, and the Appearance message size still moves
  it one step down or up. Line height 1.55. The composer input is one step
  smaller (15 / 16 / 17px), as in the reference. `AGENTS.md` (the
  typography section) and the tests that pin the old 14 / 15 / 16 contract are
  updated in the same change. This is an intentional, owner-approved change
  to a documented contract and the PR calls it out.
- Spacing and shapes: rows radius 10 to 11px, cards 15 to 16px, composer
  18px with a 1.5px border, pills 999px, send button 42px square with 13px
  radius, avatars 42px in channels and 36px in threads, sidebar 276px default
  width (the old 260 default migrates to 276 the same way 244 migrated to
  260; custom widths are kept).

### D5. Layout of the conversation

- Top bar: kept (history, Work area, browser, member stack, members, search,
  Inbox) as a quiet transparent row on the paper.
- Channel header: kicker with icon, large title, description, with Pins,
  Huddle and Settings on the title row's right. Tabs (Discussion, Work,
  Knowledge, Canvas, Files) restyled as quiet office tabs under it.
- Timeline, header and composer share the reference's centred reading column
  (max 980px with 48px side padding, composer max 884px), implemented with
  padding on the existing scroll container so virtualisation is untouched.
- Thread panel: reference header ("Thread" plus "# channel"), root message,
  uppercase reply count, 36px avatars and 16px text, rounded reply composer
  and the existing "Also send to #channel" checkbox styled as in the
  reference. Resizable width is kept.

### D6. Reference to app mapping

| Reference | App today | Restyle |
|---|---|---|
| Company block (arch mark, name, address) | Business switcher (initial, name, "Company workspace") | Arch-shaped mark (accent gradient), name 15.5px/800, subtitle in the address style |
| Today, Activity | Today, Activity (with count) | Office nav items, active row on paper with shadow |
| Channels with private and public markers | Conversations group: Client work, Channels, Starred, Forums, Direct messages | Office section headings and rows; lock and # markers kept |
| Direct messages with presence | Direct messages section with avatar and presence | Office DM rows (22px avatar, presence dot) |
| Team with presence, Hire | Company group: Team (count), Goals, Work, Workflows | Office nav rows; Team list in the sidebar is a proposal (not built) |
| Signed-in person at the bottom | Profile card (avatar, name, status, theme toggle) | Larger avatar with ring, name 14px/800, status line in the role style |
| Day divider, system events | Day divider, system rows | Uppercase divider with lines, centred system rows |
| Message: avatar, name, role, large text | Avatar, name, agent badge, timestamp, body | 42px avatar, name 15px/800, badge and time as quiet meta, 17px text |
| Reply row: avatars, count, last reply | Thread summary row | Overlapping 24px avatars, bold accent count, quiet last reply |
| Quick replies | None | Proposal (not built) |
| Composer: large rounded field, mic, send | Composer with tools row, Raise an ask, goal reference, send | Large rounded field; tools and actions kept inside it |
| Thread panel | Thread panel with broadcast checkbox | As D5 |
| "Founded today" picture card | Not in the app | Nothing to remove |

### D7. Proposals (not built, listed for the owner)

- Team members with presence listed in the sidebar under Team.
- A dashed "Hire" button in the sidebar opening the existing hiring flow.
- Quick reply chips under agent questions.
- Roles (for example "Chief of Staff") next to names in messages, from the
  team record.

### D8. Gate screens and onboarding

Untouched: `WelcomeSetup`, `CommunityApplyErrorScreen`, Not a member, keyring
locked and recovery screens, and the in-app add-business flow keep the
onboarding look. The office rules are scoped to the shell, and the proof
checks one gate screen to confirm it did not change.

## Phase 1 tasks (checkpoint)

1. Tokens: `office-tokens.css` (palette light and dark, type, space, glow),
   conversation size contract (`typography.css`,
   `conversationMessageSizePreference.ts` and its unit test).
2. Shell: content card radius and paper, top bar, channel header with kicker
   (`features/chat/ui/ChatHeader.tsx`), tabs
   (`features/channels/ui/ChannelWorkspaceTabs.tsx` styles), centred column.
3. Sidebar: company block (`AppSidebarPinnedHeader.tsx` styles), nav, groups,
   sections, channel and DM rows, Company group, footer rows, profile card;
   default width 276 (`shared/ui/sidebar.tsx`) with legacy migration.
4. Conversation: day divider, system rows, message rows (avatar, header,
   body, continuation), action bar, reactions, attachments framing, thread
   summary row, unread and highlight states.
5. Thread panel and focus drawer: header, root, count label, replies,
   composer, broadcast checkbox.
6. Composer: channel and thread composers, focus state, tools, send.
7. Direct messages: DM header kicker and title, DM timeline.
8. Appearance: the Settings Appearance panel controls (mode, style, custom
   colours, accent swatches, theme catalog entry, message size) in the office
   look, and the live preview updated to the office message look.
9. Tests: update the specs and unit tests that pin the old look (see Tests);
   typecheck, biome, px-text, file sizes.
10. Proof page "Restyle phase 1 proof" and the checkpoint line.

## Phase 2 tasks

Each group ends with a `PROGRESS RESTYLE-1:` line.

1. Today (home) and Activity, Inbox rows.
2. Agents, team and hiring (team page, agent profiles, hire flow screens).
3. Work area: files, canvas, browser, terminal panels and dock.
4. Knowledge, projects, goals and money.
5. Settings (every section), dialogs, menus, popovers, tooltips, search
   palette, huddles, toasts.
6. Final sweep: every route at 1440x900 in all variants, contrast checks in
   dark, final proof page "Restyle final proof".

## Tests

- Unit: `conversationMessageSizePreference.test.mjs`, any sidebar width
  migration test, the CSS contract tests under `shared/styles/globals`.
- E2E specs to update and run locally in both the smoke and the integration
  projects (`pnpm build:e2e` first, server on a private port):
  `shell-design`, `appearance-previews`, `appearance-chrome`,
  `buzz-theme-screenshots`, `sidebar-reference-fixture`, and every spec whose
  assertions touch changed sizes, found with a grep over the changed test ids
  and CSS values.
- `tsc --noEmit`, `biome check`, `pnpm check:px-text`, file-size check.
- Heavy jobs go through `/Users/mac/worktrees/.lanes/tools/heavy.sh`; no local
  cargo; GitHub CI is the gate.

## Proof

- `desktop/tests/visual/restyle-proof.spec.ts` with its own config (never in
  CI) captures each surface at 1440x900 in five variants: light Default, dark
  Default, light Custom (amber `#f59e0b` to teal `#14b8a6`), accent green
  (light) and accent pink (dark).
- Phase 1 surfaces: private channel with messages, public channel, direct
  message, thread open, composer focused, sidebar. Each sits next to the
  reference frame where one exists.
- Published as an org Superset page with an honest "Not verified" list.

## Open questions (best guesses in use)

- Q1. Topbar title: the channel name in the top bar duplicates the new large
  title. Guess: keep it, quieter.
- Q2. Card inset versus a flush main pane like the reference. Guess: keep the
  8px inset so the gradient frames the office.

## Risks

- Cascade: the app already stacks several restyle layers (C1, r17, w20). The
  office files load last and match the existing selector strength; computed
  style checks in the specs catch regressions.
- Long channels: no change to virtualisation or memoisation; only CSS on the
  existing scroll container and rows.
- Dark contrast: checked with computed colours in the proof run.
