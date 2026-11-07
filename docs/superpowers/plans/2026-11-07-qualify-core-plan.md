# Qualify core implementation and test plan

Status: implementation began after coordinator GO and is complete locally,
pending focused verification, PR review, and exact-head CI. This plan remains
the design and test record for PR 1; approved screen wiring is deferred to PR 2.

## Acceptance gate

The implementation is ready for review only when the Electron-main engine
collects no more than the selected thirteen v1 website signals under all
specified safety limits, stores complete per-lead facts through additive relay
records, filters and snapshots matching outreach-list IDs correctly, and makes
only fresh confident evidenced facts available to drafting and approval data.
No screen, setting, outgoing-message behavior, live website fetch, native
runtime, owner home path, production system, or protected branch is touched.

## Planned implementation sequence

1. Add the two additive kind constants and a typed qualification-record module
   in `buzz-core`. Define signal codes, observation states, evidence and value
   limits, per-lead action and head types, d-tag validation, whole-snapshot
   validation, and an old-client-safe parse boundary. Add the command to the
   business command parser and scope validator.
2. Add the relay planner beside outreach-list planning. It will require the
   normal outreach actor role, verify the referenced prospect belongs to the
   registered business channel, enforce expected-head concurrency, and atomically
   persist the member action and relay-authored head. It never fetches a URL.
3. Add a pure Node module under `desktop/electron/qualify` for address parsing,
   DNS resolution, public-address validation, request construction, redirects,
   robots, content-type filtering, streaming body cap, and typed outcomes.
   Use injected resolver, request, clock, and logger seams for deterministic
   fixture tests. Do not use global `fetch` with a second DNS lookup.
4. Add a pure extractor module for the thirteen signals. Pass Maps metadata,
   homepage result, and at most four allowed linked-page results as explicit
   inputs. Preserve evidence URLs for every claim and make `not_checked` a
   distinct output rather than a false value.
5. Add a durable run-controller module that accepts an explicit lead snapshot,
   selected signals, refresh flag, and run id. It owns the fixed caps, a
   four-worker scheduler, abort propagation, resumable queue state, per-lead
   atomic publish, and progress events. Use an injected file store in tests.
6. Defer narrow trusted-frame IPC in Electron main and preload to PR 2, when
   approved screen wiring exists. The renderer API must receive validated
   controller arguments and immutable progress snapshots, not network, DNS,
   filesystem, or signing access. It must not expose a generic website-fetch
   operation.
7. Add renderer-side record parsing and relay queries for the new head kind,
   retaining existing lead data unchanged. Extend the Discovery import mapping
   additively only as needed to retain Maps rating, review count, category, and
   city for the filter evaluator.
8. Add pure qualification filter and static outreach-list save functions.
   Connect the selected IDs to the existing `buildOutreachListCreateAction`
   path, never a live query. Add the shared drafting-context and approval-data
   mapper as a pure contract in PR 1; attach it at the actual runner and
   message-draft lead-context seam in PR 2.
9. Add stale-data guards. Facts older than 30 days are excluded from targeting
   and drafting. Twelve-month deletion or refresh maintenance is explicitly
   deferred pending a separate retention and legal decision.
10. Run focused unit, core, relay, TypeScript, formatting, and static checks
    through the approved heavy runner. Open a signed PR to `main`, wait for the
    exact head SHA to pass GitHub CI, and never merge it.

## Falsifiable test matrix

| Area | Production seam | Required cases |
| --- | --- | --- |
| Address policy | `ssrf-fetcher` request path | Reject literal loopback, private, link-local, carrier-grade NAT, multicast, metadata, IPv6 loopback, IPv4-mapped IPv6, decimal, octal, and hexadecimal IPv4 forms; allow only HTTP and HTTPS on ports 80 and 443. |
| DNS and redirects | resolver plus request adapter | Reject a hostname resolving to a private address, revalidate every redirect, reject a chain beyond four redirects, preserve host TLS and Host while connecting to the validated address, and record the allowed HTTPS to HTTP downgrade condition. |
| Stream and time limits | real stream reader and abort path | Accept only HTML and plain text, reject wrong content type, stop a body over one MiB mid-stream, stop a slow-loris response at eight seconds, enforce 25 seconds and five pages per business, and never log a fixture body. |
| Robots and failures | controller plus fetcher | A homepage robots block produces only `not_checked(blocked_by_site)` for selected checks. DNS, TLS, timeout, 5xx, oversized, cancel, and cap failures never yield a negative content claim. |
| Extractors | real extractor exports | One positive and one negative fixture per signal, evidence URL assertion, confidence cap assertion for booking and no-WhatsApp, footer-credit confidence floor, and no JavaScript assumption. |
| Scheduler | real run controller | Maximum 300 selected businesses, no more than four active workers, resume after interruption, cancel prevents new starts, 30-day skip unless refresh, progress order, and retry after uncertain publish. |
| Record contract | core validation and relay planner | Reject invalid signal code, malformed observation, duplicate signal, stale expected head, cross-channel lead, non-member actor, and partial action. Verify one complete action produces one relay-authored head. |
| Compatibility | existing business-record loader | A fixture set containing the new unknown head kind leaves an older-desktop record load intact with no error and no empty state. |
| Filtering and list save | filter evaluator and existing list action builder | Must-have intersection, must-not-have exclusion, rating and review ranges, category and city predicates, unchecked lead exclusion from every signal predicate, and exact static lead IDs in the saved list. |
| Draft facts | shared lead-to-draft mapper | Include only observed, fresh, confidence-at-least-0.6 facts with evidence; exclude stale, uncertain, missing-evidence, and not-checked rows; expose matched evidence for approval data; emit generic fallback context when none survive. |
| Retention | stale-data guards | Exclude data at 30 days. Twelve-month deletion or refresh maintenance is not part of PR 1. |

## Mutation protocol

After each newly written focused test group, make one temporary defect in the
production module it exercises. First copy the target file to a scratch backup
under the repository's `.qualify-mutation-backups/` directory. Run the
focused test and confirm it fails for the intended assertion. Restore from that
backup, remove the scratch backup, and run the test again. Never use
`git checkout` or a broad reset to restore a mutation.

The PR body will list at least these recorded mutations and the failing test
name for each:

1. Return a public result for a loopback address in the SSRF address guard.
2. Suppress a known WhatsApp link in the extractor.
3. Allow a fifth active business in the scheduler.
4. Treat a missing signal observation as matching `mustHave`.
5. Admit a stale or evidence-free observation into draft context.
6. Remove qualification action validation for an invalid signal code.

## Verification boundary

Focused fixture and unit tests prove deterministic code paths, not a live
website ecosystem, a packaged desktop, relay deployment, or end-user
behavior. GitHub CI remains the merge gate. A relay rollout and a desktop
release are separate future decisions after the implementation PR is green.
