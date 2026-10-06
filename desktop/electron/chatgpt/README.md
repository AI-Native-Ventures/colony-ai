# ChatGPT plan P1

OAuth and renewable sessions run in Electron main. There is no P1 UI and no
agent funding integration. Main starts one installation-scoped service, listens
for resume, and stops it on quit. Community remounts do not change registrations.

`COLONY_CHATGPT_PLAN=1` enables the feature. `CHATGPT_BUILD_CONFIG` defaults both
`enabled` and `testBuild` to false. Without enablement, status reports disabled,
mutating IPC fails, and no storage, network, listener or browser is started.
Only main-window requests that passed the existing sender/frame checks reach
the metadata adapter. The renderer receives no credential file path or tokens.

The two origin overrides are honored only with a trusted test-build config:
`COLONY_CHATGPT_AUTH_ORIGIN` and `COLONY_CHATGPT_API_ORIGIN`. Each accepts only
an explicit `http://127.0.0.1:PORT` origin. Production ignores both. Authorization
and token exchange use the same resource and the exact loopback callback URI.
Discovery pins the OpenAI issuer and confines JWKS/revocation to the auth origin.

Storage under `<userData>/chatgpt`:

- `host.json`: one persisted `urn:uuid` host identifier, separate from accounts.
- `accounts.json`: one atomic registry containing separate logical records keyed
  by issued client ID and verified subject, active selection, generations,
  credential tuples, pending registrations and pending revocation journals.
- `writer.lock/`: an exclusive installation lock with a uniquely named 0600
  owner file. An O_EXCL owner file and directory claim serialize writers. Dead
  owner cleanup cannot remove a successor's differently named owner file.

All writes use a same-directory exclusive temporary file, fsync, rename and
Unix directory sync. Files are 0600 and the folder is 0700 on Unix. Symlinks,
hard-linked files, unexpected ownership/modes and oversized state fail closed.
Windows inherits its private user-profile ACL and checks it with `icacls.exe`
before folder use, credential reads and writes to empty temporary files. SID-based
SDDL inspection rejects grants to Everyone, Authenticated Users and
Users / BUILTIN\\Users, including inherited grants and read-control rights.
Inspection has a 30 second deadline and one timeout retry, bounded output and
scratch cleanup. A failed check propagates before secret bytes are written;
the previous snapshot and durable rotation/revocation journals remain intact.
The existing Windows build job checks both the folder and credential file.
No Keychain or safeStorage code is called. See the at-rest trade-off in
[CLEAN-ROOM.md](../../../CLEAN-ROOM.md).

An in-progress refresh is journaled before calling OpenAI. Rotated credentials
are saved together before further network validation, while the last verified
ID token remains the reauthorization hint. Transient JWKS failure retries that
validation rather than rotating again. Interrupted rotation on restart clears
usable tokens, persists needs-sign-in and preserves the registration and hint.
Received tokens awaiting sign-in validation are journaled for revocation; failed
code exchange retains the issued registration so fresh OAuth can reuse it.

Refresh is single-flight per account and serialized across processes. It honors
earliest_refresh_at (Unix seconds), runs near expiry and on wake, and checks a
retirement generation before activating async results. Agent integration must
not serve a token while refresh_inflight or rotation_id_token is present.
Switching accounts is serialized with refresh and preserves both registrations.
The single writer never changes the selected account as a side effect of refresh.

Temporary failures use 30s, 1m, 2m, 5m and 10m backoff, with bounded jitter.
After exhaustion, automatic work pauses as unavailable and preserves credentials.
Explicit Retry restarts it. Terminal refresh errors persist needs-sign-in.
Pending remote revoke material is retained until empty HTTP 200 confirms success.
Automatic revocation has a finite retry budget; explicit Retry or Disconnect
retries it. Local disconnection never claims remote revocation was confirmed.

Differences from the initial design:

- Logical account records share an atomic snapshot to avoid torn selection and
  credential state across several files (Review-Proven Rule 5).
- A directory and unique owner file replace a single reclaimable lock filename.
  Live owners are never evicted by age alone; lock wait is bounded at 15 seconds.
- No machine hardware identifier is read. Copying the app-data folder copies the
  host ID. A copied installation must use a new app-data folder on another host.
- No Plus/Pro tier is guessed from undocumented ID-token claims. Metadata says
  ChatGPT plan. Eligibility and usage are established by the real service later.
- Transient retry exhaustion pauses with credentials intact, per OpenAI's public
  recovery guidance, instead of treating an infrastructure outage as revocation.

Focused checks:

```sh
node --test "desktop/electron/chatgpt/*.test.mjs" desktop/scripts/fake-openai-siwc.test.mjs
```

The fake uses Node HTTP and RSA/JWKS on loopback only. It implements the public
registration, token, revocation, models and Responses/SSE contracts. Faults are
controlled programmatically through the exported fixture; no real login is used.
Its bounded request records contain method/path only. It does not establish real
eligibility, consent, accepted tool shapes, allowance attribution or inference.
The public docs do not specify a requirement for a preview inference header;
that question belongs to P2 and the owner/OpenAI gate.
