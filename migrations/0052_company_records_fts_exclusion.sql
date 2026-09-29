-- Company asks and binding metadata may contain sensitive business context.
-- Remove every company-record kind from full-text search without changing the
-- existing search policy for other kinds. This closes the brownfield gap in
-- installations that kept the pre-0008 negative skip set.
--
-- PostgreSQL cannot alter a generated expression in place. Preserve the
-- current expression for every non-company kind while adding this exclusion.
-- This rewrites events.search_tsv and rebuilds its GIN index under an exclusive
-- schema lock, so the cost grows with the event table size.
DO $$
DECLARE
    existing_expression TEXT;
BEGIN
    SELECT pg_get_expr(d.adbin, d.adrelid)
      INTO existing_expression
      FROM pg_attrdef d
      JOIN pg_attribute a
        ON a.attrelid = d.adrelid
       AND a.attnum = d.adnum
     WHERE d.adrelid = 'events'::regclass
       AND a.attname = 'search_tsv';

    IF existing_expression IS NULL THEN
        RAISE EXCEPTION 'events.search_tsv generated expression not found';
    END IF;

    ALTER TABLE events DROP COLUMN search_tsv;
    EXECUTE format(
        'ALTER TABLE events ADD COLUMN search_tsv TSVECTOR GENERATED ALWAYS AS (CASE WHEN kind IN (30642, 30643, 30646, 30647, 30648, 47031, 47032, 47033, 47035, 47036, 47037) THEN NULL::tsvector ELSE (%s) END) STORED',
        existing_expression
    );
    CREATE INDEX idx_events_search_tsv ON events USING GIN (search_tsv);
END $$;
