-- =============================================================================
-- Patch: Time Off requests — dashboard-owned request → approval workflow
-- Date:  2026-09-24
--
-- WHY
--   The CRM section gets a "Time Off" page (/time-off-requests) that shows the
--   full Dynamics time-off history (new_vacationrequest, read-only) PLUS
--   requests created in the dashboard, which go Pending → Approved / Denied.
--   Approved dashboard requests also feed the OOO Summary page.
--
-- CREATES
--   public.time_off_requests    one row per request (dashboard-owned)
--   public.time_off_days        one row PER DAY of a request, with its portion
--                               (Full / AM / PM). total_days = sum of portions.
--   public.time_off_reviewers   admin mapping: person -> their reviewing team
--   public.time_off_set_days()  the ONLY writer of time_off_days + total_days,
--                               in one transaction, so the two never disagree
--   public.v_admin_time_off_all Dynamics history UNION dashboard requests
--
-- NOT MIRRORS
--   These are NEW dashboard-owned tables, not Dynamics mirrors: the sync never
--   writes them and the deletion sweep never reads them, so they need no
--   origin fence. `origin` is still stamped 'dashboard' (the shared purge and
--   the Audit Log's origin badge key on it) and `is_test` marks test data for
--   the "Delete test requests" button.
--
-- DATES
--   Every date is an EASTERN calendar day, stored as a plain `date` — no time,
--   no zone, so nothing can shift it.
--
-- SECURITY
--   RLS on, zero policies => only service_role reaches these tables. Every
--   write goes through the super-user-gated server actions in
--   app/time-off-requests/actions.ts and app/admin/time-off-reviewers/actions.ts.
--
-- Safe to re-run.
-- =============================================================================

-- ---- 1. Requests -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.time_off_requests (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requested_by_id    uuid NOT NULL,          -- public.users.user_id (Dynamics id space)
  requested_by_name  text,
  request_type       text NOT NULL
                     CHECK (request_type IN ('Vacation','Sick Leave','Personal','Jury Duty','Remote Work','Other')),
  start_date         date NOT NULL,
  end_date           date NOT NULL,
  total_days         numeric NOT NULL DEFAULT 0,  -- written ONLY by time_off_set_days()
  description        text,
  comments           text,
  status             text NOT NULL DEFAULT 'Pending'
                     CHECK (status IN ('Pending','Approved','Denied')),
  reviewed_by_id     uuid,
  reviewed_by_name   text,
  reviewed_at        timestamptz,
  review_comments    text,
  origin             text NOT NULL DEFAULT 'dashboard',
  is_test            boolean NOT NULL DEFAULT false,
  created_by_id      uuid,
  created_by_name    text,
  created_on         timestamptz NOT NULL DEFAULT now(),
  modified_on        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT time_off_requests_dates_ordered CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_time_off_requests_person ON public.time_off_requests (requested_by_id);
CREATE INDEX IF NOT EXISTS idx_time_off_requests_status ON public.time_off_requests (status);
CREATE INDEX IF NOT EXISTS idx_time_off_requests_dates  ON public.time_off_requests (start_date, end_date);

-- ---- 2. Per-day rows ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.time_off_days (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id  uuid NOT NULL REFERENCES public.time_off_requests (id) ON DELETE CASCADE,
  off_date    date NOT NULL,
  portion     text NOT NULL DEFAULT 'Full' CHECK (portion IN ('Full','AM','PM')),
  CONSTRAINT time_off_days_one_per_day UNIQUE (request_id, off_date)
);

CREATE INDEX IF NOT EXISTS idx_time_off_days_date ON public.time_off_days (off_date);

-- ---- 3. Reviewing teams ------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.time_off_reviewers (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_user_id    uuid NOT NULL,   -- the requester
  reviewer_user_id  uuid NOT NULL,   -- one member of their reviewing team
  CONSTRAINT time_off_reviewers_unique UNIQUE (person_user_id, reviewer_user_id)
);

CREATE INDEX IF NOT EXISTS idx_time_off_reviewers_reviewer ON public.time_off_reviewers (reviewer_user_id);

-- ---- 4. Lock down ------------------------------------------------------------
ALTER TABLE public.time_off_requests  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.time_off_days      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.time_off_reviewers ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.time_off_requests  TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.time_off_days      TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.time_off_reviewers TO service_role;

-- ---- 5. The one writer of the per-day rows + total ---------------------------
-- Replaces a request's day rows with `p_days` ([{"off_date":"2026-10-12",
-- "portion":"AM"}, ...]) and re-derives total_days (Full = 1, AM/PM = 0.5) in
-- the SAME transaction. Create and edit both call it, so total_days and the day
-- rows can never drift apart.
CREATE OR REPLACE FUNCTION public.time_off_set_days(p_request_id uuid, p_days jsonb)
RETURNS numeric
LANGUAGE plpgsql
AS $$
DECLARE
  v_total numeric;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.time_off_requests WHERE id = p_request_id) THEN
    RAISE EXCEPTION 'time_off_set_days: request % not found', p_request_id;
  END IF;
  IF p_days IS NULL OR jsonb_typeof(p_days) <> 'array' OR jsonb_array_length(p_days) = 0 THEN
    RAISE EXCEPTION 'time_off_set_days: a request needs at least one day';
  END IF;

  DELETE FROM public.time_off_days WHERE request_id = p_request_id;

  INSERT INTO public.time_off_days (request_id, off_date, portion)
  SELECT p_request_id, x.off_date, COALESCE(x.portion, 'Full')
  FROM jsonb_to_recordset(p_days) AS x(off_date date, portion text);

  SELECT COALESCE(sum(CASE WHEN portion = 'Full' THEN 1 ELSE 0.5 END), 0)
    INTO v_total
    FROM public.time_off_days
   WHERE request_id = p_request_id;

  UPDATE public.time_off_requests SET total_days = v_total WHERE id = p_request_id;
  RETURN v_total;
END;
$$;

REVOKE ALL ON FUNCTION public.time_off_set_days(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.time_off_set_days(uuid, jsonb) TO service_role;

-- ---- 6. The list view: Dynamics history UNION dashboard requests -------------
-- Dynamics rows:
--   * dates are the UTC wall-clock day, exactly as v_time_off reads them (the
--     mirror stores some rows at UTC midnight and some at Eastern midnight).
--   * total_days is NULL here — the page fills it with the OOO Summary's own
--     business-day count (lib/ooo-summary/compute.ts), so the two pages agree.
--   * status: new_requeststatus is empty on every mirrored row, and every
--     Dynamics entry is treated as approved (product decision 2026-06-30, the
--     same rule v_time_off applies) — so a blank status reads 'Approved'.
--   * reviewing_team is the Dynamics team lookup's name.
-- Dashboard rows:
--   * reviewing_team is the requester's CURRENT reviewers from
--     time_off_reviewers, resolved live (not frozen at submit time).
CREATE OR REPLACE VIEW public.v_admin_time_off_all AS
SELECT
  v.ooo_id                                                  AS id,
  'Dynamics'::text                                          AS source,
  v.requested_by_id,
  v.requested_by_name,
  (v.start_date AT TIME ZONE 'UTC')::date                   AS start_date,
  (v.end_date   AT TIME ZONE 'UTC')::date                   AS end_date,
  v.request_type_label                                      AS request_type,
  NULL::numeric                                             AS total_days,
  COALESCE(NULLIF(btrim(v.request_status_label), ''), 'Approved') AS status,
  v.reviewing_team_name                                     AS reviewing_team,
  v.description_comments                                    AS description,
  NULL::text                                                AS comments,
  v.reviewed_by                                             AS reviewed_by_name,
  NULL::timestamptz                                         AS reviewed_at,
  v.review_comments,
  false                                                     AS is_test,
  v.created_by_name,
  v.created_on
FROM public.new_vacationrequest v
WHERE v.start_date IS NOT NULL
  AND v.end_date IS NOT NULL

UNION ALL

SELECT
  r.id,
  'Dashboard'::text,
  r.requested_by_id,
  r.requested_by_name,
  r.start_date,
  r.end_date,
  r.request_type,
  r.total_days,
  r.status,
  (
    SELECT string_agg(COALESCE(u.display_name, '(unknown)'), ', ' ORDER BY u.display_name)
    FROM public.time_off_reviewers tr
    LEFT JOIN public.users u ON u.user_id = tr.reviewer_user_id
    WHERE tr.person_user_id = r.requested_by_id
  ),
  r.description,
  r.comments,
  r.reviewed_by_name,
  r.reviewed_at,
  r.review_comments,
  r.is_test,
  r.created_by_name,
  r.created_on
FROM public.time_off_requests r;

GRANT SELECT ON public.v_admin_time_off_all TO service_role;


-- ---- CHECK IT ---------------------------------------------------------------
-- SELECT source, status, count(*) FROM public.v_admin_time_off_all GROUP BY 1, 2;
-- (473 Dynamics / Approved on 2026-09-24; 0 Dashboard until the first request.)
--
-- total_days always equals its day rows:
-- SELECT r.id, r.total_days,
--        sum(CASE WHEN d.portion = 'Full' THEN 1 ELSE 0.5 END) AS from_days
-- FROM public.time_off_requests r JOIN public.time_off_days d ON d.request_id = r.id
-- GROUP BY 1, 2 HAVING r.total_days <> sum(CASE WHEN d.portion = 'Full' THEN 1 ELSE 0.5 END);
--
-- ---- PURGE TEST REQUESTS (manual equivalent of the page's button) ----------
-- DELETE FROM public.time_off_requests WHERE origin = 'dashboard' AND is_test = true
-- RETURNING id, requested_by_name, start_date, end_date;   -- days cascade
