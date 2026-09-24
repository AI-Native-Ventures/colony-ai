# Desktop account service

This folder owns the desktop client for the account routes in
[docs/auth-accounts.md](../../../../docs/auth-accounts.md). The onboarding and
persistent account UI should call the shared authService; this folder does not
own screens or copy.

<pre><code>import { authService } from "@/features/auth/authService";

await authService.signUp(email, password);
const account = await authService.verifyEmail(email, code);</code></pre>

The service exposes signUp, verifyEmail, resendCode, signIn, signInWithGoogle,
requestReset, confirmReset, claimAccount, changePassword, getAccount, and
deleteAccount.

## Identity handling

Successful verification, password sign-in, Google sign-in, and password reset
return an account and an nsec from the API client. The service immediately
passes the nsec to the existing native import_identity path, clears its
references, and returns only the account. The UI never receives or displays the
secret.

claimAccount(email, password) reads the current identity through the existing
native identity API and includes its nsec only in the NIP-98 signed claim
request. Callers do not pass or receive the secret.

getAccount() returns the linked account or null when the relay responds with
404 {"error":"account_not_found"}. The contract does not currently define
this no-account response; this implementation uses it to distinguish an
unclaimed key from a relay failure. Network and other API failures remain typed
errors, so the caller can keep local use available and offer a retry.

The result is cached for the current identity and relay URL. The service checks
the identity again before caching a response and clears the cache after account
or session changes. An in-flight lookup that crosses one of those changes fails
with `account_state_changed` instead of returning or caching stale metadata.

## Errors and retry timing

AuthApiError.code is a stable error code from the contract, plus local transport
and identity errors. Relay response bodies and credentials are not attached to
the error. For rate_limited, retryAfterSecs contains the server's
retry_after_secs value. The client does not repeat account-changing requests
automatically; UI retry controls should wait for that interval.

## Google desktop configuration

Set COLONY_GOOGLE_DESKTOP_CLIENT_ID in the desktop build environment and
COLONY_GOOGLE_DESKTOP_CLIENT_SECRET only for the native host Cargo build. The
Vite build embeds only the public client ID. The secret is read at compile time
by the native host and is never added to renderer configuration. The service
invokes the native google_desktop_sign_in command, which owns the 127.0.0.1
callback listener, PKCE verifier, state check, system-browser launch, timeout,
and authorization code exchange. The native command returns only the ID token needed by
POST /api/accounts/google; it stores and logs neither the token nor the
authorization code.
