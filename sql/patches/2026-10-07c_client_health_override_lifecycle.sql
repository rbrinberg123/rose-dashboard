-- =============================================================================
-- Patch: Client Health — override lifecycle (strong prior, not a permanent lock)
-- Date:  2026-10-07
--
-- WHY
--   An override used to lock the AI out forever. Now it is a strong human prior:
--   every regeneration feeds the active override into the model as context and
--   still stores a fresh ai_* "shadow" rating. When the fresh AI view diverges
--   from the override, or new client notes / contract changes arrive after the
--   override was last reviewed, the client is flagged "Needs review" for a
--   super-user to resolve (Keep / Update / Revert to AI). Nothing is auto-applied.
--
-- ADDS (public.client_health_assessments)
--   override_mode              'prefer' (default) | 'pin'. Pin = hard lock: never
--                              flagged, but ai_* is still refreshed for awareness.
--   review_suggested           true while a review flag is open. STICKY: only a
--                              human resolution clears it.
--   review_reason              'divergence' (AI now disagrees — the louder signal)
--                              | 'new_evidence' (new notes / contract changes).
--   review_flagged_at          when the open flag was raised.
--   override_reviewed_at       the review baseline. = overridden_at when an
--                              override is saved; bumped to now on every human
--                              resolution / mode change. New-evidence checks
--                              compare against it.
--   review_baseline_ai_rating  the AI rating at the last baseline, so an already-
--                              acknowledged, unchanged divergence is not re-flagged.
--
--   Writers: the override actions (app/client-health/actions.ts) own all of
--   these; the regeneration (lib/client-health.ts) only ever RAISES a flag
--   (review_suggested / review_reason / review_flagged_at), never clears one,
--   and still never writes an override_* column.
--
-- BACKFILL
--   Existing overrides start clean: override_reviewed_at = overridden_at and
--   review_baseline_ai_rating = the current ai_rating (the AI view the reviewer
--   already disagreed with), so the first run after this patch only flags a
--   client whose AI view MOVES, or that has new notes / contract changes since
--   the override.
--
-- Safe to re-run.
-- =============================================================================

ALTER TABLE public.client_health_assessments
  ADD COLUMN IF NOT EXISTS override_mode             text NOT NULL DEFAULT 'prefer',
  ADD COLUMN IF NOT EXISTS review_suggested          boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS review_reason             text,
  ADD COLUMN IF NOT EXISTS review_flagged_at         timestamptz,
  ADD COLUMN IF NOT EXISTS override_reviewed_at      timestamptz,
  ADD COLUMN IF NOT EXISTS review_baseline_ai_rating text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'client_health_override_mode_allowed') THEN
    ALTER TABLE public.client_health_assessments
      ADD CONSTRAINT client_health_override_mode_allowed
      CHECK (override_mode IN ('prefer','pin'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'client_health_review_reason_allowed') THEN
    ALTER TABLE public.client_health_assessments
      ADD CONSTRAINT client_health_review_reason_allowed
      CHECK (review_reason IS NULL OR review_reason IN ('divergence','new_evidence'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'client_health_review_baseline_allowed') THEN
    ALTER TABLE public.client_health_assessments
      ADD CONSTRAINT client_health_review_baseline_allowed
      CHECK (review_baseline_ai_rating IS NULL
             OR review_baseline_ai_rating IN ('1','2','3','Management / IR Change'));
  END IF;
END $$;

-- Backfill existing overrides (only rows not yet baselined).
UPDATE public.client_health_assessments
   SET override_reviewed_at      = overridden_at,
       review_baseline_ai_rating = ai_rating
 WHERE (override_rating IS NOT NULL OR override_note IS NOT NULL)
   AND override_reviewed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_client_health_review
  ON public.client_health_assessments (review_suggested) WHERE review_suggested;

-- ---- Verify ------------------------------------------------------------------
-- SELECT account_id, override_rating, override_mode, override_reviewed_at,
--        review_baseline_ai_rating, review_suggested, review_reason
--   FROM public.client_health_assessments
--  WHERE override_rating IS NOT NULL OR override_note IS NOT NULL;
