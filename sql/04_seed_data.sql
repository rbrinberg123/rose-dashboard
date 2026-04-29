-- =============================================================================
-- 04_seed_data.sql
--
-- Initial seed data. Run once after 02_rose_owned_tables.sql.
-- =============================================================================

-- The single row of cost assumptions. Values match the locked design:
--   benefits multiplier = 1.15
--   in-person multiplier = 2.0
--   booker hours per meeting = 0.5
--   host hours per meeting = 1.5
--   work hours per year = 2000
INSERT INTO public.cost_assumptions
  (id, work_hours_per_year, booker_hours_per_meeting_base,
   host_hours_per_meeting_base, in_person_multiplier, default_benefits_multiplier)
VALUES
  (1, 2000, 0.5, 1.5, 2.0, 1.15)
ON CONFLICT (id) DO NOTHING;
