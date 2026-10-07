-- =============================================================================
-- Patch: Events Planner — Phase 4: private storage bucket for itinerary PDFs
-- Date:  2026-10-02
-- Needs: 2026-10-02d_events_planner.sql
--
-- CREATES
--   storage bucket 'event-itineraries' — PRIVATE (public = false). Generated
--   PDFs are saved at <itinerary id>/v<version>/<timestamp>-<audience>.pdf and
--   recorded in public.ep_exports. They are only ever handed out as short-lived
--   signed URLs by the super-user-gated server code.
--
-- SECURITY
--   No storage policies are added, so only the service role (the app's server)
--   can read or write the bucket — the same "locked, app is the gate" model as
--   the ep_ tables. This is the first use of Supabase Storage in the dashboard.
--
-- Safe to re-run.
-- =============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('event-itineraries', 'event-itineraries', false, 20971520, ARRAY['application/pdf'])
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;


-- ---- CHECK IT ---------------------------------------------------------------
-- SELECT id, public, file_size_limit, allowed_mime_types FROM storage.buckets WHERE id = 'event-itineraries';
-- (one row, public = false)
