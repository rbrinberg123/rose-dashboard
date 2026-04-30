# Rose & Co. Dashboard

Internal management dashboard for Rose & Company. Single-page Next.js
(App Router) app that reads from Supabase via server components and
renders six analytics dashboards plus seven admin pages.

The Next.js app lives in this `dashboard/` subdirectory. The repo root
also contains the SQL views/migrations that back the dashboard.

## Stack

- Next.js 16 (App Router, React 19, Turbopack)
- Tailwind v4 + shadcn/ui (base-ui primitives)
- TanStack Table for data grids
- Recharts for charts
- Supabase (`@supabase/supabase-js`) — server-side only with the
  service-role key. The browser never sees Supabase credentials.

## Run locally

```bash
cd dashboard
cp .env.example .env.local      # then fill in the two values below
npm install
npm run dev                      # http://localhost:3000
```

### Environment variables

Both are required server-side (no `NEXT_PUBLIC_*` prefixes — these
must never be shipped to the browser):

| Var                          | Where it comes from                              |
| ---------------------------- | ------------------------------------------------ |
| `SUPABASE_URL`               | Supabase → Settings → API → Project URL          |
| `SUPABASE_SERVICE_ROLE_KEY`  | Supabase → Settings → API → `service_role` key   |

The factory in [lib/supabase.ts](lib/supabase.ts) throws at first call
if either is missing.

### Useful scripts

```bash
npm run dev      # local dev server
npm run build    # production build (used by CI / Vercel)
npm run start    # serve the production build locally
npm run lint     # eslint
node scripts/smoke.mjs   # row-count sanity check across all views
```

## How the deploy works

The app deploys to Vercel via GitHub integration. Every push to
`main` triggers a production deploy; PR branches get preview URLs.

Vercel project configuration:

- **Root directory:** `dashboard` (the Next.js app is a subdirectory)
- **Framework preset:** Next.js (auto-detected)
- **Build command:** `npm run build` (default)
- **Output directory:** `.next` (default)
- **Node version:** Vercel reads `engines.node` from `package.json` (pinned to `>=20.x`)

The two Supabase env vars above must be set in Vercel under
**Project Settings → Environment Variables** for the Production (and
Preview, if desired) environments.

### Production URL

To be filled in after the first deploy completes — visible at the top
of the Vercel project dashboard.

## Architecture notes

- All Supabase reads happen in server components (`page.tsx`) using
  `getSupabaseServer()`. Pages are marked `dynamic = "force-dynamic"`
  because the underlying views recompute on every read.
- Mutations live in `actions.ts` files (server actions) per route.
- Each route has its own `loading.tsx` (skeleton) and `error.tsx`
  (retry boundary) for consistent UX during slow queries or failures.
- The sidebar collapses to a hamburger sheet below `md` so the app
  works on phones and narrow laptop windows.
