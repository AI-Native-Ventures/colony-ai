# Prompt for Codex: design every screen of the new Colony app

You are the product designer for Colony. Your job is to design every screen of the new Colony desktop app. The planning is done and approved by the owner: this pack says what every screen shows and does. You own how it looks.

## What Colony is

Colony is an AI company for small business owners who are not technical. The owner talks to Scout, their Chief of Staff, in a few topic conversations. A starter team of AI employees does the work on the owner's computer: Maya (Growth Marketer), Naledi (Social Media Manager), Sipho (Sales Director), Leo (Website Builder) and Grace (Customer Care and Admin). Anything public, any money and any big call comes to the owner as a card to approve.

The owner should feel calm and in control. It must never feel like Slack, a dashboard or a developer tool. As little interface as possible, and every part of it well thought out.

## Read first

Repository `AI-Native-Ventures/colony-ai`, branch `docs/colony-os`:

1. `docs/superpowers/specs/2026-10-11-colony-os-screens/00-index.md`: the contract. IDs, product rules, the words to use, the sample company, the deliverable format.
2. `docs/superpowers/specs/2026-10-11-colony-os-design.md`: the product, the owner's decisions, the team.
3. Files `01` to `09` in the same folder: every screen, card, state and flow. File `10` explains the data behind each screen (context only).

## What is fixed and what is yours

- **Fixed by the pack:** which screens exist, what each shows and in what order of importance, every action and who may use it, every state, the words, the rules.
- **Yours:** layout, visual language, components, icons, illustration, motion, spacing and colour.
- Never add, drop or merge screens, actions or states. If you think something should change, design it as the pack says and write your proposal in `notes/<ID>.md`.
- Use the pack's words exactly. Better wording goes in the notes, not in the design.

## Look and feel

- A fresh look. Keep the Colony name, the Colony ant mark and the Manrope font (never Satoshi). Light and dark themes that follow the computer, with a manual switch.
- Calm, warm, confident and uncluttered. Built for a busy person who hates reading: short text, clear actions, nothing technical on screen.
- A desktop app for Mac and Windows. Design at 1440 x 900, check every screen at 1728 x 1117 (the owner's screen) and make sure it still works in a 1024 x 700 window. Respect each platform's habits: the menu bar on Mac, the tray near the clock on Windows.
- Accessibility is part of the design: every action reachable by keyboard, visible focus, status never shown by colour alone, WCAG AA contrast, a clear name for every control.
- Use the sample company (Lerato Designs, 00-index section 7) everywhere. No lorem ipsum.
- No em dashes anywhere, in the design or in your files.

## Deliverables

Create the branch `design/colony-os` from `docs/colony-os` and put everything in `design/colony-os/`:

1. `foundations/`: a design system page with the type scale, colour tokens for light and dark, spacing, radii, elevation, and every shared component: the app frame, a card in its inline and full forms, banner, toast, status chip, buttons, inputs, the message composer with voice note, and the empty and loading patterns.
2. `prototype/`: a clickable prototype in React and TypeScript (Vite) with a mock data layer and no real backend. Build presentational components that take plain props, so the real app can reuse them later. One route per ID, each with a switch for every state its entry lists. Flows F-01 to F-08 clickable end to end. It must run from a plain static build with no external CDN (bundle Manrope).
3. `png/`: an export of every ID and every state at 1440 x 900, in light and dark, named by ID, for example `T-03-conversation.png`, `T-03-conversation--offline.png`, `T-03-conversation--dark.png`. Use Playwright to export them from the prototype.
4. `notes/`: one file per ID where you have a proposal or a question.
5. `COVERAGE.md`: every ID from 00-index section 11 with the states you designed, so nothing is missed.

## Order of work

Stop after milestone 1 and show the owner before going on.

1. Foundations, G-01 app window, G-07 employee identity, T-01 Today, T-03 conversation, T-05 Needs you, cards C-00 to C-05, M-01 Team, M-02 employee page and D-03 Naledi's desk. **Then stop for review.**
2. First run: O-01 to O-10, P-01, P-01a, N-01 and N-02.
3. The rest of the cards (C-06 to C-20), then team and desks (M-03 to M-08, D-01 to D-06 with their sub-screens).
4. Settings (S-01 to S-09), system states and dialogs (X-01 to X-22, G-02 to G-06, G-08), and the pages outside the app (W-01 to W-09).

## Before you hand anything back

- Every ID in the milestone has a design for every state its entry lists.
- The words match the pack exactly.
- Light and dark are both checked, at 1440 x 900, 1728 x 1117 and 1024 x 700.
- Keyboard focus order makes sense on every screen.
- `COVERAGE.md` is up to date.
