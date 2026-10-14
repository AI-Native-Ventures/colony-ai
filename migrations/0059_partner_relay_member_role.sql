-- Colony partners are company decision makers without relay admin powers.
-- Keep generic relay invites member-only until partner invitation lifecycle
-- and the full server-side permission contract are ready.
ALTER TABLE relay_members DROP CONSTRAINT relay_members_role_check;
ALTER TABLE relay_members ADD CONSTRAINT relay_members_role_check
    CHECK (role IN ('owner', 'admin', 'partner', 'member'));
