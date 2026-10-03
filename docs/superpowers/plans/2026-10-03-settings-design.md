# Settings design implementation plan

Goal: restore the frozen Appearance and R17 named-theme flow.
Architecture: route Appearance to its existing full panel; retain scoped preference snapshots as the durable source; use the existing theme loader for preview palettes. Theme preview must preserve conversation preferences, cancel without writes, and apply only after snapshot persistence succeeds.

- [x] Replace the stub route in SettingsPanels.tsx with AppearanceSettingsPanel.
- [x] Restore catalog heading, search, mode filters, current selection, four-column workspace thumbnails and return action in ThemeCatalogRoute.tsx and its CSS.
- [x] Restore preview and applied workspace scenes, preserving density and text size.
- [x] Update dependent e2e specs with the same UI commit; cover cancel, apply, reload, storage failure, search and filters.
- [x] Run quick TypeScript, Biome, px-text and focused preference tests.
- [ ] Capture frozen and mock-bridge routes at 1728x1117 and 1440x900; inspect and attach with honest verdicts.
- [ ] Rebase, push a draft PR into develop, monitor GitHub checks and correct caused failures.
- [ ] Audit remaining Settings groups and record route verdicts and unresolved design/API dependencies.

Owner constraints override repository-wide local checks: no local Rust build/test/clippy, no packaged app or keychain access, no release/deploy changes. Sidebar and typography tokens belong to shell-design.
