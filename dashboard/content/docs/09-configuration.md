# 09 — Configuration

## What it does (plain language)

The app is configured entirely through **environment variables** — secrets and settings that live outside the code. In production they're set in the **Vercel project settings**; for local development they go in a `dashboard/.env.local` file (never committed). `dashboard/.env.example` is the template listing what's needed.

Two rules to internalize:
- There are **two Supabase keys** and **two Azure apps** — using the wrong one is the classic mistake. See the tables below.
- Anything prefixed `NEXT_PUBLIC_` is shipped to the browser, so it must **never** hold a secret.

## Technical

### From `dashboard/.env.example`

#### Data access (server-only — bypasses RLS)

| Var | Purpose | Where set |
|-----|---------|-----------|
| `SUPABASE_URL` | Supabase project URL, used by `getSupabaseServer()` for all page data reads. | Vercel + `.env.local` |
| `SUPABASE_SERVICE_ROLE_KEY` | The **service_role** secret. Bypasses RLS. **Never** expose to the browser. | Vercel + `.env.local` |

#### Auth flow (safe for the browser)

| Var | Purpose | Where set |
|-----|---------|-----------|
| `NEXT_PUBLIC_SUPABASE_URL` | Same project URL, re-exposed under a public name for the sign-in client. | Vercel + `.env.local` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | The **anon** public key for sign-in (Microsoft SSO + magic link). **Different** from the service-role key. | Vercel + `.env.local` |

#### Sign-in URLs & Microsoft/Entra SSO (Supabase dashboard — not app env vars)

Microsoft/Entra SSO and the magic link both come back to the app's **`/auth/callback`**. Because the app derives `redirectTo` from the request origin / `window.location.origin`, **no app env var is needed** — but these dashboard settings must be right (placeholders only; set real values in the dashboards):

| Setting | Where | Placeholder |
|---------|-------|-------------|
| **Site URL** | Supabase → Authentication → URL Configuration | `https://<your-app-domain>` |
| **Redirect URLs** allowlist | Supabase → Authentication → URL Configuration | `https://<your-app-domain>/auth/callback`, `http://localhost:3000/auth/callback` |
| **Azure provider** (client ID/secret, tenant URL) | Supabase → Authentication → Providers → Azure | single-tenant `https://login.microsoftonline.com/<TENANT_ID>/v2.0` — **stored in Supabase, never in the repo** |
| **Entra app Redirect URI** | Azure → App registrations | `https://<project-ref>.supabase.co/auth/v1/callback` |

> The Azure SSO **client secret lives only in the Supabase dashboard** — it is not an app env var and must not be committed. See [01 — Access & Users](01-access-and-users.md) for the sign-in flow and domain guard.

#### Dynamics sync (Azure app #1)

| Var | Purpose |
|-----|---------|
| `AZURE_TENANT_ID` | Azure AD tenant for the **Dynamics** app. |
| `AZURE_CLIENT_ID` | Client ID of the Dynamics app registration (a Dataverse Application User). |
| `AZURE_CLIENT_SECRET` | Client secret for the Dynamics app (server-only). |
| `DYNAMICS_BASE_URL` | Dynamics environment base URL, no trailing slash, e.g. `https://clientcrm.crm.dynamics.com`. |
| `CRON_SECRET` | Shared secret guarding all `/api/*` cron routes (`Authorization: Bearer <secret>`). Also reused by the admin "Run now" buttons. Generate a long random value. |

#### Microsoft Graph calendar (Azure app #2)

| Var | Purpose |
|-----|---------|
| `GRAPH_TENANT_ID` | Azure AD tenant for the **Graph** app (often the same directory, kept explicit on purpose). |
| `GRAPH_CLIENT_ID` | Client ID of the Graph app (`Calendars.ReadBasic.All`, no Dataverse access). |
| `GRAPH_CLIENT_SECRET` | Client secret for the Graph app (server-only). |

> **The two-apps rule:** `AZURE_*` = Dynamics, `GRAPH_*` = Graph. They are different Azure apps with different permissions; pointing one at the other breaks the sync. See [05 — Sync & Integrations](05-sync-and-integrations.md).

### Other env vars used in code (not in `.env.example`)

These are referenced by the code but aren't in the template — set them in Vercel as needed.

| Var | Purpose | Notes |
|-----|---------|-------|
| `ANTHROPIC_API_KEY` | AI client-summary generation (`/api/client-summary/*`). | Costs API money — keep the nightly batch non-public. |
| `GRAPH_CALLER_MAILBOX` / `GRAPH_SCHEDULE_CALLER_MAILBOX` | The mailbox identity the Graph app calls as (free/busy, mail). | Must be in the `dashboards@` group per the Graph RestrictAccess policy, or Graph returns 403. |
| `SUPABASE_SECRET_KEY` | Alternate name checked for the service-role/secret key in some code paths. | Prefer `SUPABASE_SERVICE_ROLE_KEY`. |
| `NEXT_PUBLIC_VERCEL_DASHBOARD_URL` | Admin hub → Vercel card link. Card hidden if unset. | Browser-exposed (a URL, not a secret). |
| `NEXT_PUBLIC_SUPABASE_DASHBOARD_URL` | Admin hub → Supabase card link. Defaults to this project's dashboard if unset. | Browser-exposed. |
| `NEXT_PUBLIC_DYNAMICS_URL` | Admin hub → Dynamics card link. Defaults to `https://clientcrm.crm.dynamics.com`. | Browser-exposed. |
| `NEXT_PUBLIC_GITHUB_REPO_URL` | Admin hub → GitHub card link. Card hidden if unset. | Browser-exposed. |
| `NEXT_PUBLIC_STATUS_URL` | Admin hub → optional uptime/status card. Card hidden if unset. | Browser-exposed. |

### Vercel-provided system vars (read-only, set automatically)

| Var | Purpose |
|-----|---------|
| `VERCEL_ENV` | `production` / `preview` / `development` — shown on the Admin hub Build tile. |
| `VERCEL_GIT_COMMIT_SHA` | The deployed commit — shown (short) on the Build tile. |
| `VERCEL_REGION` | The serverless region — shown on the Build tile. |

### External project references

| System | Reference |
|--------|-----------|
| **Supabase** project | `uegfmuvkavexmxxaxnwe` — dashboard at `https://supabase.com/dashboard/project/uegfmuvkavexmxxaxnwe`. |
| **Dynamics** environment | `https://clientcrm.crm.dynamics.com` (Dataverse). |
| **Vercel** | The hosting project (URL configurable via `NEXT_PUBLIC_VERCEL_DASHBOARD_URL`). |
| **GitHub** | The source repo (URL configurable via `NEXT_PUBLIC_GITHUB_REPO_URL`). |

> The live **Env inventory** panel at **Admin → Docs** shows, for each expected variable name, whether it is currently set (a yes/no) — never the value itself. Use it to confirm a deployment has all its configuration without exposing any secret.
