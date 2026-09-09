-- 15_ooo_table.sql
-- Mirror table for the custom Dataverse `new_vacationrequest` entity
-- (entity set: new_vacationrequests). Rose's out-of-office / PTO. ~400 rows.
--
-- Conventions (see 03_data_taxonomy.md):
--   - PK is the Dynamics GUID (new_vacationrequestid) typed uuid, named ooo_id
--   - Choice fields -> {field}_code (int) + {field}_label (text)
--   - Lookups -> {field}_id (uuid) + {field}_name (text), NO foreign keys
--   - ownerid is the "Requested By" person (per Decision 12) -> requested_by_*
--   - Full Dynamics row preserved in _raw
--
-- "Mirror everything" per Decision 12.
--
-- TABLE NAME: public.new_vacationrequest — the Dataverse entity's own name, and
-- the name lib/sync/entities.ts writes to and every view/page reads. This file
-- created public.ooo until 2026-09-09, so a database rebuilt from sql/ got a
-- table nothing referenced and every OOO/Time Off feature came up empty. The
-- idx_ooo_* index names are left as they are — short, and already live.

CREATE TABLE IF NOT EXISTS public.new_vacationrequest (
  -- Primary key (Dataverse new_vacationrequestid)
  ooo_id                    uuid PRIMARY KEY,

  -- Core OOO fields
  name                      text,            -- new_name
  start_date                timestamptz,     -- new_startdate
  end_date                  timestamptz,     -- new_enddate
  duration                  integer,         -- new_duration
  pto_type                  text,            -- new_ptotype (String, not a choice)
  request_status_code       integer,         -- new_requeststatus (Picklist)
  request_status_label      text,
  request_type_code         integer,         -- new_requesttype (Picklist)
  request_type_label        text,
  description_comments      text,            -- new_descriptioncomments (Memo)
  review_comments           text,            -- new_reviewcomments (Memo)
  reviewed_by               text,            -- new_reviewedby (String, not a lookup)
  reviewing_team_id         uuid,            -- new_reviewingteam (Lookup, no FK)
  reviewing_team_name       text,

  -- ownerid == "Requested By" (Decision 12)
  requested_by_id           uuid,
  requested_by_name         text,

  -- Standard Dataverse system fields
  created_by_id             uuid,
  created_by_name           text,
  modified_by_id            uuid,
  modified_by_name          text,
  state_code                integer,
  state_label               text,
  status_code               integer,
  status_label              text,
  created_on                timestamptz,
  modified_on               timestamptz,
  overridden_created_on     timestamptz,

  -- Catch-all + sync bookkeeping
  _raw                      jsonb,
  _synced_at                timestamptz NOT NULL DEFAULT now()
);

-- Indexes for common access patterns + the incremental watermark
CREATE INDEX IF NOT EXISTS idx_ooo_modified_on    ON public.new_vacationrequest (modified_on DESC);
CREATE INDEX IF NOT EXISTS idx_ooo_requested_by   ON public.new_vacationrequest (requested_by_id);
CREATE INDEX IF NOT EXISTS idx_ooo_dates          ON public.new_vacationrequest (start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_ooo_status         ON public.new_vacationrequest (request_status_code);

-- Sync writes via service_role
GRANT INSERT, UPDATE, SELECT ON public.new_vacationrequest TO service_role;

-- Stamp _synced_at on every sync (see public.touch_synced_at in 01_mirror_tables.sql).
DROP TRIGGER IF EXISTS new_vacationrequest_touch_synced_at ON public.new_vacationrequest;
CREATE TRIGGER new_vacationrequest_touch_synced_at
  BEFORE INSERT OR UPDATE ON public.new_vacationrequest
  FOR EACH ROW EXECUTE FUNCTION public.touch_synced_at();
