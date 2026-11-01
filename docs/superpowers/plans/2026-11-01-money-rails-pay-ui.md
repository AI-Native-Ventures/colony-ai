# Money Rails Payment UI Implementation Plan

> **For agentic workers:** Execute inline in the assigned UI worktree. Keep relay integration behind the documented contract and never merge.

**Goal:** Implement the approved payment-link approval, connection, browser confirmation and customer money interfaces against the mock bridge, then bind them to the relay contract when it lands.

**Architecture:** Keep payment-link facts and state labels in a focused cofounder model, reuse one accessible card in chat and Needs you, and add provider setup under Business settings. Route the browser exception through the existing Electron broker so it is origin-bound, task-bound, time-limited and consumed once. Keep fixtures in the E2E bridge until the relay document supplies the real event shapes.

**Tech Stack:** React 19, TypeScript, Tailwind/CSS, TanStack Query, Playwright, Electron browser broker.

---

## File Structure

- `desktop/src/features/cofounder/moneyRails.ts`: payment-link and connection view types, state labels and edit invalidation rules.
- `desktop/src/features/cofounder/ui/MoneyRailPaymentCard.tsx` and `moneyRails.css`: shared chat and Needs you card, including all payment states.
- `desktop/src/features/cofounder/ui/MoneyRailsSettingsPanel.tsx`: provider list and add-provider dialog with browser/API routes, safe key entry and blocked money-out actions.
- `desktop/src/features/cofounder/ui/CustomerRecordScreen.tsx`: money summary and payment-link states.
- `desktop/src/features/settings/ui/SettingsPanels.tsx`: Business > Money and calendar navigation.
- `desktop/src/features/messages/ui/MessageRow.tsx`: render the shared card from the relay-defined payment-link reference once the contract is available.
- `desktop/src/features/workarea/browser/*` and `desktop/electron/browser-broker/*`: one-use Create authorization scoped to the approved provider origin and task, expiring after 15 minutes.
- `desktop/src/testing/*`, `desktop/tests/e2e/money-rails-payment.spec.ts`, `desktop/tests/e2e/affected-map.json`, and `desktop/playwright.config.ts`: mock fixtures, state and board coverage, and CI mapping.

## Task 1: Payment-link model and shared card

- [ ] Define the states `draft`, `needs_you`, `creating_link`, `sent`, `payment_reported`, `paid`, `expired`, `cancelled`, and `failed`.
- [ ] Render the exact approved board facts, message, provider route, expiry and money-only safety copy in one shared card.
- [ ] Keep Approve disabled while edits are unsaved. Saving an edit clears approval provenance and returns the card to the review state.
- [ ] Provide explicit screen-reader labels and role alerts for failures.

## Task 2: Settings and customer record

- [ ] Add the Business > Money and calendar section and show provider, route, status and last use.
- [ ] Add browser and API-key connection modes. Keep key input password-masked, clear it after submit, and never include it in returned data or UI text.
- [ ] Show create-link and payment-check actions as allowed. Show refunds, payouts, transfers and withdrawals as blocked.
- [ ] Add the payment-notice address and copy action.
- [ ] Render paid, reported-check and expired states in the customer money section.

## Task 3: Mock bridge, chat and Needs you

- [ ] Add fixture-backed payment-link and connection queries/actions without calling provider services or inventing relay event payloads.
- [ ] Render the shared card in the message row and Needs you after the relay contract documents the card reference and action shapes.
- [ ] Keep owner/admin approval controls aligned with the card state; show errors without dropping the pending card.

## Task 4: Browser one-use approval

- [ ] Add a main-process authorization record bound to one task, provider origin and payment-link Create action.
- [ ] Set expiry to 15 minutes and remaining uses to one. Consume it only for the matching payment Create action.
- [ ] Preserve normal confirmation for Pay, Refund, other origins, other tasks, and later Create actions.
- [ ] Add production-seam broker tests for exact host, action, task, expiry, one-use consumption and rejection of other categories.

## Task 5: E2E, boards and delivery

- [ ] Add mock E2E coverage for each supplied payment board and every payment-link state, including disabled Approve after edit and no API-key echo.
- [ ] Map the focused spec in `desktop/tests/e2e/affected-map.json` and include it in the smoke project's `testMatch`.
- [ ] Capture board comparisons at 1440 px and 390 px in light and dark themes, store them beside the approved renders, and post them with `scripts/post-screenshots.sh`.
- [ ] Run focused desktop type, mock E2E and browser-broker checks. Do not run Cargo locally. Push the UI branch, open the required PR and redproof drafts, inspect exact-SHA CI, and do not merge.
