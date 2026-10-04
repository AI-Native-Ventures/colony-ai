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

The coordinator authorized a branch-only push and will ask the owner to run
the combined candidate with their own Google account. This live gate does not
block publishing the prepared branch. It remains a gate for claiming live
Google sign-in works. The worker does not run the native app, modify production
accounts or automate keychain prompts.

## Owner test script, exactly five steps

Use the coordinator's combined candidate on a first-run account screen. Use
your own Google account in the browser; do not send credentials, browser URL
queries, authorization codes, tokens or developer-console output to the team.

1. On "Let’s get you started.", leave name, email and password empty and click
   "Continue with Google" below "Create account" and the "or" divider. Success:
   the system browser opens Google's account chooser or sign-in page, and
   Colony shows "Waiting for Google…" with instructions to finish in the
   browser. There must be no email/password validation error or duplicate
   browser launch. If no browser opens, record the plain message in Colony.
2. Cancel in Google's browser flow, then return to Colony. Success: the
   Account form stays available and shows "Google sign-in was cancelled. Try
   again or use your email." If Google offers no Cancel action, close that
   browser tab and wait about three minutes: expect "Google sign-in took too
   long. Try again or use your email." The Google and email buttons must become
   usable again. Closing a tab does not immediately notify Colony.
3. Click "Sign in" beside "Already have an account?". On "Welcome back.",
   leave email and password empty and click its "Continue with Google" below
   "Sign in" and the "or" divider. Success: a new Google browser flow opens
   with the same waiting copy; the email form must not block it.
4. In Google, choose your own account, complete any requested sign-in and
   approve the requested access, then return to Colony. Success: the waiting
   state ends and the Business step opens without asking for a Colony password,
   verification code or API key. Failure: Colony stays on Sign in with plain
   copy, such as "We couldn’t finish Google sign-in. Try again or use your
   email.", "Google sign-in isn’t available right now. You can use your email
   instead.", or "Can't reach the server right now. Try again later." No stack
   trace, provider response, authorization code or token may appear.
5. Complete Business and Connect using the coordinator's designated connection,
   wait for Scout's real reply on Connected, then click "Open my Colony".
   Success: "Getting things ready" ends and the full app opens the Welcome
   channel. Record seconds from that click until Welcome is usable. Send the
   coordinator the candidate version, which steps passed, the visible plain
   failure text if any, and that timing. If any step fails, stop and report its
   number; do not copy browser URL queries or console/network payloads.

## Remaining proof

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
