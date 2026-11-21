-- Password operator sign-ins use the existing privacy-preserving session audit
-- table. Keep the operation vocabulary constrained while admitting the new
-- path on already-migrated deployments.
ALTER TABLE relay_operator_email_login_audit
    DROP CONSTRAINT relay_operator_email_login_audit_operation_check,
    ADD CONSTRAINT relay_operator_email_login_audit_operation_check
        CHECK (operation IN ('start', 'verify', 'password'));
