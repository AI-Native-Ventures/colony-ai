# Desktop and mobile canary interoperability

This runbook exercises the upstream Flutter client against the Phase 1 Electron
desktop on the dedicated canary tenant `p1e-mudsa14i`. It never targets
production and never creates a community. The prepare action uses the existing
owner-authenticated `POST /api/invites` path to create a one-use invite that
expires after one hour. Mobile creates a fresh key when that invite is claimed.

All actions require `COLONY_CANARY_INTEROP=1`. The script also checks the exact
canary host, owner pubkey, and `#general` channel id before it can build, mint,
publish, or launch anything. The owner NSEC is read from the supplied owner
file and passed only to the Electron/native-host child as `BUZZ_PRIVATE_KEY`;
the script never prints or saves it. The invite code is kept in a mode-600 file
under the private run directory.

## Prepare the iOS run

Boot an iOS Simulator, then set the opt-in and run directory. The default is
`~/worktrees/.lanes/interop-proof-colony`:

```bash
. ./bin/activate-hermit
export COLONY_CANARY_INTEROP=1
export COLONY_IOS_SIMULATOR=34E4D7EE-1D23-4264-8350-6F43E936CAD7
export COLONY_INTEROP_RUN_DIR="$HOME/worktrees/.lanes/interop-proof-colony"
scripts/interop/desktop-mobile-canary.sh prepare
```

`prepare` builds the iOS Simulator app with `CARGO_BUILD_JOBS=4`, installs it,
copies the native host, and opens the owner invite in Buzz Mobile. The
Simulator may first ask to open Buzz. Confirm that prompt, check that the invite preview names
`p1e-mudsa14i.canary.colony.ainative.ventures`, then tap **Join**. This is the
normal mobile invite flow: the app generates the new key and claims the
owner-minted invite. Do not erase the simulator after joining; its secure
storage contains the mobile test identity.

Set these exports in any new terminal used below:

```bash
. ./bin/activate-hermit
export COLONY_CANARY_INTEROP=1
export COLONY_IOS_SIMULATOR=34E4D7EE-1D23-4264-8350-6F43E936CAD7
export COLONY_INTEROP_RUN_DIR="$HOME/worktrees/.lanes/interop-proof-colony"
```

## Live message directions

For mobile to desktop, start the wait action first and leave it running. Then
send the exact unique message from Buzz Mobile in `#general`:

```bash
scripts/interop/desktop-mobile-canary.sh desktop-wait 'MOBILE-TO-DESKTOP-20260923-a1'
```

For desktop to mobile, run:

```bash
scripts/interop/desktop-mobile-canary.sh desktop-send 'DESKTOP-TO-MOBILE-20260923-b1'
scripts/interop/desktop-mobile-canary.sh mobile-screenshot desktop-to-mobile
```

Each Electron action uses Playwright `_electron`, a fresh private copy of the
user A profile, the user A signing key from the owner file, a copy of
`colony-native-host`, and `COLONY_ELECTRON_BACKGROUND=1`.
The wait action captures only after the supplied mobile message appears live in
Electron. `desktop-send` waits for the sending state to clear, then reads the
canary relay as user A and requires the message in the expected `#general`
channel before it passes. Capture the mobile screen after confirming its live
arrival.

To verify a thread reply on both clients, open the desktop-originated message
thread in mobile, reply from mobile, then run:

```bash
scripts/interop/desktop-mobile-canary.sh desktop-thread \
  'DESKTOP-TO-MOBILE-20260923-b1' 'MOBILE-THREAD-REPLY-20260923-d1'
scripts/interop/desktop-mobile-canary.sh mobile-screenshot thread-reply
```

The desktop action waits for the exact reply text inside the thread panel before
capturing its screenshot.

## Restart and foreground recovery

After messages are visible in mobile history, these actions save screenshots
after relaunch or foreground recovery:

```bash
scripts/interop/desktop-mobile-canary.sh mobile-relaunch
scripts/interop/desktop-mobile-canary.sh mobile-screenshot relaunch-history
scripts/interop/desktop-mobile-canary.sh mobile-background
```

`mobile-relaunch` terminates and relaunches the app without erasing simulator
data. Open `#general` again and capture the restored history. `mobile-background`
brings iOS Settings to the foreground briefly, then returns to Buzz. Send a new
desktop message and confirm it appears in mobile after foregrounding. These
actions write PNGs to the run directory.

## Evidence and limits

PNG evidence, the copied Electron profiles, the copied host binary, and the
one-use invite are kept in `COLONY_INTEROP_RUN_DIR` with private directory
permissions. Electron screenshots use the `desktop-*.png` prefix and mobile
screenshots use `ios-*.png`. Keep the screenshots needed for review and attach
them to the PR with:

```bash
scripts/post-screenshots.sh <PR-number> "$COLONY_INTEROP_RUN_DIR"
```

Report each requested direction separately as proven or failed, with the exact
screenshot filename. Simulator evidence proves the iOS simulator path only. It
does not prove physical iOS, Android, app-store builds, or production behavior.
