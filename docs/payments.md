# Account credits and PayFast

Colony credit balances belong to deployment-global accounts. The relay is the
source of truth for pack prices, payment status, granted credits, and usage
debits. A client cannot submit a balance or credit amount.

## API

`GET /api/payments/packs` is public and returns the server-priced ZAR packs.
The account routes require NIP-98 authentication:

- `GET /api/payments/balance` reads the confirmed account ledger balance.
- `GET /api/payments/usage` returns the last twelve UTC monthly totals from
  server usage debits, including zero-use months.
- `GET /api/payments/history` returns ledger, payment intent, and hosting
  subscription history.
- `POST /api/payments/checkout` creates or recovers one credit checkout.
- `GET /api/payments/intents/{reference}` reads one payment intent.
- `GET` and `POST /api/payments/site-subscriptions` list or start monthly
  Website hosting subscriptions.
- `GET /api/payments/site-subscriptions/{id}` reads one subscription.
- `POST /api/payments/site-subscriptions/{id}/cancel` requests cancellation.
- `POST /api/payments/webhook/payfast` receives PayFast ITNs.

Checkout requests contain `packId` and a UUID `idempotencyKey`. The optional
`email` must match the verified account email. Responses return the immutable
intent reference, server amount, USD credit grant, sandbox mode, and hosted
authorization form. Submit `authorizationFields` as a form POST to
`authorizationUrl` using the `authorizationMethod` value. The action URL has no
query string. A repeated idempotency key does not open another checkout.

Payment intents use `pending`, `paid`, `delayed`, `failed`, `cancelled`, and
`uncertain`. A retry with a new idempotency key first reconciles an unresolved
intent when PayFast has supplied a payment ID. If no provider ID is known, the
relay keeps the intent open and returns its reference instead of creating a
second charge. A verified `COMPLETE` notification credits the ledger in the
same transaction that marks the intent paid. Duplicate notifications and
payment IDs cannot grant credits twice.

The usage API reports only negative `usage` entries committed by the server to
the account credit ledger. Provider or agent usage that has not been recorded
there is not included.

## Website hosting

Hosting is listed at USD 10 per site per month. PayFast recurring billing uses
a configured ZAR amount because its recurring form is denominated in ZAR. Set
`COLONY_HOSTING_MONTHLY_ZAR_CENTS` only after the deployment owner selects the
local charge amount. The subscription route remains unavailable when that
setting is absent. Each account can have one current subscription per site;
failed payment attempts remain visible and do not silently create a second
subscription. Cancellation is recorded before the PayFast API call, and the
local state changes to cancelled only after PayFast confirms it.

## Configuration

Payments are disabled by default and sandbox mode is enabled by default. To
enable sandbox checkout, configure:

- `COLONY_PAYMENTS_ENABLED=true`
- `COLONY_PAYMENTS_SANDBOX=true`
- `PAYFAST_MERCHANT_ID`
- `PAYFAST_MERCHANT_KEY`
- `PAYFAST_PASSPHRASE`
- `COLONY_PAYMENTS_NOTIFY_URL`

Live mode requires HTTPS for the callback URL. Each ITN must pass PayFast
signature verification, source address validation, and PayFast server
postback validation before a database write. Merchant credentials and the
passphrase belong in the deployment secret manager, not source control. Keep
the passphrase configured for recurring billing and PayFast API requests.

The `buzz credits` CLI provides balance, usage, history, pack listing,
checkout, and intent verification commands. Checkout sends one request and
prints the response, including the hosted form action and fields. When delivery
is ambiguous, retry with the same `--idempotency-key` shown in the error.
