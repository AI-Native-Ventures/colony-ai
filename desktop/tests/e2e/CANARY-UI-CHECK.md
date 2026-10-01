# Signed-in canary UI check

The `canary` Playwright project is local-only. It drives the E2E web build over
the real canary community relay with the throwaway owner account and NIP-42
signing. An optional managed-agent fixture lets the suite inspect employee
profile, duties, lessons, permissions, and AI spend screens when the matching
server-side records make those screens reachable.
The Playwright project is absent unless `BUZZ_E2E_CANARY=1` is set, and refuses
to run in CI.

## One-time canary setup

Create the throwaway account and community with the existing setup flow, copied
and adapted outside this repository:

1. Create `~/.colony-canary` with mode `0700`.
2. Copy `/Users/mac/worktrees/colony-p1-drive/desktop/cp5-live-setup.tmp.mjs`
   to a temporary filename in that same `desktop` directory.
3. Change only its output path to
   `~/.colony-canary/canary-ui.json`. The script writes the signing key to that
   file with mode `0600`.
4. Run the adapted script from
   `/Users/mac/worktrees/colony-p1-drive/desktop`, where its installed Node
   dependencies are available. The script uses a mail.tm inbox and the canary
   relay to verify the account, create one community with `#general`, and post
   one thread root.
5. Confirm file permissions with `stat`; never print, copy into the repository,
   upload, or screenshot the account file.

The account file contains the Nostr signing key and private account metadata.
Keep it under `~/.colony-canary` with mode `0600`. The test validates the key
against the derived public key and rejects non-canary community hosts.

## Run

From the repository root:

```sh
mkdir -m 700 -p "$HOME/.colony-canary/artifacts/l-ui-current-run"
cd desktop
pnpm build:e2e
BUZZ_E2E_CANARY=1 \
  BUZZ_E2E_CANARY_ACCOUNT_FILE="$HOME/.colony-canary/canary-ui.json" \
  BUZZ_E2E_CANARY_AGENT_FILE="$HOME/.colony-canary/agents/<managed-agent-fixture>.json" \
  BUZZ_E2E_CANARY_ARTIFACT_DIR="$HOME/.colony-canary/artifacts/l-ui-current-run" \
  pnpm exec playwright test --project=canary
```

The E2E web build uses the relay-backed browser bridge and does not start the
Tauri host or access the macOS keychain. Screenshots and Playwright artifacts
are written to the configured artifact directory outside the repository.
The test creates synthetic canary goals, work records, and messages. It does
not create ask or secret-binding records without a real authorized recipient
or request record. It never enables Mesh sharing, issues or sends an invoice,
or logs the account signing key.

The ask-recipient check adapts to the real channel membership. It verifies that
the signed-in owner is not offered as a recipient, and records the
single-member recovery state only when that state is present. Ask creation,
new-thread setup, ask-type selection, allowance drafts, and hire-proposal drafts
are left unsent. Decision reasons require a real eligible human recipient
because the relay permits agents to receive only question or verdict asks.
Secret binding and revocation require a real pending request authored by the
managed agent. The suite reports both paths as `NEEDS_API` when the canary has
no eligible records.

The frozen company-v9 contract gives human members Overview and History only.
The suite checks those tabs on the owner and checks employee-only tabs when the
managed-agent identity has a real employee or position record. If the identity
is absent from the company roster, the profile, duties, and lessons are
reported as `NEEDS_API`. The fixture must have mode `0600`; the test reads only
its public key and never returns or logs its signing material.

The existing Tools & access grant page is separate from the frozen batch 2
context-bound tool-consent flow. The suite checks that the generic grant starts
with blank action, scope and expiry fields, but reports the batch 2 consent flow
as `NEEDS_API` when the canary has no real pending tool-consent request. It does
not synthesize that request from mockup state.

Hiring inspection opens the empty role-pack editor and verifies that its title,
job, skills, tool scope and worker menu have no preselected values. It records
runtime recovery when the canary has no available configured runtime and never
saves a role pack. Appearance inspection opens the named theme catalog and a
Buzz preview, then cancels the preview without applying a theme or density.

The suite captures each exercised desktop state in light and dark at 1440x900
and 1728x1117. It records console and page errors, failed requests, HTTP errors,
requests pending longer than 15 seconds, horizontal overflow, and visible
interactive controls without accessible names. Diagnostic URLs omit query
strings and redact identity-shaped path values. Request headers and bodies are
never recorded.

No workflow is published, no standing permission is saved, no watchdog or Mesh
sharing is enabled, and no invoice is issued. A canary with no real invoice or
founder-handoff record leaves those states unproven and is reported in the
suite output. The desktop canary project does not exercise the Flutter mobile
runtime.
