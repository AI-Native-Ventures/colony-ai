# First reply runtime implementation plan

Goal: preserve the Connect runtime selection, prove a real reply before connection success, and keep account lookup failures away from the composer.

Acceptance gates:
1. Persist the selected runtime before onboarding completion. Provision all starter agents with that runtime and refuse an unavailable selection. Focused production-path node tests and TypeScript must pass before the draft PR.
2. Use the shared ACP session/prompt path for a bounded first hello. Show the returned reply and negotiated model only after a successful nonempty turn. Test empty, failed, stale and timed-out results. Capture frozen reference and actual mock-bridge screens at 1728x1117 and 1440x900.
3. Trace account lookup across signup, identity import and community switching. Preserve authenticated account identity and hide passive lookup outages from the composer, retaining recovery in Account settings. Test production service behavior and dependent UI specs.
4. Audit Claude launch settings and personal memory exposure without changing isolation. Report NEEDS_OWNER.

Validation: quick focused node tests, tsc, Biome, text-token guard and Rust formatting only. GitHub CI owns Rust execution. Draft PR into develop, no merge or deployment.
