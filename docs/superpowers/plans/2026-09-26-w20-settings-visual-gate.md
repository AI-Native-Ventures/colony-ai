# W20 Settings Visual Gate Plan

> **For agentic workers:** Execute this plan inline in the W20 settings worktree. Keep each completed sub-slice in a signed local commit. Do not push before every local proof gate passes.

**Goal:** Bring data-backed W20 settings routes into measured fidelity with frozen design r19, wire the channel template picker and moderation action failure, and exclude routes whose required data or failure states remain undesigned.

**Architecture:** Keep behavior inside the existing settings and feature flows. Match the frozen r19 screens in the settings shell and feature CSS, keep appearance preferences scoped to stable person and business identifiers, and use existing relay or local data sources. Route visual fixtures through the visual harness and verify changed interactions in production-bound smoke specs.

**Tech Stack:** React 19, TypeScript, CSS, Tailwind, Playwright, Biome, Vite, and the existing desktop settings and channel template hooks.

## Files and responsibilities

- `desktop/src/features/settings/ui/SettingsView.css`: W20 settings shell, route layout, typography, background material, and appearance grid.
- `desktop/src/features/settings/ui/AppearanceSettingsPanel.tsx` and `AppearanceSettingsControls.tsx`: appearance behavior, atomic save, scope, and controls.
- `desktop/src/features/settings/ui/SettingsView.tsx`, `SettingsPanels.tsx`, and `SettingsAdditionalSections.tsx`: settings route resolution and the nine group navigation model.
- `desktop/src/features/settings/ui/ModerationQueueCard.tsx`: live moderation queue and real action error path.
- `desktop/src/features/sidebar/ui/CreateChannelFormFields.tsx` and `desktop/src/features/sidebar/lib/useCreateChannelForm.ts`: actual channel creation flow and template selection state.
- `desktop/src/features/channel-templates/`: reusable channel template picker backed by the existing template query.
- `desktop/tests/visual/w20-settings-manifest.json` and `desktop/tests/visual/visual-compare.spec.ts`: r19 route fixtures and measured geometry.
- `desktop/tests/e2e/channels.spec.ts`, `settings-section-layout.spec.ts`, and relevant settings specs: behavior assertions that follow any UI change.
- `desktop/tailwind.config.js`: named zoom-safe heading token only if the frozen title size has no matching existing token.
- `desktop/tests/visual/w20-settings-baseline-summary.md`: retained baseline and final route measurements after generated galleries are removed.

## Task 1: Fix shared appearance fidelity

- [ ] Compare frozen r19 and app geometry for the settings sidebar, top bar, section bar, content grid, controls column, live preview, and footer at 1440x900 and 1728x1117.
- [ ] Match the field background sizing and position to the frozen `.app-shell` treatment. Keep the existing frozen light and dark SVG assets.
- [ ] Compare layout, panel widths, padding, text sizes, colors, radii, borders, and preview rendering against `20260926-r19/app/workspace/settings.css`.
- [ ] Correct shared settings-shell causes before route-specific spacing.
- [ ] Capture all four appearance variants and record exact changed-pixel percentage plus region measurements.

## Task 2: Match data-backed settings routes

- [ ] Use the frozen workspace routes for Appearance, themes, profile/avatar, notifications, privacy, archive/recovery, custom emoji, moderation queue, voice library, harness lifecycle, and feedback.
- [ ] Use existing data and operations. Preserve designed empty, denied, and failure states; do not substitute fixture success in production paths.
- [ ] Compare each route at both required viewports and themes. Record before and after percentages and measure the cause of each residual above 3%.
- [ ] Add only visual-harness fixture values needed to reproduce the frozen records.

## Task 3: Wire the two designed flows

- [ ] Map frozen `desktop/#12/pick` to the template picker inside the existing channel creation flow. Keep settings template creation and editing in the settings route.
- [ ] Map frozen `desktop/#14/moderation-failed` to the real moderation action failure. Preserve the report and selected action so the user can retry after the existing server operation fails.
- [ ] Update `desktop/tests/e2e/channels.spec.ts` and the focused moderation spec to assert the frozen UI and preserve product behavior assertions.

## Task 4: Exclude unsupported data routes

- [ ] Remove navigation and visual manifest entries for compute hosts, Blocks catalog and permissions, Business defaults and connections, and AI provider connections when their underlying source is absent.
- [ ] Prevent direct entry into a blank panel by using the settings route's existing fallback behavior.
- [ ] Record the exact unmet state under `NEEDS_DESIGN`: items 55 through 58 from the handoff ledger.

## Task 5: Run acceptance gates

- [ ] Grep `desktop/tests/e2e`, `desktop/src/**/*.test.*`, and `mobile/test` for every changed label, role, test id, route, and control.
- [ ] Run `pnpm build:e2e`, then each affected Playwright spec one at a time in `mcr.microsoft.com/playwright:v1.60.0-noble` with two CPUs.
- [ ] Run focused Biome, TypeScript, `pnpm check:px-text`, and affected unit tests.
- [ ] Run the visual harness with the r19 manifest at both viewports in light and dark, then update the retained summary and remove the task gallery.
- [ ] Push only after the local gates pass, open or update the draft PR to `codex/phase2-integration`, and wait for all hosted checks including the full smoke suite to pass.
