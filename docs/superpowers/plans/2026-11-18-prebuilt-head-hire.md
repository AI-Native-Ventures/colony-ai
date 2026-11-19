# Prebuilt Head Hire Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an owner hire each approved prebuilt function head from the company map with an existing agent identity, a real runtime choice, a durable slot assignment, and one bounded first move.

**Architecture:** Keep the approved agent text in a typed data module and adapt it through the existing `materializeBuiltInRole` path. Put the job-doer decision in one pure shared function, then render the map, phone, and function cards from it. Keep relay proposals strictly aligned with the Rust `HireProposal` schema; store any local UI-only configuration separately. The map dialog owns the new happy path and delegates durable agent creation, channel attachment, retry state, and start errors to a focused executor.

**Tech Stack:** React 19, TypeScript, TanStack Query, Tauri managed-agent bridge, Nostr relay actions, Playwright E2E mock bridge, Node unit tests.

---

### Task 1: Define approved prebuilt agents and the shared job-doer rule

**Files:**
- Create: `desktop/src/features/cofounder/prebuiltAgents.ts`
- Create: `desktop/src/features/cofounder/prebuiltAgents.test.mjs`
- Modify: `desktop/src/features/cofounder/companyMapAssignments.ts`
- Modify: `desktop/src/features/cofounder/companyMapAssignments.test.mjs`

- [ ] **Step 1: Write failing data and assignment tests**

```js
assert.equal(PREBUILT_AGENTS.length, 25);
assert.deepEqual(PREBUILT_AGENT_RULES, expectedApprovedRules);
assert.match(buildPrebuiltAgentInstructions(agent), /Who does a job:/);
assert.deepEqual(companyMapJobDoer(slot, "specialist-pubkey"), {
  kind: "specialist",
  pubkey: "specialist-pubkey",
});
assert.equal(companyMapJobDoer(emptySlot, null).kind, "scout");
```

- [ ] **Step 2: Run the scoped tests and confirm the missing exports fail**

Run: `/Users/mac/worktrees/.lanes/tools/heavy.sh node --test desktop/src/features/cofounder/prebuiltAgents.test.mjs desktop/src/features/cofounder/companyMapAssignments.test.mjs`

Expected: a failing import or assertion naming the missing production function.

- [ ] **Step 3: Add the typed catalog and production assignment helper**

```ts
export function companyMapJobDoer(
  slot: CompanyFunctionSlot | null | undefined,
  specialistPubkey: string | null,
): CompanyMapJobDoer {
  if (specialistPubkey) return { kind: "specialist", pubkey: specialistPubkey };
  if (slot?.headPubkey) return { kind: "head", pubkey: slot.headPubkey };
  return { kind: "scout" };
}
```

The catalog carries every approved source field verbatim. `buildPrebuiltAgentInstructions` includes the agent name, part, work, asks, first move, and each of the seven approved rules. `prebuiltRoleForAgent` uses `materializeBuiltInRole` rather than adding a second persona persistence format.

- [ ] **Step 4: Re-run the scoped tests**

Run: `/Users/mac/worktrees/.lanes/tools/heavy.sh node --test desktop/src/features/cofounder/prebuiltAgents.test.mjs desktop/src/features/cofounder/companyMapAssignments.test.mjs`

Expected: PASS.

### Task 2: Remove unsupported function jobs and align strict relay data

**Files:**
- Modify: `desktop/src/features/cofounder/functions.ts`
- Modify: `desktop/src/features/cofounder/companyMapJobRoutes.ts`
- Modify: `desktop/src/features/company-asks/askRecords.ts`
- Modify: `desktop/src/features/company-hiring/companyHireModels.ts`
- Modify: `desktop/src/features/company-hiring/hireDraft.ts`
- Modify: `desktop/src/testing/e2eBridge.ts`
- Test: `desktop/src/features/cofounder/functions.test.mjs`
- Test: `desktop/src/features/company-hiring/companyHireModels.test.mjs`

- [ ] **Step 1: Add failing regression cases**

```js
assert.equal(FUNCTION_DETAILS.finance.jobs.includes("Quotes"), false);
assert.equal(FUNCTION_DETAILS.customerSuccess.jobs.includes("Renewals"), false);
assert.equal(parseHireProposal({ ...validProposal, effortLevel: "high" }), null);
assert.throws(() => acceptMockHireAction(extraProposalField), /unknown proposal field/);
```

- [ ] **Step 2: Run the focused tests and observe the failures**

Run: `/Users/mac/worktrees/.lanes/tools/heavy.sh node --test desktop/src/features/cofounder/functions.test.mjs desktop/src/features/company-hiring/companyHireModels.test.mjs`

Expected: assertions fail before the route and schema changes land.

- [ ] **Step 3: Make the production schema exact**

Keep only the Rust `HireProposal` fields in a relay proposal: `hireId`, `rolePack`, `displayName`, `title`, `managerPubkey`, `introductionChannelId`, `runtimeId`, `providerId`, `modelId`, and `weeklyAllowance`. Move local channel selection, response behavior, and effort choice into the local durable draft configuration. Update legacy call sites to build the strict proposal plus local configuration. Reject extras in the E2E relay mock.

- [ ] **Step 4: Remove Finance Quotes and Customer Success Renewals from function details, routes, layouts, fixtures, and tests**

Sales Quotes continues to route to `/clients`. Finance and Customer Success no longer expose a duplicate job or screen.

- [ ] **Step 5: Re-run focused schema and function tests**

Run: `/Users/mac/worktrees/.lanes/tools/heavy.sh node --test desktop/src/features/cofounder/functions.test.mjs desktop/src/features/company-hiring/companyHireModels.test.mjs`

Expected: PASS.

### Task 3: Build the prebuilt-head dialog and atomic hire execution

**Files:**
- Create: `desktop/src/features/cofounder/ui/PrebuiltHireDialog.tsx`
- Create: `desktop/src/features/cofounder/prebuiltHireChoice.ts`
- Create: `desktop/src/features/cofounder/prebuiltHireExecution.ts`
- Modify: `desktop/src/features/cofounder/ui/CompanyMapBoard.tsx`
- Modify: `desktop/src/features/cofounder/ui/CompanyMapPhone.tsx`
- Modify: `desktop/src/features/cofounder/ui/CompanyMapScreen.tsx`
- Modify: `desktop/src/features/cofounder/ui/FunctionScreen.tsx`
- Modify: `desktop/src/features/company-hiring/ui/HireReviewScreen.tsx`
- Modify: `desktop/src/shared/api/tauriManagedAgentMessages.ts`
- Test: `desktop/src/features/cofounder/prebuiltHireChoice.test.mjs`
- Test: `desktop/src/features/cofounder/prebuiltHireExecution.test.mjs`

- [ ] **Step 1: Add failing storage and execution tests**

```js
assert.deepEqual(readPrebuiltHireChoice("community-a"), null);
writePrebuiltHireChoice("community-a", choice);
assert.deepEqual(readPrebuiltHireChoice("community-b"), null);
assert.deepEqual(calls.map((call) => call.name), [
  "create", "slot_hire_set", "approve", "createManagedAgent", "attach", "complete",
]);
```

- [ ] **Step 2: Run the new scoped tests and confirm they fail**

Run: `/Users/mac/worktrees/.lanes/tools/heavy.sh node --test desktop/src/features/cofounder/prebuiltHireChoice.test.mjs desktop/src/features/cofounder/prebuiltHireExecution.test.mjs`

Expected: missing module or failing ordered-call assertion.

- [ ] **Step 3: Implement the dialog from runtime-discovered choices**

The dialog reads harnesses, models, providers, and effort behavior from existing runtime discovery hooks. It renders provider only when the selected harness does not imply one. It renders canonical effort choices only when the runtime supplies them; otherwise it explicitly says the selected harness owns that setting. It saves the last successful choice under a key containing the active community identifier, restores it only for that community, and opens the same dialog for a later hire.

- [ ] **Step 4: Execute the hire in durable order with recovery state**

The executor creates the strict proposal, records `slot_hire_set`, approves, creates the managed agent without an accidental full workflow, attaches it with a bounded start attempt, completes the hire only after those steps succeed, and records retryable failure details. It sends one durable first-move wake after completion, with an idempotency key tied to the hire. It never sends the old full `on-hire` workflow trigger.

- [ ] **Step 5: Use the same dialog from desktop map, phone map, and FunctionScreen**

Show an approved prebuilt head card for an empty part, an assigned-head card for a filled part, and an Operations card even when Operations is empty. Keep the map action card in its own component so `CompanyMapBoard.tsx` remains under 1,200 lines. The Team and Agents entry paths point owners to the map with a pending function instead of a role-editor catalog.

- [ ] **Step 6: Re-run focused tests**

Run: `/Users/mac/worktrees/.lanes/tools/heavy.sh node --test desktop/src/features/cofounder/prebuiltHireChoice.test.mjs desktop/src/features/cofounder/prebuiltHireExecution.test.mjs`

Expected: PASS.

### Task 4: Verify map interactions, visual states, and repository gates

**Files:**
- Create or modify: `desktop/tests/e2e/prebuiltHeadHire.spec.ts`
- Modify: `desktop/src/testing/e2eBridge.ts`
- Modify: `~/colony-work/out/prebuilt-hire/REPORT.md`

- [ ] **Step 1: Add production-seam E2E cases**

```ts
test("owner hires a prebuilt head from the map and sees the assigned card", async ({ page }) => {
  await page.getByRole("button", { name: "Hire Head of Finance" }).click();
  await selectRuntimeAndModel(page);
  await page.getByRole("button", { name: "Hire Head of Finance" }).click();
  await expect(page.getByText("Head of Finance")).toBeVisible();
});

test("map uses Scout until a head is hired and does not render job plus controls", async ({ page }) => {
  await expect(page.getByTestId("job-doer-quotes")).toHaveText("Scout");
  await expect(page.getByTestId("job-doer-quotes")).not.toContainText("+");
});
```

- [ ] **Step 2: Run only the changed E2E spec through the heavy queue**

Run: `. ./bin/activate-hermit && /Users/mac/worktrees/.lanes/tools/heavy.sh env COLONY_E2E_PORT=4194 pnpm exec playwright test desktop/tests/e2e/prebuiltHeadHire.spec.ts --project=smoke`

Expected: PASS.

- [ ] **Step 3: Run allowed local checks**

Run: `. ./bin/activate-hermit && /Users/mac/worktrees/.lanes/tools/heavy.sh pnpm exec tsc --noEmit`

Run: `. ./bin/activate-hermit && /Users/mac/worktrees/.lanes/tools/heavy.sh pnpm exec biome check <touched-files>`

Run: `. ./bin/activate-hermit && /Users/mac/worktrees/.lanes/tools/heavy.sh pnpm check:px-text`

Expected: PASS.

- [ ] **Step 4: Capture required light and dark proof**

Build the E2E frontend with `pnpm build:e2e` through the heavy queue. Take `1440x900` and `1728x1117` screenshots for the empty card, first-hire dialog, assigned card, and first-move state in each theme. Call `waitForAnimations` before each capture. Verify all screenshot hashes are distinct before posting with `scripts/post-screenshots.sh`.

- [ ] **Step 5: Commit, push, open the PR, and wait for GitHub CI**

Run: `. ./bin/activate-hermit && git commit -s -m "feat: hire prebuilt heads from company map"`

Run: `. ./bin/activate-hermit && LEFTHOOK_EXCLUDE=desktop-tauri-checks git push origin colony/feat/prebuilt-agents-hire`

Open a PR to `develop`, post the verified screenshots, and wait for the GitHub CI checks for the final pushed SHA. Update `STATUS.txt` to `DONE` only after the PR is open, CI is green, screenshots are posted, and `REPORT.md` records the remaining unverified boundaries.
