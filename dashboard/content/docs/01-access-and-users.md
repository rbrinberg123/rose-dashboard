# 01 — Access & Users

## What it does (plain language)

Everyone signs in with their **@roseandco.com account**, two ways:

- **Sign in with Microsoft** (recommended) — one click, uses your existing Microsoft 365 / Entra sign-in. No email round-trip.
- **Magic link** (fallback) — type your email, get a one-time link, click it, and you're in.

Either way there are **no passwords stored in this app**, and either way your identity is your verified **@roseandco.com email** — so roles, page access, and data scopes work exactly the same no matter which button you used. A hard **domain guard** signs out anyone whose email isn't `@roseandco.com`, even if they somehow reach the app.

Once signed in, access is controlled entirely from **two Admin screens** — no code change needed:

- **Admin → Users** gives each person a **role**: Super User, Client Manager, Logistics, User, or **None**.
- **Admin → Roles** is a grid that says, for each role, **which pages that role can see**.

So a person's access = *their role* (from the Users page) → *the pages that role is allowed* (from the Roles grid). Put together:

- **Super User** — sees everything, always (a hard rule the grid can't turn off).
- **Any other role** — sees exactly the pages checked for it in the Roles grid, and nothing else.
- **None / no role** — can't see any real page; they land on a "request access" screen.

The rule is **deny-by-default**: a page is blocked for a role unless its box is checked in the Roles grid. A brand-new page is therefore Super-User-only until someone ticks it on for a role — you can't accidentally leak a new finance page to everyone.

### Seeing money — the "Financials" permission

Being allowed onto a page is not the same as being allowed to see the **dollar figures** on it. **Financials** is a separate tick-box that decides whether a person sees retainer / fee amounts at all:

- **Admin → Users** — a **Financials** checkbox on each person's row, next to their data-scope boxes.
- **Admin → Roles** — a **Financials** row in a **Data permissions** section at the bottom of the grid, so you can grant it to a whole role at once.

Either one is enough — person **or** role. **Super Users always have it.** Everyone else starts **off** (deny-by-default).

It is **independent of** which clients someone sees. Data scopes decide *which clients*; Financials decides *whether those clients' dollars show*. So a Client Manager can see their own clients with the money columns simply **not there** — no blanks, no dashes, no "—" placeholder. The values are left out of the page entirely, not hidden with styling, so they aren't recoverable by anyone poking at the page.

Where it applies today:

- **Client Portfolio** — without it, the **Retainer** column and the **contract document** link are gone (the Contract band just has four columns).
- **Client Detail** — without it, the **Annualized Retainer** and **$ per Meeting** tiles are gone, and the remaining four tiles spread out evenly to fill the row.

The **AI client summary** is a separate matter: there is only **one** summary per client and everyone sees the same one, so it now **never mentions retainer, fee, or rate amounts for anybody** — including Super Users. Renewal and term-end **dates** are still there; only money is gone. Summaries written before this change may still quote a figure until they're regenerated on the next refresh.

### "View as" — see the app as any role, or any person

Super-users have two related testing tools, both super-user-only and both invisible to everyone else:

- **View as role** — on the **Admin** page, a small dropdown (Super User / Client Manager / Logistics / User) + **Apply**. Previews an *abstract* role.
- **View as person** — on **Admin → Users**, each row has a small **"View as"** button. Previews the app as *that specific person*, using **their** real role. Most people have no role yet, so viewing as them correctly shows the "no access" experience — which is a valid, useful test.

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

### Collapsing the sidebar

The desktop sidebar **starts collapsed** as a **58px icon rail**. The `«` / `»` chevron that toggles it sits in the **footer**, alongside the user avatar and admin gear — nothing sits above the logo. It's a manual toggle only; nothing auto-collapses it.

- **Expanded** is the full nav: the full Rose & Co IQ lockup, section labels, sub-page links, active highlighting, and the footer row of *Sign out · admin gear · collapse chevron*.
- **Collapsed** wears just the square **IQ logomark** (`public/favicon-512.png`) and shows one icon per top-level section, with the active section highlighted. **Hovering (or focusing) an icon opens a fly-out** to the right listing that section's label and all of its sub-pages, so every page is still one hover away; direct-link sections (Institutions, Contracts) get a plain label tooltip instead. The footer collapses to avatar (its fly-out carries the email + sign-out), gear, and chevron.
- Fly-outs are keyboard-reachable: the trigger carries `aria-expanded`, Tab steps from the icon into the sub-links and back out to the next icon, Escape closes. The content column reflows to claim the reclaimed width, with a 200ms width transition.
- The state is remembered per user in a **`sidebar_collapsed` cookie**, read by the root layout so the *server* render already has the right width — the sidebar never flashes wide before snapping narrow. **Collapsed is the default**: only an explicit `0` (written when a user expands it) opts out, so a deliberate choice always beats the default on later loads. See `dashboard/lib/sidebar.ts`.

> **Why the fly-out is portaled.** `<aside>` is `position: sticky`, and sticky *always* establishes a stacking context — which capped the fly-out's z-index inside a layer that paints *before* `<main>`, so page tables covered it however high the z-index went. The panel is therefore rendered through `createPortal` into `<body>` (at `z-60`, clear of sticky table headers at `z-20` and sticky first columns at `z-30`; the sidebar itself is `z-40`). The portal costs the natural tab order, so `useFlyout` in `dashboard/components/nav.tsx` hands focus across the boundary by hand.

Below `md` the sidebar is replaced by the existing hamburger sheet, which always shows the full nav — the collapse toggle is desktop-only.

### View as (super-user testing mode)

A super-user can preview the app as an abstract **role** or as a specific **person**. It is built on a clean split between the caller's **real** identity/role and the **effective** identity/role:

- `getRealRole(email)` (`dashboard/lib/user-role.ts`) — the caller's actual role from the `user_roles` table (the old `getUserRole`, kept as an alias). Used **only** to authorize impersonation and the exit action, so it can never be spoofed by a cookie.
- `resolveEffective(realRole, viewAsUserCookie, viewAsRoleCookie)` (`dashboard/lib/impersonation.ts`) — the shared core. Honors impersonation **only** when `realRole` is `super_user`. **Person** mode (`view_as_user`) takes precedence over **role** mode (`view_as`); otherwise it returns the real role. It has **no** `next/headers` import, so the proxy imports it directly (reading cookies off the `NextRequest`).
- `getEffectiveRole()` and `getEffectiveIdentity()` (`dashboard/lib/effective-identity.ts`) — the request-context wrappers (they read cookies via `next/headers`) for Server Components/Actions. **`getEffectiveIdentity()` is the single source future row-scoping resolvers (`accessibleClientIds`, `hostedMeetingIds`, `feedbackAssignments`) will consume** — it returns `{ email, userId, name, role, impersonated }`, where `userId` is the Dynamics system-user id from the `users` mirror. So person-scoping lights up automatically when those resolvers land (no scoping changes here yet).

`proxy.ts`, `canAccessRoute`, and the nav all gate on the **effective role** (and its `getAllowedRoutes`), so the whole app (route gating + sidebar) reflects the viewed-as person/role. A person's effective role is **their** `getRealRole` — often `null` or a role with few grants, which correctly yields the "no access" or reduced experience.

- **The cookies** — `view_as_user` (`VIEW_AS_USER_COOKIE`, an `@roseandco.com` email) and `view_as` (`VIEW_AS_COOKIE`, a role). Both are **httpOnly**, `sameSite=lax`, `path=/`, and `secure` in production (relaxed in dev so they work over `http://localhost`). Read **server-side** only; client state is never trusted. The two modes are mutually exclusive — setting one clears the other.
- **Entry points** — a per-row **"View as"** button on **Admin → Users** (`dashboard/app/admin/users/users-view.tsx` → `setViewAsUserAction`), and the **"View as role"** dropdown on the Admin hub (`dashboard/app/admin/page.tsx`, `ViewAsControl` → `setViewAsAction`). Neither is in the main nav.
- **Banner** — while either cookie is active, `dashboard/components/view-as-banner.tsx` renders a slim banner pinned to the top of every page, from the **root layout** (outside the sidebar, which hides itself on some pages). The layout builds the label ("Viewing as {Name} — {role or 'No role'}"). Its **Exit view** button posts to `exitViewAsAction`.
- **Actions** — `dashboard/app/view-as-actions.ts`. `setViewAsAction`, `setViewAsUserAction`, and `exitViewAsAction` all authorize off `getRealRole` (via `requireSuperUser`), **never** the effective role — so you can always exit even while viewing as someone with no access, and a non-super holding a stray cookie is ignored. Exit clears **both** cookies.

**Guardrails.** Only a real `super_user` can set or hold either cookie; `resolveEffective` ignores them for anyone else, and a stale/bogus `view_as_user` email that matches no active mirror row is safely ignored. When the effective role can't reach the requested route, the proxy redirects to that role's first allowed page, or the always-allowed `/no-access` when it has none — so previewing a no-access person lands on the request-access screen (with the banner's Exit still present) instead of a redirect loop.

### Admin pages

`/admin` and everything under `/admin/*` have no `role_page_access` grants for any non-super role, so they're Super-User-only by the deny-by-default rule. Don't tick them on for another role unless you truly mean to.

The Admin hub also has a **Hidden Pages** section (`dashboard/app/admin/page.tsx`, the `HIDDEN_PAGES` array) that links to routes parked off the main nav — currently `/pipeline`, `/relationships`, and `/conference-rooms`. Those pages are super-user-only purely because Admin is; the pages themselves keep their own routes. To park another page later, add one `{ href, label }` line to `HIDDEN_PAGES`.

### Users (Admin → **live**)

`/admin/users` (`dashboard/app/admin/users/`) lists every **active `@roseandco.com`** person from the `users` mirror table (Dynamics system users — filtered `is_active = true` and email ending `@roseandco.com`) and lets a super-user set a role for each: **None** (no grant), **User**, **Client Manager**, **Logistics**, or **Super User**. Each row shows the name (bold) and email on one line; changing a selector saves immediately (with a small updating/saved state).

Granted users **float to the top**, ordered Super User → Logistics → Client Manager → User (each carrying a small colored role pill), with the **None** rows muted below, alphabetical by name. A summary line up top reads e.g. "N users · N granted · N none", and a **"Show granted only"** checkbox hides the None rows so you can review just who's assigned.

#### Identity resolution — `public.users.email` only

Every relationship-based data scope (Level 2) depends on mapping a person's **login email** to a CRM `users.user_id`. **Identity resolves against `public.users.email` ONLY** — there is no `internalemailaddress` column on `public.users` (the Dynamics field of that name is synced *into* `users.email`). An earlier version matched the non-existent column; the resulting error was swallowed into an empty index, so **every** login became "No match" and was silently denied. Matching is **case-insensitive and trimmed**, and the name shown comes from `display_name`.

The central resolver lives in `dashboard/lib/access/identity-index.ts` (pure, unit-tested via `npm test`) + `identity.ts` (the async load). It is used by **both** the Admin → Users page (roster + badges) and the data-scope resolver, so they can never diverge.

**Row classification** (applied to both resolution and the roster):

- **excluded** — no email, a non-`@roseandco.com` address (incl. `@onmicrosoft.com` and external domains like `@sportradar.com`), or a Dynamics-disabled row whose local-part starts with a **32-hex hash** (`^[0-9a-f]{32}`). Dropped from the roster **and never resolvable**.
- **service** — a shared/service `@roseandco.com` mailbox (`conference*`, `ga`, `corporateaccess`, `dmgsupport`, `externaldev`) or a `#`-prefixed display name. **Kept in the roster, tagged "service/shared", but never resolvable** to a login.
- **human** — a real person. Resolvable.

**Same-name duplicates are unioned by person.** Some people have two active, non-hashed `@roseandco.com` records with different emails and different `user_id`s (e.g. Blair Mutschler, Brian Smith, Simon Rose, Shawna Giust). Rows with the same normalized `display_name` are treated as the **same person**: a login that hits one resolves to the **union** of all their `user_id`s, and every downstream relationship check (account team, and later booker/host/feedback) matches **any** of them. This is a strict **superset** — it can only add the twin's clients/meetings, never remove the primary's — and a union of >1 GUID is logged.

Each roster row shows a badge: **✅ resolved** (with "✓ N" when the person spans N unioned records; hover lists the user_ids), **🟠 No match**, **🟠 Ambiguous (N)** (one email → N *different* people — fail-closed), or a grey **service/shared** tag. A summary line reads e.g. *"Identity mapping: X resolve · Y no-match · Z ambiguous · W service/shared · V with duplicate records (unioned)."*

**Fail LOUD, never silent.** A genuine no-match denies (fail-closed) as before. But a **query/schema error is never swallowed**: the loader logs at error level and returns a distinct error state, and Admin → Users shows a **red "Identity resolver error"** banner (visually different from a per-row "No match") — so a schema fault can never again masquerade as "nobody has access". In the loaders, a resolver error still fails closed (denies) but is logged loudly.

Above the roster, a thin **session banner** (`SessionBanner`) resolves your **own live login** — the real authenticated Supabase session email (via `getUser()`, not a roster row and not the impersonation-aware effective identity) — through the same resolver, showing "Your login {email} resolves to user_id {id} — {name}" (or a red-amber "does NOT resolve" / "is ambiguous"). This exercises the actual **session → `user_id`** path enforcement uses, which the per-row column can't, since the roster is built from the `users` table itself. Display-only.

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

### Level-2 data scopes (Admin → Users — **Account Management enforced**)

Each user row also has a second line of **data-scope** checkboxes: **All · Account Mgmt · Booker · Host · Feedback**, followed (after a divider) by the field-level **Financials** grant. Where a role (Level 1) decides *which pages* a person can open, data scopes (Level 2) decide *which rows on those pages* they see — and **Financials** decides which *fields* of those rows they receive.

> **LIVE (Account Management).** `public.user_data_scopes` is the **single source of truth**: the checkboxes here **write** it and the loaders **read** it (`getUserScopes` → `resolveClientScope`) to enforce. **Account Management** is enforced on the client pages now (Portfolio, Client Detail, NDRS Calendar, Onboarding). **Booker / Host / Feedback** (meeting-level) are recorded but enforced in a later pass. Changes take effect on the user's **next page load**.

- **All** — no row filtering: they see every row on any page they can open. When checked it **overrides and dims** the other four.
- **Account Mgmt** — client-level: clients where they're on the account team. **Enforced.**
- **Booker / Host / Feedback** — meeting-level: meetings where they are the booker / host / feedback assignee. **Recorded; Pass-2.**
- **Financials** — **not a row scope.** A field-level grant: may this person see retainer / fee **dollar figures**? Deliberately **not** dimmed by **All** (All is a row override and says nothing about money). **Enforced** — see _The Financials permission_ below.
- **Super User** rows show **All** and **Financials** implied and **locked on** (the checkboxes are disabled) — and Super Users **always bypass** scope enforcement, so activating scopes can never lock a super out.
- Everyone else defaults to **unchecked** (**deny-by-default** — nothing checked = no client rows), freely editable. Each toggle saves immediately through a super-user-gated server action (`dashboard/app/admin/users/actions.ts`, `setUserDataScopes` → `requireSuperUser`, domain-validated, upsert, `revalidatePath`). A non-super with **no** row is denied and that denial is **logged** (never a silent lockout).

Create the table once in the Supabase SQL editor:

```sql
CREATE TABLE IF NOT EXISTS public.user_data_scopes (
  email          text PRIMARY KEY,
  scope_all      boolean NOT NULL DEFAULT false,
  account_mgmt   boolean NOT NULL DEFAULT false,
  booker         boolean NOT NULL DEFAULT false,
  host           boolean NOT NULL DEFAULT false,
  feedback       boolean NOT NULL DEFAULT false,
  financials     boolean NOT NULL DEFAULT false,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     text
);
ALTER TABLE public.user_data_scopes ENABLE ROW LEVEL SECURITY;
```

> **RUN THIS if the table already exists** (`sql/21_financials_permission.sql`) — the `financials` column is a later addition:
>
> ```sql
> ALTER TABLE public.user_data_scopes
>   ADD COLUMN IF NOT EXISTS financials boolean NOT NULL DEFAULT false;
> ```
>
> The loaders read this table with `SELECT *` precisely so a not-yet-migrated database degrades to "nobody has Financials" instead of erroring — an error here fails closed and would deny **every row** to **everyone**. Until the column exists, the Users checkbox will fail to save.

**Enforcement mapping** — each scope matches rows where the person's `users.user_id` is:

| Scope | Match | Status |
|-------|-------|--------|
| Account Mgmt | `accounts.sales_lead_primary_id`, `secondary_manager_id`, `associate_id`, or `logistics_coordinator_id` (**exclude** `owner`) | **LIVE** — client pages + account-team meetings |
| Booker | `meetings.booker_id` | **LIVE** — meeting pages |
| Host | `meetings.host_id` | **LIVE** — meeting pages |
| Feedback | `meetings.feedback_id` | **LIVE** — meeting pages |
| Financials | *(not a row match — a field-level grant)* | **LIVE** — see below |

All resolve against the **login-email → `users.user_id`** mapping (matched case-insensitively + trimmed against **`public.users.email` only** — see _Identity resolution_ above; same-name duplicate records are unioned by person).

#### Level-2 client scoping (Account Management) — **LIVE**

The resolver lives in `dashboard/lib/access/`:

- `client-scope-policy.ts` — the **pure** decision (unit-tested via `npm test`, Node's built-in runner): given a user's scopes + their account-team ids → `null` (see all), a `Set` of account ids (see only those), or an empty `Set` (see none).
- `data-scope.ts` — the I/O: `getUserScopes(email)` (Super User ⇒ `{ all: true }`; no row ⇒ all false), `resolveClientScope(user)` (driven off `getEffectiveIdentity`, so **View as {person}** tests it). It resolves the login through the shared identity module (see _Identity resolution_ above) to the person's **user_id set** (unioned across same-name duplicate records) and matches accounts where **any** of those ids is on the team. **Fail-closed** — returns an empty Set (deny), never `null` — on a genuine no-match, an ambiguous match (one email → >1 distinct person), or a resolver error (also logged loudly).

`resolveClientScope` returns:

- `null` → **no filter** (Super User, or anyone with **All**) — pages render unchanged.
- a **Set of account ids** → the loader filters to `account_id ∈ set` (on the NDRS Calendar view the client key is `client_account_id`).
- an **empty Set** → the loader renders a friendly "no clients assigned to you" state.

Enforcement is server-side in the loaders only (the service-role key bypasses RLS, so the loader is the gate). Wired into: **Portfolio** (`v_client_portfolio`), **Client Detail** (`v_client_detail_summary` — and a direct URL to an out-of-scope client is blocked), **NDRS Calendar** (`v_marketing_calendar`), **Onboarding** (`v_client_onboarding`), and **Client Statistics** (whole-book aggregate — blocked entirely for any scoped, non-`null` user).

#### The Financials permission (field-level) — **LIVE**

**Financials is not a row scope.** Row scoping decides *which* clients a person sees; Financials decides whether those clients' **dollar figures** are in the payload at all. The two are orthogonal and compose in both directions:

| | no Financials | Financials |
|---|---|---|
| **no row scope** | sees no rows | sees no rows (nothing to price) |
| **Account Mgmt** | their clients, money fields **absent** | their clients, money fields present |
| **All / Super User** | every client, money fields **absent** | every client, money fields present |

**The resolver** — `canSeeFinancials(user)` in `dashboard/lib/access/financials.ts`, driven off `getEffectiveIdentity` (so **View as {person}** previews their money view):

```ts
export async function canSeeFinancials(
  user: Pick<EffectiveIdentity, "email">,
): Promise<boolean> {
  if (!user.email) return false                       // unresolved identity → deny
  const role = await getRealRole(user.email)
  if (role === "super_user") return true              // Super User: always
  const scopes = await getUserScopes(user.email)      // user_data_scopes.financials
  const roleFlag = /* role_page_access(role, 'data:financials').allowed */
  return decideFinancials({ isSuper: false, userFlag: scopes.financials, roleFlag })
}
```

Granted when **any** of: real role is `super_user` · the person's `user_data_scopes.financials` flag · their role's `data:financials` grant. Everything else — flag off, role ungranted, no email, no scope row, or a query error (which is **logged**) — is **false**. The pure decision (`decideFinancials`) and the gated field lists live in `dashboard/lib/access/financials-policy.ts` and are unit-tested (`npm test`).

**Where the role grant lives.** The **Data permissions → Financials** row in the Roles matrix writes `public.role_page_access` with `route = 'data:financials'` — the same table page access uses. The `data:` prefix can never collide with a real route, and `getAllowedRoutes` filters its result through `PAGE_REGISTRY`, so the row can never be mistaken for a page a role may navigate to. It is written by its own action (`setRoleDataPermission`), which accepts **only** registered data-permission keys — `setRolePageAccess` accepts **only** registered page routes, so neither can write the other's key space. `super_user` is never written (granted in code).

**Enforcement is server-side omission, never CSS.** The loader **deletes** the fields from the rows before they are serialized into the page, so an ungranted user's payload has no key at all — not a null, not an empty string:

| Surface | Omitted for an ungranted viewer |
|---|---|
| **Portfolio** (`app/portfolio/page.tsx`) | `annualized_retainer`, `quarterly_retainer`, `contract_url`. The **Retainer** and **Doc** columns are not rendered (the Contract band drops from 6 columns to 4), and the `contracts.contract_url` lookup is **skipped entirely** — the links are never even read. The **Export PDF** button prints the rendered table, so the printed output loses them too. |
| **Client Detail** (`app/client-detail/page.tsx`) | `annualized_retainer` and the retainer-**derived** `dollars_per_meeting_ltm` — from the selected client *and* from the whole `allClients` switcher list. The **Annualized Retainer** and **$ per Meeting** KPI tiles are not built, so the tile set is **4 instead of 6** and the grid's column count follows `tiles.length` (`lg:grid-cols-4` instead of `lg:grid-cols-6`) — the survivors **stretch to fill the row**, with no empty placeholders where the money was. |

`dollars_per_meeting_ltm` **must** go with the retainer: it is retainer ÷ LTM meetings, and the meeting count is on the same page, so leaving it would make the retainer trivially recoverable.

**The AI summary is NOT gated — it is sanitized for everyone.** There is one cached summary per client (`accounts.ai_summary`) shown to every viewer, so a per-viewer variant is impossible without generating two. Instead the summary now **never contains a money amount at all**, for anyone including Super Users, enforced twice in `dashboard/lib/client-summary-prompt.ts`:

1. `buildSummaryFields` **never puts the retainer in the model's input** — the model cannot quote a figure it was never given.
2. `SUMMARY_SYSTEM_PROMPT` explicitly forbids contract-revenue / retainer / fee / rate figures, currency symbols, and per-quarter or per-meeting derivations.

Renewal and term-end **dates** are deliberately kept — dates are not financials. A `containsMoneyAmount` tripwire runs after each generation and **logs** (never rewrites) if a figure slips through. **Existing cached summaries generated before this change may still quote an amount** until they are regenerated — the nightly batch refreshes stale ones, or force a full pass via `/api/client-summary/refresh-all`.

#### Level-2 meeting scoping (Booker / Host / Feedback + account-team) — **LIVE**

`resolveMeetingScope(user)` (`dashboard/lib/access/data-scope.ts`) mirrors `resolveClientScope`: same effective-identity **union** of `user_id`s (a same-name duplicate's records all count — e.g. `bsmith@` + the `brian.smith@` twin), same `teamAccountIds`, same fail-closed rules. The decision is the pure, unit-tested `meetingMatches` / `decideMeetingMode` (`meeting-scope-policy.ts`).

A meeting is visible if **ANY** checked scope matches (**OR** logic):

- **Booker** → `meetings.booker_id ∈ userIds`
- **Host** → `meetings.host_id ∈ userIds`
- **Feedback** → `meetings.feedback_id ∈ userIds`
- **Account Mgmt** → `meetings.client_account_id ∈ teamAccountIds(userIds)` (a person on an account team sees that client's meetings too)

Return: `{ mode: "all" }` (Super User / `all` — no filtering), `{ mode: "none" }` (nothing checked, unresolved/ambiguous email, or resolver error — **deny-by-default**, never opens), or `{ mode: "filter", … }`. Because the views don't expose all of `booker/host/feedback`, the loader passes the view's candidate `meeting_id`s to `filterVisibleMeetingIds`, which fetches those FK fields from `meetings` (chunked `.in`) and applies `meetingMatches` — keeping id lists small even for a person with ~1,100 meetings.

Wired into: **Profiles** (`/profiles`, `v_profiles_upcoming` — filtered; a scoped-empty viewer gets a "No meetings assigned to you" state), and **Feedback Collection** (`/feedback-collection`, `v_feedback_outstanding`). The **Feedback Reports** page (`/feedback-manager`, `v_feedback_pipeline`) and **Live Outreach** stay all-access by design and are **not** scoped. (Host Calendar `/scheduler` and Planning `/planning-v2` are meeting lists that are *not yet* scoped — flagged for a follow-up if they should be.)

> **Feedback Reports vs Feedback Collection are now separate pages/routes with independent role grants.** `/feedback-manager` (**Feedback Reports** — the report pipeline) and `/feedback-collection` (**Feedback Collection** — concluded meetings needing feedback) are two distinct rows in the page registry / Roles matrix, so a role can be granted one without the other. Reports is route-gated only (all rows); Collection is route-gated **and** meeting-scoped (above). The legacy `/feedback` route redirects to `/feedback-collection` (preserving `?client=`). To preserve today's behavior at the split, copy the Reports grants to Collection once in Supabase:
>
> ```sql
> INSERT INTO public.role_page_access (role, route, allowed)
> SELECT role, '/feedback-collection', allowed
> FROM public.role_page_access WHERE route = '/feedback-manager'
> ON CONFLICT (role, route) DO NOTHING;
> -- and, so the legacy /feedback redirect stays reachable for the same roles:
> INSERT INTO public.role_page_access (role, route, allowed)
> SELECT role, '/feedback', allowed
> FROM public.role_page_access WHERE route = '/feedback-manager'
> ON CONFLICT (role, route) DO NOTHING;
> ```

### Roles matrix (Admin → **live**)

`/admin/roles` (`dashboard/app/admin/roles/`) is a **pages × roles** matrix that controls, per role, **which pages that role may reach**. It is reached from a **Roles** card on the Admin hub.

- **Rows** come from a central **page registry** — `PAGE_REGISTRY` in `dashboard/lib/page-registry.ts`, one `{ route, label, section }` entry per navigable page, grouped by nav section. It also feeds `getAllowedRoutes` (route ordering for landing).
- A final **Data permissions** section adds rows that are **not pages** — today just **Financials** (`DATA_PERMISSIONS` in the same registry). These gate which **fields** a role receives, not which routes it may open; see _The Financials permission_ above. They share `role_page_access` under a `data:`-prefixed key and are written by a separate action.
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

### Sign-in — Microsoft/Entra SSO + magic-link fallback

Sign-in runs entirely through **Supabase Auth**. Two methods, one identity:

- **Microsoft/Entra SSO (Azure provider).** The login page's **"Sign in with Microsoft"** button (`dashboard/app/login/microsoft-button.tsx`, a client component) calls `supabase.auth.signInWithOAuth({ provider: "azure", options: { redirectTo: <origin>/auth/callback, scopes: "email openid profile" } })`. The `redirectTo` is derived from `window.location.origin`, so localhost / preview / production all work without an env var. The provider (client ID/secret, tenant) is configured **only in the Supabase dashboard** — single-tenant, so only the Rose directory can sign in. **No client secret lives in this repo.**
- **Magic link (fallback).** The email form below the button (`dashboard/app/login/login-form.tsx` → `sendMagicLink` in `actions.ts`) still calls `signInWithOtp`, gated by the login allowlist (`isAllowedEmail`, `dashboard/lib/auth-allowlist.ts`). Unchanged.

**One callback for both.** Both methods land on `dashboard/app/auth/callback/route.ts`, which calls `supabase.auth.exchangeCodeForSession(code)` — the same authorization-code exchange handles the OAuth (PKCE) flow and the magic-link flow, so there's no separate OAuth handling. On success it redirects to the requested page (default `/portfolio`, validated to be a same-origin path — no open redirect); a missing code or a failed exchange returns to `/login?error=…`.

**Domain guard (defense in depth).** Immediately after the exchange, the callback re-checks the **verified** session email with `isAllowedSessionEmail` (`dashboard/lib/auth-allowlist.ts`, the same `@roseandco.com` allowlist as the login form). If it isn't a Rose address, the callback **signs the session out and redirects to `/no-access`**. Single-tenant Entra should already block outsiders — this enforces it app-side regardless of how a session was obtained. The branching is a pure, unit-tested function (`decideAuthCallback`, `dashboard/lib/auth-callback.ts`; tests in `lib/auth-callback.test.ts` + `lib/auth-allowlist.test.ts`).

**Identity is unchanged.** The OAuth session exposes `user.email` as the `@roseandco.com` address, exactly like magic link. Everything downstream — `getRealRole`, `getEffectiveIdentity`, `getUserScopes`/`resolveClientScope`/`resolveMeetingScope`, and the identity index — keys on that session email and needs **no changes** for SSO.

The browser/server/proxy Supabase clients live in `dashboard/lib/supabase/{browser,server,proxy}.ts` and use the **anon** key (safe for the client). Data reads, by contrast, use the **service-role** key server-side (`dashboard/lib/supabase.ts`) — a different, secret key. Don't mix them up (see [09 — Configuration](09-configuration.md)).

#### Config steps (one-time, in dashboards — no code)

1. **Supabase → Authentication → Providers → Azure:** enable it; set the Application (client) ID, client secret, and the Azure URL (`https://login.microsoftonline.com/<TENANT_ID>/v2.0`) for the single tenant. These are stored in Supabase, **not** in this repo.
2. **Supabase → Authentication → URL Configuration:** set the **Site URL** and add the app's **`/auth/callback`** to the **Redirect URLs** allowlist for every environment (production, preview, `http://localhost:3000`). Placeholders: `https://<your-app-domain>/auth/callback`, `http://localhost:3000/auth/callback`.
3. **Entra (Azure) app registration → Redirect URIs:** add Supabase's provider callback `https://<project-ref>.supabase.co/auth/v1/callback` (project ref `uegfmuvkavexmxxaxnwe`). Grant delegated `openid`, `email`, `profile`.

No new app env vars are required — `redirectTo` is derived at runtime and all provider secrets live in Supabase. See [09 — Configuration](09-configuration.md) for the sign-in URL settings.
