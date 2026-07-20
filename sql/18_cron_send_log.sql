-- 18_cron_send_log.sql
-- Idempotency ledger for scheduled (cron) email sends.
--
-- One row per (job_key, sent_on). The PRIMARY KEY on that pair is the whole
-- point: the scheduled Live Outreach digest INSERTs a row before sending, and
-- only the FIRST insert for a given Eastern date can succeed. A duplicate cron
-- delivery hits a unique-violation and skips, so the whole team can never be
-- emailed twice in one day. (The route also gates on the 7:30 AM Eastern window;
-- this table is the belt-and-suspenders second guard.)
--
-- Read/written ONLY via the service_role client from
-- dashboard/lib/live-outreach-send-log.ts. RLS is ENABLED with NO policies, so
-- the anon/browser key gets nothing — same lockdown as public.user_roles.

CREATE TABLE IF NOT EXISTS public.cron_send_log (
  job_key  text        NOT NULL,             -- e.g. 'live_outreach_digest'
  sent_on  date        NOT NULL,             -- the Eastern calendar date claimed
  sent_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (job_key, sent_on)
);

-- Lock down: RLS on, zero policies => only service_role (which bypasses RLS)
-- can read/write. Matches the existing app pattern.
ALTER TABLE public.cron_send_log ENABLE ROW LEVEL SECURITY;

-- Explicit service-role grant, matching the app's existing table pattern.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cron_send_log TO service_role;
