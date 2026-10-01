# B2 Role Pack Page Fidelity Implementation Plan

> **For agentic workers:** Follow this plan task by task in the existing Colony l-ui worktree. Steps use checkbox syntax for tracking.

**Goal:** Make the role-pack create and edit screens match the frozen B2 full-page editor while preserving real authorization and saved persona metadata.

**Architecture:** Keep the existing `usePersonaActions` mutations, persona draft state, and role recovery routes. Render role-pack create and edit in the company page shell, outside the community catalog modal. Populate allowed worker choices from the live ACP runtime catalog. Leave tool scope unavailable when no real catalog API exists, preserve previously saved scope metadata, and report that gap as `NEEDS_API`.

**Tech Stack:** React 19, TanStack Router, TypeScript, Tailwind CSS, Playwright.

---

### Task 1: Render role-pack create and edit as full-page company screens

**Files:**
- Modify: `desktop/src/features/agents/ui/AgentsView.tsx`
- Modify: `desktop/src/features/agents/ui/CommunityCatalogDialog.tsx`
- Modify: `desktop/src/features/agents/ui/AgentDialog.tsx`
- Modify: `desktop/src/features/agents/ui/AgentDefinitionDialogShell.tsx`

- [x] Keep the existing `personas.handleSubmit`, role recovery callbacks, and owner/admin checks. When a role-pack create or edit is active, render the `Company / Role catalog` header, Back control, and `Role catalog` heading in the route content area.
- [x] In `CommunityCatalogDialog`, make role-pack mode render only its embedded create form and the existing discard confirmation. Leave the ordinary agent and team catalog in its current modal layout.
- [x] Add embedded rendering to the definition-edit `AgentDialog` branch and use it only for company role packs. Keep its save and cancel callbacks connected to the existing persona mutation.
- [x] For embedded role-pack mode, render the save and cancel footer in normal page flow below `CompanyRoleFields`, not as a fixed dialog footer.
- [x] Set the role-pack submit action label to `Save role pack` and route successful saves back to the real saved role record.

### Task 2: Match blank selectors without inventing catalog values

**Files:**
- Modify: `desktop/src/features/agents/ui/CompanyRoleFields.tsx`
- Modify: `desktop/tests/e2e/company-hiring.spec.ts`
- Modify: `desktop/tests/e2e/company-canary.canary.spec.ts`
- Modify: `desktop/tests/e2e/CANARY-UI-CHECK.md`

- [x] Replace the free-form tool-name and risk inputs with the designed blank `Tool scope` selector. Add no example options. Keep the control unavailable when the runtime tool catalog is absent and retain any tool metadata already stored on the persona.
- [x] Replace runtime checkboxes with the designed `Allowed worker model` selector, sourcing options only from available runtime records. Do not preselect a runtime. Preserve an existing saved worker menu until a person explicitly changes the selector.
- [x] Update tests to verify page structure, empty title/job/skills, no preselected worker choice, unavailable empty tool scope, and failed-save input retention. Remove assertions for controls that no longer exist; keep product behavior assertions intact.
- [x] Record the missing tool-scope catalog as `NEEDS_API` in canary output and the canary check documentation.

### Task 3: Compare the implemented state and run the constrained gates

**Files:**
- Test: `desktop/tests/e2e/company-hiring.spec.ts`
- Test: `desktop/tests/e2e/company-canary.canary.spec.ts`

- [x] Run the affected company-hiring Playwright spec and one focused canary role-pack check only if each finishes quickly.
- [ ] Capture the role-pack editor at 1440x900 and 1728x1117 in light and dark, outside the repository, and compare each result with `20260930-company-v9`.
- [x] Run `pnpm exec tsc --noEmit`, focused Biome, and `pnpm check:px-text` from `desktop/`.
- [x] Grep E2E and unit tests for every changed label, test id, and accessible name. Scan the diff for em dashes and secrets before committing.
- [ ] Commit the working sub-slice with `git commit -s`, push only after the current head's GitHub CI cycle completes, then hold and poll that head until its checks finish.

---

## Scope decisions

- Tool-scope examples in the mockup are not shipped values. The current runtime catalog does not expose a tool-scope registry, so new scope selection remains unavailable and is reported as `NEEDS_API`.
- Existing company role records remain the source for saved tool scopes and worker menus. Rendering the new page must not seed, grant, or silently erase those values.
- No frozen reference file is edited. Items 86 to 89 remain outside this slice.
