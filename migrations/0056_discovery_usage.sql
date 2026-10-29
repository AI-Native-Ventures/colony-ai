-- Per-company monthly count of Discovery (Outscraper) results served by the
-- relay. The relay refuses new searches once a company reaches its monthly
-- cap, so one company cannot spend the operator's provider credits without
-- bound. The counter is a cost guard only; it holds no search content.
CREATE TABLE discovery_usage (
    community_id UUID NOT NULL REFERENCES communities(id),
    month DATE NOT NULL CHECK (EXTRACT(DAY FROM month) = 1),
    results INTEGER NOT NULL DEFAULT 0 CHECK (results >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (community_id, month)
);

SELECT attach_community_write_fence('discovery_usage');
