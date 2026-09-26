ALTER TABLE account_site_subscriptions
    ADD COLUMN provider_cycles_complete INTEGER NOT NULL DEFAULT 0
        CHECK (provider_cycles_complete >= 0),
    ADD COLUMN last_provider_payment_cycle INTEGER NOT NULL DEFAULT 0
        CHECK (last_provider_payment_cycle >= 0);
