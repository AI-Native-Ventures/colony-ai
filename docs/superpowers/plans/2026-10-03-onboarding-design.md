# Launch onboarding design implementation

Goal: restore frozen onboarding Scout r4 presentation, remove legacy first-run presentation, preserve required setup writes and hand off into the shared app.

Authority: owner launch-day instructions, DESIGN-CONTRACT.md, frozen onboarding-scout-r4 and agent-presence-r2. Review fixtures and timers are not runtime proof.

- [x] Read root contributor/product/testing guidance and frozen handoffs.
- [x] Port Scout eyeless SVG from the frozen r4 `reference/app/onboarding/ant.js` into a typed component. Original Colony design asset, retained green palette and proportions. No external image or replacement mascot.
- [x] Add scoped presence layout and exact state copy to the existing form renderer.
- [x] Provide `data.scoutGuidance`, `data.firstReply` and `data.connectionLabel` as integration seams. The first-reply-runtime lane owns reply evidence and routing. Business-detect owns website/discovery feedback; OpenRouter OAuth owns authorization.
- [ ] Remove community profile/team interstitials while retaining durable setup and recovery.
- [x] Remove user-visible Buzz branding from account, welcome message, canvas and machine screens. Remove bee illustrations from those surfaces.
- [ ] Remove the legacy community profile/team screens, which still contain retired UI.
- [x] Update dependent tests in the same commits as their UI changes.
- [ ] Capture reference and production-renderer routes at 1728x1117 and 1440x900, inspect each, publish side-by-side evidence.
- [ ] Rebase on develop, push draft PR, wait for green GitHub checks.

Local gate: TypeScript, focused Biome, px-text guard, focused Node tests, quick affected Playwright smoke/integration. No local Rust build/test/clippy or packaged app launch.

NEEDS_DESIGN: DESIGN-CONTRACT.md selects Satoshi while the latest frozen r4 typography.css and HANDOFF.md select Manrope. Which font should the launch onboarding use? Preserve the existing Manrope until reconciled. This prevents claiming exact parity against conflicting authorities.


Rendered proof: 55 production-presentation form/recovery routes captured at both requested sizes. Account, business and connect also exercised through the actual app router with the mock native bridge. Real agent reply, external OAuth and packaged runtime remain unproven.

NEEDS_API: first-reply-runtime must supply request/cancel/retry, progress, actual reply content, connection label and completion callbacks before removing the community profile/team gate. `OnboardingScenePresentation` accepts `data.firstReply`, `data.connectionLabel`, `data.scoutGuidance`, `onCancelTest` and `onNavigate`.

NEEDS_API: the account name is sent to signUp but AccountAuthRecord has no displayName. Which durable account/profile record supplies that name after identity installation and community switch? Existing getProfile may return no profile event and the legacy gate then asks for a name again.

NEEDS_API: UpdateManagedAgentInput has no avatar field. The copied Scout asset is supplied when creating the starter instance. What API should migrate the installed 1.0.2 starter avatar without recreating its identity?
