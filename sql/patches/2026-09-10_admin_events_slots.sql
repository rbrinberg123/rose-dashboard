-- =============================================================================
-- Patch: Admin -> Events -- Meetings / Meeting Slots / Slots Remaining
-- Date: 2026-09-10
--
-- Adds the two computed columns behind the drawer's stat row. Run AFTER
-- sql/patches/2026-09-10_admin_events.sql (this one only appends to the view it
-- creates).
--
-- ── THE DEFINITION, AND WHY IT IS COUNTED RATHER THAN READ ─────────────────
--   Meetings        count of Confirmed rows in public.meetings for the event
--   Meeting Slots   events.of_slots (the CRM's "# of Slots")
--   Slots Remaining of_slots - Meetings, NULL when of_slots is NULL
--
--   This is the SAME confirmed-meeting count the Portfolio "Open Slots" column
--   and v_client_todo.open_slots already use (see the `event_confirmed` CTE in
--   sql/03_views.sql), so the numbers reconcile.
--
--   *** DO NOT USE events.confirmed_meetings OR events.slots_remaining. ***
--   Those are Dynamics rollups and they are STALE. Measured against live data
--   on 2026-09-10: events.confirmed_meetings disagrees with the real count on
--   29 of 968 events -- reporting 0 where the mirror holds 3, 2 and 6 Confirmed
--   meetings -- and events.slots_remaining disagrees on 38 of the 419 events
--   that have a slot count. The rest of the app already ignores them for this
--   reason; this view now does too.
--
-- ── ONE DELIBERATE DIVERGENCE FROM Portfolio ───────────────────────────────
--   Portfolio floors each event at GREATEST(of_slots - confirmed, 0) because it
--   SUMS across a client's events, and a negative would silently cancel out
--   another event's genuinely open slots.
--
--   This column is NOT floored: on a single event, "-5" is the useful answer and
--   hiding it as "0" would conceal an overbooking. That is not hypothetical --
--   92 of the 419 events with a slot count are currently overbooked.
--
--   So for a healthy event the drawer and Portfolio agree exactly; for an
--   overbooked one the drawer says -5 where Portfolio contributes 0. Same
--   inputs, same subtraction, different treatment of the floor -- on purpose.
--
-- SAFE TO RE-RUN.
-- =============================================================================

-- The aggregate below groups public.meetings by event_id, which nothing indexes
-- today. v_client_portfolio and v_client_todo already run the same aggregate, so
-- this helps all three. Partial: a meeting with no event contributes to none of
-- them.
CREATE INDEX IF NOT EXISTS idx_meetings_event_id
  ON public.meetings (event_id)
  WHERE event_id IS NOT NULL;

CREATE OR REPLACE VIEW public.v_admin_events_all AS
SELECT
  e.event_id,

  -- ---- the seven list columns ----
  e.client_account_name,
  e.dates                                       AS event_dates,      -- free text, e.g. "10/2 & 10/3"
  e.event_location,
  e.event_state_label,
  e.targeting_url,
  e.name                                        AS event_title,
  e.user_team_lead,

  -- ---- identity / links ----
  e.client_account_id,
  COALESCE(a.ticker_symbol, e.client_ticker)    AS client_ticker,
  e.marketing_state_label,
  e.state_label,

  -- ---- General section ----
  e.tbc,
  e.sales_lead_primary_id                       AS account_manager_id,
  e.sales_lead_primary_name                     AS account_manager_name,
  e.logistics_coordinator_id,
  e.logistics_coordinator_name,
  e.feedback_team_name,
  e.feedback_report_id,
  e.feedback_report_name,
  e.leads_labels,
  e.team,
  e.event_notes,
  e.event_start_actual                          AS meetings_start,
  e.event_end_actual                            AS meetings_end,

  -- ---- Planning section ----
  e.event_parameters,
  e.of_slots,
  e.urgency_label,
  e.proposed_launch_date                        AS launch_week,
  e.teaser_date                                 AS memo_date,          -- MEMO = teaser
  e.teaser_not_required                         AS memo_not_required,  -- MEMO = teaser
  e.last_data_upload,
  e.shareholder_report_received_date,
  e.targeting_not_required,
  e.targeting_date,
  e.profile_link,
  e.targeting_notes,
  e.launch,
  e.outreach_complete,

  -- ---- system ----
  e.created_on,
  e.modified_on,

  -- ---- NEW in this patch, appended last (CREATE OR REPLACE may only append) --
  -- Confirmed meetings actually attached to this event. COALESCE to 0: no
  -- matching rows means none are confirmed, which is a real zero, not unknown.
  COALESCE(mc.confirmed_meetings, 0)::int       AS confirmed_meetings,

  -- of_slots - confirmed, NOT floored (see the header). NULL when the event has
  -- no slot count: capacity unknown is not capacity zero, and the drawer shows
  -- an em dash rather than a misleading number.
  CASE
    WHEN e.of_slots IS NULL THEN NULL
    ELSE e.of_slots - COALESCE(mc.confirmed_meetings, 0)
  END::int                                      AS slots_remaining
FROM public.events e
LEFT JOIN public.accounts a ON a.account_id = e.client_account_id
LEFT JOIN (
  -- The app's canonical confirmed-meeting count, identical to the
  -- `event_confirmed` CTE in sql/03_views.sql.
  SELECT m.event_id, count(*)::int AS confirmed_meetings
  FROM public.meetings m
  WHERE m.meeting_status_label = 'Confirmed'
    AND m.event_id IS NOT NULL
  GROUP BY m.event_id
) mc ON mc.event_id = e.event_id;

GRANT SELECT ON public.v_admin_events_all TO service_role;

-- Check it, and confirm it reconciles with Portfolio's flooring:
--   SELECT event_title, of_slots, confirmed_meetings, slots_remaining
--   FROM public.v_admin_events_all
--   WHERE of_slots IS NOT NULL
--   ORDER BY slots_remaining
--   LIMIT 10;      -- the most overbooked events, shown as negatives
--
--   SELECT count(*) FILTER (WHERE slots_remaining < 0) AS overbooked,
--          count(*) FILTER (WHERE of_slots IS NULL)    AS no_slot_count,
--          count(*)                                    AS total
--   FROM public.v_admin_events_all;
