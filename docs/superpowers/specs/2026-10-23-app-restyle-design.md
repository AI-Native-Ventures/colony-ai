# Colony desktop restyle: the office look across the whole app

Date: 23 Oct 2026. Owner: Basheer. Status: APPROVED by the owner on 23 Oct 2026 ("Approve, start now").

Owner answer to the builder check: with the Default theme style, **keep today's pink-to-blue gradient** (the `--colony-field-*` values in `desktop/src/shared/styles/globals/theme.css`) painting the app. The office reference sets the layout, type, sizes, spacing and component shapes, not the Default colours. Custom still swaps in the user's two gradient colours. Where the reference's flat lavender sidebar and paper background conflict with the gradient, the gradient wins; the builder decides how the gradient sits behind or around the office layout so that it reads clearly in both Default and Custom.

## Intent (owner's words)

- On the prototype's office screen: "for the actual UI [office screenshot] i love this without the clay thing at the top though but this ui is what i want for the channels and experience across the app. can you redesign the app in this style please same fonts same size but with the gradient styler still and the flexibility with color changing please"
- Earlier the same day: "the channels and threads are important but i love the chat UI and font style and font size you have"
- On onboarding: "i prefer the older onboarding". The onboarding stays exactly as it is in 1.0.12.
- On who builds it: "take this on yourself or give it to an opus 5.5 agent on max reasoning".

Why: the owner wants the everyday app, meaning channels, threads and everything around them, to feel like the calm, roomy office he saw in the prototype, without losing the personal colour controls the app already has.

## The reference (design authority)

The office from the Opus founding prototype is the reference. A screen that differs from it is wrong unless this document says otherwise.

- Commit `cf7f4176e` on branch `colony/spike/founding-colony-opus` (its worktree is archived; the branch and commit remain), folder `prototypes/founding-colony/`. Copies of the three files are in `/Users/mac/worktrees/.lanes/restyle/reference/`; any worktree of the repo can also run `git show cf7f4176e:prototypes/founding-colony/<file>`:
  - `index.html`: office markup
  - `styles.css`: office rules and type scale
  - `app.js`: office behaviour
- Screenshots: `/Users/mac/worktrees/.lanes/restyle/reference/screens/` (`07-office-ready.webp`, `07-office-greeting.webp`, `07-office-general.webp`, `07-office-dm.webp`, `07-office-thread.webp`, `07-office-not-connected.webp`, `07-member-general.webp`).
- The owner's own screenshot of what he loves: `/Users/mac/worktrees/.lanes/restyle/owner-reference-office.png`.

What the reference defines:
- **Type and space.** Manrope with its sizes, weights, line heights and tracking, plus its spacing, radii and light colours. The app already ships Manrope; what changes is the scale and the space.
- **Sidebar.** Company block with its address, then Today, Activity, Channels (private and public markers), Direct messages, Team with presence, Hire, and the signed-in person at the bottom.
- **Channel header.** Privacy label, large channel title and the description.
- **Messages.** Day divider and system events. Each message has an avatar, name and role, and the large text size. Below it: a reply row with avatars, count and last reply time, plus quick replies.
- **Composer.** A large rounded field with mic and send.
- **Thread panel.** Header with the channel name, root message, reply count label, replies, reply composer and "Also send to #channel".

Remove: the "Founded today" picture card at the top of Welcome (the owner calls it "the clay thing at the top").

## Goals

1. Every desktop screen after onboarding uses this look: same font, same sizes, same spacing, same component shapes. Channels, direct messages and threads come first, then everything else:
   - Today (home) and Activity
   - agents, team and hiring
   - the work area (files, canvas, browser, terminal)
   - knowledge, projects, goals and money
   - settings, dialogs, menus, search and huddles
2. Appearance keeps working, and its controls show in the new look:
   - colour mode: light, dark, follow system
   - theme style: Default, or Custom with its two-colour gradient
   - accent colour, the theme catalog, and the conversation message size preference
   The gradient must visibly carry through the new chrome (the owner calls it "the gradient styler"), and changing the accent must recolour the new components. The reference is light only, so the builder designs the dark version in the same language. The reference's text size becomes the default conversation size; the size preference still adjusts it.
3. Nothing is lost. Every feature reachable today stays reachable (owner rule: "all means all").

## Non-goals

- Onboarding: it stays as it is today.
- The mobile app.
- Behaviour changes, new features, and changes to data, relay or Rust. This is presentation and layout only.
  - Where the reference shows something the app does not have, map it to the closest existing feature. If nothing fits, list it as a proposal; do not build it.
- The founding prototype's world art and clay renders.

## Constraints

- Follow `desktop/AGENTS.md`: text sizing and zoom, community switching, the mention editor contract, and the E2E screenshot specs. Text sizing and zoom must keep working.
- Follow the repo `AGENTS.md` Review-Proven Rules, especially rule 7 on accessibility (one owner per actionable label, no duplicate screen-reader stops) and rule 8 on input modalities.
- Do not regress long-channel performance. Keep virtualisation working and follow the `React.memo` rule in AGENTS.md gotcha 6.
- Copy: never em dashes, never the word "Buzz".
- Process:
  - No local cargo; GitHub CI is the gate.
  - Commit and push with `LEFTHOOK=0`, and commit with `git commit -s` plus the Co-Authored-By trailer.
  - One draft PR into develop, kept as a draft until the owner approves the final proof. The builder never merges.
- Tests: build E2E with `pnpm build:e2e`. Update the specs the restyle changes, and run the affected specs locally in both the smoke and the integration projects.
- Safety: never touch the owner's real home data folders, keychain or secrets. Headless browsers use a throwaway profile with `--use-mock-keychain --password-store=basic`.

## Decided (coordinator's calls; the owner may override)

- **Builder:** one Claude Opus 5.5 agent at max effort (the owner's choice), in its own Superset workspace on branch `feat/app-restyle` from `origin/develop`.
- **Phase 1:** shell, sidebar, channel view, messages, threads, composer, direct messages, and Appearance (light, dark, custom gradient, accents). Ends at a checkpoint with a proof page for the owner.
- **Phase 2:** every other surface listed in Goal 1. The builder continues straight after the Phase 1 checkpoint, and owner feedback is relayed while it works.
- **Proof:** every surface at 1440x900 in light, dark, one custom gradient and two accents, next to the reference where one exists, published as a Superset page.
- **Merge:** merge into develop only after the owner approves the final proof, so develop stays releasable while the restyle is half done. It ships in the next release the owner promotes.
- **Gate screens keep the onboarding look.** These full-screen screens share onboarding's components and stay exactly as in 1.0.12, even though some can appear after onboarding: "Join or create a community" (`WelcomeSetup`), "Community connection failed" (`CommunityApplyErrorScreen`), "Not a member yet", the keyring-locked and recovery screens, and the add-business flow opened from inside the app. Restyling them would change onboarding, which must stay as it is.

## Left to the builder

- The token mapping: how the reference's values become the app's CSS variables (`desktop/src/shared/styles/globals/theme.css`, `typography.css` and so on).
- The dark version, in the reference's language.
- Where the gradient appears in the new chrome and how strong it is, as long as both Default and Custom styles visibly apply.
- The look of surfaces the reference does not show, extrapolated from it.
- Sidebar section order and naming, mapped to today's features.
