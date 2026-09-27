# W20 settings visual metrics, r19 current audit

This summary stores route means, ranges, and measured residual causes after the Appearance shell alignment and moderation failure alignment. Capture gallery: `/tmp/w20-settings-r19-data-backed-final` (188 captures, 47 routes). Each route has light/dark captures at 1440x900 and 1728x1117. Exact RGB comparison, no masks or tolerance; mean RGB delta is mean absolute channel delta across pixels.

Binding reference: 20260926-r19. Its verifier passed: 329 frozen files match. The earlier baseline is the 260-capture r17 summary; r17 workspace settings routes are unchanged in r19. For the same 47 route IDs, baseline route-mean average was 41.17% and this matrix route-mean average is 18.93%. These exact-pixel percentages include color compositing and text-edge changes; they are not a perceptual score.

The matrix completed before the channel picker button-color fix was committed. The `desktop-12-pick` values below are pre-fix and must be recaptured before final signoff.

The capture excludes owner-held agent surfaces, unavailable states covered by NEEDS-DESIGN items 55-58, and any route without a current real data source. The channel template picker and moderation action failure are captured in their real app flows.

## Per-route before and current

| Route | Baseline mean | Current mean | Change | Current range | Mean RGB delta |
| --- | ---: | ---: | ---: | ---: | ---: |
| `desktop-06-camera` | 59.76% | 5.96% | -53.80 pp | 5.42% to 6.50% | 2.928 |
| `desktop-06-cancelled` | 58.47% | 2.01% | -56.46 pp | 1.55% to 2.52% | 1.157 |
| `desktop-06-choose` | 50.11% | 9.06% | -41.05 pp | 8.52% to 9.61% | 3.602 |
| `desktop-06-crop` | 73.38% | 6.40% | -66.98 pp | 5.93% to 6.87% | 2.729 |
| `desktop-06-failed` | 80.27% | 4.93% | -75.34 pp | 4.31% to 5.54% | 2.075 |
| `desktop-06-invalid` | 60.92% | 8.49% | -52.43 pp | 8.13% to 8.86% | 4.365 |
| `desktop-06-profile` | 58.47% | 2.01% | -56.46 pp | 1.55% to 2.52% | 1.157 |
| `desktop-06-saved` | 62.41% | 6.65% | -55.76 pp | 5.34% to 8.25% | 1.707 |
| `desktop-06-saving` | 52.48% | 5.45% | -47.03 pp | 4.87% to 6.02% | 2.889 |
| `desktop-06-upload` | 52.67% | 5.76% | -46.91 pp | 5.21% to 6.30% | 3.108 |
| `desktop-07-confirm` | 8.26% | 8.26% | -0.00 pp | 6.62% to 9.75% | 3.761 |
| `desktop-08-catalog` | 67.86% | 63.64% | -4.22 pp | 24.71% to 100.00% | 18.601 |
| `desktop-08-compact` | 67.54% | 63.27% | -4.27 pp | 24.09% to 100.00% | 18.382 |
| `desktop-08-custom` | 69.87% | 63.52% | -6.35 pp | 24.61% to 100.00% | 17.587 |
| `desktop-08-saved` | 68.19% | 64.00% | -4.19 pp | 26.44% to 100.00% | 18.378 |
| `desktop-08-spacious` | 67.91% | 63.71% | -4.20 pp | 24.88% to 100.00% | 18.572 |
| `desktop-11-library` | 58.13% | 51.90% | -6.23 pp | 3.18% to 100.00% | 4.929 |
| `desktop-12-pick` | 58.37% | 51.58% | -6.79 pp | 2.59% to 100.00% | 4.409 |
| `desktop-14-moderation-failed` | 60.44% | 2.00% | -58.44 pp | 1.99% to 2.01% | 0.664 |
| `desktop-15-diagnostics` | 61.11% | 21.81% | -39.30 pp | 21.37% to 22.25% | 8.067 |
| `desktop-15-failed` | 60.42% | 16.53% | -43.89 pp | 12.19% to 20.86% | 8.703 |
| `desktop-15-form` | 55.04% | 9.67% | -45.37 pp | 9.23% to 10.12% | 7.123 |
| `desktop-15-sending` | 53.87% | 6.96% | -46.91 pp | 6.03% to 7.75% | 5.091 |
| `desktop-15-sent` | 53.82% | 7.51% | -46.31 pp | 7.26% to 7.75% | 7.115 |
| `workspace-account` | 27.69% | 13.78% | -13.91 pp | 10.43% to 18.35% | 1.536 |
| `workspace-account-accessibility` | 29.81% | 15.28% | -14.53 pp | 12.26% to 19.71% | 2.797 |
| `workspace-account-archive` | 14.92% | 12.29% | -2.63 pp | 8.93% to 16.38% | 0.940 |
| `workspace-account-audit` | 15.13% | 12.46% | -2.67 pp | 9.19% to 16.57% | 0.977 |
| `workspace-account-moderation` | 15.35% | 12.84% | -2.51 pp | 9.66% to 17.04% | 1.220 |
| `workspace-account-notifications` | 29.18% | 16.36% | -12.82 pp | 13.36% to 20.82% | 3.031 |
| `workspace-account-recovery` | 15.32% | 12.84% | -2.48 pp | 9.58% to 17.02% | 1.334 |
| `workspace-account-security` | 23.03% | 13.92% | -9.11 pp | 10.74% to 18.41% | 1.495 |
| `workspace-settings` | 17.89% | 13.66% | -4.23 pp | 10.59% to 18.05% | 2.021 |
| `workspace-settings-admin` | 15.13% | 12.46% | -2.67 pp | 9.19% to 16.57% | 0.977 |
| `workspace-settings-appearance` | 24.78% | 12.55% | -12.23 pp | 9.29% to 16.27% | 0.628 |
| `workspace-settings-device` | 18.79% | 14.33% | -4.46 pp | 11.38% to 18.79% | 2.293 |
| `workspace-settings-emoji` | 27.95% | 13.54% | -14.41 pp | 10.46% to 17.86% | 1.663 |
| `workspace-settings-experiments` | 24.89% | 13.62% | -11.27 pp | 10.59% to 17.95% | 1.646 |
| `workspace-settings-people` | 14.05% | 13.25% | -0.80 pp | 10.06% to 17.51% | 1.753 |
| `workspace-settings-shortcuts` | 33.15% | 14.89% | -18.26 pp | 11.66% to 19.13% | 2.268 |
| `workspace-settings-storage` | 23.25% | 14.91% | -8.34 pp | 11.90% to 19.32% | 2.663 |
| `workspace-settings-templates` | 14.26% | 13.40% | -0.86 pp | 10.27% to 17.67% | 1.619 |
| `workspace-settings-theme-applied` | 26.47% | 25.79% | -0.68 pp | 20.84% to 32.11% | 3.102 |
| `workspace-settings-theme-preview` | 26.40% | 25.71% | -0.69 pp | 20.78% to 32.02% | 2.934 |
| `workspace-settings-themes` | 42.81% | 12.60% | -30.21 pp | 9.21% to 16.77% | 0.904 |
| `workspace-settings-updates` | 16.01% | 13.55% | -2.46 pp | 10.52% to 17.87% | 2.150 |
| `workspace-settings-voice` | 19.01% | 14.63% | -4.38 pp | 11.68% to 19.09% | 1.729 |

## Measured shared-shell residual

At light 1440x900 on workspace Appearance, whole-screen changed pixels are 9.29% (mean RGB delta 0.559). The measured main surface is x=240,y=61,w=1191,h=830 and the heading/control grid bounds match the reference. Region measurements:

| Region | Exact changed pixels | Above channel delta 4 | Above 16 | Mean RGB delta |
| --- | ---: | ---: | ---: | ---: |
| Field and sidebar, x=0..240 | 32.19% | 1.79% | 1.17% | 0.91 |
| Top bar, x=240..1431 y=9..61 | 20.01% | 2.69% | 0.46% | 0.75 |
| Inner section bar | 2.55% | 2.40% | 2.14% | 2.17 |
| Appearance content | 1.52% | 0.35% | 0.29% | 0.21 |

The field asset URL and file content match. At pixel (20,600), reference RGB is [246,220,232] and app RGB is [246,220,231], a one-channel delta. In the top bar, reference has transparent background over the parent while the app paints #fffefd; at pixel (400,55), the reference is [255,254,253] and the app is [254,253,252]. These large-area low-amplitude differences explain most workspace route exact-pixel counts. Appearance's settings content itself has 1.52% exact changed pixels in this capture, with only 0.35% above delta 4.

## Route-specific residuals and dispositions

- `workspace-account-notifications` is a content mismatch in the current capture. The reference shows Activity preferences (Channel messages, Agent updates, client approvals, invoice follow-ups, quiet hours, and save) plus one Desktop alerts control. The app shows the old Notify while viewing, per-event sound and Home badge controls. The content region is 7.12% exact changed and 6.82% above delta 4 at light 1440x900. The user-facing Home badge control also has an existing product-behavior test; resolution is pending owner direction.
- `workspace-settings-theme-preview` and `workspace-settings-theme-applied` have content-region changed ratios 24.20% and 24.33% respectively at light 1440x900; above-delta-4 ratios are 14.47% and 14.52%. The captured reference uses a 950x475 workspace preview, while the app preview content has several measured 1-5 px offsets in nested message/card elements and different preview/avatar fills. This remains a measured layout/content residual, not a shell raster explanation.
- `desktop-08-*` captures a separate frozen Theme catalog and density screen. The current manifest routes those cases to the workspace Appearance page; light cases average 24.09% to 29.95% and dark cases are 100% exact changed. This is a route/screen composition mismatch and is not folded into the workspace shell cause.
- `desktop-11-library` has the same saved voice record in light mode (4.41% at 1440x900, 3.18% at 1728x1117). The app's heading/list/button placement differs from the standalone reference shell. Dark exact-pixel changes are 100%; the dark standalone prototype background and lavender accent differ from the workspace app's dark token. No route-specific local data mismatch was observed in the light capture.
- `desktop-12-pick` shows the same three channel templates in both light captures; the current picker is wired to channel creation. Light changed pixels are 3.74% at 1440x900 and 2.59% at 1728x1117. The app action buttons use the workspace lavender accent while the standalone screen uses blue. Dark exact-pixel changes are 100% because the standalone prototype dark surface is RGB [38,35,45] at (10,100), while the app surface is [33,30,38]; its buttons also use a different palette.
- `desktop-14-moderation-failed` is a component crop of the designed failure panel, not the whole workspace shell. Current change is 1.99% light and 2.01% dark across both viewport sizes; the crop is below 3%.
- Other workspace screens retain their designed controls and local data. Their aggregate exact differences are dominated by the measured shared field/top bar and text/border edges; rows where content is visibly distinct remain in the route-specific audit before signoff.

## Excluded routes

- `desktop-09-*`, workspace agent-directory/profile/settings surfaces, Teams, Power/usage: owner hold, not captured.
- Compute hosts and host failures: NEEDS-DESIGN item 55.
- Blocks catalog and permissions: NEEDS-DESIGN item 56.
- Business defaults and connections: NEEDS-DESIGN item 57.
- AI provider connections: NEEDS-DESIGN item 58.
- Channel-template availability/error states without a real source are excluded; the live-source picker itself is covered.

The individual capture gallery is disposable after the final route audit; this summary is the retained metric record.
