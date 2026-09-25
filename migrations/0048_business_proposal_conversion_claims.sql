-- One accepted proposal version may reserve only one conversion result.
-- The claim is written in the same event transaction as the acceptance event.
CREATE TABLE business_proposal_conversion_claims (
    community_id UUID NOT NULL REFERENCES communities(id),
    business_channel_id UUID NOT NULL,
    conversion_id UUID NOT NULL,
    proposal_id UUID NOT NULL,
    proposal_version_event_id BYTEA NOT NULL
        CHECK (octet_length(proposal_version_event_id) = 32),
    proposal_version_digest BYTEA NOT NULL
        CHECK (octet_length(proposal_version_digest) = 32),
    acceptance_event_id BYTEA NOT NULL
        CHECK (octet_length(acceptance_event_id) = 32),
    receipt_event_id BYTEA NOT NULL
        CHECK (octet_length(receipt_event_id) = 32),
    accepted_by_pubkey BYTEA NOT NULL
        CHECK (octet_length(accepted_by_pubkey) = 32),
    client_id UUID NOT NULL,
    work_item_id UUID NOT NULL,
    draft_invoice_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
    PRIMARY KEY (community_id, conversion_id),
    FOREIGN KEY (community_id, business_channel_id)
        REFERENCES channels (community_id, id),
    UNIQUE (community_id, proposal_version_event_id),
    UNIQUE (community_id, work_item_id),
    UNIQUE (community_id, draft_invoice_id),
    UNIQUE (community_id, acceptance_event_id),
    CHECK (client_id <> '00000000-0000-0000-0000-000000000000'::uuid),
    CHECK (conversion_id <> '00000000-0000-0000-0000-000000000000'::uuid),
    CHECK (proposal_id <> '00000000-0000-0000-0000-000000000000'::uuid),
    CHECK (work_item_id <> '00000000-0000-0000-0000-000000000000'::uuid),
    CHECK (draft_invoice_id <> '00000000-0000-0000-0000-000000000000'::uuid)
);

CREATE INDEX business_proposal_conversion_claims_client_idx
    ON business_proposal_conversion_claims (community_id, client_id, created_at DESC);

SELECT attach_community_write_fence('business_proposal_conversion_claims');
