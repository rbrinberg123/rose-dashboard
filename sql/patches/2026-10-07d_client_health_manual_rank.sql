-- =============================================================================
-- Patch: Client Health — firm order (fixed category order + shared manual rank)
-- Date:  2026-10-07
--
-- WHY
--   The Client Health page's default view ("Firm order") is a two-level sort
--   everyone shares:
--     1. fixed category order by EFFECTIVE rating (override else AI):
--          '3' High risk → '2' Monitor → 'Management / IR Change' → '1' Healthy
--     2. manual_rank within the category, set by a super-user dragging rows,
--        ONE firm-wide order (not per user); then client name.
--   Equivalent ORDER BY (the page sorts in lib/client-health-order.ts):
--     category_order(effective_rating), manual_rank ASC NULLS LAST, client_name
--
-- ADDS (public.client_health_assessments)
--   manual_rank   1..n within the client's current category; NULL = not yet
--                 placed (new client, or its category just changed) → bottom
--                 of its category, A→Z.
--
--   Writers: reorderHealthCategory (app/client-health/actions.ts) renumbers a
--   whole category 1..n on each drop; the regeneration (lib/client-health.ts)
--   and the override save / revert actions set it to NULL when the client's
--   effective rating moves it to a different category.
--
-- Safe to re-run.
-- =============================================================================

ALTER TABLE public.client_health_assessments
  ADD COLUMN IF NOT EXISTS manual_rank integer;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'client_health_manual_rank_positive') THEN
    ALTER TABLE public.client_health_assessments
      ADD CONSTRAINT client_health_manual_rank_positive
      CHECK (manual_rank IS NULL OR manual_rank > 0);
  END IF;
END $$;

-- ---- Verify ------------------------------------------------------------------
-- SELECT account_id, COALESCE(override_rating, ai_rating) AS effective, manual_rank
--   FROM public.client_health_assessments
--  ORDER BY CASE COALESCE(override_rating, ai_rating)
--             WHEN '3' THEN 1 WHEN '2' THEN 2
--             WHEN 'Management / IR Change' THEN 3 WHEN '1' THEN 4 ELSE 5 END,
--           manual_rank NULLS LAST;
