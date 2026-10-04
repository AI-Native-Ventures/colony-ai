# Google account entry evidence, 4 October 2026

Base: origin/develop 6e04386b1. Branch: codex/104b-google-account.
Owner confirmed adding Google to Account and Sign in. The frozen Scout r4
reference has no Google action; its absence in 1.0.3 was design parity,
not evidence that the OAuth implementation was removed.

## Implemented

Account and Sign in keep the frozen shell, Scout, Manrope, labels and primary
email actions. Both now include an or divider and a secondary Continue with
Google button. The button bypasses email/password form validation and calls
the existing shared auth service. Pending copy explains the browser handoff.
Cancel, timeout, unavailable and failure states retain typed fields, offer
Google retry and leave the email path available. Native error payloads are
mapped through an exact allowlist; unknown payloads do not become UI copy.

Electron configures an ordinary native IPC deadline of 120 seconds in
main.mjs. Native Google OAuth allows 180 seconds for the callback plus 20 for
token exchange. This change gives google_desktop_sign_in 210 seconds, keeping
the native flow and other command deadlines unchanged. A test exercises the
production NativeHost transport with a fake child response after 120 seconds.

## Observed locally

- Account and Sign in were rendered and inspected at 1728x1117 and 1440x900.
  Each was compared with its separately rendered frozen #account or #signin
  reference. All four reference/app pairs have different SHA256 hashes.
  Verdict: CLOSE. The Google action and divider are an owner approved addition;
  the form moves upward to accommodate them. Reference review chrome and
  sample values differ from the app. No full-screen MATCH is claimed.
- The installed 1.0.3 app.asar was read without launching the app. Its renderer
  contains the configured public desktop Google client ID. The native host
  contains the Google command, Google token endpoint and a Google client-secret
  format marker. Those facts do not prove that the embedded secret is valid.
  No secret, authorization code or ID token was printed or saved.
- GitHub configuration metadata reports the desktop public client ID and
  native client-secret configuration present. Secret values were not read.
- An anonymous live authorization request, using the configured desktop client
  ID, the native loopback redirect shape and S256 PKCE, reached Google's
  /v3/signin/identifier page with HTTP 200. No invalid_client or
  redirect_uri_mismatch was observed. No user authenticated and no account
  request was sent to a relay.
- The existing auth service was executed against local HTTP fixtures. Tests
  assert the ID-token body at POST /api/accounts/google, identity import,
  session cleanup and safe native failure propagation. This is a client test
  with fixture tokens, not a live Google/relay login.

Local checks: the mock-bridge build, TypeScript, Biome (warnings only),
px-text and 36 focused Node tests passed. All 66 account and compact/dark
identity cases passed across smoke and integration after one unchanged
rerun: the first run had 65 passes and a smoke startup visibility timeout
with a blank screen. The same case then passed in both projects. Its cause
was not diagnosed; no assertion was weakened.

Local visual artifacts:
/Users/mac/worktrees/.lanes/phase2/onboarding-design-local-output-20261004/
playwright/google-account/index.html,
SHA256SUMS, authorization-probe.json, installed-config.json,
installed-native-config.json and entry-timings.json. These are local files,
not committed image uploads.

## Getting things ready, lane 2 handoff

A temporary observation spec exercised the real rendered post-Connected UI on
the mock bridge, without changing entry logic. Open my Colony to curtain gone:
1633 ms in smoke and 1403 ms in integration. Welcome readiness was announced
1046 ms and 766 ms after observation began. These are mock timings only; the
owner's real first-run duration and cause have not been measured.

CommunityOnboardingFlow.finalize serially reads identity and membership,
ensures the kind:0 profile, initializes starter/public and private Welcome
channels, refreshes the channel cache and mounts the Welcome route. Profile
and account reads each have a 10-second deadline. Starter provisioning seeds
Scout and the canvas in the background. The entry curtain waits for Welcome's
settled timeline, then adds 500 ms; if readiness is missed it starts that delay
after eight seconds. These are source observations and possible checkpoints,
not a diagnosis of the owner's slow run. Lane 2 owns changes to this path.

## Not proven and required next gate

NEEDS_API / NEEDS_OWNER: designate an isolated relay and existing Google test
account, or an owner-driven run that can complete the native flow without
keychain prompts. Confirm that this relay's COLONY_GOOGLE_CLIENT_IDS includes
the configured desktop client audience. A successful account request creates
or links an account and imports the returned identity; the brief prohibits
production data changes and automation that triggers keychain prompts.

No live Google ID token was obtained. No real relay accepted a desktop token.
The valid client-secret/client-ID pairing, production audience allowlist,
native callback/token exchange, real identity import and real post-Connected
latency remain unproven. No native app, Rust build/test, deployment or PR was
run. CI proof belongs to the coordinator's combined integration run.

The existing flow uses the installed-app browser and loopback PKCE approach
in Google's primary documentation:
https://developers.google.com/identity/protocols/oauth2/native-app
If the isolated run rejects the token audience, the smallest operational fix
is to include the desktop client ID in that test relay's audience allowlist.
If token exchange rejects client credentials, correct the matching native
build configuration. Neither condition has been observed, so neither is
claimed as the current failure.
