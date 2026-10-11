-- Passwordless sign-in codes and terms acceptance for the Colony app.
ALTER TABLE accounts
    ADD COLUMN terms_version TEXT
        CHECK (terms_version IS NULL OR length(terms_version) BETWEEN 1 AND 64),
    ADD COLUMN terms_accepted_at TIMESTAMPTZ;

ALTER TABLE account_codes
    DROP CONSTRAINT account_codes_purpose_check,
    ADD CONSTRAINT account_codes_purpose_check
        CHECK (purpose IN ('verify_email', 'reset_password', 'sign_in'));

ALTER TABLE account_mail_outbox
    DROP CONSTRAINT account_mail_outbox_purpose_check,
    ADD CONSTRAINT account_mail_outbox_purpose_check
        CHECK (purpose IN ('verify_email', 'reset_password', 'sign_in'));

ALTER TABLE account_test_mail
    DROP CONSTRAINT account_test_mail_purpose_check,
    ADD CONSTRAINT account_test_mail_purpose_check
        CHECK (purpose IN ('verify_email', 'reset_password', 'sign_in'));
