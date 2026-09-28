# W20 settings visual metrics, r19 final audit

Frozen reference: `20260926-r19`. Verification command `python3 verify.py` in that package passed: 329 frozen files match.
Capture set: `/tmp/w20-settings-r19-final-20260928-0618` (192 captures, 48 routes, four variants per route: light/dark at 1440x900 and 1728x1117). The gallery was temporary and is removed after these metrics are recorded. Comparison is exact RGB with no masks or tolerance. Route percentages below are the mean of four captures; mean RGB is mean absolute channel delta.
Baseline is the previously saved r17 summary. Across the 47 route IDs present in both sets, the route-mean average changed-pixel ratio moved from 41.17% to 16.03%, a 25.14 percentage-point reduction. Including the new `desktop-08-comfortable` capture, the 48-route current average is 17.10%. These are exact pixel counts, not a perceptual score.

Cause codes point to the measured residuals below. Rows with a workspace shell code have no route-specific body mismatch above 3% unless listed separately. The per-route cause is included even when a residual is below 3%.

## Per-route before and current

| Route | Baseline | Current | Change | Current range | Mean RGB | Residual cause |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| `desktop-06-camera` | 59.76% | 5.98% | -53.78 pp | 5.47% to 6.51% | 2.677 | AVATAR |
| `desktop-06-cancelled` | 58.47% | 4.28% | -54.19 pp | 4.11% to 4.45% | 2.489 | AVATAR |
| `desktop-06-choose` | 50.11% | 9.05% | -41.06 pp | 8.50% to 9.59% | 3.568 | AVATAR |
| `desktop-06-crop` | 73.38% | 7.07% | -66.31 pp | 6.68% to 7.46% | 2.742 | AVATAR |
| `desktop-06-failed` | 80.27% | 5.80% | -74.47 pp | 5.35% to 6.23% | 2.083 | AVATAR |
| `desktop-06-invalid` | 60.92% | 8.88% | -52.04 pp | 8.45% to 9.31% | 4.131 | AVATAR |
| `desktop-06-profile` | 58.47% | 4.28% | -54.19 pp | 4.11% to 4.45% | 2.489 | AVATAR |
| `desktop-06-saved` | 62.41% | 4.24% | -58.17 pp | 4.08% to 4.39% | 2.518 | AVATAR |
| `desktop-06-saving` | 52.48% | 5.43% | -47.05 pp | 4.86% to 6.00% | 2.716 | AVATAR |
| `desktop-06-upload` | 52.67% | 5.75% | -46.92 pp | 5.19% to 6.31% | 3.019 | AVATAR |
| `desktop-07-confirm` | 8.26% | 6.68% | -1.58 pp | 4.81% to 8.25% | 3.248 | SIGNOUT |
| `desktop-08-catalog` | 67.86% | 67.10% | -0.76 pp | 33.67% to 97.74% | 17.739 | ROUTE08 |
| `desktop-08-comfortable` | n/a | 67.10% | new | 33.67% to 97.74% | 17.739 | ROUTE08 |
| `desktop-08-compact` | 67.54% | 66.80% | -0.74 pp | 33.14% to 97.74% | 17.570 | ROUTE08 |
| `desktop-08-custom` | 69.87% | 69.55% | -0.32 pp | 35.99% to 100.00% | 21.951 | ROUTE08 |
| `desktop-08-saved` | 68.19% | 67.41% | -0.78 pp | 35.13% to 97.74% | 17.547 | ROUTE08 |
| `desktop-08-spacious` | 67.91% | 67.16% | -0.75 pp | 33.78% to 97.74% | 17.717 | ROUTE08 |
| `desktop-11-library` | 58.13% | 2.25% | -55.88 pp | 1.42% to 3.07% | 0.834 | VOICE-LIBRARY |
| `desktop-12-pick` | 58.37% | 2.60% | -55.77 pp | 2.10% to 3.11% | 1.616 | TEMPLATE-PICKER |
| `desktop-14-moderation-failed` | 60.44% | 0.64% | -59.80 pp | 0.58% to 0.70% | 0.368 | MODERATION-FAIL |
| `desktop-15-diagnostics` | 61.11% | 7.99% | -53.12 pp | 7.81% to 8.18% | 4.839 | FEEDBACK |
| `desktop-15-failed` | 60.42% | 9.29% | -51.13 pp | 9.13% to 9.46% | 5.683 | FEEDBACK |
| `desktop-15-form` | 55.04% | 6.93% | -48.11 pp | 6.71% to 7.16% | 4.153 | FEEDBACK |
| `desktop-15-sending` | 53.87% | 6.31% | -47.56 pp | 5.96% to 6.53% | 4.410 | FEEDBACK |
| `desktop-15-sent` | 53.82% | 4.88% | -48.94 pp | 4.71% to 5.07% | 3.487 | FEEDBACK |
| `workspace-account` | 27.69% | 12.66% | -15.03 pp | 9.82% to 16.71% | 2.568 | PROFILE |
| `workspace-account-accessibility` | 29.81% | 16.04% | -13.77 pp | 13.00% to 20.16% | 4.162 | ACCESSIBILITY |
| `workspace-account-archive` | 14.92% | 11.77% | -3.15 pp | 8.99% to 15.53% | 1.973 | SHELL |
| `workspace-account-audit` | 15.13% | 11.98% | -3.15 pp | 9.10% to 15.78% | 2.032 | SHELL |
| `workspace-account-moderation` | 15.35% | 12.46% | -2.89 pp | 9.86% to 16.21% | 2.368 | SHELL |
| `workspace-account-notifications` | 29.18% | 16.16% | -13.02 pp | 13.14% to 20.25% | 4.225 | NOTIFICATIONS |
| `workspace-account-recovery` | 15.32% | 12.44% | -2.88 pp | 9.54% to 16.35% | 2.404 | SHELL |
| `workspace-account-security` | 23.03% | 13.03% | -10.00 pp | 10.25% to 16.81% | 2.554 | SECURITY |
| `workspace-settings` | 17.89% | 13.28% | -4.61 pp | 10.47% to 17.45% | 3.151 | BUSINESS-PROFILE |
| `workspace-settings-admin` | 15.13% | 11.98% | -3.15 pp | 9.10% to 15.78% | 2.032 | SHELL |
| `workspace-settings-appearance` | 24.78% | 12.05% | -12.73 pp | 9.49% to 15.35% | 1.646 | SHELL |
| `workspace-settings-device` | 18.79% | 14.22% | -4.57 pp | 10.92% to 18.47% | 3.498 | DEVICE |
| `workspace-settings-emoji` | 27.95% | 13.15% | -14.80 pp | 10.25% to 17.10% | 2.706 | EMOJI |
| `workspace-settings-experiments` | 24.89% | 13.43% | -11.46 pp | 10.29% to 17.51% | 2.849 | EXPERIMENTS |
| `workspace-settings-people` | 14.05% | 14.22% | +0.17 pp | 11.17% to 18.38% | 3.694 | PEOPLE |
| `workspace-settings-shortcuts` | 33.15% | 15.76% | -17.39 pp | 12.89% to 19.69% | 3.622 | SHORTCUTS |
| `workspace-settings-storage` | 23.25% | 14.92% | -8.33 pp | 11.71% to 19.10% | 3.957 | STORAGE |
| `workspace-settings-templates` | 14.26% | 13.13% | -1.13 pp | 10.28% to 17.06% | 2.694 | TEMPLATES |
| `workspace-settings-theme-applied` | 26.47% | 11.47% | -15.00 pp | 8.71% to 15.09% | 1.439 | SHELL |
| `workspace-settings-theme-preview` | 26.40% | 11.55% | -14.85 pp | 8.80% to 15.18% | 1.461 | SHELL |
| `workspace-settings-themes` | 42.81% | 14.12% | -28.69 pp | 11.34% to 17.04% | 1.753 | THEMES |
| `workspace-settings-updates` | 16.01% | 13.15% | -2.86 pp | 10.07% to 17.16% | 3.222 | UPDATES |
| `workspace-settings-voice` | 19.01% | 14.22% | -4.79 pp | 11.22% to 18.29% | 2.685 | VOICE |

## Measured residual causes

### SHELL: shared workspace field, sidebar, and chrome

At 1440x900 on workspace Appearance, whole-screen change is 9.49% with mean RGB delta 1.491. The settings sidebar bounds match at x=1,y=8,w=238,h=884; topbar bounds match at x=240,y=9,w=1191,h=52; main surface bounds match at x=240,y=61,w=1191,h=830. The app inner surface is transparent over the paper canvas as the reference expects.

The 1440x900 Appearance field/sidebar ROI (x=0..240) has 35.0% exact changed pixels, 5.4% with max-channel delta above 4, 4.1% above 16, and mean RGB delta 1.56. At (20,600), reference RGB is [246,220,232] and app RGB is [246,220,231], a one-channel difference. At 1728x1117 the same light ROI is 46.9% exact changed, 4.5% above delta 4, and mean RGB delta 1.38. In dark mode the ROI is 72.0% to 76.9% exact changed, but only 4.4% to 5.2% above delta 4, with mean RGB delta 1.87 to 2.02. This low-amplitude field and text-edge mismatch drives much of the full-screen score.

The Appearance topbar changes 2.3% to 2.8% of pixels in light mode with mean RGB delta 1.42 to 1.80; its geometry matches. The inner section bar ranges from 1.9% to 8.2% exact changed depending on its selected label and underline, with mean RGB delta 1.1 to 4.4. Appearance content is 1.54% exact changed at light 1440x900, with 0.38% above delta 4 and mean RGB delta 0.208. The whole-screen Appearance score is therefore mostly shell pixels, not its controls.

Workspace theme preview and applied routes have 0.3% to 0.6% exact changes in the content ROI; their full-screen residuals come from the shared shell and section bar. Workspace archive, audit, moderation, and recovery have 0.8% to 2.2% content changes at 1440x900. Their remaining full-screen scores are likewise shell and section-bar pixels.

### AVATAR: dialog states

The avatar captures are clipped to the 540px-wide dialog, so the 4.24% to 9.05% route means do not include the workspace field. Across those routes, the fixed dialog header changes 5.38% to 5.51% of pixels, with mean RGB delta 1.82 to 3.49, localized around the title and close icon. The choose state body changes 11.83% of pixels, 10.27% above delta 4, mean RGB delta 4.49; the reference and app differ in avatar-option/button painting and file/camera control edges. The invalid-file body changes 10.00%, 9.75% above delta 4, mean RGB delta 4.78; the alert and drop area have 3px to 4px vertical placement/height differences. Crop changes concentrate in the circle outline and footer controls: body 6.71% exact changed and footer 11.11%. Profile/cancelled/saved body states are lower at 4.01% to 4.34%, with the same text and small control edge differences.

### SIGNOUT: confirmation dialog

`desktop-07-confirm` is the same 540px dialog and copy on both sides. Its mean is 6.68%; the body changes 4.98% and the 72px footer changes 13.38% of pixels. The residual is localized to the confirmation buttons, footer divider, title, and text edges; screenshot geometry and displayed state match.

### ROUTE08: theme catalog and density route mapping

All `desktop-08-*` cases currently point to `/#/settings?section=appearance`, while frozen `/desktop/#08/catalog` is a standalone theme-catalog-and-density screen. The catalog capture shows four built-in theme previews, a theme selector, and density controls; the mapped workspace Appearance route shows the r19 workspace Appearance screen. The measured result is 66.80% to 69.55% route mean, with dark captures 97.74% to 100% changed. This is a screen-composition/route-mapping mismatch, not raster noise. No alternate app route is represented in the manifest for the separate catalog/density reference; retain this as a route-mapping decision instead of inventing a new visible route.

### VOICE-LIBRARY: standalone library crop

`desktop-11-library` uses a matched 1191x245 crop. The same Voice library and Saved voices headings appear on both sides; route mean is 2.25%, range 1.42% to 3.07%, mean RGB delta 0.834. The residual is small heading/rule text-edge rendering. No voice records are seeded in the app visual fixture, so no sample voice was added to the app.

### TEMPLATE-PICKER: channel creation

`desktop-12-pick` compares the designed picker in the channel-creation flow. The three template names and descriptions match. Reference crop bounds are x=238,y=8,w=1191,h=882; app bounds are x=240,y=9,w=1191,h=882, a measured 2px horizontal and 1px vertical offset. Route mean is 2.60%, range 2.10% to 3.11%, mean RGB delta 1.616. The residual is the crop offset plus button and text-edge rendering.

### MODERATION-FAIL: action failure state

`desktop-14-moderation-failed` is a designed failure-panel crop. Its route mean is 0.64%, range 0.58% to 0.70%, mean RGB delta 0.368. The reported-message text, action, failure copy, and retry affordance match.

### FEEDBACK: dialog states

The feedback states compare 540px-wide dialog crops. Their route means are 4.88% to 9.29%. In the failed state, 6.10% of header pixels, 9.72% of body pixels, and 10.06% of footer pixels change; body mean RGB delta is 5.63. The form, textarea, diagnostic checkbox, alert and buttons are present with matching copy. The remaining change is concentrated on form-control borders/shadows, button bounds, and text rendering. The sending state has 12.40% footer pixels changed, driven by the progress button/status area; the sent state has a 1.93% footer residual.

### Route-specific content and behavior differences

- `workspace-account-accessibility`: content is 7.47% exact changed at light 1440x900, 7.14% above delta 4, and 5.37% above 16. The reference presents boxed Reading and motion controls plus a keyboard card. The app presents summary rows and a longer shortcut list.
- `workspace-account-notifications`: content is 7.59% exact changed, 7.44% above delta 4, and 5.16% above 16 at light 1440x900. The reference presents Channel messages, Agent updates, client approvals, invoice follow-ups, quiet hours, Save activity preferences, and Desktop alerts. The app still presents while-viewing, per-event sound, and Home badge controls. Existing UI tests cover Home badge behavior, so that behavior was not silently removed.
- `workspace-account-security`: content is 3.71% exact changed and 3.07% above delta 16 at light 1440x900. The reference shows email/password reset/change controls and signed-in devices; the app shows local sign-out and data-removal actions, which are represented separately by `desktop-07`.
- `workspace-settings-device`: content is 5.12% exact changed, 5.03% above delta 4, and 4.61% above 16 at light 1440x900. The reference includes Connected work rows and a waiting state in addition to local preferences. The app currently exposes the two local preference toggles. The separate r19 `desktop/#10` Compute hosts screen is designed, but host registry data is not available from the current API.
- `workspace-settings-emoji`: content is 3.26% exact changed at light 1440x900. The reference marks the three listed emoji as Built in; the app shows delete affordances and a styled upload form where the reference uses native file controls.
- `workspace-settings-experiments`: content is 3.80% exact changed at light 1440x900. The reference has an empty Experiments state; the app exposes five existing feature toggles. The discrepancy is content and control count, not shell geometry.
- `workspace-settings-people`: content is 5.13% exact changed, 4.98% above delta 4, and 4.64% above 16 at light 1440x900. Both screens contain the same two people, but the reference uses a member table plus Client access card and the app uses an Invites page with search and member cards.
- `workspace-settings-shortcuts`: content is 6.80% exact changed, 6.71% above delta 4, and 4.45% above 16 at light 1440x900. The app lists additional live keyboard commands and explanations absent from the shorter reference list; the commands were retained rather than deleting working behavior.
- `workspace-settings-storage`: content is 6.11% exact changed, 6.00% above delta 4, and 5.19% above 16 at light 1440x900. The reference shows device storage totals and an archive summary. The app shows real observer-frame metrics and channel subscription controls; synthetic storage totals were not inserted.
- `workspace-settings-updates`: content is 3.33% exact changed at light 1440x900. The reference is a release-status preview with preview-only actions; the app preserves the real Check for updates action. No simulated update result was added.
- `workspace-settings-voice`: content is 4.91% exact changed at light 1440x900. The app disables voice choice/preview/add controls when the local voice source is unavailable; the reference shows those controls enabled. No fake voice source was added.
- `workspace-settings-themes`: content is 4.14% exact changed but only 1.33% is above delta 4 and mean RGB delta is 0.51 at light 1440x900. The theme cards and selection match; the residual is mostly card and label edge rendering.
- `workspace-settings-templates`: content is 3.18% exact changed, 3.09% above delta 4, and 2.50% above 16 at light 1440x900. Template names/descriptions and actions match; the residual is row/button spacing and text edges.
- `workspace-account`: content is 3.24% exact changed at light 1440x900. Profile values match; the reference renders Timezone as a select and the app currently renders a text input.
- `workspace-settings`: content is 3.83% exact changed at light 1440x900. The reference has a business name, email, timezone, and About form; the app shows workspace name, relay URL, and logo upload. The product data shape is different, not just the shared shell.

## Omitted routes and open items

### NEEDS_DESIGN

- Desktop privacy settings: r19 contains the mobile `settings/privacy` screen only. There is no frozen desktop privacy route or state, so no desktop privacy UI was added.
- Mesh sharing panel: `MeshComputeSettingsCard` exposes the shipped local model selection and mesh start/stop controls in the existing Compute settings section. The frozen compute screens show a host list and do not represent this panel. Design should decide whether the host list and local sharing panel share one screen.

### NEEDS_API

- Compute host registry and worker list. Existing `tauriMesh` calls report this device's mesh runtime, installed models and serving usage; they do not list business hosts or workers.
- Blocks catalog manifest and business permission records. The local channel template store is a separate feature.
- Business defaults read and atomic save for default reviewer and external-action policy. Failed and saved states also need a durable write result, with the form draft retained on failure.
- Business connection records and access scope. No list or update API exists.
- AI source records and provider connection status. Global agent configuration exposes one provider and model default, not provider connections; new AI connection surfaces remain under the owner hold.
- Credential store metadata and availability. Existing OS-backed storage serves identity and device pairing; there is no business credential catalog API.

The company-v8 package supplies designed recovery routes for these states. They remain out of this implementation until real data and write APIs exist; no sample records or simulated retry success are shown.

### OWNER HOLD and route mapping

- Agent directory, agent profile tabs, create-agent screens, Teams, Power/usage, and the harness lifecycle route are excluded by the owner hold. Existing nine-group settings navigation is preserved as required by r19.
- The desktop `#08` theme catalog and density screen has a design, but its relationship to the separate r19 workspace `settings/themes` route is not represented as one app route. The 66.80% to 69.55% comparison is invalid for visual signoff until the route mapping is resolved. This is a route-mapping conflict, not a missing design.
- Notifications has a design/content conflict with existing Home badge and sound controls. Existing behavior was retained and the visual conflict is recorded above.
- Hosted-community UI, Deployment console UI, and private-key export/import UI are removed from the settings surface. Shared code remains only where other retained identity paths use it.

## Test and capture evidence

- R19 frozen-package verification: passed, 329 files match.
- Desktop visual harness: 192 of 192 captures completed across 48 routes, two viewports, and light/dark themes. The results above report exact changes and do not claim every route is under 3%.
- Desktop E2E: 76 affected smoke cases passed in the Linux Playwright v1.60.0 Noble image with `--cpus=2`, after `pnpm build:e2e`.
- Desktop TypeScript: `tsc --noEmit` passed from `desktop/` using the installed binary. The pnpm wrapper tried to purge `node_modules` and aborted without a TTY, so no package cleanup was run.
- Biome: the two changed CSS/E2E files passed with the desktop Biome config. Three existing `noDescendingSpecificity` warnings remain in avatar-control CSS.
- px-text: passed with `node scripts/check-px-text.mjs` from `desktop/`.
- Settings unit tests: 233 passed in 17 suites before the final CSS-only commit; the final commit changes no settings logic.

The retained summary is the metrics artifact. Temporary image galleries were deleted after the route, region, and residual measurements were extracted.
