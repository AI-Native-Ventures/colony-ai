-- Anonymous code starts do not reserve permanent account identities.
ALTER TABLE account_codes ADD COLUMN email TEXT;
UPDATE account_codes c SET email = a.email FROM accounts a WHERE a.id = c.account_id;
ALTER TABLE account_codes
    ALTER COLUMN email SET NOT NULL,
    ADD CONSTRAINT account_codes_email_check
        CHECK (email = lower(btrim(email)) AND length(email) <= 254),
    ADD CONSTRAINT account_codes_pending_sign_in_check
        CHECK (account_id IS NOT NULL OR purpose = 'sign_in'),
    ALTER COLUMN account_id DROP NOT NULL;
DROP INDEX account_codes_one_active_purpose;
CREATE UNIQUE INDEX account_codes_one_active_purpose
    ON account_codes (email, purpose) WHERE consumed_at IS NULL;
ALTER TABLE account_mail_outbox ALTER COLUMN account_id DROP NOT NULL;
ALTER TABLE account_test_mail ALTER COLUMN account_id DROP NOT NULL;
