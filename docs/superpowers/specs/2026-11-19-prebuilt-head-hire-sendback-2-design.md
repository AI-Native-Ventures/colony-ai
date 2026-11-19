# Pre-built head hire send-back 2 design

Date: 19 November 2026. Design authority: coordinator acceptance notes in
`/Users/mac/.claude/coord-work/colony-prebuilt/briefs/S1-SENDBACK2.md`.

## Scope

This approved refinement changes only the existing pre-built head hire dialog
and the role-pack label derived from the approved agent catalog.

## Dialog fields

The Harness, Model, and Effort controls remain a three-column row on desktop.
Each field may shrink inside its column. A selected model label stays on one
line, clips with an ellipsis, and exposes the complete label through its native
title. The untruncated option label remains available in the menu.

An accent border is a completion signal, not a generic empty-state treatment.
It appears only when a field is currently required and has no value:

- Harness is required until selected.
- Model is required only after a harness is selected.
- Effort is required only when the selected model exposes effort choices.

Consequently, a disabled Effort field reading "Set by this harness" uses the
normal input border.

## Role-pack label

For a pre-built head whose catalog `job` is null, the user-readable role-pack
job is the approved `agent.name`. This preserves display capitalization and
spacing, including "Head of Finance" and "Head of Customer Success", in the
proposal, Team, persisted hire record, and shared relay fixture.

## Proof boundary

The focused desktop mock E2E test will select a deliberately long model label,
assert that all three controls have disjoint horizontal boxes, verify the
ellipsis/title contract and the neutral disabled Effort border, and capture the
approved popup state. This proves desktop UI behavior against the mock bridge;
GitHub CI proves repository checks. It does not prove a packaged desktop build
or a live relay runtime.
