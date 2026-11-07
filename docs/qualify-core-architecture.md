# Qualify core architecture

Status: implemented core contract, under focused verification. This document is
the architecture note placed first in the PR body.

## Decision

Qualify runs on the owner's computer in the Electron main-process boundary.
The renderer does not fetch websites, resolve DNS, parse page bodies, or manage
the resumable queue. The relay remains the signed record broker. It never
crawls a website and receives no website credential.

This PR supplies the engine and record contracts only. It deliberately does not
add an Electron renderer endpoint, a screen, or a hard-coded agent name. PR 2
will attach the approved controls and screens to the bounded engine through a
narrow trusted-renderer bridge.

Selection data starts disabled with no selected signals. The first seven v1
signals are exported as the recommended shortcut, but the shortcut is not
applied by default.

## Additive record contract

Two new business-record kinds carry qualification data:

- `KIND_QUALIFY_OBSERVATION_ACTION = 47070`
- `KIND_QUALIFY_OBSERVATION_HEAD = 30681`

An action is member or agent signed. The relay validates it, confirms that the
referenced prospect is in the registered business channel, enforces the exact
current-head fence, and atomically writes a relay-authored latest head. The
head coordinate is `business:<community>:qualify_observation:<lead-id>`.
Immutable actions retain prior runs.

Every action contains an explicit `checkedSignals` set and zero or more fact
rows. The explicit set matters: a selected check that found no fact is distinct
from a check that was never attempted or ended as `not_checked`. This lets a
must-not-have filter avoid treating unknown data as an absence claim.

Each row has its signal, `observed` or `not_checked` state, text or numeric
value, confidence, evidence URLs, observed time, run id, optional failure
reason, and a `personalData` flag for a personal-looking public email.
`not_checked` rows cannot carry a value, confidence, or evidence. Observed
rows require evidence except an evidence-free no-URL `NO_WEBSITE` result.
The relay also enforces the booking cap of 0.6, the no-WhatsApp cap of 0.7,
and the incumbent-builder minimum of 0.75.

The new kinds are additive. Existing desktop versions neither query nor parse
them, so ordinary lead records continue to load. This desktop does parse the
new heads separately. Prospect records add an optional Maps snapshot containing
rating, review count, category, and city, while older records remain valid.

## Fetch and extraction boundary

The Electron modules are deliberately small and injectable:

1. `ssrf-fetcher` accepts only HTTP or HTTPS on ports 80 and 443. It resolves
   DNS itself, rejects non-public address forms, pins the validated address for
   the connection while preserving TLS and Host names, checks every redirect,
   ignores proxy settings, sends no cookies or credentials, and never executes
   JavaScript. It accepts only HTML or plain text, limits each response to one
   MiB and eight seconds, and never logs a page body.
2. `extractors` are pure functions over Maps fields and bounded fetched pages.
   They produce only the thirteen selected v1 signals. A blocked, down,
   oversized, timed-out, or otherwise uncheckable site becomes `not_checked`;
   it never becomes a negative content claim.
3. `run-controller` caps work at 300 businesses, four concurrent businesses,
   five pages per business, and 25 seconds per business. It checks robots for
   the homepage and every fetched follow-up path. It writes an unpublished
   action to an injected durable store before calling the injected publisher,
   so an interrupted publish can resume without refetching. The production UI
   integration will provide the explicit app-owned store path and publisher.

No-URL and known social, link-in-bio, or directory URLs produce a Maps-only
`NO_WEBSITE` result without a website fetch. Normal sites may add only four
same-site contact, about, booking, or careers pages. An HTTPS to HTTP result is
recorded for `NO_HTTPS`; a failed page produces no other content conclusion.

## Targeting and draft context

The filter evaluator is pure. `mustHave` requires every requested observed
signal. `mustNotHave` requires that each signal was checked and has neither an
observed row nor a `not_checked` row. Rating and review ranges use the retained
Maps snapshot, while category and city use its values with safe legacy
fallbacks. Saving delegates to the existing outreach-list builder and stores
the matching lead IDs at that moment, never a live query.

The draft-context mapper accepts only observed rows that are no more than 30
days old, have confidence of at least 0.6, and include evidence. It excludes
public email from v1 drafting. Facts at confidence 0.85 or above are plain
statements. Lower-confidence negative facts use limited language beginning
with "I couldn't find ...". The same filtered facts and evidence URLs form the
approval-card evidence payload. No surviving fact means the consumer must use
its generic opener.

## Verification and boundaries

Focused fixture tests cover SSRF address and redirect rejection, streamed body
limits, timeout handling, robots enforcement, each extractor, confidence caps,
resumable scheduling, filters, static list IDs, draft evidence, and old-client
compatibility. Core tests validate the storage contract. An ignored
disposable-Postgres test binds a signed action to the production broker and
checks the relay-authored head; it is compiled locally and is for CI's
infrastructure lane.

This proof does not establish live-site behavior, a packaged desktop, a relay
deployment, data retention after twelve months, legal approval, or end-user UI
behavior. Relay deployment and desktop release remain separate decisions after
the exact PR commit is green in GitHub CI.
