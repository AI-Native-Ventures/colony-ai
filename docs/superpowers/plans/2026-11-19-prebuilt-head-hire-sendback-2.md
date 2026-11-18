# Pre-built Head Hire Send-back 2 Implementation Plan

> **For Colony contributors:** Execute on `colony/feat/prebuilt-agents-hire` and keep draft PR #868 open until the new head SHA is green in GitHub CI.

**Goal:** Finish the accepted pre-built head hire refinement by preventing long
model labels from colliding with Effort and preserving approved human-readable
head job labels everywhere a person reads them.

**Architecture:** Keep the existing reusable dropdown. The dialog supplies
correct required-state styling and a selected-label title, while the dropdown's
existing truncation remains the clipping boundary. The role adapter uses the
approved catalog display name instead of reconstructing a title from an
internal function id. Production builders remain the contract seam and the
shared fixture remains parsed by both TypeScript and Rust.

**Tech Stack:** React, TypeScript, existing AgentDropdownSelect, Node unit
tests, Playwright mock E2E, Rust serde fixture validation, GitHub Actions.

---

### Task 1: Correct popup field layout and required-state styling

**Files:**
- Modify: `desktop/src/features/cofounder/ui/PrebuiltHeadHireDialog.tsx`
- Modify: `desktop/tests/e2e/prebuilt-head-hire.spec.ts`

- [ ] Make each three-column label and trigger shrinkable, with the selected
      model label constrained to its own control and a native title containing
      the full model name.
- [ ] Replace selected-or-empty styling with an explicit required-and-empty
      predicate. Apply it to Harness, Model, and Effort according to the active
      selection dependencies.
- [ ] Add a production-seam mock E2E case with a long Goose model label. Assert
      the selected text is ellipsized, its title has the full label, Effort is
      neutral and disabled when no effort is configured, and all three field
      boxes do not overlap.

### Task 2: Preserve approved head job labels

**Files:**
- Modify: `desktop/src/features/cofounder/prebuiltAgents.ts`
- Modify: `desktop/src/features/cofounder/prebuiltHireModels.test.mjs`
- Modify: `test-fixtures/company-hire/prebuilt-head-finance.json`
- Modify: `crates/buzz-core/src/company_records.rs`

- [ ] Derive a pre-built head's fallback role-pack job from `agent.name`.
- [ ] Add TypeScript assertions for Finance and Customer Success, bound to the
      real proposal builder and fixture contract.
- [ ] Update the Finance fixture and add the Rust relay-type assertion for its
      exact user-readable job label.

### Task 3: Prove, commit, and hand off

- [ ] Run touched-file Biome, desktop TypeScript, px-text, focused Node tests,
      and the changed Playwright spec through the heavy queue.
- [ ] Capture only PbHireNext popup states in light and dark at 1440x900 and
      1728x1117, wait for animations, and verify unique image hashes.
- [ ] Commit with `git commit -s`, push the existing branch, post the refreshed
      screenshot comment, delete the obsolete screenshot comment, and wait for
      every required GitHub check on the final SHA.
- [ ] Record choices and evidence in `REPORT.md`. Leave `STATUS.txt` at
      WORKING until GitHub CI is green, then set it to DONE with the final SHA.
