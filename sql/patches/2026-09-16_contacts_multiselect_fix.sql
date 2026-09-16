-- =============================================================================
-- Patch: fix the contacts sync failure — multi-select option sets cast to integer
-- Date: 2026-09-16
--
-- SYMPTOM
--   150 rows in sync_errors, entity_name = 'contacts', every one of them:
--     invalid input syntax for type integer: "755860001,755860005"
--   `run.ts` upserts the whole mapped row, so ONE bad column fails the ENTIRE
--   contact — name, email, client link and all. 150 contacts were missing from
--   the mirror completely, not just missing a field.
--
-- CAUSE
--   Two of the six choice fields on `contact` are MULTI-SELECT option sets.
--   Dynamics returns those as a COMMA-JOINED string of codes, with the
--   FormattedValue as a SEMICOLON-JOINED string of labels:
--     "755860001,755860004"  ->  "Robert Brinberg; Brian Smith"
--   sql/23_contacts_table.sql modeled every choice field as the standard
--   single-select `_code integer` + `_label text` pair, so Postgres rejected the
--   comma-joined string.
--
-- WHICH FIELDS — measured, not guessed
--   The failing rows are absent from the mirror, so the evidence could not come
--   from public.contacts. It came from the SAME Dynamics fields on tables whose
--   rows sync fine:
--     bcs_internalassignment   accounts:     38 of 131 populated are comma-joined
--     bcs_contacttype          touchpoints:  60 of 561 populated are comma-joined
--   The other four are single-select everywhere they appear and are LEFT ALONE:
--     bcs_industrychoice, bcs_state, bcs_stateforaddress, bcs_lastactivitytype
--
-- THE FIX FOLLOWS AN EXISTING PRECEDENT
--   `public.touchpoints.contact_type_code` is already `text` in the live
--   database for exactly this reason — someone hit this bug there and widened
--   the column. (Note sql/01_mirror_tables.sql:294 still declares it `int`: the
--   repo DDL never caught up. See the FLAG FORWARD note at the bottom.)
--   So: widen, keep the singular `_code` name, and let the mapper pass the
--   string straight through. Same shape as touchpoints.
--
-- BLAST RADIUS: NONE beyond the two columns.
--   Neither `contacts.contact_type_code` nor `contacts.internal_assignment_code`
--   is selected by v_admin_contacts_all or v_admin_contacts_filter_options
--   (both read the *_label columns, which are text and do not change), and
--   neither appears anywhere in the app. Verified 2026-09-16. No view needs
--   rebuilding, which is also why the ALTERs below cannot fail on a dependency.
--
-- SAFE TO RE-RUN.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Widen the two multi-select code columns
--    USING ...::text is a no-op on the rows already stored (they are the
--    single-valued ones that succeeded); it exists so the ALTER is valid.
-- ---------------------------------------------------------------------------

ALTER TABLE public.contacts
  ALTER COLUMN internal_assignment_code TYPE text USING internal_assignment_code::text;

ALTER TABLE public.contacts
  ALTER COLUMN contact_type_code TYPE text USING contact_type_code::text;

COMMENT ON COLUMN public.contacts.internal_assignment_code IS
  'MULTI-SELECT option set: comma-joined Dynamics codes, e.g. "755860001,755860004". '
  'text, not integer. The matching labels are semicolon-joined in internal_assignment_label.';

COMMENT ON COLUMN public.contacts.contact_type_code IS
  'MULTI-SELECT option set: comma-joined Dynamics codes, e.g. "755860001,755860002". '
  'text, not integer. The matching labels are semicolon-joined in contact_type_label.';

-- ---------------------------------------------------------------------------
-- 2. Re-pull every contact
--    The sync is incremental off sync_runs.last_synced_at, and the 150 failed
--    rows were never written — so they will NOT come back on their own: their
--    modifiedon is older than the watermark, which advanced anyway (a partial
--    run still advances it; the failures are what sync_errors is for).
--    Clearing the watermark forces a full pull on the next cron run.
-- ---------------------------------------------------------------------------

UPDATE public.sync_runs SET last_synced_at = NULL WHERE entity_name = 'contacts';

-- The next scheduled sync (every 10 minutes on weekdays) re-pulls all contacts.
-- Every previously-failing row now upserts cleanly: the only thing that rejected
-- it was the integer cast, and the column it was cast into is now text.

-- ---------------------------------------------------------------------------
-- 3. Check it — AFTER the next sync run
-- ---------------------------------------------------------------------------
--   -- Should be 758 + the ~150 that could never land before:
--   SELECT count(*) FROM public.contacts;
--
--   -- The multi-valued rows are now present. Expect a non-zero count:
--   SELECT count(*) FILTER (WHERE internal_assignment_code LIKE '%,%') AS multi_assignment,
--          count(*) FILTER (WHERE contact_type_code LIKE '%,%')        AS multi_contact_type
--   FROM public.contacts;
--
--   -- And no NEW integer-cast failures. Expect zero rows:
--   SELECT run_started_at, count(*)
--   FROM public.sync_errors
--   WHERE entity_name = 'contacts'
--     AND error_message LIKE 'invalid input syntax for type integer%'
--     AND run_started_at > now() - interval '1 day'
--   GROUP BY 1 ORDER BY 1 DESC;
--
--   -- If ANY still appear, a THIRD field is multi-select. Find it the same way
--   -- this one was found — look for comma-joined values in _raw:
--   SELECT key, count(*) FROM public.contacts, LATERAL jsonb_each_text(_raw)
--   WHERE value LIKE '75586%,75586%' GROUP BY 1 ORDER BY 2 DESC;

-- =============================================================================
-- FLAG FORWARD — do not repeat this
-- =============================================================================
-- 1. accounts.bcs_internalassignment is the SAME multi-select field (57.5%
--    populated, 38 of 131 comma-joined) and is still unflattened. When the
--    deferred accounts pass flattens it, the code column MUST be text — not
--    integer — or accounts will fail exactly the way contacts just did, and an
--    accounts-wide failure is worse: every dashboard page reads that table.
--
-- 2. Any future choice field should be checked for comma-joined values in _raw
--    BEFORE being modeled as `_code integer`. The one-line test:
--      SELECT count(*) FROM <table> WHERE _raw ->> '<bcs_field>' LIKE '%,%';
--
-- 3. sql/01_mirror_tables.sql:294 declares touchpoints.contact_type_code as
--    `int`, but the live column is `text`. A database rebuilt from the repo
--    would reintroduce this exact bug on touchpoints. Left unchanged here to
--    keep this patch minimal — worth fixing in the next DDL reconcile pass.
