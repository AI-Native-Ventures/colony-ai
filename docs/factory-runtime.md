# Factory run runtime

Factory runs are owned by the native desktop host. Renderer panes subscribe to
run data, but they do not own or stop the underlying ACP process.

## Ownership and storage

The runtime is registered in `desktop/src-tauri/src/lib.rs` and implemented in
`desktop/src-tauri/src/factory_runtime.rs`. Run metadata, transcript events,
and unsent drafts are stored in SQLite at
`<app data directory>/factory/runs.sqlite3`. The database uses WAL mode and
foreign keys. On Unix, the Factory directory is owner-only and the database is
owner-readable and owner-writable. Parent run ids form the parent and child
graph.

Each run records its project id, repository id, canonical checkout path, agent
id, selected harness, ACP session id, lifecycle status, timestamps, and latest
error. It also stores its immutable native authorization scope: relay URL,
identity pubkey, business community id, and optional client channel id. The
initial prompt is stored as the first transcript event in the same transaction
that creates the run. Drafts are one record per run and persist independently
from transcript events.

The active scope is installed only by `apply_workspace`, after the native host
has applied and re-read its own relay URL and signing identity. The host checks
the selected business community against the active identity's NIP-98
authenticated `/api/communities/mine?scope=member` response. A requested client
channel is accepted only after the native host verifies the relay-signed
kind:39002 membership event using its NIP-42 authenticated relay session. A
positive or negative client membership result is cached for 30 seconds.
Workspace binding and every event-stream reattach force a fresh client
membership query. If client membership is revoked, the current Factory scope is
cleared and its renderer attachments stop receiving events. Scope changes
detach renderer subscriptions without cancelling their durable runs.

Every Factory list, snapshot, draft, cancel, create, and reattach operation is
filtered by the active scope. A run from a different business or client is
reported as not found for single-run operations. Parent runs must have the exact
same scope. When project or repository ids are supplied, the native host checks
their signed announcements on the active relay, verifies that a selected
repository is listed by its project, and requires any client-scoped project or
repository to carry the active client channel tag. Rows created by earlier
versions have empty scope columns after migration and remain inaccessible.

## Lifecycle

Creation persists a queued run before starting a worker. The worker resolves the
local agent configuration without loading managed-agent private keys from the
OS keyring, then starts an ACP client in the selected checkout. Up to 30 ACP
sessions can run at once. Up to 30 additional runs can wait in the native
queue. Creation is rejected when that queue is full.
Each create request supplies a stable `operationKey`. The native store binds it
to a hash of the normalized request in the same transaction as the queued run.
An identical retry returns the original run without scheduling another ACP
worker. Reusing a key with different request data is rejected. If the queued to
running checkpoint temporarily fails, that worker remains attached to the
queued run and retries with a capped backoff until the checkpoint succeeds or
the run is cancelled.
At most 256 renderer event subscriptions are held at once.

The run statuses are `queued`, `running`, `waiting`, `blocked`, `error`,
`done`, and `cancelled`. `waiting` is part of the shared status contract for
future user-mediated ACP waits. The current ACP client resolves permission
requests internally, so this runtime does not currently emit `waiting` for a
human approval step.

Cancel is explicit through `cancelFactoryRun`. Detaching a subscription only
ends that renderer's event stream. It does not cancel the run. Closing a pane
therefore leaves the native worker and its durable transcript alone.

The ACP client does not expose a generic session restore operation. After the
native host starts with a different host id, queued, running, and waiting runs
are marked `blocked`, with their saved transcript and drafts preserved. The
runtime does not claim that the provider process resumed. The user can inspect
the saved run and start another run to continue.

Transcript capture treats observer lag and database write errors as run errors.
It attempts to persist a `transcript_capture_error` marker. A failed capture
task overrides a successful ACP prompt result, so a partial transcript cannot
be reported as a completed run.

## Renderer API

The typed API is in `desktop/src/shared/api/factoryRuntime.ts`:

- `createFactoryRun` creates a durable run.
- `listFactoryRuns` returns up to 200 recently updated runs.
- `getFactoryRunSnapshot` reads an event page and indicates whether more pages
  remain through `hasMore`. Pass the last event sequence as `afterSequence` to
  read the next page.
- `reattachFactoryRun` returns an attachment with a snapshot promise and a live
  event subscription. Call its `detach` method when the pane no longer observes
  the run. Detach also waits for an in-flight attachment command before
  releasing the native subscription.
- `cancelFactoryRun` explicitly cancels the run.
- `setFactoryRunDraft` and `getFactoryRunDraft` store and retrieve the unsent
  draft.

Transcript event sequence numbers are durable SQLite cursors. The runtime saves
ACP message, tool, plan, and configuration update events. Reasoning chunks are
not included. Individual event payloads are capped at 64 KiB and each run's
transcript is capped at 8 MiB. A `transcript_truncated` event marks when the
per-run limit is reached. Snapshot pages contain at most 1000 events. The
renderer buffers at most 512 live events while the initial snapshot is loading;
it is notified when it must resynchronize after buffer overflow or stream lag.
Run and event API objects include the stored scope, and the native event
publisher checks both that scope and the current host relay and identity before
forwarding an event.

The aggregate Factory store limits run, transcript, and draft payload to
120 MiB. The SQLite database file is capped at 128 MiB using a page ceiling
calculated from its page size, leaving room for status and capture-error events
plus SQLite bookkeeping. WAL checkpointing and a 4 MiB journal size limit keep
the transient journal bounded. The store
targets 100 retained terminal runs. When a new terminal run crosses that limit,
the oldest terminal leaf run and its transcript and draft are removed in the
same transaction. Active and blocked runs are protected, as are terminal
parents that still have children. Creation is rejected at 200 total stored runs
when the retained graph cannot be pruned safely.
These limits are local retention behavior; users who need long-term run history
must preserve it outside this runtime before retention removes it.

## Operational boundaries

Factory uses the existing `buzz-acp` client and its process-group cleanup. The
current worker starts one ACP session for its initial prompt. Draft persistence
does not send a prompt. The runtime does not create UI panes or define Factory
visual layout; those remain renderer concerns governed by the frozen design.
