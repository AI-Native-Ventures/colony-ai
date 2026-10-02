# Mobile v5 M1 Foundation and Navigation

## Acceptance gate

Implement the approved 27 September 2026 mobile v5 foundation on
`codex/m-v5-foundation`. The slice passes when the shell, route-backed Company
hub, shared identity components, and unchanged sample feature screens render
against the frozen v5 direction at 390x844 and 412x915 in light and dark
themes; route and theme tests pass; and the full mobile suite passes.

## Constraints

- `20260927-mobile-v5/APPROVED.md` and its verified frozen copy define the
  design boundary.
- Keep Manrope and preserve all existing capabilities and route stacks.
- Compose Today, Chat, and Company in the shared shell. Keep Activity reachable
  from Today.
- Show a Company destination only when the app route registry has a builder for
  its typed route. The current app has no Team, Goals, Work, Workflows, or
  business-area route builders. Use the existing Settings page builder for the
  reference's Appearance & preferences entry so Company remains actionable.
- Keep feature screens as-is except where they consume shared shell or identity
  components. Do not copy mockup data or scripted behavior.
- Honor reduced motion. Do not add literal colors or text sizes to widgets.
- Update dependent tests in the same slice and run the full mobile suite.

## Implementation sequence

1. Add v5 plum, lilac, apricot, surface, identity, and semantic typography
   tokens to the shared theme. Apply shared card, sheet, button, shell, and
   reduced-motion treatments through theme and shared components.
2. Replace the four-tab shell with Today, Chat, and Company while retaining
   independent nested navigation for each destination. Move Activity access
   to the existing Today entry point.
3. Add a Company hub that filters its reference entries through the registered
   typed route builders. Route Appearance & preferences through the existing
   Settings page builder. No unregistered destination opens an empty page.
4. Add reusable person and agent identity avatar and row components in the
   shared layer, with focused widget coverage.
5. Update home, shell, theme, and identity tests. Search desktop and mobile test
   trees for affected labels and route identifiers, then run affected tests and
   the full mobile suite.
6. Capture shell, Company hub, and representative existing screens at both
   target sizes and brightness modes. Compare against the verified frozen
   reference and report numeric visual deltas per route.
7. Commit signed changes, push when local gates pass, and verify all hosted PR
   checks before reporting the slice ready.

## Needs design

If a required state has no frozen reference, stop work on that state and report
its route and situation under `NEEDS_DESIGN` instead of inventing a screen.
