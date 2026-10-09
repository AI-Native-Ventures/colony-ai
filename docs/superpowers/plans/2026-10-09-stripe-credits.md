# Stripe credit checkout implementation plan

Goal: add USD Stripe Checkout beside PayFast without changing frozen screen design.
Architecture: extend the existing payment provider, account intents, atomic journal and ledger path; add a signed desktop HTTP adapter and Power checkout panel. No refunds or Stripe subscriptions.

1. Add USD pack selection, redacted Stripe config, hosted Checkout client and raw-body signature verification in credit_packs.rs, config.rs and stripe.rs. Fake HTTP tests use loopback only and exercise PaymentProvider methods.
2. Add migration 0054 and desired schema constraints for provider/currency pairs and Stripe session/event identifiers. Generalize the existing payment store behind PayFast compatibility wrappers. Preserve one transaction for receipt, ledger and settlement. Add ignored postgres_tests using isolated database helpers, including injected ledger failure and retry.
3. Route configured credit checkout through the selected provider; retain PayFast subscription routing. Record/recover sessions, keep retries within Stripe idempotency retention, and expose actual currency. Webhook returns non-success on persistence errors.
4. Add signed account payments client and checkout component using current Power controls, rem typography, fieldset/radios and live status. Poll a bounded number of times, allow manual retry, and recover open intents from server history.
5. Register mock-bridge stripe-credits.spec.ts in smoke and integration. Run only focused checks through heavy.sh with a ten-minute deadline. Delegate Rust compilation and full suites to hosted CI.
6. Review diff, sign commits with required coauthor trailer, push --no-verify, open one REST PR to develop, inspect latest checks and correct failures. Never merge. Report live proof separately.

## Coordinator addition: terms consent

Require Stripe terms consent and link both policies from the desktop purchase notice. Resolve public HTTPS policy URLs once in relay configuration, pass them to Stripe consent text, and return them in the catalog. Prove custom URLs and required consent in fake Stripe requests, catalog HTTP tests, and keyboard/pointer UI cases in both Playwright projects. Stripe Public Details must use the same terms URL before launch.
