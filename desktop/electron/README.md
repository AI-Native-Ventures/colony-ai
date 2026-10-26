# Electron shell

Electron owns the only visible window. The existing Tauri app runs as a hidden
headless child (`colony-native-host`, see `src-tauri/src/electron_host/`) and
serves every Tauri command to this shell over stdio. The renderer shim
(`src/shared/api/electronTauriShim.ts`) installs `window.__TAURI_INTERNALS__`
so the React app's `@tauri-apps/api` calls work unchanged.

## Browser profile lifecycle

The embedded browser keeps persistent profiles keyed by the business and
optional client scope. The host stores only hashed profile identifiers in
`browser-profiles.json` under Electron's user data directory. It accepts at most
32 distinct profiles across restarts and at most 32 Electron session objects in
one process. Existing profiles remain usable at the limit. New profiles are
rejected when the registry or process session limit is full. Each Electron
session object counts until the app restarts. Forgetting an inactive profile
clears its data but does not free its session object. A persisted profile that
has not been opened in this process needs one free session slot before it can
be forgotten; restart first if all slots are in use. Electron does not expose
session teardown.

The host does not automatically evict profile data. `closeBusiness` and
`closeClient` close matching tabs and cancel their active downloads while
retaining cookies, site storage, cache, and the profile download directory.
`forgetBusiness` and `forgetClient` are explicit data cleanup operations. They
clear browser storage, cache, authentication cache, and profile downloads only
after all matching tabs are closed and downloads have finished; otherwise the
request fails without clearing that profile. A caller should use the forget
operations only for an explicit data erasure request. Closing a business or
client by itself retains its data for later reuse.

Permission and download handlers are installed once per Electron session. A
failed session setup remains failed for that session rather than retrying
partial setup and registering duplicate listeners. Restart the app to recover
from a persistent setup failure.

## Updating the unsigned Mac app in place

The Mac build has no Apple Developer ID, so Squirrel.Mac (electron-updater)
cannot install over it. `mac-self-update.mjs` does it instead, driven by
`updater-service.mjs`:

1. `update-metadata.json` lists `darwin-arm64.selfUpdate: true` and the
   update archive (`updateArchive`) with its size and sha256 in `assets`.
   Older clients read `signed`/`autoUpdate` only and keep the manual card.
2. A newer version is downloaded beside the running app (same volume) into a
   hidden `.colony-update-*` folder. Size and sha256 must match the manifest.
3. The archive is unpacked with `ditto`; the app must have the running app's
   bundle id, `CFBundleShortVersionString` equal to the manifest version, and
   pass `codesign --verify --deep --strict`.
4. The card offers "Update now". One click starts `mac-update-helper.mjs`'s
   detached `sh` script, which waits for Colony to quit, moves the old app into
   the stage folder, moves the new one in, clears `com.apple.quarantine`,
   re-verifies the signature, then reopens the app. Any failure puts the old
   app back, reopens it, and leaves a result the next launch reports.
5. An app that cannot replace itself (disk image, App Translocation, folder not
   writable, not owned by the user) shows the manual card, which links to
   https://colony.global/#download.

The update source is always the official release URL. A packaged local test
build (`COLONY_ELECTRON_UPDATE_TEST=1 pnpm electron:package`, never combined
with `COLONY_ELECTRON_RELEASE=1`) may read its manifest from a loopback server
named in `COLONY_UPDATE_TEST_METADATA_URL`; a release build ignores that
variable.
