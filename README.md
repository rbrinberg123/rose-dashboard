# Rose & Company Management Dashboard

A management dashboard for Rose & Company that tracks client portfolio health,
analyst productivity, feedback discipline, pipeline, contract renewals, and
margin by client. Data flows nightly from Microsoft Dynamics 365 (Dataverse)
into Supabase, with a Next.js dashboard reading from views.

## Repository layout

```
.
├── README.md                  ← you are here
├── docs/
│   ├── DESIGN.md              ← architecture and data model design
│   └── ADMIN_UI_SPEC.md       ← spec for the cost-entry admin pages
├── sql/
│   ├── 01_mirror_tables.sql   ← tables that mirror Dynamics (sync-overwritten)
│   ├── 02_rose_owned_tables.sql ← admin-entered tables (never overwritten)
│   ├── 03_views.sql           ← computed views powering each dashboard
│   └── 04_seed_data.sql       ← initial cost_assumptions row
├── loader/
│   ├── load.py                ← reads JSON exports → upserts to Supabase
│   ├── requirements.txt
│   └── .env.example
└── dataverse_exports/         ← (not committed) JSON files from Dataverse
    ├── account.json
    ├── bcs_clientnote.json
    ├── bcs_contract.json
    ├── phonecall.json
    └── bcs_meeting.json
```

## Architecture overview

```
Dynamics 365 (Dataverse)
        │
        │ nightly Python sync (Web API + modifiedon filter)
        ▼
   ┌────────────────────────────────────────────────┐
   │              Supabase (Postgres)               │
   │                                                │
   │   MIRROR (sync-managed)    ROSE-OWNED (admin)  │
   │   ─────────────────────    ─────────────────   │
   │   accounts                 cost_assumptions    │
   │   meetings                 salary_schedule     │
   │   touchpoints              client_direct_costs │
   │   client_notes             overhead_periods    │
   │   contracts                overhead_overrides  │
   │   users                    revenue_overrides   │
   │                                                │
   │   COMPUTED VIEWS                               │
   │   ─────────────────────                        │
   │   v_meeting_costs                              │
   │   v_client_quarterly_pnl  (margin)             │
   │   v_client_portfolio                           │
   │   v_analyst_activity                           │
   │   v_feedback_by_client / _analyst / _overall   │
   │   v_pipeline_30d                               │
   │   v_contract_renewals                          │
   └────────────────────────────────────────────────┘
        │
        ▼
   Next.js dashboard on Render
```

## Setup checklist

### One-time setup

1. **Create the Supabase schema.**

   Open the Supabase SQL editor for your project and run, in order:
   - `sql/01_mirror_tables.sql`
   - `sql/02_rose_owned_tables.sql`
   - `sql/03_views.sql`
   - `sql/04_seed_data.sql`

   Each file is idempotent — safe to re-run.

2. **Export the JSON from Dynamics.**

   Use the existing `dataverse_export.py` script (one level up from this repo).
   It produces five JSON files in `dataverse_exports/`.

3. **Configure the loader.**

   ```
   cd loader
   python -m venv venv
   venv\Scripts\activate         # Windows
   # or: source venv/bin/activate # Mac/Linux
   pip install -r requirements.txt
   cp .env.example .env
   # edit .env and set SUPABASE_DB_URL from Supabase Settings → Database
   ```

4. **Run the loader.**

   ```
   python load.py --exports-dir ../dataverse_exports
   ```

   Expect ~30 seconds for the initial load. The script is idempotent — running
   it again upserts on the primary key.

5. **Verify the data.**

   In the Supabase SQL editor:

   ```sql
   SELECT 'accounts' AS t, COUNT(*) FROM accounts
   UNION ALL SELECT 'meetings', COUNT(*) FROM meetings
   UNION ALL SELECT 'touchpoints', COUNT(*) FROM touchpoints
   UNION ALL SELECT 'client_notes', COUNT(*) FROM client_notes
   UNION ALL SELECT 'contracts', COUNT(*) FROM contracts
   UNION ALL SELECT 'users', COUNT(*) FROM users;
   ```

   Expected: ~216 accounts, ~12,242 meetings, ~877 touchpoints, ~177 client
   notes, ~354 contracts, ~50 users.

   Sanity-check a view:

   ```sql
   SELECT * FROM v_pipeline_30d LIMIT 20;
   SELECT * FROM v_contract_renewals WHERE renewal_urgency IN ('overdue','urgent');
   ```

### Build the dashboard with Claude Code

Once the data is loaded:

1. Initialize a Next.js app in this repo (or a sibling directory):
   ```
   npx create-next-app@latest dashboard --typescript --tailwind --app
   cd dashboard
   ```

2. Open Claude Code in the dashboard directory.

3. Tell Claude Code:
   > "Read the README.md, DESIGN.md, and ADMIN_UI_SPEC.md in the parent
   > project. Build the management dashboard using shadcn/ui, TanStack Table,
   > and Recharts. The Supabase schema is already set up — connect using the
   > service_role key from environment variables. Start with the Client
   > Portfolio view as a vertical slice, then add the others."

4. Claude Code handles the rest — UI, queries, deployment to Render.

## Operating model

**Daily:**
- Dashboard reads happen automatically in the browser.

**Periodic admin entry (in the dashboard):**
- New hire: add a `salary_schedule` entry.
- Raise: end-date the current `salary_schedule` row, add a new one.
- T&E or event cost: log via the Direct Costs page.
- Each quarter: set the `overhead_periods` total; add overrides for advisory
  clients; review the Exception Report.

**Nightly (automated, once we ship the cron):**
- Render cron job runs `dataverse_export.py --incremental` followed by
  `loader/load.py`. Mirror tables get fresh data; Rose-owned tables are
  untouched. View results update on next dashboard load.

## Known wrinkles, by design

- **Cancelled meetings still incur cost.** Booker and host time was spent.
  This is intentional and documented in the cost model.
- **NULL meeting_type defaults to Virtual** (cheaper). Surfaced in the
  Exception Report so you can fix in Dynamics.
- **Users table is built incrementally** from sync, not exported separately.
  An employee who never appears in any record won't be in the table — but
  there's no point representing them in the cost model anyway.
- **No row-level security** in v1. All Rose users see all clients. Add
  Supabase RLS when you expose this beyond the office.
- **No audit log** on Rose-owned tables in v1. Edits overwrite. If you need
  history, add a trigger-based audit table later.

## Troubleshooting

**Loader fails on `accounts` foreign keys.** The loader inserts users first,
then accounts. If a Dynamics row references a user GUID that was never
encountered in any lookup field, the FK insert fails. The fix: add the
referenced user manually to `users`, or remove the FK if data is dirty.

**View query is slow.** All views are non-materialized. At Rose's data scale
(hundreds of accounts, ~12k meetings) this should be fine. If `v_client_quarterly_pnl`
gets sluggish, materialize it with `CREATE MATERIALIZED VIEW` and refresh after
each sync.

**A `bcs_*` field I want isn't in the schema.** It's still in `_raw` (jsonb).
You can query it with `accounts._raw->>'bcs_fieldname'` and add it to the
schema if it earns its keep.
