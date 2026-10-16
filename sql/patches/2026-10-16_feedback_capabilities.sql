-- =============================================================================
-- Patch: feedback capabilities — per-person "Mark feedback received" flag
-- Date:  2026-10-16
--
-- WHY
--   Two grantable feedback capabilities (lib/access/feedback-capabilities.ts):
--     Claim feedback report    per-person: user_data_scopes.claim_feedback
--                              (exists since 2026-10-07_feedback_claims.sql)
--     Mark feedback received   per-person: user_data_scopes.mark_feedback_received
--                              (NEW — this patch)
--   Each is also grantable per ROLE in Admin → Roles, stored in
--   public.role_page_access under the non-route keys data:claim_feedback /
--   data:mark_feedback_received. Those are ordinary rows written when a box is
--   ticked — no seeding is needed, and none is done: both capabilities FAIL
--   CLOSED (nobody but super users / admins has them until granted).
--
-- ORDER
--   Safe before or after the code ships. Until it is run, the Users page's
--   "Mark feedback received" checkbox refuses to turn ON (it says so) and
--   every other scope edit still saves; the role-level grant works regardless.
--
-- Safe to re-run.
-- =============================================================================

ALTER TABLE public.user_data_scopes
  ADD COLUMN IF NOT EXISTS mark_feedback_received boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.user_data_scopes.mark_feedback_received IS
  'Capability (not a row scope): may mark a feedback report''s feedback all in, and assign / release / reassign its Feedback report task. Super users / admins always have it. Role-level grant: role_page_access route ''data:mark_feedback_received''.';
