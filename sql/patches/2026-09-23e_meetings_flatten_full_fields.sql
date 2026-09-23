-- =============================================================================
-- Patch: flatten the last _raw-only meeting drawer fields + rewrite
--        v_admin_meetings_all to read them
-- Date:  2026-09-23
--
-- WHY
--   The Meetings create/edit form must cover every field the drawer shows
--   ("form field set = drawer field set"). Five drawer fields had NO column --
--   v_admin_meetings_all and the drawer dug them out of _raw -- so a
--   dashboard-authored meeting could never carry them. Flattened here:
--
--     city_name, state_region_name   <- _bcs_city_value / _bcs_stateregion_value
--                                       formatted values (Dynamics LOOKUPS; the
--                                       ids were already flattened as city_id /
--                                       state_region_id). ~3,900 / ~3,500 rows.
--     on_behalf_of_id / _name        <- _bcs_onbehalfof_value, falling back to
--                                       _createdonbehalfby_value (systemuser
--                                       lookups -> id + name, user picker)
--     host2_id / host2_name          <- _bcs_host2_value (systemuser lookup)
--     fb_received_date  (date)       <- bcs_feedbackreceiveddate, falling back
--                                       to crdfa_feedbackreceiveddate
--
--   MEASURED 2026-09-23 against all 13,854 meetings: the on-behalf-of, host2 and
--   feedback-received keys are ABSENT from every _raw payload (and
--   _createdonbehalfby_value is present but always null). So those backfills
--   write nothing -- the columns exist so DASHBOARD meetings can own the
--   fields, and so the sync picks them up if Dynamics ever returns them.
--
-- VIEW
--   v_admin_meetings_all is restated from
--   sql/patches/2026-09-16_flatten_raw_fields.sql (verified against the live
--   column list: same 40 names, same order, same types). The ONLY changes are
--   the five expressions that read _raw; they now read the new columns.
--   fb_received stays TEXT (a view column cannot change type): the date is
--   rendered M/D/YYYY, the same shape as Dynamics' formatted value.
--
-- ORDER -- RUN THIS BEFORE THE CODE SHIPS
--   lib/sync/mappers.ts mapMeeting now writes these columns on every sync. If
--   the code deploys first, EVERY meetings upsert fails ("column does not
--   exist") until this runs.
--
-- Safe to re-run.
-- =============================================================================


-- ---- PART A -- columns --------------------------------------------------------
ALTER TABLE public.meetings
  ADD COLUMN IF NOT EXISTS city_name          text,
  ADD COLUMN IF NOT EXISTS state_region_name  text,
  ADD COLUMN IF NOT EXISTS on_behalf_of_id    uuid,
  ADD COLUMN IF NOT EXISTS on_behalf_of_name  text,
  ADD COLUMN IF NOT EXISTS host2_id           uuid,
  ADD COLUMN IF NOT EXISTS host2_name         text,
  ADD COLUMN IF NOT EXISTS fb_received_date   date;


-- ---- PART B -- one-time backfill from _raw -----------------------------------
-- The _synced_at trigger is paused so a backfill is not mistaken for a sync
-- (same pattern as 2026-09-16_flatten_raw_fields.sql). Dashboard meetings have
-- a tiny _raw with none of these keys, so they are untouched in effect.
BEGIN;
ALTER TABLE public.meetings DISABLE TRIGGER meetings_touch_synced_at;

UPDATE public.meetings SET
  city_name         = NULLIF(btrim(_raw ->> '_bcs_city_value@OData.Community.Display.V1.FormattedValue'), ''),
  state_region_name = NULLIF(btrim(_raw ->> '_bcs_stateregion_value@OData.Community.Display.V1.FormattedValue'), ''),
  on_behalf_of_id   = CASE
                        WHEN _raw ->> '_bcs_onbehalfof_value' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                          THEN (_raw ->> '_bcs_onbehalfof_value')::uuid
                        WHEN _raw ->> '_createdonbehalfby_value' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                          THEN (_raw ->> '_createdonbehalfby_value')::uuid
                      END,
  on_behalf_of_name = COALESCE(
                        NULLIF(btrim(_raw ->> '_bcs_onbehalfof_value@OData.Community.Display.V1.FormattedValue'), ''),
                        NULLIF(btrim(_raw ->> '_createdonbehalfby_value@OData.Community.Display.V1.FormattedValue'), '')
                      ),
  host2_id          = CASE
                        WHEN _raw ->> '_bcs_host2_value' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                          THEN (_raw ->> '_bcs_host2_value')::uuid
                      END,
  host2_name        = NULLIF(btrim(_raw ->> '_bcs_host2_value@OData.Community.Display.V1.FormattedValue'), ''),
  fb_received_date  = CASE
                        WHEN _raw ->> 'bcs_feedbackreceiveddate' ~ '^\d{4}-\d{2}-\d{2}'
                          THEN left(_raw ->> 'bcs_feedbackreceiveddate', 10)::date
                        WHEN _raw ->> 'crdfa_feedbackreceiveddate' ~ '^\d{4}-\d{2}-\d{2}'
                          THEN left(_raw ->> 'crdfa_feedbackreceiveddate', 10)::date
                      END
WHERE _raw IS NOT NULL
  AND origin = 'dynamics';

ALTER TABLE public.meetings ENABLE TRIGGER meetings_touch_synced_at;
COMMIT;


-- ---- PART C -- v_admin_meetings_all reads the columns ----------------------
CREATE OR REPLACE VIEW public.v_admin_meetings_all AS
SELECT
  m.meeting_id,

  m.meeting_type_label,
  m.meeting_status_label,
  m.meeting_date,

  m.client_account_name,
  e.name                                        AS event_name,
  m.institution_name,
  m.investor_text                               AS investor_name,

  -- WAS: host_name + _raw->>'_bcs_host2_value@…FormattedValue'
  NULLIF(concat_ws(', ',
    NULLIF(m.host_name, ''),
    NULLIF(m.host2_name, '')
  ), '')                                        AS host_names,

  NULLIF(btrim(m.feedback_name), '')            AS feedback_name,

  m.booker_name,
  -- WAS: COALESCE of two _raw lookups' formatted values
  NULLIF(btrim(m.on_behalf_of_name), '')        AS on_behalf_of,

  m.calendar_label,
  m.feedback_bda_label,

  -- WAS: COALESCE of three _raw formatted values (text). Still text.
  to_char(m.fb_received_date, 'FMMM/FMDD/YYYY') AS fb_received,

  m.state_label,
  m.client_account_id,
  m.event_id,
  a.ticker_symbol                               AS client_ticker,

  -- WAS: _raw formatted values
  NULLIF(btrim(m.city_name), '')                AS city_name,
  NULLIF(btrim(m.state_region_name), '')        AS state_region_name,
  m.group_meeting,
  m.hosted_in_hq,
  m.general_notes,
  m.client_booked,
  m.host_notes_label,
  m.profile_label,
  m.feedback_notes,
  m.sent,
  m.confirm,
  m.driver,
  m.food_order,
  m.logistics_notes,
  m.created_by_name,
  m.created_on,
  m.modified_by_name,
  m.modified_on,

  m.host_id,

  m.created_by_id,
  m.modified_by_id
FROM public.meetings m
LEFT JOIN public.events e ON e.event_id = m.event_id
LEFT JOIN public.accounts a ON a.account_id = m.client_account_id;

GRANT SELECT ON public.v_admin_meetings_all TO service_role;


-- ---- CHECK IT (run by hand after the patch) ---------------------------------
-- 1. Backfill coverage. Expect ~3,879 city / ~3,467 state; 0 for the rest.
--
-- SELECT count(city_name) AS city, count(state_region_name) AS state,
--        count(on_behalf_of_name) AS on_behalf, count(host2_name) AS host2,
--        count(fb_received_date) AS fb_rec
-- FROM public.meetings;
--
-- 2. The view still has 40 columns and the same row count as the table.
--
-- SELECT count(*) FROM public.v_admin_meetings_all;
-- SELECT count(*) FROM public.meetings;
--
-- 3. No drift: the new city/state columns reproduce what _raw said.
--    Expect 0.
--
-- SELECT count(*) FROM public.meetings
-- WHERE origin = 'dynamics'
--   AND (city_name IS DISTINCT FROM NULLIF(btrim(_raw ->> '_bcs_city_value@OData.Community.Display.V1.FormattedValue'), '')
--     OR state_region_name IS DISTINCT FROM NULLIF(btrim(_raw ->> '_bcs_stateregion_value@OData.Community.Display.V1.FormattedValue'), ''));
