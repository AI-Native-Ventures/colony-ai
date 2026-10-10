# Stripe credit checkout

Owner specification: 9 October 2026, Colony 1.0.7. Retain PayFast and existing Power design. Stripe wins credit-provider selection when both Stripe secrets are configured. PayFast subscriptions and callbacks remain available independently.

Stripe charges USD 5, 15, 50, or 120 and grants exactly that value in nanoUSD. Prices and grants are server-owned. Usage markup remains a gateway concern. Hosted Checkout opens in the system browser for normal wallet and bank authentication. Redirects never grant credits.

Persist the intent before contacting Stripe. Use its stable reference as Stripe's idempotency key. Verify timestamped HMAC-SHA256 over the raw webhook body. Journal the Stripe event id, match provider/currency/session/amount, and commit notification, grant, and intent settlement atomically. A failed transaction returns an error so delivery can retry. Different event ids for the same session cannot grant twice. Keep pending payment recovery available after navigation or restart. Never infer cancellation from closing a browser.

Acceptance gates: provider/config and durable settlement tests cover invalid signatures, replay, unknown pack, mismatched currency/amount/provider, and a database failure between receipt and grant followed by retry. Desktop mock-bridge specs run in smoke and integration and cover USD packs, external opening, pending, confirmed balance, failure, and recovery. GitHub CI must pass on the latest PR head. Live Stripe, Fly secret configuration, deployment, and packaged desktop behavior remain unproven by CI.
