# W20 settings visual metrics, r19 progress

This summary preserves route-level metrics before removing the untracked capture gallery. It is an intermediate audit, not visual signoff. The route cause audit and local gates remain open.

## Capture basis

- Frozen reference: 20260926-r19. The r17 workspace settings routes are unchanged in this revision. The reference remains read-only.
- Historical route baseline: `w20-settings-baseline-summary.md`, 260 captures across 65 routes. Overall mean was 41.99%; median was 22.90%.
- Current route set: 220 captures across 55 routes. Scores come from the last full r19 matrix in `/tmp/w20-settings-r19-contained-final`, with the corrected `desktop-08-catalog` four-case subset and latest `workspace-settings-themes` four-case subset overlaid.
- Exact changed pixels are reported without a tolerance. Mean channel delta is the average absolute RGB channel delta across all pixels. Light and dark plus 1440x900 and 1728x1117 are aggregated per route.

On the same 55-route subset, the historical baseline mean was 40.95% and the current mean is 39.39% (median 23.46%; range 3.71% to 100.00%). The small aggregate change is not an acceptance result.

## Per-route before and current

| Route | Baseline mean | Current mean | Change | Current range | Mean RGB delta |
| --- | ---: | ---: | ---: | ---: | ---: |
| `desktop-06-camera` | 59.76% | 59.74% | -0.02 pp | 19.32% to 100.00% | 17.98 |
| `desktop-06-cancelled` | 58.47% | 46.62% | -11.85 pp | 6.02% to 87.19% | 5.28 |
| `desktop-06-choose` | 50.11% | 50.08% | -0.03 pp | 10.22% to 89.94% | 6.71 |
| `desktop-06-crop` | 73.38% | 73.38% | +0.00 pp | 46.87% to 99.81% | 35.28 |
| `desktop-06-failed` | 80.27% | 80.26% | -0.01 pp | 60.46% to 99.99% | 38.31 |
| `desktop-06-invalid` | 60.92% | 60.91% | -0.01 pp | 21.82% to 100.00% | 8.04 |
| `desktop-06-profile` | 58.47% | 46.62% | -11.85 pp | 6.02% to 87.19% | 5.28 |
| `desktop-06-saved` | 62.41% | 50.55% | -11.86 pp | 13.12% to 87.19% | 6.17 |
| `desktop-06-saving` | 52.48% | 52.48% | -0.00 pp | 4.82% to 100.00% | 5.51 |
| `desktop-06-upload` | 52.67% | 52.67% | -0.00 pp | 5.33% to 100.00% | 5.76 |
| `desktop-07-confirm` | 8.26% | 6.69% | -1.57 pp | 4.82% to 8.25% | 3.25 |
| `desktop-08-catalog` | 67.86% | 56.31% | -11.55 pp | 23.84% to 87.48% | 16.63 |
| `desktop-08-compact` | 67.54% | 56.02% | -11.52 pp | 23.32% to 87.48% | 16.46 |
| `desktop-08-custom` | 69.87% | 69.94% | +0.07 pp | 36.70% to 100.00% | 20.32 |
| `desktop-08-saved` | 68.19% | 56.62% | -11.57 pp | 25.31% to 87.48% | 16.44 |
| `desktop-08-spacious` | 67.91% | 56.37% | -11.54 pp | 23.96% to 87.48% | 16.61 |
| `desktop-09-discovered` | 58.49% | 46.93% | -11.56 pp | 6.20% to 87.46% | 5.72 |
| `desktop-09-failed` | 5.45% | 4.71% | -0.74 pp | 3.71% to 5.72% | 2.02 |
| `desktop-11-library` | 58.13% | 46.59% | -11.54 pp | 5.64% to 87.49% | 5.50 |
| `desktop-12-pick` | 58.37% | 47.68% | -10.69 pp | 7.76% to 87.48% | 6.69 |
| `desktop-14-archive-failed` | 60.00% | 48.42% | -11.58 pp | 8.58% to 87.48% | 5.73 |
| `desktop-14-draft-failed` | 60.08% | 48.51% | -11.57 pp | 8.75% to 87.48% | 5.85 |
| `desktop-14-emoji-invalid` | 61.10% | 49.49% | -11.61 pp | 10.39% to 87.44% | 6.64 |
| `desktop-14-moderation-failed` | 60.44% | 50.79% | -9.65 pp | 12.43% to 87.46% | 6.49 |
| `desktop-15-diagnostics` | 61.11% | 61.09% | -0.02 pp | 22.15% to 100.00% | 10.25 |
| `desktop-15-failed` | 60.42% | 60.40% | -0.02 pp | 20.78% to 100.00% | 10.91 |
| `desktop-15-form` | 55.04% | 55.01% | -0.03 pp | 9.98% to 100.00% | 9.26 |
| `desktop-15-sending` | 53.87% | 53.80% | -0.07 pp | 7.59% to 100.00% | 7.89 |
| `desktop-15-sent` | 53.82% | 53.75% | -0.07 pp | 7.39% to 100.00% | 9.08 |
| `workspace-account` | 27.69% | 31.31% | +3.62 pp | 16.26% to 48.65% | 2.33 |
| `workspace-account-accessibility` | 29.81% | 34.05% | +4.24 pp | 18.75% to 49.47% | 3.25 |
| `workspace-account-archive` | 14.92% | 18.63% | +3.71 pp | 14.79% to 23.30% | 1.31 |
| `workspace-account-audit` | 15.13% | 18.67% | +3.54 pp | 14.75% to 23.46% | 1.26 |
| `workspace-account-moderation` | 15.35% | 19.11% | +3.76 pp | 15.10% to 23.98% | 1.52 |
| `workspace-account-notifications` | 29.18% | 33.11% | +3.93 pp | 19.63% to 49.22% | 4.14 |
| `workspace-account-recovery` | 15.32% | 19.07% | +3.75 pp | 15.18% to 23.78% | 1.59 |
| `workspace-account-security` | 23.03% | 26.33% | +3.30 pp | 16.20% to 38.41% | 2.15 |
| `workspace-agent-settings-defaults` | 23.13% | 26.94% | +3.81 pp | 19.36% to 36.34% | 2.32 |
| `workspace-agent-settings-harnesses` | 15.86% | 19.79% | +3.93 pp | 17.01% to 22.81% | 2.86 |
| `workspace-settings` | 17.89% | 21.65% | +3.76 pp | 15.84% to 28.94% | 2.31 |
| `workspace-settings-admin` | 15.13% | 18.68% | +3.55 pp | 14.75% to 23.47% | 1.26 |
| `workspace-settings-appearance` | 24.78% | 19.02% | -5.76 pp | 16.91% to 21.27% | 1.36 |
| `workspace-settings-device` | 18.79% | 22.72% | +3.93 pp | 16.53% to 30.46% | 2.72 |
| `workspace-settings-emoji` | 27.95% | 31.70% | +3.75 pp | 17.14% to 50.92% | 2.97 |
| `workspace-settings-experiments` | 24.89% | 28.69% | +3.80 pp | 16.34% to 45.06% | 2.42 |
| `workspace-settings-mobile` | 33.20% | 36.93% | +3.73 pp | 29.32% to 45.52% | 2.92 |
| `workspace-settings-people` | 14.05% | 17.90% | +3.85 pp | 15.58% to 20.39% | 2.11 |
| `workspace-settings-shortcuts` | 33.15% | 37.52% | +4.37 pp | 19.33% to 58.23% | 3.55 |
| `workspace-settings-storage` | 23.25% | 27.17% | +3.92 pp | 17.65% to 39.56% | 3.19 |
| `workspace-settings-templates` | 14.26% | 18.04% | +3.78 pp | 15.66% to 20.58% | 1.93 |
| `workspace-settings-theme-applied` | 26.47% | 30.35% | +3.88 pp | 25.81% to 34.95% | 3.41 |
| `workspace-settings-theme-preview` | 26.40% | 30.27% | +3.87 pp | 25.74% to 34.85% | 3.26 |
| `workspace-settings-themes` | 42.81% | 34.00% | -8.81 pp | 32.47% to 35.75% | 6.35 |
| `workspace-settings-updates` | 16.01% | 19.80% | +3.79 pp | 15.86% to 24.48% | 2.58 |
| `workspace-settings-voice` | 19.01% | 22.87% | +3.86 pp | 17.15% to 29.99% | 2.46 |

## Measured residuals so far

- Workspace Appearance at light 1440x900: changed pixels were 20.24%, with mean channel delta 1.48. Region changed-pixel percentages and thresholds were: field plus sidebar 80.44% exact, 6.30% above channel delta 4, 4.70% above 16; top bar 30.95%, 6.77%, 3.51%; inner section bar 3.05%, 2.99%, 2.78%; heading 2.77%, 2.69%, 2.12%; controls 4.34%, 4.05%, 3.62%; preview 6.85%, 3.98%, 3.20%; save row 3.32%, 3.14%, 2.21%. Pixels with max channel delta above 32 were 2.625% across the screen. The reference and app use the same Colony field SVG hash, and the measured shell, main surface, heading, controls and preview bounds matched. These measurements locate the residual in low-amplitude rendered color and text-edge differences across large flat/gradient regions.
- Workspace named theme catalog: the preview was previously aspect-ratio sized, making it about 180px tall at 1728px viewport width. The frozen reference measures 140px at both viewport widths. The card is now 140px high, with 10px radius and label margin/line metrics matching the measured reference. In the 1728 light capture, row starts align within about 1px. The current route mean is 34.00% versus the last pre-fix full-run mean 46.85%. Current per-case range is 32.47% to 35.75%, and mean channel delta is 6.35. Residual component attribution still needs a measured region pass.
- Desktop #08 catalog entry: the visual manifest compares the actual Appearance entry state with no click action. Current mean is 56.31% versus the prior click-action capture mean 68.91%. The reference #08 screen is the older catalog plus density composition; the r17 app entry is the redesigned Appearance page. This screen-level difference needs route disposition before final signoff.

## Routes not in the current r19 matrix

| Route | Disposition to confirm |
| --- | --- |
| `desktop-10-hosts` | NEEDS_DESIGN item 55: compute and host unavailable/failure states. Do not invent the missing state. |
| `desktop-10-unavailable` | NEEDS_DESIGN item 55: compute and host unavailable/failure states. Do not invent the missing state. |
| `desktop-12-unavailable` | Suggested-agent availability source is absent; the create-from-template picker is implemented in the real channel-creation flow. |
| `desktop-13-catalog` | NEEDS_DESIGN item 56: live Blocks and permission states have no supported data source in this slice. |
| `desktop-13-permissions` | NEEDS_DESIGN item 56: live Blocks and permission states have no supported data source in this slice. |
| `workspace-agent-settings-connections` | NEEDS_DESIGN item 58: AI provider connection states are not designed. |
| `workspace-compute` | NEEDS_DESIGN item 55: compute and host unavailable/failure states. Do not invent the missing state. |
| `workspace-settings-connections` | NEEDS_DESIGN item 57: Business defaults/connections unavailable state is not designed. |
| `workspace-settings-defaults` | NEEDS_DESIGN item 57: Business defaults/connections unavailable state is not designed. |
| `workspace-settings-extensions` | Excluded from the current manifest; verify whether this route maps to the dropped hosted-community/Deployment-console/export-import UI before final scope report. |

## Remaining audit

For every route above 3%, inspect the residual at the route level and record the concrete region and measured cause before the slice is pushed. This progress file will be updated with those findings. The 2.6GB untracked gallery was reduced to the route and threshold metrics retained here; individual captures are disposable.
