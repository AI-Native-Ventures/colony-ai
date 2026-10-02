# Colony launch security review

Review period: 2026-10-01 to 2026-10-02

Review base: Colony Phase 2 integration fork from `origin/develop` at `475fcf5a`. Review scope is code added or changed since that fork point, including auth, account, payment, company-record, HTTP, Electron, release, and dependency changes. No production relay, database, Fly app, or production workflow was accessed or run.

## Reviewed

- Account creation, sign-in, email verification, password reset, sessions, key handling, Google token checks, enumeration, brute force resistance, and auth rate limits.
- Payfast ITN signature and source validation, merchant and amount checks, replay and idempotency, ledger writes, arithmetic, races, and checkout return URLs.
- Brokered company-record writes, authority and visibility checks, p-tag and d-tag trust, expected-head handling, secret bindings, consent and permissions, input limits, and deserialization bounds.
- HTTP event, query, count, CORS, security headers, Blossom uploads and downloads, tenant boundaries, and outbound fetch validation.
- Electron host isolation, IPC allowlists, navigation, window opening, protocol and deep-link handling, updater behavior, and command execution surfaces.
- Relay and client pacing, retry queues, release workflows, production workflow source, repository controls available through read-only GitHub APIs, package advisories, and repository history secret-scan candidates.

## Confirmed findings

### Medium, confidence 9/10: sign-in disclosed unverified account state before password verification

A caller could submit an incorrect password for an unverified account and receive `email_unverified`. The path also allowed failed guesses to trigger verification email without following the password-failure counter. The test-first production decision test failed before the fix because the handler returned `EmailUnverified` instead of entering password verification.

Status: fixed in PR #166 and merged by the coordinator at `382c46b5230de880fa9c972fdb43c7fb8fce58fe`. Hosted CI run `36900884461` passed. No deploy or live verification was performed.

### Medium, confidence 9/10: HTTP query and count accepted unbounded filter counts

`POST /query` and `POST /count` limited request bytes but did not limit the number of filters in a request. A caller could make a single HTTP request add substantially more server-side query work than the one-request admission accounting reflected. The WebSocket parsers already enforce a limit of ten filters.

Status: fixed in PR #163. The production parser test failed first on eleven filters and accepted ten. Fix commit `49ffd09a391132907ccfbab13aeb5fc4bbd48c59` was merged at `97f6e1d0433b5fc082f4b77207a5f42234623a15`. Hosted CI run `36915223583` passed. No deploy or live verification was performed.

### Medium, confidence 9/10: mobile relay operations waited outside the bounded scheduler

After a relay rate-limit response, concurrent history requests, publishes, and paced frames awaited the shared gate before entering the scheduler. Those suspended operations bypassed its 256-item queue bound. The new `RelaySessionNotifier.publish` regression failed before the fix: publish 257 timed out waiting on the active gate instead of failing promptly with the scheduler's queue-full `StateError`.

Status: fixed in PR #174, commits `730292b19` (test first) and `e59921cd9` (fix). History requests, publishes, and paced frames now enter the bounded scheduler before the gate delay. Local `relay_session_test.dart` passed all 54 tests, `flutter analyze --no-pub` passed, and pre-push file-size checks passed. On head `e59921cd924fa2ede9fbf431aa322b54ee5622b6`, the first hosted CI attempt failed during Android debug APK packaging after format, analysis, and tests passed. Safe job metadata identified Gradle dependency resolution. The same-head rerun passed. The first iOS landing and relaunch proof failed in its XCTest step; its log contained token-like content, so no lines were printed, and available artifact metadata did not identify a failing assertion. The same-head iOS rerun passed. All current PR checks passed or were intentionally skipped. CI run `36928647163` attempt 2 and iOS runtime run `36928646696` attempt 2 completed successfully. PR #174 was merged by the coordinator at `f5013d52c8a1289e22cf4a053c17b9973958418f`. Not deployed or live-verified.

### Medium, confidence 9/10: signup reveals whether an email is registered

`/api/accounts/signup` returns `409 email_taken` for an existing address, which lets an unauthenticated caller test whether an account exists. Desktop onboarding has a designed recovery treatment for that response. Changing it changes the current auth flow, so no fix was chosen without product direction. This risk remains open.

## Advisory inventory with reachability unconfirmed

The current `pnpm audit --prod` reports six advisories: two high and four moderate. The lockfile includes `@tiptap/core` 3.22.5 and `markdown-it` 14.1.1 in the composer dependency tree, and vulnerable `nanoid` versions under PostCSS and Vite. The advisories cover Markdown parsing complexity, Tiptap attribute handling, PostCSS source maps, and a zero-size nanoid loop. Source review did not confirm attacker-controlled relay content reaching the vulnerable parser or generator paths. No dependency change is claimed.

- [GHSA-2v37-7h3g-55p8](https://github.com/advisories/GHSA-2v37-7h3g-55p8)
- [GHSA-j95f-988m-3j2f](https://github.com/advisories/GHSA-j95f-988m-3j2f)
- [GHSA-6v5v-wf23-fmfq](https://github.com/advisories/GHSA-6v5v-wf23-fmfq)
- [GHSA-fxqj-rqcc-2cmp](https://github.com/advisories/GHSA-fxqj-rqcc-2cmp)
- [GHSA-cp6q-959q-f8rh](https://github.com/advisories/GHSA-cp6q-959q-f8rh)
- [GHSA-253c-mchw-3w2r](https://github.com/advisories/GHSA-253c-mchw-3w2r)

`cargo-deny` and `cargo-audit` were not installed, and no deny configuration was present, so the Rust dependency audit could not be completed locally.

## Unconfirmed control risks and review limits

- The production Fly workflow has a dry-run path and requires a default-branch dispatch, typed confirmation, and a recorded data plan for a live deploy. It has no source-level GitHub environment reviewer gate. Repository-level API checks found no configured environment, no repository rulesets, and no branch protection on the queried branches. The workflow token default is read-only. The read-only token could not inspect organization rulesets or establish effective tag and dispatch restrictions. A writer who can dispatch the workflow and access its secrets could execute the production deploy path; effective organization controls remain unconfirmed, so this is not reported as a confirmed unauthorized exploit. The workflow was not dispatched.
- The desktop release workflow can run from matching release tags and exposes signing secrets to its build job, with a publish job granted `contents: write`. It has no source-level environment reviewer gate. Repository-level tag protections were not confirmed, and organization-level rulesets were inaccessible to the available token. A writer able to create a matching tag could run that tag's workflow with signing secrets and publish assets if no inherited controls block it. This remains an unconfirmed release-control risk. No release workflow was run.
- Visible repository grants showed one direct write or admin collaborator and no visible team grants. No identities are included here. Whether organization controls restrict the effective actor set remains unconfirmed.
- Source review found Google token verification checks for issuer, audience, expiry, signature algorithm, verified email, and bounded key lookup. Deployed provider configuration and live rate-limit behavior were not verified.
- No live CORS behavior, security headers, database state, production secret custody, or runtime deployment mapping was verified.
- The history secret scan produced heuristic candidates, including two post-fork test-fixture strings. No active credential was confirmed. Candidate values are excluded from this report.
- No credits deep-link implementation was present in the reviewed source.

## Findings not confirmed in reviewed code

No confirmed Payfast signature, source validation, merchant or amount mismatch, replay, idempotency, or ledger race defect was found. No confirmed company-record authority bypass, secret-value storage, expected-head race, cross-community HTTP leak, SSRF path, Electron IPC or navigation bypass, or command execution bypass was found.

## Delivery state

- Implemented and merged: account sign-in ordering, PR #166; HTTP filter count bounds, PR #163; mobile scheduler admission, PR #174 at merge commit `f5013d52c8a1289e22cf4a053c17b9973958418f`.
- Hosted CI passed on PR #174 head `e59921cd924fa2ede9fbf431aa322b54ee5622b6`, including successful same-head retries of the Android package build and iOS runtime proof after their first attempts failed. The cause of the first iOS failure remains unconfirmed.
- Open product decision: whether signup should keep its account-specific `email_taken` recovery response or use a uniform response.
- Deployed and live-verified: none.
- Production actions: none. The production workflow was reviewed statically only and never run.
