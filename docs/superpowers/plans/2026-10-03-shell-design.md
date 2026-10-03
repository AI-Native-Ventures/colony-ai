# Launch shell design implementation plan

Goal: match the frozen app frame and conversation chrome, with the owner's larger sidebar and typography.

Architecture: retain the existing resizable SidebarProvider and conversation preference variables. Give the primary ContentSurface one frame inset on every route. Put existing global history chrome inside that surface rather than moving the entire sidebar down. Keep huddle windows unframed and settings owned by their lane.

Acceptance: compare rendered references and mock-bridge app at 1728x1117 and 1440x900. Run only quick frontend checks and affected browser tests. Open a draft PR into develop and wait for GitHub checks. No merge, deploy, packaged app launch or native build.

- [ ] Capture baseline frame, sidebar, channel and thread measurements and PNGs.
- [ ] Change `SidebarInset` chrome composition in `AppShell.tsx`, `AppShellChannelSurface.tsx` and `BuzzThemeSurfaces.tsx`; use an 8px inset and 11px surface radius.
- [ ] Set the default sidebar width to 260 in `shared/ui/sidebar.tsx`. Keep saved widths, resize bounds and collapse behavior.
- [ ] Change the shared type scale in `typography.css` from 13/14/15 to 14/15/16 for Smaller/Default/Larger. Sidebar uses the next named text and icon steps.
- [ ] Match channel and thread composer outer gutters and inner input padding from the rendered conversation references.
- [ ] Follow DESIGN-CONTRACT's Satoshi instruction only after checking font distribution terms. Record the frozen Manrope conflict in the PR.
- [ ] Update dependent size assertions, add a production-rendered shell regression spec, capture after PNGs and inspect every comparison.
- [ ] Run TypeScript, targeted Biome, px-text and focused node tests. Run affected smoke and integration browser projects when quick.
- [ ] Rebase on origin/develop, commit with signoff and required coauthor, push without local native hooks, open draft PR, attach reference/before/after proof.
- [ ] Poll GitHub checks and correct caused failures; keep implemented, local browser proof and CI proof separate.
