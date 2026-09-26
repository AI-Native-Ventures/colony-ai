# W20 settings baseline visual metrics

Baseline source: local visual gallery `w20-settings-post-rebase`, captured against frozen r17. The settings routes in this baseline are unchanged in frozen r19. Comparison is exact RGB with no masks or thresholds. The gallery contained 260 captures across 65 routes, four variants per route (light/dark at 1440x900 and 1728x1117).

Overall mean changed pixels: 41.99%. Median: 22.90%. Range: 4.83% to 100.00%.

## Per-route baseline

| Route | Mean changed pixels | Range | Captures |
| --- | ---: | ---: | ---: |
| `desktop-06-camera` | 59.76% | 19.36% to 100.00% | 4 |
| `desktop-06-cancelled` | 58.47% | 16.86% to 98.35% | 4 |
| `desktop-06-choose` | 50.11% | 10.26% to 89.96% | 4 |
| `desktop-06-crop` | 73.38% | 46.87% to 99.81% | 4 |
| `desktop-06-failed` | 80.27% | 60.49% to 99.99% | 4 |
| `desktop-06-invalid` | 60.92% | 21.83% to 100.00% | 4 |
| `desktop-06-profile` | 58.47% | 16.86% to 98.35% | 4 |
| `desktop-06-saved` | 62.41% | 23.96% to 98.35% | 4 |
| `desktop-06-saving` | 52.48% | 4.83% to 100.00% | 4 |
| `desktop-06-upload` | 52.67% | 5.34% to 100.00% | 4 |
| `desktop-07-confirm` | 8.26% | 6.62% to 9.75% | 4 |
| `desktop-08-catalog` | 67.86% | 34.38% to 98.37% | 4 |
| `desktop-08-compact` | 67.54% | 33.81% to 98.37% | 4 |
| `desktop-08-custom` | 69.87% | 36.50% to 100.00% | 4 |
| `desktop-08-saved` | 68.19% | 35.89% to 98.37% | 4 |
| `desktop-08-spacious` | 67.91% | 34.56% to 98.37% | 4 |
| `desktop-09-discovered` | 58.49% | 16.80% to 98.37% | 4 |
| `desktop-09-failed` | 5.45% | 4.95% to 5.95% | 4 |
| `desktop-10-hosts` | 60.83% | 21.20% to 98.39% | 4 |
| `desktop-10-unavailable` | 96.22% | 90.97% to 100.00% | 4 |
| `desktop-11-library` | 58.13% | 16.23% to 98.37% | 4 |
| `desktop-12-pick` | 58.37% | 16.62% to 98.37% | 4 |
| `desktop-12-unavailable` | 88.44% | 73.63% to 100.00% | 4 |
| `desktop-13-catalog` | 57.73% | 15.57% to 98.38% | 4 |
| `desktop-13-permissions` | 91.19% | 78.92% to 100.00% | 4 |
| `desktop-14-archive-failed` | 60.00% | 19.22% to 98.39% | 4 |
| `desktop-14-draft-failed` | 60.08% | 19.38% to 98.39% | 4 |
| `desktop-14-emoji-invalid` | 61.10% | 21.05% to 98.38% | 4 |
| `desktop-14-moderation-failed` | 60.44% | 19.92% to 98.38% | 4 |
| `desktop-15-diagnostics` | 61.11% | 22.19% to 100.00% | 4 |
| `desktop-15-failed` | 60.42% | 20.83% to 100.00% | 4 |
| `desktop-15-form` | 55.04% | 10.04% to 100.00% | 4 |
| `desktop-15-sending` | 53.87% | 7.74% to 100.00% | 4 |
| `desktop-15-sent` | 53.82% | 7.53% to 100.00% | 4 |
| `workspace-account` | 27.69% | 13.38% to 44.20% | 4 |
| `workspace-account-accessibility` | 29.81% | 15.12% to 43.80% | 4 |
| `workspace-account-archive` | 14.92% | 12.01% to 17.91% | 4 |
| `workspace-account-audit` | 15.13% | 12.12% to 18.26% | 4 |
| `workspace-account-moderation` | 15.35% | 12.30% to 18.54% | 4 |
| `workspace-account-notifications` | 29.18% | 16.68% to 43.57% | 4 |
| `workspace-account-recovery` | 15.32% | 12.36% to 18.34% | 4 |
| `workspace-account-security` | 23.03% | 13.33% to 33.90% | 4 |
| `workspace-agent-settings-connections` | 16.85% | 15.42% to 18.82% | 4 |
| `workspace-agent-settings-defaults` | 23.13% | 16.51% to 30.88% | 4 |
| `workspace-agent-settings-harnesses` | 15.86% | 12.77% to 19.41% | 4 |
| `workspace-compute` | 24.81% | 19.95% to 30.18% | 4 |
| `workspace-settings` | 17.89% | 13.03% to 23.52% | 4 |
| `workspace-settings-admin` | 15.13% | 12.12% to 18.26% | 4 |
| `workspace-settings-appearance` | 24.78% | 20.80% to 29.34% | 4 |
| `workspace-settings-connections` | 14.06% | 11.09% to 17.58% | 4 |
| `workspace-settings-defaults` | 13.72% | 10.81% to 17.19% | 4 |
| `workspace-settings-device` | 18.79% | 13.58% to 24.84% | 4 |
| `workspace-settings-emoji` | 27.95% | 14.32% to 45.51% | 4 |
| `workspace-settings-experiments` | 24.89% | 13.48% to 39.61% | 4 |
| `workspace-settings-extensions` | 13.47% | 10.62% to 16.89% | 4 |
| `workspace-settings-mobile` | 33.20% | 26.56% to 40.04% | 4 |
| `workspace-settings-people` | 14.05% | 11.11% to 17.54% | 4 |
| `workspace-settings-shortcuts` | 33.15% | 15.55% to 52.67% | 4 |
| `workspace-settings-storage` | 23.25% | 14.68% to 33.96% | 4 |
| `workspace-settings-templates` | 14.26% | 11.34% to 17.73% | 4 |
| `workspace-settings-theme-applied` | 26.47% | 20.75% to 32.91% | 4 |
| `workspace-settings-theme-preview` | 26.40% | 20.69% to 32.82% | 4 |
| `workspace-settings-themes` | 42.81% | 32.79% to 52.27% | 4 |
| `workspace-settings-updates` | 16.01% | 13.04% to 19.01% | 4 |
| `workspace-settings-voice` | 19.01% | 14.24% to 24.43% | 4 |

## Appearance region baseline

Sample: light theme, 1440x900. Regions use fixed viewport coordinates and exact RGB pixel comparison.

| Region | Changed pixels | Mean absolute RGB delta |
| --- | ---: | ---: |
| Workspace field and settings sidebar | 72.11% | 6.70 |
| Top bar | 31.60% | 2.71 |
| Inner section bar | 2.92% | 2.30 |
| Page heading | 4.53% | 4.22 |
| Appearance controls | 13.95% | 7.85 |
| Live preview | 44.67% | 8.70 |
| Save row | 11.96% | 5.23 |
| Whole settings surface | 19.47% | 6.13 |

## Appearance geometry from the reference capture

| Element | Bounds at 1440x900 |
| --- | --- |
| Settings sidebar | x=1, y=8, width=238, height=884 |
| Top bar | x=240, y=9, width=1191, height=52 |
| Main surface | x=240, y=61, width=1191, height=830 |

The old gallery and per-capture metrics were deleted after extracting this summary.
