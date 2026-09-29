# Signed-in canary UI check

The `canary` Playwright project is local-only. It drives the E2E web build over
the real canary community relay with one mail.tm account and NIP-42 signing.
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
mkdir -m 700 -p "$HOME/.colony-canary/artifacts"
cd desktop
pnpm build:e2e
BUZZ_E2E_CANARY=1 \
  BUZZ_E2E_CANARY_ACCOUNT_FILE="$HOME/.colony-canary/canary-ui.json" \
  BUZZ_E2E_CANARY_ARTIFACT_DIR="$HOME/.colony-canary/artifacts" \
  pnpm exec playwright test --project=canary
```

The E2E web build uses the relay-backed browser bridge and does not start the
Tauri host or access the macOS keychain. Screenshots and Playwright artifacts
are written to the configured artifact directory outside the repository.
The test never enables Mesh sharing, issues or sends an invoice, or logs the
account signing key or the synthetic secret input.

The one-member setup has no other ask recipient, so the UI cannot send an ask
from the owner's own thread. The check records that limitation and uses a
synthetic relay ask addressed to the owner to exercise approval.

The frozen company-v8 owner profile shows Overview and History only. It has no
design for employee-specific tabs on a human owner, including an honest
not-available state. The canary check records this as `NEEDS_DESIGN` and does
not invent those tabs.

A fresh community has no invoice record, so the tax editor and its zero-rate
default cannot be exercised without a draft invoice. The check opens the
invoice list and records the unavailable tax route; it does not issue or send
an invoice.
