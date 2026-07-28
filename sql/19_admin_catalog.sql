-- ---------------------------------------------------------------------------
-- Admin → Docs live reference panels: catalog helper functions.
--
-- PostgREST does not expose information_schema / pg_catalog over the REST API,
-- so the in-app "live — generated from the current system" panels cannot read
-- them directly. These SECURITY DEFINER functions wrap the catalog queries and
-- are callable from the service-role server client via supabase.rpc(...).
--
-- Read-only. They return only structural metadata (names, types, row-count
-- ESTIMATES) — never any table data and never any secret. Safe to expose.
--
-- Run this file in the Supabase SQL editor. Until it is run, the Admin → Docs
-- live panels fail soft and show "unavailable" (they never error the page).
-- Idempotent — safe to re-run.
-- ---------------------------------------------------------------------------

-- Every public view named v_* (the dashboard's computed views).
create or replace function public.admin_catalog_views()
returns table (view_name text)
language sql
security definer
set search_path = public, pg_catalog
as $$
  select table_name::text
  from information_schema.views
  where table_schema = 'public'
    and table_name like 'v\_%'
  order by table_name;
$$;

-- Every public BASE TABLE with an approximate row count. Uses pg_class.reltuples
-- (the planner's estimate refreshed by ANALYZE/autovacuum) so this stays cheap —
-- no count(*) scan per table. A never-analyzed table reports -1; we surface null.
create or replace function public.admin_catalog_tables()
returns table (table_name text, est_rows bigint)
language sql
security definer
set search_path = public, pg_catalog
as $$
  select c.relname::text as table_name,
         case when c.reltuples < 0 then null else c.reltuples::bigint end as est_rows
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
  order by c.relname;
$$;

-- Columns of every public base table, in ordinal order. Joined to the table
-- list app-side to render a per-table schema.
create or replace function public.admin_catalog_columns()
returns table (table_name text, column_name text, data_type text, ordinal_position int)
language sql
security definer
set search_path = public, pg_catalog
as $$
  select c.table_name::text,
         c.column_name::text,
         c.data_type::text,
         c.ordinal_position::int
  from information_schema.columns c
  join information_schema.tables t
    on t.table_schema = c.table_schema
   and t.table_name = c.table_name
  where c.table_schema = 'public'
    and t.table_type = 'BASE TABLE'
  order by c.table_name, c.ordinal_position;
$$;

grant execute on function public.admin_catalog_views() to authenticated, service_role;
grant execute on function public.admin_catalog_tables() to authenticated, service_role;
grant execute on function public.admin_catalog_columns() to authenticated, service_role;
