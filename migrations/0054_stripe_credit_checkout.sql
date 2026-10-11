-- Keep existing PayFast rows valid while adding immutable Stripe/USD terms.
ALTER TABLE account_payment_intents
    DROP CONSTRAINT account_payment_intents_provider_check,
    DROP CONSTRAINT account_payment_intents_charge_currency_check,
    DROP CONSTRAINT account_payment_intents_provider_payment_id_check,
    ADD CONSTRAINT account_payment_intents_provider_currency_check CHECK (
        (provider = 'payfast' AND charge_currency = 'ZAR') OR
        (provider = 'stripe' AND charge_currency = 'USD')
    ),
    ADD CONSTRAINT account_payment_intents_provider_payment_id_check CHECK (
        provider_payment_id IS NULL OR
        (provider = 'payfast' AND provider_payment_id ~ '^[0-9]{1,32}$') OR
        (provider = 'stripe' AND provider_payment_id ~ '^cs_[A-Za-z0-9_]{1,197}$')
    );
ALTER TABLE account_payment_notifications RENAME COLUMN amount_zar_cents TO amount_minor_units;
ALTER TABLE account_payment_notifications RENAME CONSTRAINT account_payment_notifications_amount_zar_cents_check TO account_payment_notifications_amount_minor_units_check;
ALTER TABLE account_payment_notifications
    ADD COLUMN provider TEXT NOT NULL DEFAULT 'payfast' CHECK (provider IN ('payfast', 'stripe')),
    ADD COLUMN charge_currency TEXT NOT NULL DEFAULT 'ZAR' CHECK (charge_currency ~ '^[A-Z]{3}$'),
    DROP CONSTRAINT account_payment_notifications_event_id_check,
    DROP CONSTRAINT account_payment_notifications_provider_payment_id_check,
    ADD CONSTRAINT account_payment_notifications_event_id_check CHECK (
        (provider = 'payfast' AND event_id ~ '^[0-9a-f]{64}$') OR
        (provider = 'stripe' AND event_id ~ '^evt_[A-Za-z0-9_]{1,196}$')
    ),
    ADD CONSTRAINT account_payment_notifications_provider_payment_id_check CHECK (
        provider_payment_id IS NULL OR
        (provider = 'payfast' AND provider_payment_id ~ '^[0-9]{1,32}$') OR
        (provider = 'stripe' AND provider_payment_id ~ '^cs_[A-Za-z0-9_]{1,197}$')
    );
