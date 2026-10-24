# Signed-in canary UI check

The `canary` Playwright project is local-only. It drives the E2E web build over
the real canary community relay with the throwaway owner account and NIP-42
signing. An optional managed-agent fixture lets the suite inspect the employee
profile screen when the matching server-side record makes it reachable. The
suite also walks Today, asks, the team list, money, the AI spend usage and
credits views, hiring, and settings.
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
The test reads screens and leaves every draft unsent. It does not create ask
records without a real authorized recipient. It never enables Mesh sharing,
issues or sends an invoice, or logs the account signing key.

The ask-recipient check adapts to the real channel membership. It verifies that
the signed-in owner is not offered as a recipient, and records the
single-member recovery state only when that state is present. Ask creation,
new-thread setup, ask-type selection, and hire-proposal drafts are left unsent.
Decision reasons require a real eligible human recipient because the relay
permits agents to receive only question or verdict asks. The suite reports that
path as `NEEDS_API` when the canary has no eligible records.

The suite opens the owner's team member page. It also opens the managed agent's
page when the managed-agent identity has a real employee or position record. If
the identity is absent from the company roster, the agent profile is reported as
`NEEDS_API`. The fixture must have mode `0600`; the test reads only its public
key and never returns or logs its signing material.

Hiring inspection opens the role catalog and never submits a hire. Appearance
inspection opens the appearance settings section without changing any setting.

The suite captures each exercised desktop state in light and dark at 1440x900
and 1728x1117. It records console and page errors, failed requests, HTTP errors,
requests pending longer than 15 seconds, horizontal overflow, and visible
interactive controls without accessible names. These conditions fail the
canary test. Browser requests cancelled by an explicit route reload are recorded
separately from failed requests. Diagnostic URLs omit query strings and redact
identity-shaped path values. Request headers and bodies are never recorded.

No Mesh sharing is enabled and no invoice is issued. A canary with no real
invoice or founder-handoff record leaves those states unproven and is reported
in the suite output. The desktop canary project does not exercise the Flutter
mobile runtime.
