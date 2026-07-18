# Rose & Co. Dashboard

Internal management dashboard for Rose & Company. Single-page Next.js
(App Router) app that reads from Supabase via server components and
renders the analytics dashboards plus the admin pages.

The Next.js app lives in this `dashboard/` subdirectory. The repo root
also contains the SQL views/migrations that back the dashboard.

## Stack

- Next.js 16 (App Router, React 19, Turbopack)
- Tailwind v4 + shadcn/ui (base-ui primitives)
- TanStack Table for data grids
- Recharts for charts
- Supabase — two clients, one role each:
  - **Data client** (`@supabase/supabase-js` with `service_role`) for
    server-only reads/writes of dashboard data. Bypasses RLS.
  - **Auth client** (`@supabase/ssr` with `anon`) for the magic-link
    login flow. Browser-safe.

## Run locally

```bash
cd dashboard
cp .env.example .env.local      # then fill in the values (see tables below)
npm install
npm run dev                      # http://localhost:3000
```

### Environment variables

The dashboard needs **four** env vars now: two for the data client
(server-only, must not leak to the browser) and two for the auth client
(browser-safe, must be `NEXT_PUBLIC_*` so the bundle can read them).

| Var                            | Scope        | Where it comes from                                   |
| ------------------------------ | ------------ | ----------------------------------------------------- |
| `SUPABASE_URL`                 | Server only  | Supabase → Settings → API → Project URL               |
| `SUPABASE_SERVICE_ROLE_KEY`    | Server only  | Supabase → Settings → API → `service_role` secret     |
| `NEXT_PUBLIC_SUPABASE_URL`     | Client + svr | Same Project URL re-exposed to the browser            |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`| Client + svr | Supabase → Settings → API → `anon` `public` key       |

`SUPABASE_SERVICE_ROLE_KEY` must NEVER be set with a `NEXT_PUBLIC_`
prefix and must NEVER be imported into a Client Component. It bypasses
RLS, which is what we want for the data client and what we definitely
do not want for browser code.

The nightly Dynamics sync (Phase 6a) needs **five more** server-only vars:

| Var                  | Where it comes from                                              |
| -------------------- | ---------------------------------------------------------------- |
| `AZURE_TENANT_ID`    | **Dynamics** app registration → Directory (tenant) ID           |
| `AZURE_CLIENT_ID`    | **Dynamics** app registration → Application (client) ID          |
| `AZURE_CLIENT_SECRET`| **Dynamics** app registration → Certificates & secrets          |
| `DYNAMICS_BASE_URL`  | Dynamics env URL, no trailing slash (`https://clientcrm.crm.dynamics.com`) |
| `CRON_SECRET`        | A long random value you generate (`openssl rand -hex 32`)        |

See [Dynamics sync](#dynamics-sync-phase-6a) below for how these are used.

The Microsoft Graph calendar integration (`lib/graph/*`, free/busy lookups)
uses a **separate** Azure app and its own three vars — never reuse the
`AZURE_*` values here:

| Var                  | Where it comes from                                              |
| -------------------- | ---------------------------------------------------------------- |
| `GRAPH_TENANT_ID`    | **Graph/calendar** app registration → Directory (tenant) ID     |
| `GRAPH_CLIENT_ID`    | **Graph/calendar** app registration → Application (client) ID    |
| `GRAPH_CLIENT_SECRET`| **Graph/calendar** app registration → Certificates & secrets    |

The Graph app has `Calendars.ReadBasic.All` (admin-consented) and no Dataverse
access; the Dynamics app is a Dataverse Application User with no Graph
permission. They are different apps — pointing `AZURE_*` at the Graph app
breaks the sync (Dataverse "user is not a member of the organization").

### Useful scripts

```bash
npm run dev      # local dev server
npm run build    # production build (used by CI / Vercel)
npm run start    # serve the production build locally
npm run lint     # eslint
node scripts/smoke.mjs   # row-count sanity check across all views
```

## Authentication

Email magic links via Supabase Auth, gated by an explicit allowlist.

### How a sign-in works

1. User opens any page → [proxy.ts](proxy.ts) sees no session cookie
   and redirects to `/login?next=…`.
2. User enters their email and submits the form. The
   [`sendMagicLink`](app/login/actions.ts) Server Action runs
   server-side, validates the address with Zod, checks
   [`isAllowedEmail`](lib/auth-allowlist.ts), and then calls
   `supabase.auth.signInWithOtp({ email })`.
3. Supabase emails them a one-time link. Clicking it lands them at
   `/auth/callback?code=…`.
4. [`auth/callback/route.ts`](app/auth/callback/route.ts) calls
   `exchangeCodeForSession(code)`, which writes the session cookies
   via the proxy's `setAll` handler, then redirects to `/portfolio`.
5. Subsequent requests carry the cookie. The proxy refreshes the
   token transparently when it nears expiry.

### Editing the allowlist

Open [lib/auth-allowlist.ts](lib/auth-allowlist.ts):

- Add a domain → push onto `ALLOWED_DOMAINS` (e.g. `"acme.com"`).
- Add a one-off external collaborator → push their full address onto
  `ALLOWED_EMAILS`.

The check runs in the Server Action before Supabase is contacted, so
non-allowlisted addresses never receive an email. The browser-side
form does no allowlist check on its own — that's deliberate. Server
is the gate.

### Files involved

| Path                                    | Role                                                      |
| --------------------------------------- | --------------------------------------------------------- |
| [proxy.ts](proxy.ts)                    | Route protection + session refresh on every request       |
| [lib/supabase/browser.ts](lib/supabase/browser.ts) | Browser auth client (sign-out etc.)            |
| [lib/supabase/server.ts](lib/supabase/server.ts)   | Server auth client (RSC, Server Actions)       |
| [lib/supabase/proxy.ts](lib/supabase/proxy.ts)     | Auth client used inside `proxy.ts`             |
| [lib/auth-allowlist.ts](lib/auth-allowlist.ts)     | Domain + email allowlist                       |
| [app/login/](app/login)                 | Login page, form, server action                            |
| [app/auth/callback/route.ts](app/auth/callback/route.ts) | Magic-link code → session exchange      |
| [app/auth/actions.ts](app/auth/actions.ts) | `signOutAction` used by the sidebar                  |

> **Note on naming:** Next.js 16 renamed the old `middleware.ts`
> convention to `proxy.ts` (and the function from `middleware` to
> `proxy`). Same machinery; if you're used to the older name, this
> is the file you're looking for.

### What's not protected

The dashboard's data tables don't have RLS yet. Auth here is purely
**route-level** — the proxy bounces unauthenticated visitors. Anyone
who lands a session can read everything via the data client. That's
acceptable for a small internal tool with a tight allowlist, but if
you want defense in depth, layer RLS on the views in a follow-up.

### Troubleshooting common login errors

| Symptom                                          | Likely cause                                                                  |
| ------------------------------------------------ | ----------------------------------------------------------------------------- |
| "Access restricted to Rose & Company staff."     | Email isn't in the allowlist. Edit `lib/auth-allowlist.ts`.                   |
| Click magic link → bounced back to /login        | Site URL / Redirect URLs in Supabase don't match the host you're on.          |
| Click magic link → "missing_code" or "invalid_*" | Link already used or expired. Request a new one.                              |
| "Could not send magic link: …"                   | SMTP misconfigured in Supabase, or rate-limit hit. Check Supabase Auth logs.  |
| Redirect loop on /login                          | Browser blocking third-party cookies for the Supabase domain.                 |
| Looks signed in then suddenly logged out         | `proxy.ts` matcher accidentally excludes a path it shouldn't.                 |

## Dynamics sync (Phase 6a)

The mirror tables (`accounts`, `meetings`, `touchpoints`, `client_notes`,
`contracts`, `users`) are populated nightly from Dynamics 365 by an
automated sync. This replaces the manual Python loader
([`loader/load.py`](../loader/load.py)), which is **kept as a fallback** —
both write identical row shapes, so either can run.

### How it works

1. **Schedule.** [`vercel.json`](vercel.json) defines a Vercel Cron job that
   hits `GET /api/sync-dynamics` daily at **07:00 UTC** (~2–3 AM ET).
2. **Auth to Dynamics.** The route mints a fresh OAuth2 token via Azure AD
   client-credentials (cached in memory for its ~1h lifetime). No bearer
   tokens are stored in env vars — only the client id/secret.
3. **Incremental pull.** For each entity, the sync reads its
   `last_synced_at` from `sync_runs` and queries Dynamics with
   `$filter=modifiedon gt {timestamp}`. The first-ever run for an entity
   (no `sync_runs` row) is a full pull. After a successful run the watermark
   advances to the run's start time.
4. **Upsert.** Rows are mapped ([`lib/sync/mappers.ts`](lib/sync/mappers.ts))
   and upserted in batches on each table's primary key. A batch that fails
   is retried row-by-row so one bad record doesn't sink the other 499.
5. **Resilience.** Network/auth/throttle failures retry up to 3× with
   exponential backoff. Per-record failures are logged to `sync_errors` and
   skipped. One entity failing **does not** stop the others.

### Request auth

Both `/api/sync-dynamics` invocations are gated by `CRON_SECRET`:

- **Cron** — Vercel automatically attaches `Authorization: Bearer ${CRON_SECRET}`.
- **Manual** — the "Run sync now" button calls a Server Action that adds the
  same header server-side, so the secret never reaches the browser.

The route handles its own auth, so `/api/*` is excluded from the auth proxy
matcher in [`proxy.ts`](proxy.ts). `/api/sync-status` is read-only and needs
no auth.

### The Sync Status page (`/admin/sync`)

Linked under **Admin → Sync Status** in the sidebar. It shows:

- **Entities** — one row per entity from `sync_runs`: last synced time,
  status (`success` / `partial` / `error` / `never run`), records written,
  and error count. `partial` means the entity synced but some records landed
  in `sync_errors`.
- **Recent errors** — the 50 newest `sync_errors` rows (when, entity,
  Dynamics id, message).
- **Run sync now** — triggers an immediate sync for ad-hoc refreshes between
  scheduled runs. Same data is also available as JSON at `/api/sync-status`.

### Manually triggering a sync

```bash
# Production / preview (Vercel sets CRON_SECRET in the environment):
curl -X POST https://<your-domain>/api/sync-dynamics \
  -H "Authorization: Bearer $CRON_SECRET"

# Locally (reads CRON_SECRET from .env.local):
curl -X POST http://localhost:3000/api/sync-dynamics \
  -H "Authorization: Bearer <your-local-CRON_SECRET>"
```

Or just click **Run sync now** on `/admin/sync`. The Python loader remains
available as a fallback (see [`loader/`](../loader)).

### Adding a new entity to the sync

The sync is data-driven from a single list. To add an entity:

1. Add a row mapper in [`lib/sync/mappers.ts`](lib/sync/mappers.ts) that
   returns an object keyed by the target mirror table's column names (mirror
   `loader/load.py` if it has an equivalent).
2. Append one entry to `ENTITIES` in
   [`lib/sync/entities.ts`](lib/sync/entities.ts) with the Web API entity
   **set** name (plural), the Supabase `table`, its `pk`, and the `map`
   function.
3. Grant `service_role` `INSERT, UPDATE` on the new table (see
   [`sql/07_sync_tables.sql`](../sql/07_sync_tables.sql)).

The run loop, `/api/sync-status`, and the admin page all read from
`ENTITIES` — nothing else needs changing.

### SQL setup

Run [`sql/07_sync_tables.sql`](../sql/07_sync_tables.sql) once in the
Supabase SQL editor. It creates `sync_runs` + `sync_errors` and grants
`service_role` write access to the mirror tables (the REST-based sync needs
this; the Python loader used a direct Postgres connection and didn't).

## Supabase project configuration

One-time setup in the Supabase dashboard:

1. **Authentication → Providers** → confirm **Email** is enabled.
   The default settings (magic link enabled, email confirmations off)
   are fine for our flow.
2. **Authentication → URL Configuration**:
   - **Site URL:** `http://localhost:3000` for development. After
     deploy, change this to the production URL (e.g.
     `https://rose-dashboard.vercel.app`).
   - **Redirect URLs:** add `http://localhost:3000/auth/callback`. Add
     `https://<your-vercel-domain>/auth/callback` after deploy. Vercel
     preview URLs use a different host per branch — if you need to
     test auth on previews, you can either add a wildcard pattern
     supported by Supabase or rely on production-only sign-in.
3. **SMTP**: the built-in Supabase mailer works for low volume and is
   fine for this team size. Emails come from `noreply@mail.app.supabase.io`.
   If users report missing emails, check spam, then check
   **Authentication → Logs** in Supabase. Switching to a custom
   provider (Resend, Postmark, SES) is a one-page config under
   **Project Settings → Auth → SMTP**.

## Vercel deploy

The app deploys to Vercel via GitHub integration. Every push to `main`
triggers a production deploy; PR branches get preview URLs.

Vercel project configuration:

- **Root directory:** `dashboard` (the Next.js app is a subdirectory)
- **Framework preset:** Next.js (auto-detected)
- **Build command:** `npm run build` (default)
- **Output directory:** `.next` (default)
- **Node version:** Vercel reads `engines.node` from `package.json`
  (pinned to `>=20.x`)

### Environment variables on Vercel

All env vars must be set under **Project Settings → Environment
Variables** for the Production environment (and Preview, if you want
auth on preview deploys):

| Var                              | Value                              |
| -------------------------------- | ---------------------------------- |
| `SUPABASE_URL`                   | Project URL                        |
| `SUPABASE_SERVICE_ROLE_KEY`      | service_role secret (not anon!)    |
| `NEXT_PUBLIC_SUPABASE_URL`       | Same Project URL                   |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`  | anon public key                    |
| `AZURE_TENANT_ID`                | Dynamics app — tenant (directory) ID |
| `AZURE_CLIENT_ID`                | Dynamics app — application (client) ID |
| `AZURE_CLIENT_SECRET`            | Dynamics app — client secret       |
| `DYNAMICS_BASE_URL`              | `https://clientcrm.crm.dynamics.com` |
| `CRON_SECRET`                    | Long random secret (also auto-injected into cron requests by Vercel) |
| `GRAPH_TENANT_ID`                | Graph/calendar app — tenant (directory) ID |
| `GRAPH_CLIENT_ID`                | Graph/calendar app — application (client) ID |
| `GRAPH_CLIENT_SECRET`            | Graph/calendar app — client secret (separate app from `AZURE_*`) |

> **Cron note:** Vercel Cron is configured in [`vercel.json`](vercel.json)
> and runs on the **production** deployment only. Setting `CRON_SECRET` in
> Production scope both guards the route and is the value Vercel attaches to
> the scheduled request.

### Post-deploy Supabase steps

Once Vercel gives you a production domain:

1. Update **Site URL** in Supabase → Authentication → URL Configuration
   to the Vercel domain (e.g. `https://rose-dashboard.vercel.app`).
2. Add `https://<your-vercel-domain>/auth/callback` to **Redirect URLs**.
3. Sign in once with an allowlisted address to confirm the loop closes.

### Production URL

To be filled in after the first deploy completes.

## Architecture notes

- All dashboard data reads happen in server components (`page.tsx`)
  using the service-role `getSupabaseServer()`. Pages are marked
  `dynamic = "force-dynamic"` because the underlying views recompute
  on every read.
- The auth client (`getSupabaseServerAuth()`, `getSupabaseBrowser()`,
  `getSupabaseProxy()`) is strictly for sign-in/out and never reads
  business data.
- Mutations live in `actions.ts` files (Server Actions) per route.
- Each route has its own `loading.tsx` (skeleton) and `error.tsx`
  (retry boundary) for consistent UX during slow queries or failures.
- The sidebar collapses to a hamburger sheet below `md` and shows
  the signed-in user's email + sign-out button.
