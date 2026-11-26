-- Cloud agents on the free route (owner decision, 25 Nov 2026).
--
-- A cloud agent whose model is `colony-free` first works through OpenCode's free model. When
-- OpenCode refuses (or the free model ends) the harness reports it and the relay records, here,
-- that this agent uses the OpenRouter free route until the given time (six hours later). The
-- next boot reads the column to pick its route; a time in the past or no value means the
-- OpenCode route again. One switch per wake: a refusal is only recorded while no switch is in
-- force.
ALTER TABLE cloud_agents ADD COLUMN free_route_until TIMESTAMPTZ;
