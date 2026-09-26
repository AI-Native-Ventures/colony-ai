-- Deployment-global credits and PayFast payment records belong to Colony
-- accounts, not communities. Financial records remain attributable until the
-- account-retention policy is explicitly changed.
CREATE TABLE account_credit_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    entry_type TEXT NOT NULL CHECK (entry_type IN ('purchase', 'usage', 'refund', 'adjustment')),
    amount_nanousd BIGINT NOT NULL CHECK (amount_nanousd <> 0),
    source_id TEXT NOT NULL CHECK (length(source_id) BETWEEN 1 AND 200),
    reference TEXT CHECK (reference IS NULL OR length(reference) <= 200),
    description TEXT NOT NULL CHECK (length(description) BETWEEN 1 AND 256),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (account_id, source_id)
);
CREATE INDEX account_credit_ledger_history_idx
    ON account_credit_ledger (account_id, created_at DESC, id DESC);
CREATE INDEX account_credit_ledger_usage_idx
    ON account_credit_ledger (account_id, created_at DESC)
    WHERE entry_type = 'usage' AND amount_nanousd < 0;

CREATE TABLE account_payment_intents (
    reference TEXT PRIMARY KEY CHECK (length(reference) BETWEEN 1 AND 200),
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    idempotency_key UUID NOT NULL,
    provider TEXT NOT NULL CHECK (provider = 'payfast'),
    pack_id TEXT NOT NULL CHECK (length(pack_id) BETWEEN 1 AND 64),
    charge_minor_units BIGINT NOT NULL CHECK (charge_minor_units > 0),
    charge_currency TEXT NOT NULL CHECK (charge_currency = 'ZAR'),
    grant_nanousd BIGINT NOT NULL CHECK (grant_nanousd > 0),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'paid', 'delayed', 'failed', 'cancelled', 'uncertain')),
    provider_payment_id TEXT UNIQUE CHECK (
        provider_payment_id IS NULL OR provider_payment_id ~ '^[0-9]{1,32}$'
    ),
    provider_status TEXT CHECK (provider_status IS NULL OR length(provider_status) <= 64),
    paid_minor_units BIGINT CHECK (paid_minor_units IS NULL OR paid_minor_units >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (account_id, idempotency_key)
);
CREATE UNIQUE INDEX account_payment_intents_one_open_idx
    ON account_payment_intents (account_id)
    WHERE status IN ('pending', 'delayed', 'uncertain');
CREATE INDEX account_payment_intents_history_idx
    ON account_payment_intents (account_id, created_at DESC, reference DESC);

CREATE TABLE account_site_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    site_id TEXT NOT NULL CHECK (length(site_id) BETWEEN 1 AND 128),
    reference TEXT NOT NULL UNIQUE CHECK (length(reference) BETWEEN 1 AND 200),
    idempotency_key UUID NOT NULL,
    provider TEXT NOT NULL CHECK (provider = 'payfast'),
    provider_token TEXT UNIQUE CHECK (
        provider_token IS NULL OR provider_token ~ '^[A-Za-z0-9-]{1,36}$'
    ),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'active', 'delayed', 'failed', 'cancelled', 'uncertain')),
    monthly_usd_cents INTEGER NOT NULL DEFAULT 1000 CHECK (monthly_usd_cents = 1000),
    monthly_zar_cents BIGINT NOT NULL CHECK (monthly_zar_cents >= 500),
    provider_status TEXT CHECK (provider_status IS NULL OR length(provider_status) <= 64),
    last_provider_payment_id TEXT CHECK (
        last_provider_payment_id IS NULL OR last_provider_payment_id ~ '^[0-9]{1,32}$'
    ),
    cancel_requested_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (account_id, idempotency_key)
);
CREATE UNIQUE INDEX account_site_subscriptions_one_current_idx
    ON account_site_subscriptions (account_id, site_id)
    WHERE status IN ('pending', 'active', 'delayed', 'failed', 'uncertain');
CREATE INDEX account_site_subscriptions_history_idx
    ON account_site_subscriptions (account_id, created_at DESC, id DESC);

CREATE TABLE account_site_subscription_payments (
    provider_payment_id TEXT PRIMARY KEY CHECK (provider_payment_id ~ '^[0-9]{1,32}$'),
    subscription_id UUID NOT NULL REFERENCES account_site_subscriptions(id) ON DELETE RESTRICT,
    provider_status TEXT NOT NULL CHECK (length(provider_status) BETWEEN 1 AND 64),
    status TEXT NOT NULL CHECK (status IN ('paid', 'delayed', 'failed', 'cancelled', 'uncertain')),
    amount_zar_cents BIGINT CHECK (amount_zar_cents IS NULL OR amount_zar_cents >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX account_site_subscription_payments_history_idx
    ON account_site_subscription_payments (subscription_id, created_at DESC, provider_payment_id DESC);

CREATE TABLE account_payment_notifications (
    event_id TEXT PRIMARY KEY CHECK (event_id ~ '^[0-9a-f]{64}$'),
    reference TEXT CHECK (reference IS NULL OR length(reference) <= 200),
    provider_payment_id TEXT CHECK (
        provider_payment_id IS NULL OR provider_payment_id ~ '^[0-9]{1,32}$'
    ),
    provider_status TEXT NOT NULL CHECK (length(provider_status) <= 64),
    amount_zar_cents BIGINT CHECK (amount_zar_cents IS NULL OR amount_zar_cents >= 0),
    result TEXT NOT NULL CHECK (result IN (
        'processing', 'applied', 'already_applied', 'unmatched', 'uncertain', 'duplicate_payment'
    )),
    received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at TIMESTAMPTZ
);
CREATE INDEX account_payment_notifications_reference_idx
    ON account_payment_notifications (reference, received_at DESC)
    WHERE reference IS NOT NULL;

INSERT INTO _operator_global_tables (table_name, reason) VALUES
    ('account_credit_ledger', 'deployment-global account credit balance and server-confirmed usage'),
    ('account_payment_intents', 'deployment-global PayFast credit checkout and settlement state'),
    ('account_site_subscriptions', 'deployment-global PayFast website hosting subscriptions'),
    ('account_site_subscription_payments', 'deployment-global PayFast subscription payment history'),
    ('account_payment_notifications', 'deployment-global idempotent PayFast ITN processing journal');
