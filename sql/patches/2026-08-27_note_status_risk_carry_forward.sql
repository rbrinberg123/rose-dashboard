-- =============================================================================
-- Patch: carry status_text and primary_risk_driver forward on
--        public.v_client_detail_recent_note
-- Date: 2026-08-27
--
-- The Client Detail note card read this view, which returned the LATEST note
-- verbatim. Client status and primary risk driver are standing facts, not
-- per-note entries, so a newer note that leaves them blank was wiping them from
-- the card (e.g. 4D Medical, whose most recent note sets neither).
--
-- After this patch each of the two fields is resolved INDEPENDENTLY as the last
-- non-blank value: the newest note that actually set that field wins, and a
-- newer blank note is ignored. This is the rule v_client_portfolio's recent_note
-- CTE already used for status; primary_risk_driver never had it anywhere.
--
-- Unchanged: notes_text and the action fields (action_step / action_owner /
-- action_deadline) still come from the latest note only — those are current
-- to-dos and must not survive a newer note.
--
-- Adds two columns at the END of the view (so CREATE OR REPLACE is legal):
-- status_note_date / risk_note_date, the note_date each carried-forward value
-- came from.
--
-- Idempotent — safe to re-run. Mirrors sql/03_views.sql.
-- =============================================================================

CREATE OR REPLACE VIEW public.v_client_detail_recent_note AS
WITH cleaned AS (
  SELECT
    n.client_account_id AS account_id,
    n.note_id,
    n.note_date,
    n.modified_on,
    n.created_on,
    btrim(n.notes_text) AS notes_text,
    NULLIF(btrim(n.status_text, E' \t\n\r'), '') AS status_text,
    -- NB: the blank/'none' guard trims the SAME character set as the value it
    -- returns (space, tab, CR, LF). One-argument btrim() strips spaces only, so
    -- a risk driver of E'\n' slipped past the guard and came back as an empty
    -- string — harmless while it died with the latest note, but it would now be
    -- carried forward into a blank "Primary risk:" pill. 2 notes in the source
    -- hold exactly that value.
    CASE
      WHEN lower(btrim(COALESCE(n.primary_risk_driver, ''), E' \t\n\r')) IN ('', 'none') THEN NULL
      ELSE btrim(n.primary_risk_driver, E' \t\n\r')
    END AS primary_risk_driver,
    NULLIF(btrim(n.action_step), '') AS action_step,
    NULLIF(btrim(n.action_owner), '') AS action_owner,
    n.action_deadline
  FROM public.client_notes n
  WHERE n.client_account_id IS NOT NULL
),
-- The latest note itself — body + action fields come from here.
latest AS (
  SELECT *
  FROM (
    SELECT
      c.*,
      ROW_NUMBER() OVER (
        PARTITION BY c.account_id
        ORDER BY c.note_date DESC, c.modified_on DESC NULLS LAST, c.created_on DESC NULLS LAST
      ) AS rn
    FROM cleaned c
  ) r
  WHERE r.rn = 1
),
-- Newest note that actually SET a status (blank notes filtered out first, so
-- they cannot overwrite a prior value). Same ranking as `latest`.
last_status AS (
  SELECT DISTINCT ON (account_id)
    account_id,
    status_text,
    note_date AS status_note_date
  FROM cleaned
  WHERE status_text IS NOT NULL
  ORDER BY account_id, note_date DESC, modified_on DESC NULLS LAST, created_on DESC NULLS LAST
),
-- Same, independently, for the primary risk driver.
last_risk AS (
  SELECT DISTINCT ON (account_id)
    account_id,
    primary_risk_driver,
    note_date AS risk_note_date
  FROM cleaned
  WHERE primary_risk_driver IS NOT NULL
  ORDER BY account_id, note_date DESC, modified_on DESC NULLS LAST, created_on DESC NULLS LAST
)
SELECT
  l.account_id,
  l.note_id,
  l.note_date,
  l.notes_text,
  ls.status_text,
  lr.primary_risk_driver,
  l.action_step,
  l.action_owner,
  l.action_deadline,
  CASE
    WHEN l.action_deadline IS NULL THEN NULL
    ELSE (l.action_deadline - CURRENT_DATE)::int
  END AS days_to_deadline,
  ls.status_note_date,
  lr.risk_note_date
FROM latest l
LEFT JOIN last_status ls ON ls.account_id = l.account_id
LEFT JOIN last_risk   lr ON lr.account_id = l.account_id;
