# 01 — Access & Users

## What it does (plain language)

Everyone signs in with a **magic link** — you type your email, get a link, click it, and you're in. There are no passwords.

Once signed in, access is controlled entirely from **two Admin screens** — no code change needed:

- **Admin → Users & Roles** gives each person a **role**: Super User, Client Manager, Logistics, User, or **None**.
- **Admin → Roles** is a grid that says, for each role, **which pages that role can see**.

So a person's access = *their role* (from Users & Roles) → *the pages that role is allowed* (from the Roles grid). Put together:

- **Super User** — sees everything, always (a hard rule the grid can't turn off).
- **Any other role** — sees exactly the pages checked for it in the Roles grid, and nothing else.
- **None / no role** — can't see any real page; they land on a "request access" screen.

The rule is **deny-by-default**: a page is blocked for a role unless its box is checked in the Roles grid. A brand-new page is therefore Super-User-only until someone ticks it on for a role — you can't accidentally leak a new finance page to everyone.

### "View as" — see the app as any role, or any person

Super-users have two related testing tools, both super-user-only and both invisible to everyone else:

- **View as role** — on the **Admin** page, a small dropdown (Super User / Client Manager / Logistics / User) + **Apply**. Previews an *abstract* role.
- **View as person** — on **Admin → Users & Roles**, each row has a small **"View as"** button. Previews the app as *that specific person*, using **their** real role. Most people have no role yet, so viewing as them correctly shows the "no access" experience — which is a valid, useful test.

Either way, the whole app — the sidebar and every page — instantly behaves as if you *were* that role/person: pages they can't see disappear and become blocked. A thin **amber banner is pinned across the top of every page** while active — e.g. "👁 Viewing as Jane Smith — Logistics — Exit view", or "👁 Viewing as User (role) — Exit view". The **Exit view** button always returns you to your normal super-user view — even when viewing as someone who can't reach Admin — so you can never get stuck. The two modes are mutually exclusive; starting one clears the other, and Exit clears both.

Because it reuses the real access rules, it doubles as a live test: as each role's page access (and, later, each person's data scoping) gets wired up, "View as" immediately reflects it.

## How to open a page to a role

Go to **Admin → Roles**, find the page's row, and tick the box in that role's column. It saves immediately and takes effect on the user's **next page load** — no code change or deploy. Both the security gate and the sidebar read the same grid, so they can never disagree.

To keep a page Super-User-only, leave every other role's box unchecked — that's the default (deny-by-default).

## Technical

### The roles (now driven by the Admin UI tables)

`Role = "super_user" | "user" | "client_manager" | "logistics"` (`dashboard/lib/access-control.ts`). A person's role is read at request time from **`public.user_role_grants`** by `getRealRole()` (`dashboard/lib/user-role.ts`), keyed by lower-cased email. No grant row → `null` → no access beyond the always-allowed infra routes.

> The old `user_roles` table is left in place as a **backup** but is no longer read. Copy its rows into `user_role_grants` before relying on this (see **Go-live migration** below) — otherwise nobody, not even a super-user, has a role.

### Which pages a role may reach — `public.role_page_access`

The per-role page allow-list lives in **`public.role_page_access`** — the **Admin → Roles** grid (one `{ role, route, allowed }` row per checked cell). At request time `getAllowedRoutes(role)` (`dashboard/lib/page-access.ts`) loads that role's `allowed = true` routes in **one query**, ordered by `PAGE_REGISTRY` so the first entry is a natural landing page. It **fails closed** — any error (including the table not existing) returns `[]`, denying rather than leaking — and short-circuits to `[]` for `super_user` (who is never gated by the grid).

`ALWAYS_ALLOWED_ROUTES` (`dashboard/lib/access-control.ts`) stays as the one hardcoded infra list — currently just `/no-access` — reachable by any signed-in user regardless of role. (`/login`, `/auth/*` are handled separately as public paths by the proxy.)

### The decision function

```ts
// canAccessRoute(role, pathname, allowedRoutes) — the single source of truth.
// `allowedRoutes` comes from getAllowedRoutes(role), loaded once per request.
export function canAccessRoute(
  role: Role | null,
  pathname: string,
  allowedRoutes: readonly string[],
): boolean {
  if (ALWAYS_ALLOWED_ROUTES.some((r) => matchesRoute(pathname, r))) return true
  if (role === "super_user") return true            // hard backstop — never gated by the grid
  if (!role) return false                           // no role → nothing but ALWAYS_ALLOWED
  return allowedRoutes.some((r) => matchesRoute(pathname, r))
}
```

`matchesRoute` is segment-aware (`pathname === route || pathname.startsWith(route + "/")`), so a granted `/client-detail` also allows `/client-detail/123`.

### Where it's actually enforced — `dashboard/proxy.ts`

The real security boundary is the **proxy** (Next.js 16's name for middleware), which runs on the server *before any page renders*:

1. It calls `supabase.auth.getUser()` to validate the session and refresh the cookie.
2. **No session** on a protected path → redirect to `/login` (preserving the intended destination in `?next=`).
3. **Signed in** → resolve the **effective** role (View-as aware), load `getAllowedRoutes(effectiveRole)` once, and call `canAccessRoute(role, pathname, allowedRoutes)`. If denied, redirect to the role's **first allowed page** (`allowedRoutes[0]`), or `/no-access` if they have none. This replaces the old fixed `USER_HOME_ROUTE` and can never redirect-loop (the target is always reachable).

Public paths (`/login`, `/auth/callback`) are allowlisted. The matcher excludes `/api/*` (those routes do their own auth — see [06 — Automations](06-automations.md)) and static assets.

> Because the proxy runs server-side before render, it also blocks someone who types a restricted URL directly. The sidebar hiding links (via the same `canAccessRoute`) is **cosmetic** — the proxy is the gate.

### The nav mirrors the gate — `dashboard/components/nav.tsx`

The root layout loads `getAllowedRoutes(effectiveRole)` once and passes it to the sidebar, which filters each section's items with `canAccessRoute(role, item.href, allowedRoutes)` and drops any section left empty — so the nav shows exactly the pages the grid grants, never one more query than needed. Admin is reached via a small **gear icon** (links to `/admin`) that renders only when `canAccessRoute(role, "/admin", allowedRoutes)` is true.

### View as (super-user testing mode)

A super-user can preview the app as an abstract **role** or as a specific **person**. It is built on a clean split between the caller's **real** identity/role and the **effective** identity/role:

- `getRealRole(email)` (`dashboard/lib/user-role.ts`) — the caller's actual role from the `user_roles` table (the old `getUserRole`, kept as an alias). Used **only** to authorize impersonation and the exit action, so it can never be spoofed by a cookie.
- `resolveEffective(realRole, viewAsUserCookie, viewAsRoleCookie)` (`dashboard/lib/impersonation.ts`) — the shared core. Honors impersonation **only** when `realRole` is `super_user`. **Person** mode (`view_as_user`) takes precedence over **role** mode (`view_as`); otherwise it returns the real role. It has **no** `next/headers` import, so the proxy imports it directly (reading cookies off the `NextRequest`).
- `getEffectiveRole()` and `getEffectiveIdentity()` (`dashboard/lib/effective-identity.ts`) — the request-context wrappers (they read cookies via `next/headers`) for Server Components/Actions. **`getEffectiveIdentity()` is the single source future row-scoping resolvers (`accessibleClientIds`, `hostedMeetingIds`, `feedbackAssignments`) will consume** — it returns `{ email, userId, name, role, impersonated }`, where `userId` is the Dynamics system-user id from the `users` mirror. So person-scoping lights up automatically when those resolvers land (no scoping changes here yet).

`proxy.ts`, `canAccessRoute`, and the nav all gate on the **effective role** (and its `getAllowedRoutes`), so the whole app (route gating + sidebar) reflects the viewed-as person/role. A person's effective role is **their** `getRealRole` — often `null` or a role with few grants, which correctly yields the "no access" or reduced experience.

- **The cookies** — `view_as_user` (`VIEW_AS_USER_COOKIE`, an `@roseandco.com` email) and `view_as` (`VIEW_AS_COOKIE`, a role). Both are **httpOnly**, `sameSite=lax`, `path=/`, and `secure` in production (relaxed in dev so they work over `http://localhost`). Read **server-side** only; client state is never trusted. The two modes are mutually exclusive — setting one clears the other.
- **Entry points** — a per-row **"View as"** button on **Admin → Users & Roles** (`dashboard/app/admin/users/users-view.tsx` → `setViewAsUserAction`), and the **"View as role"** dropdown on the Admin hub (`dashboard/app/admin/page.tsx`, `ViewAsControl` → `setViewAsAction`). Neither is in the main nav.
- **Banner** — while either cookie is active, `dashboard/components/view-as-banner.tsx` renders a slim banner pinned to the top of every page, from the **root layout** (outside the sidebar, which hides itself on some pages). The layout builds the label ("Viewing as {Name} — {role or 'No role'}"). Its **Exit view** button posts to `exitViewAsAction`.
- **Actions** — `dashboard/app/view-as-actions.ts`. `setViewAsAction`, `setViewAsUserAction`, and `exitViewAsAction` all authorize off `getRealRole` (via `requireSuperUser`), **never** the effective role — so you can always exit even while viewing as someone with no access, and a non-super holding a stray cookie is ignored. Exit clears **both** cookies.

**Guardrails.** Only a real `super_user` can set or hold either cookie; `resolveEffective` ignores them for anyone else, and a stale/bogus `view_as_user` email that matches no active mirror row is safely ignored. When the effective role can't reach the requested route, the proxy redirects to that role's first allowed page, or the always-allowed `/no-access` when it has none — so previewing a no-access person lands on the request-access screen (with the banner's Exit still present) instead of a redirect loop.

### Admin pages

`/admin` and everything under `/admin/*` have no `role_page_access` grants for any non-super role, so they're Super-User-only by the deny-by-default rule. Don't tick them on for another role unless you truly mean to.

The Admin hub also has a **Hidden Pages** section (`dashboard/app/admin/page.tsx`, the `HIDDEN_PAGES` array) that links to routes parked off the main nav — currently `/pipeline`, `/relationships`, and `/conference-rooms`. Those pages are super-user-only purely because Admin is; the pages themselves keep their own routes. To park another page later, add one `{ href, label }` line to `HIDDEN_PAGES`.

### Users & Roles (Admin → **live**)

`/admin/users` (`dashboard/app/admin/users/`) lists every **active `@roseandco.com`** person from the `users` mirror table (Dynamics system users — filtered `is_active = true` and email ending `@roseandco.com`) and lets a super-user set a role for each: **None** (no grant), **User**, **Client Manager**, **Logistics**, or **Super User**. Each row shows the name (bold) and email on one line; changing a selector saves immediately (with a small updating/saved state).

Granted users **float to the top**, ordered Super User → Logistics → Client Manager → User (each carrying a small colored role pill), with the **None** rows muted below, alphabetical by name. A summary line up top reads e.g. "N users · N granted · N none", and a **"Show granted only"** checkbox hides the None rows so you can review just who's assigned.

> **Live.** The role set here is the value `getRealRole` reads, so it controls what that person can access on their **next page load**. Grants are written to `public.user_role_grants` (keyed by lower-cased email); selecting **None** deletes the row (→ no role → no access beyond the always-allowed infra routes).

Writes go through a super-user-gated server action (`dashboard/app/admin/users/actions.ts`, `setUserRole`), which enforces `requireSuperUser`, validates the `@roseandco.com` domain **server-side**, upserts/deletes in `user_role_grants`, and `revalidatePath`s.

The table must be created once in the Supabase SQL editor:

```sql
CREATE TABLE IF NOT EXISTS public.user_role_grants (
  email       text PRIMARY KEY,
  role        text NOT NULL CHECK (role IN ('user','client_manager','logistics','super_user')),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text
);
ALTER TABLE public.user_role_grants ENABLE ROW LEVEL SECURITY;
```

If the table already exists from before **Client Manager** was added, widen its CHECK constraint (run once in the Supabase SQL editor):

```sql
ALTER TABLE public.user_role_grants DROP CONSTRAINT IF EXISTS user_role_grants_role_check;
ALTER TABLE public.user_role_grants ADD CONSTRAINT user_role_grants_role_check
  CHECK (role IN ('user','client_manager','logistics','super_user'));
```

Until the table exists, the page renders the full roster with everyone at **None** and shows a notice that saves will fail (the loader treats "table not found" as an empty, non-fatal state).

### Roles matrix (Admin → **live**)

`/admin/roles` (`dashboard/app/admin/roles/`) is a **pages × roles** matrix that controls, per role, **which pages that role may reach**. It is reached from a **Roles** card on the Admin hub.

- **Rows** come from a central **page registry** — `PAGE_REGISTRY` in `dashboard/lib/page-registry.ts`, one `{ route, label, section }` entry per navigable page, grouped by nav section. It also feeds `getAllowedRoutes` (route ordering for landing).
- **Columns** are the assignable roles (`ASSIGNABLE_ROLES`): **User**, **Client Manager**, **Logistics**, **Super User**. Each cell is a checkbox — "this role can access this page." The **Super User** column is all-checked and **disabled** (a hard backstop) and is never written.
- Toggling a cell saves immediately through a super-user-gated server action (`setRolePageAccess`), writing a `public.role_page_access` row.

> **Live — WYSIWYG.** The grid now shows the **true enforced state**: a cell is checked only when a saved `allowed = true` row exists. There are **no pre-checked "seed defaults"** — an unset cell is not granted (default deny), so the grid can never imply access that isn't actually enforced. Changes take effect on the user's **next page load**.
>
> `seedDefaultAllowed()` in the registry still documents the *recommended* starting grants (Client Manager → Clients + Institutions; Logistics → Logistics; User → nothing; Super User → everything, backstopped) — it's the reference for the **optional seed** in _Go-live migration_ below, not something the grid shows.

The table must be created once in the Supabase SQL editor:

```sql
CREATE TABLE IF NOT EXISTS public.role_page_access (
  role    text NOT NULL,
  route   text NOT NULL,
  allowed boolean NOT NULL DEFAULT false,
  PRIMARY KEY (role, route)
);
ALTER TABLE public.role_page_access ENABLE ROW LEVEL SECURITY;
```

Until it exists, `getAllowedRoutes` fails closed (returns `[]`) so every non-super role can reach nothing, and the matrix shows a notice that toggles will fail to save.

### Go-live migration (run in the Supabase SQL editor)

Enforcement now reads `user_role_grants` (roles) and `role_page_access` (page access). **Run the role migration first** — until you do, `user_role_grants` may be empty and *nobody* (not even a super-user) will have a role.

**1 — Required: copy existing roles into `user_role_grants`** (idempotent; won't overwrite grants already set in the UI):

```sql
INSERT INTO public.user_role_grants (email, role, updated_at, updated_by)
SELECT lower(email), role, now(), 'migration'
FROM public.user_roles
WHERE email IS NOT NULL
ON CONFLICT (email) DO NOTHING;
```

The old `user_roles` table stays in place as a backup — it's just no longer read.

**2 — Diagnostic: which roles can reach nothing?** Any role with zero `allowed = true` rows will be able to open no pages (Super User excepted — it's backstopped in code, never in this table):

```sql
SELECT g.role, count(rpa.route) FILTER (WHERE rpa.allowed) AS allowed_pages
FROM (SELECT DISTINCT role FROM public.user_role_grants) g
LEFT JOIN public.role_page_access rpa
  ON rpa.role = g.role AND rpa.allowed = true
GROUP BY g.role
ORDER BY allowed_pages;
```

**3 — Optional: seed the recommended per-role defaults** (only fills gaps — `ON CONFLICT DO NOTHING` preserves anything you've already set; super_user is intentionally omitted since it's backstopped):

```sql
-- Client Manager → all Clients + Institutions pages
INSERT INTO public.role_page_access (role, route, allowed)
SELECT 'client_manager', route, true
FROM (VALUES
  ('/'), ('/client-statistics'), ('/portfolio'), ('/client-detail'),
  ('/institutions'), ('/institution-detail'), ('/institution-style'), ('/relationships')
) AS r(route)
ON CONFLICT (role, route) DO NOTHING;

-- Logistics → all Logistics pages
INSERT INTO public.role_page_access (role, route, allowed)
SELECT 'logistics', route, true
FROM (VALUES
  ('/planning-v2'), ('/planning'), ('/calendar'), ('/scheduler'), ('/live-outreach'),
  ('/profiles'), ('/feedback-manager'), ('/feedback'), ('/onboarding'), ('/time-off'),
  ('/pipeline'), ('/conference-rooms')
) AS r(route)
ON CONFLICT (role, route) DO NOTHING;

-- User → nothing by default (configure explicitly in the Roles grid).
```

### Magic-link auth

Sign-in uses Supabase's email magic-link flow. The browser/server/proxy Supabase clients live in `dashboard/lib/supabase/{browser,server,proxy}.ts` and use the **anon** key (safe for the client). Data reads, by contrast, use the **service-role** key server-side (`dashboard/lib/supabase.ts`) — a different, secret key. Don't mix them up (see [09 — Configuration](09-configuration.md)).
