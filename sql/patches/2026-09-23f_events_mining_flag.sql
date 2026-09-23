-- =============================================================================
-- Patch: flatten the event Mining flag (bcs_mining) + read it in v_live_outreach
-- Date:  2026-09-23
--
-- WHY
--   v_live_outreach drops an event from the Live Outreach page AND its daily
--   email when Dynamics' bcs_mining = Yes -- but read it only from _raw. A
--   dashboard-created event has an empty _raw, so it could never be marked
--   Mining. Flattened into a real boolean column events.mining, settable on the
--   event form (origin='dashboard' events only).
--
--   Live data 2026-09-23: bcs_mining is true on 4 events, false on 4, and
--   null/absent on 978.
--
-- VIEW
--   v_live_outreach is restated from sql/03_views.sql (verified against the
--   live column list: same 20 columns, same order). The ONLY change is the
--   mining predicate, which now reads the column and falls back to _raw:
--     AND COALESCE(e.mining, NULLIF(e._raw ->> 'bcs_mining', '')::boolean, false) = false
--   CREATE OR REPLACE (not DROP ... CASCADE), so grants and dependents stay.
--
-- ORDER -- RUN THIS BEFORE THE CODE SHIPS
--   lib/sync/mappers.ts mapEvent now writes `mining`. If the code deploys
--   first, every events upsert fails ("column does not exist").
--
-- Safe to re-run.
-- =============================================================================


-- ---- PART A -- column ---------------------------------------------------------
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS mining boolean;


-- ---- PART B -- backfill from _raw (dynamics events only) -------------------
BEGIN;
ALTER TABLE public.events DISABLE TRIGGER events_touch_synced_at;

UPDATE public.events
SET mining = CASE lower(NULLIF(btrim(_raw ->> 'bcs_mining'), ''))
               WHEN 'true'  THEN true
               WHEN 'false' THEN false
             END
WHERE _raw IS NOT NULL
  AND origin = 'dynamics';

ALTER TABLE public.events ENABLE TRIGGER events_touch_synced_at;
COMMIT;


-- ---- PART C -- v_live_outreach reads the column ----------------------------
CREATE OR REPLACE VIEW public.v_live_outreach AS
SELECT
  e.event_id,
  e.name                                          AS event_name,
  e.client_account_id,
  COALESCE(e.client_account_name, a.name)         AS client_account_name,
  COALESCE(a.ticker_symbol, e.client_ticker)      AS ticker,
  a.industry_option_label                         AS industry,
  NULLIF(a._raw ->> 'bcs_divyield', '')::numeric  AS div_yield,
  a.market_cap_b,
  e.sales_lead_primary_name                       AS sales_lead_name,
  e.urgency_label                                 AS urgency,
  (e.of_slots - COALESCE(cm.cnt, 0))              AS slots_remaining,
  e.of_slots,
  e.dates                                         AS event_dates,
  e.event_location,
  CASE
    WHEN e.event_location ILIKE '%virtual%' AND e.event_location ILIKE '%live%' THEN 'Hybrid'
    WHEN e.event_location ILIKE '%virtual%' THEN 'Virtual'
    WHEN e.event_location ILIKE '%live%'    THEN 'Live'
    ELSE NULL
  END                                             AS event_mode,
  -- Canonical client health flag (At Risk / Stable / Lost / New Client / Strong),
  -- computed the SAME way v_client_portfolio.recent_note does: "last non-blank
  -- status wins" — the client's most-recent client_notes row THAT ACTUALLY SET a
  -- status, normalized to one of the five canonical flags. A newer note with a
  -- blank status is ignored here (it does not clear the flag). Sourcing it
  -- identically keeps "At Risk" meaning the same thing here as on the Portfolio
  -- page. NULL when the client has never had a note with a non-blank status.
  ns.note_status                                  AS client_status_label,
  -- Earliest contract start for this client (any contract state), and the derived
  -- "new client" flag: a contract began within the last 6 months. Together they
  -- drive the Live Outreach priority tier and the "New Client" flag.
  ec.earliest_contract_start,
  (ec.earliest_contract_start IS NOT NULL
     AND ec.earliest_contract_start >= (CURRENT_DATE - INTERVAL '6 months')) AS is_new_client,
  COALESCE(cm.cnt, 0)                             AS confirmed_meeting_count,
  COALESCE(cm.meetings, '[]'::jsonb)              AS confirmed_meetings
FROM public.events e
LEFT JOIN public.accounts a ON a.account_id = e.client_account_id
-- Latest NON-BLANK client-note status flag (mirrors v_client_portfolio's
-- recent_note CTE, one client at a time). Same ranking (note_date, then
-- modified_on, then created_on — all DESC), but restricted to notes that actually
-- set a status, so a newer blank note does not clear the flag and the value agrees
-- with the Portfolio page.
LEFT JOIN LATERAL (
  SELECT s.note_status
  FROM (
    SELECT
      CASE
        WHEN lower(btrim(n.status_text)) LIKE 'at risk%'    THEN 'At Risk'
        WHEN lower(btrim(n.status_text)) LIKE 'stable%'     THEN 'Stable'
        WHEN lower(btrim(n.status_text)) LIKE 'lost%'       THEN 'Lost'
        WHEN lower(btrim(n.status_text)) LIKE 'new client%' THEN 'New Client'
        WHEN lower(btrim(n.status_text)) LIKE 'strong%'     THEN 'Strong'
        ELSE NULLIF(btrim(n.status_text, E' \t\n\r'), '')
      END AS note_status,
      n.note_date,
      n.modified_on,
      n.created_on
    FROM public.client_notes n
    WHERE n.client_account_id = e.client_account_id
  ) s
  WHERE s.note_status IS NOT NULL   -- only notes that actually set a status
  ORDER BY s.note_date DESC, s.modified_on DESC NULLS LAST, s.created_on DESC NULLS LAST
  LIMIT 1
) ns ON true
-- Earliest contract start across ALL of the client's contracts (any state).
LEFT JOIN LATERAL (
  SELECT MIN(k.contract_start_date) AS earliest_contract_start
  FROM public.contracts k
  WHERE k.client_account_id = e.client_account_id
) ec ON true
LEFT JOIN LATERAL (
  SELECT
    COUNT(*) AS cnt,
    jsonb_agg(
      jsonb_build_object(
        'meeting_id',       m.meeting_id,
        'meeting_date',     m.meeting_date,
        'institution_name', m.institution_name,
        'contact',          m.investor_text,
        'created_on',       m.created_on
      )
      ORDER BY m.meeting_date
    ) AS meetings
  FROM public.meetings m
  WHERE m.event_id = e.event_id
    AND m.meeting_status_label = 'Confirmed'
) cm ON true
WHERE e.event_state_label = 'Live Outreach'
  -- Exclude deactivated events. state_label is the Dataverse statecode
  -- ('Active' = 0 / 'Inactive' = 1), distinct from the event_state_label
  -- workflow field above. Only Active events should appear on the page.
  AND e.state_label = 'Active'
  -- Exclude Mining events. bcs_mining is a Dynamics Yes/No toggle on the event,
  -- added 2026-09-21; it is null/absent on events not yet re-synced since, so
  -- COALESCE treats null / missing / blank as false and only events explicitly
  -- ticked Mining = Yes are dropped. Activates automatically as the team ticks
  -- the box (ticking modifies the event, so the incremental sync refetches it).
  -- CHANGED 2026-09-23: read the flattened `mining` column (settable on
  -- dashboard events), falling back to _raw for any row the backfill missed.
  AND COALESCE(e.mining, NULLIF(e._raw ->> 'bcs_mining', '')::boolean, false) = false
ORDER BY a.ticker_symbol NULLS LAST, e.name;


-- ---- CHECK IT (run by hand after the patch) ---------------------------------
-- 1. Backfill: expect 4 true, 4 false, the rest null.
--
-- SELECT mining, count(*) FROM public.events GROUP BY 1 ORDER BY 1;
--
-- 2. No drift: the column agrees with _raw on every dynamics event. Expect 0.
--
-- SELECT count(*) FROM public.events
-- WHERE origin = 'dynamics'
--   AND COALESCE(mining, false)
--       IS DISTINCT FROM COALESCE(NULLIF(_raw ->> 'bcs_mining', '')::boolean, false);
--
-- 3. The Live Outreach list is unchanged by the patch itself (compare the count
--    before and after running PART C).
--
-- SELECT count(*) FROM public.v_live_outreach;
