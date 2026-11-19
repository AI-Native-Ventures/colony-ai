# Pre-built Head Hire Sendback 1 Implementation Plan

> **For Colony contributors:** Execute this plan on `colony/feat/prebuilt-agents-hire` after merging current `origin/develop`. Keep PR #868 draft until all required CI checks and proof are green.

**Goal:** Correct the owner-facing pre-built head hiring journey so approved first messages are visible only after a hire, heads consistently receive their colored ant avatars, the map-shell UI follows the approved board, and desktop and Rust share a checked wire contract.

**Architecture:** Keep `firstMove` as prompt-only catalog content. Add `firstMessage` to the approved catalog and store only that owner-visible copy in the resumable completion record. Centralize pre-built hire action builders beside the existing proposal builder, use them from the dialog, and lock their JSON shape through one repository fixture that both desktop and `buzz-core` parse with production types.

**Tech Stack:** React, TypeScript, Playwright E2E, Node unit tests, Rust serde validation, existing Colony mock bridge.

---

## 1. Approved catalog and owner-visible first message

**Files:**
- Modify: `desktop/src/features/cofounder/prebuiltAgents.json`
- Modify: `desktop/src/features/cofounder/prebuiltAgents.ts`
- Modify: `desktop/src/features/cofounder/prebuiltAgents.test.mjs`
- Modify: `desktop/src/features/cofounder/ui/PrebuiltHeadHireDialog.tsx`

1. Copy the approved catalog including every `firstMessage` value.
2. Extend the catalog type and exact-source integrity guard.
3. Keep `firstMove` exclusively in generated agent instructions.
4. Rename the owner-facing delivery helper and completion field to `firstMessage`; reject legacy completion records containing only `firstMove` so prompt instructions cannot reappear in UI.
5. Send the greeting plus `firstMessage` once behind the existing durable marker and use the same visible message in the Just hired card.

## 2. Board-aligned hiring dialog and map actions

**Files:**
- Modify: `desktop/src/features/cofounder/ui/PrebuiltHeadHireDialog.tsx`
- Modify: `desktop/src/features/cofounder/ui/CompanyMapPartCard.tsx`
- Modify: `desktop/src/features/cofounder/ui/CompanyMapPhone.tsx`

1. Derive the home channel without rendering a channel chooser. Show a direct recovery message if no eligible channel exists.
2. Build the board hierarchy: function eyebrow, head title, Scout handover line, agent strip, a single tinted does/asks box, ordered choice controls, helper copy, footer warning, and disabled action until all values are selected.
3. Use the project-styled choice control treatment with 46px fields and an accent border until a value is selected.
4. Put Hire first and primary for an empty available pre-built slot, then Open, then Close. Retain Open as primary once a head exists. Mirror this order on the phone surface.

## 3. Avatar continuity

**Files:**
- Add: `desktop/src/features/cofounder/prebuiltAgentAvatar.ts`
- Modify: `desktop/src/features/cofounder/ui/PrebuiltHeadHireDialog.tsx`
- Modify: `desktop/src/features/cofounder/ui/CompanyMapPartCard.tsx`
- Modify: `desktop/src/features/cofounder/ui/CompanyMapPhone.tsx`

1. Use one helper for the exact colored ant URL derived from the pre-built head name.
2. Supply that value while creating the managed agent and as the deterministic map/card fallback while relay data is pending.
3. Verify the created managed agent carries the same avatar through the mock flow used by Team and direct chat.

## 4. Wire fixture and production builders

**Files:**
- Add: `test-fixtures/company-hire/prebuilt-head-finance.json`
- Modify: `desktop/src/features/cofounder/prebuiltHireModels.ts`
- Modify: `desktop/src/features/cofounder/prebuiltHireModels.test.mjs`
- Modify: `crates/buzz-core/src/company_records.rs`

1. Export production action builders for create, slot access, approve, attach employee, and complete.
2. Make the dialog send those builders' outputs.
3. Compare every desktop payload against the shared Finance fixture.
4. Deserialize the fixture in `buzz-core` using real hire and access types, then validate every action and proposal.

## 5. Map-shell journey proof

**Files:**
- Modify: `desktop/tests/e2e/mapShellTestSupport.ts`
- Modify: `desktop/tests/e2e/prebuilt-head-hire.spec.ts`

1. Add an injected mock seam to map-shell setup and make the primary journey begin at map home with `map_home` and cofounder enabled.
2. Verify the new pre-built card, board dialog, actual hire, colored face, owner-visible first message, running managed agent, and owner reply through the normal send and mention-reconciler flow.
3. Keep one sidebar-map journey and one phone-map journey.
4. Regenerate comparison screenshots in light and dark at 1440x900 and 1728x1117, wait for animations, then verify image hashes are distinct.

## 6. Quality gates and handoff

1. Run targeted Biome, TypeScript, px-text, unit, and changed Playwright checks through `heavy.sh`.
2. Commit with `-s`, push normally so Rust and Tauri gates run in GitHub CI.
3. Post only the refreshed screenshot comment, delete the obsolete PR screenshot comment, monitor all required checks to green, and write current evidence and choices to `REPORT.md`.
4. Set `STATUS.txt` to `DONE: PR 868 green at <sha>` only after all required PR checks are green.
