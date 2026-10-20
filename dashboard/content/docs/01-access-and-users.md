# 01 — Access & Users

## What it does (plain language)

Everyone signs in with their **@roseandco.com account**, two ways:

- **Sign in with Microsoft** (recommended) — one click, uses your existing Microsoft 365 / Entra sign-in. No email round-trip.
- **Magic link** (fallback) — type your email, get a one-time link, click it, and you're in.

Either way there are **no passwords stored in this app**, and either way your identity is your verified **@roseandco.com email** — so roles, page access, and data scopes work exactly the same no matter which button you used. A hard **domain guard** signs out anyone whose email isn't `@roseandco.com`, even if they somehow reach the app.

Once signed in, access is controlled entirely from **two Admin screens** — no code change needed:

- **Admin → Users** gives each person a **role**: Super User, **Admin**, Client Manager, Logistics, **Associate**, User, or **None**.
- **Admin → Roles** is a grid that says, for each role, **which pages that role can see**.

So a person's access = *their role* (from the Users page) → *the pages that role is allowed* (from the Roles grid). Put together:

- **Super User** — sees everything, always (a hard rule the grid can't turn off).
- **Admin** (2026-10-13) — a near-Super-User: everything a Super User can see and do (all CRM tables and edits, sends, client deactivation, money figures, every client's data), **except** managing users and roles, **View as**, the Admin hub's Hidden Pages, Client Statistics, the Productivity pages, and the Sync / Reconciliation / Database screens. Set in code; the grid can't change it. See [Admin role](#admin-role-2026-10-13).
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

### Claiming feedback — the "Claim feedback" permission

> **2026-10-16 — two feedback capabilities, both grantable per role (Admin → Roles, data-permission rows) and per person (Admin → Users tick-boxes).** Off by default for everyone but Super Users / Admins.
> - **Claim feedback report** (`data:claim_feedback` / `user_data_scopes.claim_feedback`): Claim an unclaimed Feedback report task.
> - **Mark feedback received** (`data:mark_feedback_received` / `user_data_scopes.mark_feedback_received`, needs `sql/patches/2026-10-16_feedback_capabilities.sql`): Mark feedback all in, and assign / release / reassign Feedback report tasks.
>
> Resolved in `lib/access/feedback-capabilities.ts` (Super User / Admin, OR the person flag, OR the role grant) and enforced in each server action; buttons are hidden without them. Alongside them, three rules changed:
> - **The event drawer's Meetings & Reports tab** is now readable by anyone who can view the event (`canViewEvent`). It is read-only for them.
> - **Closes are owner-only.** The Feedback task: its claimer, or Super User / Admin. The Feedback Report Sent task: its owner (the associate), or Super User / Admin. The account-team branch is gone.
> - **Assign / release / reassign** (Feedback task only) is open to Super User / Admin, the current owner, or a holder of Mark feedback received.
>
> Full detail: [27 — Feedback reports → Feedback permissions](27-feedback-reports.md#feedback-permissions-2026-10-16). The paragraph below is the original 2026-10-07 description.

A separate per-person tick-box on **Admin → Users** (next to Financials), **off** by default. It lets a person **Claim** unclaimed Feedback tasks on Feedback Reports and release their own. Super Users always have it, and can also release, reassign and close any task. It doesn't change which pages or rows anyone sees. Stored as `user_data_scopes.claim_feedback` (patch `sql/patches/2026-10-07_feedback_claims.sql`). Full detail: [14 — Tasks → Feedback claiming](14-tasks.md#feedback-claiming-feedback-reports--claim--release--reassign--close).

### Who sees which Tasks, Touchpoints and Notes (2026-10-20)

On the Actions tables, you see a row only if you're on that client's **core team** (Primary, Secondary, Associate or Logistics), or it's **yours** (a task you own, created, or are currently assigned; a touchpoint you created; a note you own or created). Super Users and Admins see everything. **Feedback-report tasks and Data Upload tasks are visible to everyone.** This is about which rows you see, not which pages you can open — today those three pages are still Super User / Admin only. It also trims My Dashboard's **Team tasks** card to clients where you're on the core team. Client pages (Client Detail's Touches timeline, Portfolio's recent note, etc.) are not affected. Detail: [Technical → Actions row scoping](#actions-row-scoping--tasks--touchpoints--notes-2026-10-20).

### "View as" — see the app as any person

**Viewing-as is done per person, from Admin → Users.** Each row has a small **"View as"** button; it previews the app as *that specific person*, using **their** real role. Most people have no role yet, so viewing as them correctly shows the "no access" experience — which is a valid, useful test. It is super-user-only and invisible to everyone else.

> **The "View as role" dropdown at the top of the Admin page was removed on 2026-09-16.** It previewed an *abstract* role, which the per-person preview covers better — a real person carries both their role **and** their data scope, so the preview reflects what they would actually see. Nothing replaced it at the top of Admin; use the Users page.
>
> If you still have an old role-view active from before the removal, **nothing is stuck**: the amber banner below is rendered from the root layout and still recognises role views, so **Exit view** clears it as normal.

Once active, the whole app — the sidebar and every page — instantly behaves as if you *were* that role/person: pages they can't see disappear and become blocked. A thin **amber banner is pinned across the top of every page** while active — e.g. "👁 Viewing as Jane Smith — Logistics — Exit view", or "👁 Viewing as User (role) — Exit view". The **Exit view** button always returns you to your normal super-user view — even when viewing as someone who can't reach Admin — so you can never get stuck. The two modes are mutually exclusive; starting one clears the other, and Exit clears both.

Because it reuses the real access rules, it doubles as a live test: as each role's page access (and, later, each person's data scoping) gets wired up, "View as" immediately reflects it.

## How to open a page to a role

Go to **Admin → Roles**, find the page's row, and tick the box in that role's column. It saves immediately and takes effect on the user's **next page load** — no code change or deploy. Both the security gate and the sidebar read the same grid, so they can never disagree.

To keep a page Super-User-only, leave every other role's box unchecked — that's the default (deny-by-default).

## How to give ONE person an extra page

Sometimes one person needs a page their role doesn't have. Go to **Admin → Users**, click **Pages** on that person's row, and tick the page. That opens the page **for that person only**. Their role stays the same, and nobody else gains anything. It takes effect on their next page load. Untick it to take the page away again.

The panel lists the pages grouped like the sidebar:
- **From role** (locked, with a 🔒 pill): their role already opens it. Change that in Admin → Roles instead.
- **Ticked, with "Granted by … · date"**: an individual grant, and who gave it when.
- **Unticked**: a page you *could* grant them.

What a grant can and can't do:
- **It only opens the page.** What the person can *do* there is unchanged: saving, admin buttons and which clients or meetings they see still follow their role and data scopes.
- **Some pages can never be granted**, and the panel doesn't list them: the CRM Tasks / Touchpoints / Notes tables, Client Health, everything in the Admin section (Users, Roles, Sync, Reconciliation, Database, Docs …), and retired pages. Only a super user can see those.
- **Super users, admins and people with no role** have no Pages button. The first two already reach every grantable page, and a person with no role can't use a grant.
- Only a **super user** can grant or revoke, and every change is recorded in the Audit Log.

## Technical

### The roles (now driven by the Admin UI tables)

`Role = "super_user" | "admin" | "user" | "associate" | "client_manager" | "logistics"` (`dashboard/lib/access-control.ts`). A person's role is read at request time from **`public.user_role_grants`** by `getRealRole()` (`dashboard/lib/user-role.ts`), keyed by lower-cased email. No grant row → `null` → no access beyond the always-allowed infra routes.

**Associate** is a first-class role with **no built-in access of its own**. It is denied everywhere until a super-user ticks boxes for it in the **Admin → Roles** matrix — exactly like User, Client Manager and Logistics, and unlike Super User, which is a hard backstop in code. Nothing in `canAccessRoute`, `getAllowedRoutes` or `proxy.ts` enumerates roles, so Associate is enforced by the same matrix lookup as every other non-super role; `dashboard/lib/access-control.test.ts` pins that down (denied everywhere with no grants, reachable only where the matrix grants it, `/no-access` always reachable, Super still bypassing).

### Admin role (2026-10-13)

**What it is.** `admin` passes every check that used to read `role === "super_user"`, except a short, explicit list of carve-outs. Like Super User it is **code-defined**: never gated by, and never written to, `role_page_access`. Its **Admin → Roles** column is **locked** and shows exactly the pages it reaches, with excluded ones unchecked. Grant it on **Admin → Users** (label **Admin**, navy-tint pill, sorted right after Super User). **Requires `sql/patches/2026-10-13_admin_role.sql`**, which widens `user_role_grants_role_check` to allow `'admin'`. Until it runs, saving Admin fails at the database.

**The two helpers** in `lib/access-control.ts`. Every former `super_user` check now calls one of them, so the boundary is greppable and moving a power is a one-call-site change:

| Helper | True for | Used for |
|---|---|---|
| `hasSuperUserPrivileges(role)` | `super_user`, `admin` | every "may do everything" check (the default) |
| `isStrictSuperUser(role)` | `super_user` only | the carve-outs below |

Both are pure: they take a role. Real vs effective role stays the caller's choice, as before. Checks that read the **real** role (`getRealRole` / `getUserRole`: the API guards, data scopes, financials, impersonation) still do. Page and action checks still read the **effective** role, so a super user **viewing as Admin** sees exactly what an admin sees.

API and server-action guards in `lib/api-auth.ts` both read the **real** role:
- `requireSuperUserPrivileges()`: sends, previews, Admin-hub refreshes, account-team edits.
- `requireStrictSuperUser()`: Users & Roles actions, Roles-matrix actions, View as.

`requireSuperUser()` is gone; every caller moved to one of the two.

**Admin CAN** (`hasSuperUserPrivileges`):
- **Pages.** Reach every page through the `canAccessRoute` backstop **except** `ADMIN_EXCLUDED_ROUTES` and hidden pages. That includes every `ADMIN_ONLY_ROUTES` page (CRM Tasks / Touchpoints / Notes, Account Teams, Audit Log, Contract Management (admin), Time Off Reviewers, Automations, Client Health, FB Coming Soon), the four grantable CRM list pages (Clients / Events / Meetings / Contacts), plus the Admin hub and Documentation. The CRM nav block (`canSeeCrmNav`) shows, and `getAllowedRoutes` short-circuits as it does for Super User.
- **CRM writes.** Everything behind `lib/crm-write.ts` (`requireCrmWriter` etc.), including Client Detail **Quick Add**, Client Health actions and Time Off Reviewers actions, plus every CRM page and action check. Can manage shared (system) saved views.
- **Client Detail.** The super-user blocks: Key Contacts, Events · Tasks, and the Last-25 shortcuts.
- **Feedback admin powers.** Lock override, reassignment and `isAdmin` in report splitting and claims, and closing anyone's task.
- **Emails.** Sends, previews and the `canSend` flags for Feedback, Live Outreach, Time Off and Week Ahead, plus the Admin-hub refresh buttons.
- **Time Off.** The page's flags, create / edit / delete requests, and see-all (`lib/time-off-requests/visibility.ts`). Also My Dashboard actions.
- **Row-visibility bypass.** `getUserScopes` returns `{ all, financials, claimFeedback }` (`lib/access/data-scope.ts`), so every client and meeting is in scope. This also covers the **Onboarding** cells, which use `resolveClientScope`. On Admin → Users the scope boxes are implied and locked for an Admin, as for a Super User.
- **Financials.** `canSeeFinancials` (`lib/access/financials.ts`) is always true.
- **Client deactivate / reactivate.** Via `lib/accounts/deactivation-gate.ts`.

**Admin CANNOT** (strict super user, or excluded):
- **Users & Roles.** `/admin/users` and `/admin/roles` are in `ADMIN_EXCLUDED_ROUTES` (and, since 2026-10-14, in `ADMIN_ONLY_ROUTES` too, so no other role can be matrix-granted them either). Their server actions use `requireStrictSuperUser` and refuse with *"Not authorized — only a super user can manage users and roles."*. The Admin-hub **Users** / **Roles** tiles are drawn only when `canAccessRoute` allows them.
- **View as.** `app/view-as-actions.ts` uses `requireStrictSuperUser`, and `resolveEffective` (`lib/impersonation.ts`) checks `isStrictSuperUser(realRole)`, so an admin's view-as cookies are ignored. The only entry point is on `/admin/users`, which an admin can't open anyway.
- **Hidden Pages.** The Admin hub section (`app/admin/page.tsx`) renders only for `isStrictSuperUser(effective role)`. Hidden / retired routes (`HIDDEN_PAGE_REGISTRY`, today `/clients/alerts`) are refused to admin by `canAccessRoute`.
- **`ADMIN_EXCLUDED_ROUTES`** (`lib/access-control.ts`): `/admin/users`, `/admin/roles`, `/client-statistics`, `/people-statistics`, `/productivity`, `/productivity-detail`, `/capacity`, `/admin/sync`, `/admin/reconciliation`, `/admin/database`.
  - They're refused even with a matrix grant.
  - The nav drops them because it uses the same `canAccessRoute`, and the Admin hub hides the Sync / Reconciliation / Database tile links.
  - An admin who opens one by URL is redirected to My Dashboard (`proxy.ts` → `homeRouteFor`).
- **Pending Review.** Unchanged for everyone: closing a review there stays **account-team only**, with no super or admin bypass.

**Messaging.** Only the carve-outs say "super user": the Users / Roles refusal above, and the Users / Roles tiles and Hidden Pages blurb on the Admin hub. Shared-power messages are unchanged ("Only an admin can override a claimed report's lock", task close / reassign wording), since "admin" there now literally includes the Admin role.

**To change the boundary:** for a page, edit `ADMIN_EXCLUDED_ROUTES`; for a power, swap `hasSuperUserPrivileges` ↔ `isStrictSuperUser` at that call site. `lib/access-control.test.ts` pins the exclusion list, the helpers and the locked column.

> The old `user_roles` table is left in place as a **backup** but is no longer read. Copy its rows into `user_role_grants` before relying on this (see **Go-live migration** below) — otherwise nobody, not even a super-user, has a role.

### Which pages a role may reach — `public.role_page_access`

The per-role page allow-list lives in **`public.role_page_access`** — the **Admin → Roles** grid (one `{ role, route, allowed }` row per checked cell). At request time `getAllowedRoutes(role)` (`dashboard/lib/page-access.ts`) loads that role's `allowed = true` routes in **one query**, ordered by `PAGE_REGISTRY` so the first entry is a natural landing page. It **fails closed** — any error (including the table not existing) returns `[]`, denying rather than leaking — and short-circuits to `[]` for `super_user` (who is never gated by the grid).

Since 2026-10-14 the signature is `getAllowedRoutes(role, email)`, and the result also includes that person's per-user grants (next section).

### Per-user page grants — `public.user_page_grants` (2026-10-14)

**Effective page access = role pages (`role_page_access`) ∪ that person's grantable grants (`user_page_grants`).** The grants are additive only; there are no per-user denials. They are **page access only**: every write, admin power, data scope and financials check still reads the role / scopes exactly as before, so a grant can never confer a power.

**Table** (`sql/patches/2026-10-14_user_page_grants.sql`): `email` (lower-cased, `CHECK`-enforced), `route` (a `PAGE_REGISTRY` route, the same key as `role_page_access.route`), `granted_by` (the super user's email), `granted_at`. `PRIMARY KEY (email, route)`. RLS is on with no policies, so only the service role can read or write it. Revoking deletes the row. Until the patch runs, the grants query errors, the error is treated as "no grants", and access is exactly role-only.

**Where it's folded in: `getAllowedRoutes` (`lib/page-access.ts`), the one function every access check gets its list from.** It runs the role query and the grants query in parallel. `email` is a **required** argument, so the compiler flagged every call site; a site passing `null` only under-grants.
- **Proxy and root layout (nav):** pass `effectiveAccessEmail(realEmail, resolution)`.
- **Page / action re-checks:** use `getEffectiveAllowedRoutes()` (`lib/effective-identity.ts`).
- **`requireRouteAccess`** (APIs): passes the real caller's email.

Because the nav and the proxy read the same list, a granted page both appears in the sidebar and opens by URL.

**Fail-closed:**
- A role-query error still returns `[]`.
- A grants-query error adds nothing.
- `super_user` / `admin` / no-role short-circuit to `[]` exactly as before. Grants are no-ops for them: super and admin are code-defined, and `canAccessRoute` denies a role-less user before reading the list.

**What can be granted — `isGrantableRoute(route, PAGE_REGISTRY)`** (`lib/access-control.ts`). A route is grantable only if it is an exact registered route **and not**:
- in `ADMIN_ONLY_ROUTES`
- in the Admin section (`/admin` and anything under it)
- hidden (`HIDDEN_PAGE_REGISTRY`)
- in `ALWAYS_ALLOWED_ROUTES` (`/`, `/my-dashboard`, `/time-off-requests`)
- `/feedback` (redirect-only)

The grantable set today:

| Section | Grantable pages |
|---|---|
| Clients | Client Statistics, Portfolio, Client Detail, Outreach Status |
| Institutions | Summary, Detail, Style / Set Finder, Relationships (parked) |
| Productivity | People Statistics, Summary, Detail, Capacity |
| Logistics | Planning, legacy Planning, NDRS Calendar, Host Calendar, Live Outreach, Profiles, Feedback Reports, Feedback Collection, Onboarding, Time Off, Upcoming Meetings / Conference Rooms / OOO Summary (parked) |
| Contracts | every Contracts page |

`lib/access-control.test.ts` pins this list exactly.

**Enforced in three places:**
1. **The write.** `setUserPageGrant(email, route, on)` in `app/admin/users/actions.ts` checks `requireStrictSuperUser`, the `@roseandco.com` domain and `isGrantableRoute`. A crafted request for a strict page is refused before anything is written.
2. **The read.** `getAllowedRoutes` drops any grant row that isn't grantable, so a hand-inserted row for `/admin/users` or `/meetings` is inert.
3. **The decision.** `canAccessRoute` still refuses `ADMIN_ONLY_ROUTES` and hidden pages before it reads the allowed list.

**Audit.** Each grant writes `create` and each revoke writes `delete` (with the original granter and date) to `audit_log`, entity `user_page_grants`, record `email|route:/x`. The Audit Log labels it **User → Page Grant**.

**View as.**
- **PERSON mode:** shows that person's role pages ∪ **their** grants (`effectiveAccessEmail` returns the impersonated email). So viewing as someone shows exactly their sidebar and lets you open exactly their pages.
- **ROLE mode:** an abstract preview, so **role pages only** (no person, so no grants).

**UI.** Admin → Users shows a **Pages** button per row, with a `+N` count of grants. It is hidden for Super User, Admin and None. It opens a panel grouped by `PAGE_SECTIONS`, as described in *How to give ONE person an extra page* above. A row is listed when the page is grantable, or when the role already reaches it (shown locked, never toggleable).

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

1. It calls `supabase.auth.getClaims()` to validate the session (signature + expiry, checked locally) and refresh the cookie when the token is about to expire. Link **prefetches** are the exception — they verify the existing token but never refresh it (see _How the session is checked on each request_ below).
2. **No session** on a protected path → redirect to `/login` (preserving the intended destination in `?next=`).
3. **Signed in** → resolve the **effective** role (View-as aware), load `getAllowedRoutes(effectiveRole)` once, and call `canAccessRoute(role, pathname, allowedRoutes)`. If denied, redirect to the role's **first allowed page** (`allowedRoutes[0]`), or `/no-access` if they have none. This replaces the old fixed `USER_HOME_ROUTE` and can never redirect-loop (the target is always reachable).

Public paths (`/login`, `/auth/callback`) are allowlisted. The matcher excludes `/api/*` (those routes do their own auth — see [06 — Automations](06-automations.md)) and static assets.

> Because the proxy runs server-side before render, it also blocks someone who types a restricted URL directly. The sidebar hiding links (via the same `canAccessRoute`) is **cosmetic** — the proxy is the gate.

### Identity is resolved **once per request** — and never cached across requests

Resolving "who is this and what may they see?" costs real time: `auth.getUser()` is a network call to Supabase Auth (~180 ms — dearer than a query), and the role / scope / roster reads are ~100–160 ms each. It used to be done over and over inside a single page load. Two mechanisms fix that, and both have a security rule attached.

**1. Request-scoped memoisation (React `cache()`).** A single Client Portfolio load used to run the *same* one-row `user_role_grants` query **seven times** — once in the proxy, once in the layout, and up to five more inside `getEffectiveIdentity` → `lookupPerson` → `getUserScopes` → `canSeeFinancials`. `user_data_scopes` was read twice. These are now wrapped in React's `cache()`, so each resolves once per request:

| Function | File |
| --- | --- |
| `getRealRole` | `dashboard/lib/user-role.ts` |
| `getUserScopes` | `dashboard/lib/access/data-scope.ts` |
| `lookupPerson` | `dashboard/lib/impersonation.ts` |
| `loadIdentity` | `dashboard/lib/access/identity.ts` |
| `readRealIdentity` (the `auth.getClaims()` call) | `dashboard/lib/effective-identity.ts` |

> 🔒 **These caches are per-REQUEST and must stay that way.** React's `cache()` stores its memo on the per-request cache dispatcher Next.js installs around each render; a new request gets a cold cache. **Never** move any identity-, role-, scope- or permission-derived value to a module-level `Map`, a global, or any process cache — that would serve one user's permissions to another. Each wrapped function carries this warning in its own header. The cache key is always the **normalised (lower-cased) email**, so callers passing different casings share the lookup instead of missing it.
>
> Outside an RSC render — i.e. in `proxy.ts` — React's `cache()` simply calls straight through, so the proxy always does its own fresh lookup and shares nothing with the render.

**2. The proxy hands its result to the layout.** The proxy *must* resolve the user, role, View-as state and allowed routes in order to enforce access. The root layout then needed the same four answers for the nav, and used to throw that work away and re-query all of it. The proxy now forwards its result on a **server-only request header** (`x-rose-identity`, see `dashboard/lib/identity-header.ts`), set with `NextResponse.next({ request: { headers } })` — Next.js's documented proxy→app channel. It is deliberately *not* `NextResponse.next({ headers })`, which would expose it to the browser.

> 🔒 **Why a header cannot be spoofed into access.** Three properties, and all three must hold:
> 1. The proxy **overwrites** the header on every request it handles (`Headers.set`, never "only if absent") — including the public `/login` path, where it writes the *anonymous* payload rather than leaving a client value in place. A browser that sends `x-rose-identity: {"realRole":"super_user"}` has it discarded.
> 2. Nothing that renders the root layout escapes the proxy matcher: it excludes only `/api`, `_next` internals and static file extensions, none of which render a layout, and the app has **no dynamic or catch-all routes** that could be shaped to match one.
> 3. The reader **fails safe, not open** — a missing, malformed or unparseable header returns `null` and the layout resolves identity itself exactly as before (`resolveIdentityLocally` in `dashboard/app/layout.tsx`). A forged header can do no better than *no* header, which costs latency, not access.
>
> The header is **not** an authorization decision. `canAccessRoute` in the proxy has already enforced access before the value exists, and self-guarding pages (`/meetings`, `/events`) still re-check through `getEffectiveRole`. The header only saves the nav from re-deriving what was just computed.

Verified live: a request carrying a forged `super_user` header still gets `307`'d off `/portfolio` and `/admin`, and `/login` renders with **zero** admin/meetings/events links and no attacker email.

### How the session is checked on each request — and why Supabase Auth is called so rarely (2026-10-16)

**In plain language.** Every page, and every background "prefetch" the browser makes for a link, has to prove who you are. That proof is a signed token in your session cookie. The app checks the signature **itself** — no call to Supabase — on every request. It only talks to Supabase Auth to **refresh** the token, which lasts an hour, and it now makes sure that happens **once**, not dozens of times at the same moment.

**Why it mattered.** Production logs showed bursts of ~36 `AuthApiError: Request rate limit reached` (`429 over_request_rate_limit`) inside two seconds. In the last ~90 s of a token's life (or after an idle hour), opening a long list made the browser prefetch every link in view — sidebar pages plus a `/client-detail?account_id=…` per row. Each prefetch is its own server request with its own fresh Supabase client, so **each one** tried to refresh the same token. Supabase limits refreshes **per IP** (all our traffic leaves Vercel from shared IPs; the documented default is roughly 1,800/hour with bursts of ~30 — check Dashboard → Authentication → Rate Limits). Worse, on a 429 the auth library treats the refresh as failed and **deletes the session cookies**, so users saw 15–20 s stalls and were bounced to `/login`.

**How it works now — three layers, none of which changes who is let in:**

| Layer | Where | What it does |
| --- | --- | --- |
| Local verification | `proxy.ts`, `lib/effective-identity.ts` | `auth.getClaims()` verifies the JWT's ES256 signature and expiry in-process against Supabase's public key set (fetched once per server instance, cached 10 min). No Supabase Auth call unless the token needs refreshing. The page/action reuses one check per request via React `cache()` (`readRealIdentity`). |
| Prefetches never refresh | `proxy.ts` + `readSessionAccessToken` in `lib/supabase/proxy.ts` | A request with the `next-router-prefetch` header reads the access token straight from the cookie and calls `getClaims(token)` — the **same** signature + expiry check, but it can never trigger a refresh. If the token is no longer valid the proxy answers **204 "nothing to prefetch"** (no page, no redirect, cookies untouched); the click itself is a real navigation and refreshes normally. Requires `skipProxyUrlNormalize: true` in `next.config.ts`: Next 16 otherwise strips `next-router-prefetch` (and `rsc`) from the proxy's request. That flag also leaves Next's internal `_rsc` query on the proxy's URL, which `proxy.ts` drops from the `/login?next=` destination. |
| Single-flight refresh | `lib/supabase/refresh-single-flight.ts` (passed as `global.fetch` to both server clients) | When several real requests on one server instance need a refresh at the same moment, they share **one** call to `/auth/v1/token?grant_type=refresh_token`. Keyed by the refresh token itself, so only a caller already holding that token can receive its result. A successful result is reused for 10 s (Supabase's own refresh-token reuse window) so stragglers don't fire again; failures are never reused. |

Plus fewer prefetches in the first place: table-row and record-pane links to Client Detail (Clients, Events, Meetings, Contacts, Notes, Tasks, Touches, Portfolio, Onboarding, To-Do, Contracts, Client Health, FB Coming Soon, Institution Detail, Audit Log, Alerts, My Dashboard) and the sidebar / section-nav links use `prefetch={false}`. Next.js then prefetches a link only when you **hover** it, instead of every link the moment it scrolls into view. Navigation still feels instant on hover; a 50-row list no longer fans out 50 server requests.

**Background refresh is off on the server.** `@supabase/ssr`'s `createServerClient` forces `autoRefreshToken: false` (and `persistSession: true`, `skipAutoInitialize: true`), so nothing refreshes on a timer — refreshes only happen when a real request finds the token within 90 s of expiry. The only browser Supabase client is on `/login`.

> 🔒 **What did NOT change.** What counts as signed in (a token with a valid signature that hasn't expired) and every role / page / scope check are identical. A stale session is still refreshed on a real navigation or server action. A prefetch with a stale token now gets *less* (nothing) rather than more. Trade-off, unchanged from 2026-10-02: local verification means a session revoked at Supabase (sign-out-everywhere, deleted user) stays valid until its access token expires (≤ 1 h); role removal still takes effect on the next request because roles are read from the database every time.

**Still calling Supabase Auth on every use** (`getUser()`, ~1 network call each; not part of the burst): `/live-outreach`, `/time-off`, `/feedback-collection`, `/pipeline`, `/no-access`, `/login`, Admin → Users (session banner), `recordAudit` (one per audited write), the `/api` guards in `lib/api-auth.ts`, the reconciliation actions, and the layout's rarely-used fallback. These are candidates to move to `getClaims()` later.

**Verifying in production.** The burst only happens on Vercel. After deploying, open a list-heavy page (Clients, Events, Meetings) and scroll while watching the Vercel logs: success = no `over_request_rate_limit` lines.

### The nav mirrors the gate — `dashboard/components/nav.tsx`

The sidebar receives `allowedRoutes` from the root layout — resolved by the proxy and forwarded (see above), not re-queried — and filters each section's items with `canAccessRoute(role, item.href, allowedRoutes)`, dropping any section left empty. So the nav shows exactly the pages the grid grants, and costs **no** query of its own. Admin is reached via a small **gear icon** (links to `/admin`) that renders only when `canAccessRoute(role, "/admin", allowedRoutes)` is true.

> **Grouped top items (2026-10-16).** The top of the nav is now My Dash (labelled **Home** since 2026-10-17) · **Clients** (→ `/accounts`) · **Events** (→ `/events`) · **Actions** (→ `/tasks`) · Contacts (→ `/contacts`); full tree in [02 — Pages](02-pages.md). The four CRM tables moved up out of the bottom CRM block — drawing only (`TOP_NAV_CRM_HREFS` in `nav.tsx`); `CRM_NAV_ITEMS` and its gate are unchanged. Gating rules for a group: each child is filtered by `canAccessRoute` (and hidden pages) as before; the group's own default page is filtered the same way; the group shows when **either** survives; and its name links to the default page, or — if that's not reachable — the **first reachable child**. **Actions** links to `/tasks`, which is in `ADMIN_ONLY_ROUTES`, so `canAccessRoute` shows it to super users / admins only.
>
> **Update (2026-10-17).** The bottom block's **Actions** group (Tasks / Touchpoints / Notes) moved up to become the top **Actions** group's children — drawing only: `/tasks`, `/touchpoints`, `/notes` joined `TOP_NAV_CRM_HREFS`, and `CRM_NAV_ITEMS` / `canSeeCrmNav` are unchanged. The bottom CRM area now holds no links; it still renders for super users / admins so the "+" quick-add stays (its rail rule was removed). The **CRM pill** comes from the page registry's "CRM" section (`isCrmTableRoute` in `lib/page-registry.ts`), which now also lists Tasks / Touchpoints / Notes — they stay `ADMIN_ONLY_ROUTES`, so `isGrantableRoute` rejects them and their Roles-matrix checkboxes do nothing. Labels: "Client Insights" → **Insights** (sub-heading "Productivity Insights" removed) and "Workflows" → **Tools**. Labels only — every item's gate is unchanged. Current tree: [02 — Pages](02-pages.md).
>
> **Styling (2026-10-17).** Non-active top-level nav labels are a shade darker and sit ~2px further from their icons (`TOP_ROW_CLASS` / `TOP_ROW_IDLE` and the rail tile caption in `nav.tsx`). No gating change.

### Collapsing the sidebar

The desktop sidebar **starts collapsed** as a **58px icon rail**. The `«` / `»` chevron that toggles it sits in the **footer**, alongside the user avatar and admin gear — nothing sits above the logo. It's a manual toggle only; nothing auto-collapses it.

- **Expanded** is the full nav: the full Rose & Co IQ lockup, section labels, sub-page links, active highlighting, and the footer row of *Sign out · admin gear · collapse chevron*.
- **Collapsed** wears just the square **IQ logomark** (`public/favicon-512.png`) and shows one icon per top-level section, with the active section highlighted. **Hovering (or focusing) an icon opens a fly-out** to the right listing that section's label and all of its sub-pages, so every page is still one hover away; direct-link sections (Institutions, Contracts) get a plain label tooltip instead. **The section icons are also links.** Clicking one goes straight to that section's default page — Clients → `/portfolio` (Portfolio), Productivity → `/people-statistics` (Statistics), Logistics → `/planning-v2` (Planning) — while hover still opens the fly-out, so the icon is both a link and the fly-out trigger. The default page comes from `defaultHref` on each section in `dashboard/components/nav.tsx`, chosen **after** the access filter has run: if the viewer can't reach the default, the icon links to the first sub-page they *can* reach, so it never sends anyone to a blocked route. The footer collapses to avatar (its fly-out carries the email + sign-out), gear, and chevron.
- Fly-outs are keyboard-reachable: the trigger carries `aria-expanded`, Tab steps from the icon into the sub-links and back out to the next icon, Escape closes. The content column reflows to claim the reclaimed width, with a 200ms width transition.
- The state is remembered per user in a **`sidebar_collapsed` cookie**, read by the root layout so the *server* render already has the right width — the sidebar never flashes wide before snapping narrow. **Collapsed is the default**: only an explicit `0` (written when a user expands it) opts out, so a deliberate choice always beats the default on later loads. See `dashboard/lib/sidebar.ts`.
- **One-time collapse reset (2026-10-12).** Everyone was put back on the collapsed rail once, on their next load. It works through a **reset epoch**, `SIDEBAR_COLLAPSE_RESET_EPOCH` in `lib/sidebar.ts` (currently `1`), stored in the cookie value itself: `"<flag>.<epoch>"`, e.g. `0.1` = expanded, saved under epoch 1. A cookie with an older epoch, including the legacy bare `0` / `1` (treated as epoch 0), renders collapsed. On mount the sidebar re-stamps it as `1.<current epoch>` (`stampSidebarCookieIfStale`), so the reset fires **once per browser**. After that the user's own toggle sticks again. No database is involved. **To reset everyone again, bump the epoch by one** and add a line to its history comment.

> **Why the fly-out is portaled.** `<aside>` is `position: sticky`, and sticky *always* establishes a stacking context — which capped the fly-out's z-index inside a layer that paints *before* `<main>`, so page tables covered it however high the z-index went. The panel is therefore rendered through `createPortal` into `<body>` (at `z-60`, clear of sticky table headers at `z-20` and sticky first columns at `z-30`; the sidebar itself is `z-40`). The portal costs the natural tab order, so `useFlyout` in `dashboard/components/nav.tsx` hands focus across the boundary by hand.

Below `md` the sidebar is replaced by the existing hamburger sheet, which always shows the full nav — the collapse toggle is desktop-only.

### Sectional nav strip — `dashboard/components/section-nav.tsx`

A slim orientation band sits at the **top of every page, above the hero ribbon**: a blue letter-spaced **eyebrow** naming the current section, and under it one **tab per sibling page** in that section. The active page is marked with the brand **blue→teal gradient underline** (`RAIL_ACCENT_UNDERLINE` — the same token behind the rail fly-out's rule and the masthead accent strip); inactive tabs are muted and darken on hover.

It is **one shared component with a single mount point** — `<SectionNav />` in `dashboard/app/layout.tsx`, rendered inside `<main>` just above `{children}`. No page opts in, and no page carries section-nav logic of its own. To remove the feature: delete `section-nav.tsx` and drop that one line plus its import.

- **Data-driven, never hardcoded.** The strip derives its list from the *same* `sections` array and the *same* `canAccessRoute` filter the sidebar renders from, re-exported as `visibleNavSections` / `isNavRouteActive`. Add a page to the nav and its tab appears everywhere in that section with no further edit.
- **Access-gated identically to the sidebar.** Tabs come from the already-filtered item list, so the strip can never offer a page the proxy would block — a user granted 2 of Logistics' 9 pages sees exactly those 2 tabs.
- **Hidden when it would be noise.** No strip on a section with fewer than **2** reachable pages (no lone tab), and none on a page that isn't a nav section's child — so `/admin`, `/login`, `/no-access`, the drill-in detail pages (`/institution-detail`, `/institution-style`), the unlinked `/planning`, and the unlinked finance routes all render without one. The two direct-link sections (Institutions, Contracts) carry no child items and so never show a strip either.
- **Active match** uses the sidebar's own ancestor rule, keeping the **longest** match so `/clients/to-do` marks *Outreach Status* rather than a shorter sibling prefix.

### View as (super-user testing mode)

A super-user can preview the app as an abstract **role** or as a specific **person**. It is built on a clean split between the caller's **real** identity/role and the **effective** identity/role:

- `getRealRole(email)` (`dashboard/lib/user-role.ts`) — the caller's actual role from the `user_roles` table (the old `getUserRole`, kept as an alias). Used **only** to authorize impersonation and the exit action, so it can never be spoofed by a cookie.
- `resolveEffective(realRole, viewAsUserCookie, viewAsRoleCookie)` (`dashboard/lib/impersonation.ts`) — the shared core. Honors impersonation **only** when `realRole` is `super_user`. **Person** mode (`view_as_user`) takes precedence over **role** mode (`view_as`); otherwise it returns the real role. It has **no** `next/headers` import, so the proxy imports it directly (reading cookies off the `NextRequest`).
- `getEffectiveRole()` and `getEffectiveIdentity()` (`dashboard/lib/effective-identity.ts`) — the request-context wrappers (they read cookies via `next/headers`) for Server Components/Actions. **`getEffectiveIdentity()` is the single source future row-scoping resolvers (`accessibleClientIds`, `hostedMeetingIds`, `feedbackAssignments`) will consume** — it returns `{ email, userId, name, role, impersonated }`, where `userId` is the Dynamics system-user id from the `users` mirror. So person-scoping lights up automatically when those resolvers land (no scoping changes here yet).

`proxy.ts`, `canAccessRoute`, and the nav all gate on the **effective role** (and its `getAllowedRoutes`), so the whole app (route gating + sidebar) reflects the viewed-as person/role. A person's effective role is **their** `getRealRole` — often `null` or a role with few grants, which correctly yields the "no access" or reduced experience.

- **The cookies** — `view_as_user` (`VIEW_AS_USER_COOKIE`, an `@roseandco.com` email) and `view_as` (`VIEW_AS_COOKIE`, a role). Both are **httpOnly**, `sameSite=lax`, `path=/`, and `secure` in production (relaxed in dev so they work over `http://localhost`). Read **server-side** only; client state is never trusted. The two modes are mutually exclusive — setting one clears the other.
  - **`view_as` (role) is now read-only.** Since the Admin dropdown was removed on 2026-09-16 nothing can *set* it, but `resolveEffective` still honours it, the banner still labels it, and `exitViewAsAction` still clears it. That is deliberate: it lets a **stale cookie** left in a browser from before the removal be seen and exited normally. Deleting the read path would have stranded those cookies as a silent, unexplained role downgrade.
- **Entry point** — the per-row **"View as"** button on **Admin → Users** (`dashboard/app/admin/users/users-view.tsx` → `setViewAsUserAction`). Not in the main nav. **This is the only way to START impersonation.** The Admin hub's `ViewAsControl` dropdown and its `setViewAsAction` handler were both deleted on 2026-09-16.
- **Banner** — while either cookie is active, `dashboard/components/view-as-banner.tsx` renders a slim banner pinned to the top of every page, from the **root layout** (outside the sidebar, which hides itself on some pages). The layout builds the label ("Viewing as {Name} — {role or 'No role'}"). Its **Exit view** button posts to `exitViewAsAction`.
- **Actions** — `dashboard/app/view-as-actions.ts`. `setViewAsUserAction` and `exitViewAsAction` both authorize off `getRealRole` (via `requireStrictSuperUser`, so an **Admin** cannot View as), **never** the effective role — so you can always exit even while viewing as someone with no access, and a non-super holding a stray cookie is ignored. Exit clears **both** cookies.

**Guardrails.** Only a real `super_user` can set or hold either cookie; `resolveEffective` ignores them for anyone else, and a stale/bogus `view_as_user` email that matches no active mirror row is safely ignored. When the effective role can't reach the requested route, the proxy redirects to that role's first allowed page, or the always-allowed `/no-access` when it has none — so previewing a no-access person lands on the request-access screen (with the banner's Exit still present) instead of a redirect loop.

### Admin pages

`/admin` and everything under `/admin/*` have no `role_page_access` grants for any non-super role, so they're Super-User-only by the deny-by-default rule. The exception is **Admin**, which reaches `/admin` and every `/admin/*` page other than Users, Roles, Sync, Reconciliation and Database (see [Admin role](#admin-role-2026-10-13)). The hub's Hidden Pages section is strict super-user only. Don't tick them on for another role unless you truly mean to.

The Admin hub also has a **Hidden Pages** section (`dashboard/app/admin/page.tsx`, the `HIDDEN_PAGES` array) that links to routes parked off the main nav — currently `/pipeline`, `/relationships`, `/conference-rooms` and `/ooo-summary`. Those pages are super-user-only purely because Admin is; the pages themselves keep their own routes. To park another page later, add one `{ href, label }` line to `HIDDEN_PAGES`.

### The CRM block in the nav rail

> **2026-10-16 (later) — CRM access levels: None / View / Edit / Manage.** Each of the four CRM tables (**Clients**, **Events**, **Meetings**, **Contacts**) now takes a **level** instead of a yes/no page box. It's set per **role** in the Roles matrix and per **person** in Users → Pages, through the same grant tables (no parallel system).
>
> | Level | What it allows |
> |---|---|
> | **None** | No access. The page isn't granted. |
> | **View** | Exactly the old page grant: nav item, list, filters, export, saved views and the read-only drawer. All of those key off level ≥ View. |
> | **Edit** | View, plus **edit** existing dashboard-created records (not protected fields). The Edit button shows. |
> | **Manage** | Edit, plus **create** records, **delete / purge** test records, and change protected fields. The New and Purge test buttons show. |
>
> - **Implicit full access.** Super users and admins (`hasSuperUserPrivileges`) are always **Manage** on all four, whatever the matrix says. Their matrix column reads "Manage" and is locked. To make admins follow the matrix instead, switch to `isStrictSuperUser` in two places: `decideCrmWrite` (`lib/access/crm-levels-policy.ts`) and `getCrmLevels` (`lib/page-access.ts`). Both are commented.
> - **Raise-only per person.** A person's effective level is the **higher** of their role's level and their own. The Users → Pages dropdown shows the role level as "Role: X", offers nothing below it, and tags a higher pick **OVERRIDE**. Picking the role's level again removes the person's own grant.
> - **Storage:**
>   - `role_page_access.crm_level` refines `allowed`. `allowed` stays the view bit every reader uses, and `allowed = false` always means None.
>   - `user_page_grants.crm_level`: a row is at least View, and `crm_level` only raises it.
>   - Read by `getCrmLevels` / `getEffectiveCrmLevels`, which is View-as-aware like `getEffectiveAllowedRoutes`.
> - **Server-side gates** (`requireCrmLevel`, `lib/crm-write.ts`). Each also refuses while in View as:
>   - Edit: `updateClient/Event/Meeting/Contact` and `updateDashboardRow` need **Edit**. The edit-form load (`loadDashboardRowForEdit`) and the form pickers (`canUseCrmForms`) need Edit too.
>   - Create (`createX`) needs **Manage**.
>   - Purge test rows (`countTestRows` / `purgeTestRows`) needs **Manage**.
>   - The event drawer's **Add Meeting** needs **Meetings Manage**.
>   - The nav's quick-add "+" menu stays super-user / admin only; Manage holders use each page's own **New** button.
> - **Protected fields: hook only, shipped empty.** `PROTECTED_CLIENT_FIELDS`, `PROTECTED_EVENT_FIELDS`, `PROTECTED_MEETING_FIELDS` and `PROTECTED_CONTACT_FIELDS` in `lib/access/crm-levels-policy.ts` are all **empty** `[]`. `updateDashboardRow` already enforces them: changing a listed column needs Manage or super-user. Today nothing beyond create / delete is restricted. To protect a field, add its column name to the right list.
> - **Conservative seed:** `sql/patches/2026-10-16b_crm_access_levels.sql` adds the two columns and maps **every existing grant to View**. It seeds **no Edit or Manage** for any role or person, so on deploy nobody but super users / admins can write, exactly as before. Until it runs, every grant reads as View, and Edit / Manage refuse to save (with a message saying why).
> - **Unchanged:**
>   - Tasks, Touchpoints and Notes (still super-user only, no level).
>   - The Dynamics origin fence: Dynamics-synced rows stay read-only for everyone.
>   - Client deactivate / reactivate (super user or the client's primary manager).
>   - The feedback capabilities and the feedback-report split/move actions.

> **2026-10-16 — the four primary CRM list pages are grantable.** **Clients** (`/accounts`), **Events**, **Meetings** and **Contacts** left `ADMIN_ONLY_ROUTES`. They are ordinary pages now, listed in a new **CRM** section of `PAGE_REGISTRY` (`lib/page-registry.ts`), so they show up in both the Roles matrix and the per-user **Pages** panel. What a grant opens and what it doesn't:
>
> - **Opens:** the whole list, with **no row scoping**: every row, active and inactive. It also opens the quick filters, Excel export, personal saved views, and the **read-only row drawers**. The server-side gate is page access: `canAccessRoute` in the page, and `canReadCrmPage(route)` (`lib/crm-write.ts`) in each read action. Saved views follow the new `route` field on the spec (`lib/table-views/saved-views.ts` → `requireCaller(spec)`).
> - **Doesn't open:** create / edit / delete / purge stay super-user only (`requireCrmWriter`, unchanged), and the New / Purge / Edit buttons are hidden from non-super viewers. Shared (system) saved views stay super-user only. In the Events drawer, the Meetings / feedback-report panel stays super-user only (`showFeedbackReports`), as on My Dashboard.
> - **Raw Dynamics record:** the Client and Contact drawers no longer send `_raw` (the unfiltered Dynamics record) to anyone without super-user privileges. `loadAccountRecord` / `loadContactRecord` check `hasSuperUserPrivileges` on the effective (View-as-aware) role and leave `_raw` off the payload; it isn't even read from the database for them. Super users and admins still get it as before. `is_test` and `origin` go to everyone, and every mapped drawer column is unchanged. Nothing renders `_raw`, so the drawer looks the same. This also covers the Key Contacts strip on Client Detail, which uses the same contact loader.
- **Unchanged:** Client Detail keeps its account-team scoping (`resolveClientScope`). A Clients-list viewer who isn't on a client's team still can't open that profile.
> - **Still super-user only:** Tasks, Touchpoints and Notes. They stay in `ADMIN_ONLY_ROUTES` and are not in the registry.
>
> `canSeeCrmNav` lost its super-user floor. The block now draws exactly the CRM items `canAccessRoute` allows, so a person granted only Contacts sees a CRM block holding just Contacts. **No SQL is needed:** `role_page_access` and `user_page_grants` store free-text routes, so the grants are just new ticks. The paragraphs below describe the earlier, super-user-only design.

`/meetings` and `/events` are **not** hidden pages. They have their own entries at the **bottom of the main nav rail**, below every reporting section, under a thin **"CRM"** section break and drawn as a teal outline rather than the navy fill the reporting items use — it is the raw CRM mirror, not another report, and the treatment says so.

**Their gating is the strictest in the app.** Both are in `ADMIN_ONLY_ROUTES`: super-user-only, and not openable to another role through the Admin → Roles matrix. What decides whether the nav entry is *drawn* is `canSeeCrmNav` in `lib/access-control.ts`, which requires **both** `role === "super_user"` **and** `canAccessRoute` — the second so the rail can never advertise a route the proxy would block, the first as an explicit floor if `/meetings` were ever taken out of `ADMIN_ONLY_ROUTES`. For any non-super-user the whole block is absent: no item, and no divider either.

The role is the **effective** one, so a super-user in **View as** loses the block exactly as the impersonated person would. None of it is the security boundary — `proxy.ts` gates the route and the page re-checks the effective role before fetching. Covered by `lib/nav-crm.test.ts`.

To add another CRM entry later, add a `{ href, label }` line to `CRM_NAV_ITEMS` and an icon to `CRM_ICONS` in `components/nav.tsx` — but only for a page that is itself super-user-only; the test asserts that.

**The "Actions" submenu (2026-09-30).** *(Moved out of this block to the top nav's Actions group 2026-10-17 — see "Grouped top items" under the sidebar section.)* **Tasks**, **Touches** and **Notes** are no longer separate top-level CRM entries; they sit inside one collapsible **Actions** group, in that order, to save vertical space. This is drawing only — `CRM_NAV_ITEMS`, `visibleCrmNavItems` and every route and permission are unchanged, and the group holds only the children the viewer can reach (it vanishes if none survive). Which items belong to the group is `CRM_ACTIONS_HREFS` in `components/nav.tsx`.

- **Expanded sidebar / mobile sheet:** the Actions header is a button, not a link. Clicking it shows or hides the indented children, and the chevron shows which state it's in. It starts open and doesn't remember its state, because no other nav group does. It re-opens automatically on arrival at `/tasks`, `/touchpoints` or `/notes`, and while it's closed over the current page the header gets the active tint.
- **Collapsed rail:** one outlined **Actions** tile, which opens a hover/focus fly-out listing the three pages, the same way every other grouped rail row works. The tile is tinted active whenever the current page is one of them.

#### Super-user-only routes that the Roles matrix cannot open

`ADMIN_ONLY_ROUTES` in `lib/access-control.ts` is a short list of routes that stay super-user-only **no matter what the Roles matrix says**. `canAccessRoute` checks it after the `super_user` backstop and before the grant lookup, so a `role_page_access` row granting one of them — added by accident or otherwise — has no effect.

It currently holds one route, **`/meetings`**. That page reads `v_admin_meetings_all` with the service-role key (RLS bypassed) and deliberately does **not** apply `resolveMeetingScope`, so a successful load returns every client's meetings. Being merely "linked from Admin" is not a strong enough gate for that, which is why it gets its own. The page also re-checks the effective role server-side before it fetches anything.

Add a route here only when the page exposes data that the scoping layer would otherwise restrict.

> *(Outdated detail above: the list now also holds the CRM Tasks / Touchpoints / Notes tables (Clients / Events / Meetings / Contacts left it 2026-10-16 — see the CRM block note above), Account Teams, Audit Log, Admin Contracts, Time Off Reviewers, Client Health, FB Coming Soon and Automations — see the source.)*

**2026-10-14 — matrix hole closed.** `/admin/users`, `/admin/roles`, `/admin/sync`, `/admin/reconciliation` and `/admin/database` used to be only in `ADMIN_EXCLUDED_ROUTES`, which binds the **admin** role alone. That meant a tick in the Roles matrix could have opened them to User / Associate / Client Manager / Logistics. Their save actions were always strict-super-user, but the pages themselves would render. They are now in `ADMIN_ONLY_ROUTES` too, so neither the matrix nor a per-user grant can open them. Super users are unaffected, and admins are refused as before. Any `role_page_access` row for them is now inert, and their Roles-matrix labels read "(super-user only)". `ADMIN_ONLY_ROUTES` is also the first exclusion in `isGrantableRoute`.

### Users (Admin → **live**)

`/admin/users` (`dashboard/app/admin/users/`) lists every **active `@roseandco.com`** person from the `users` mirror table (Dynamics system users — filtered `is_active = true` and email ending `@roseandco.com`) and lets a super-user set a role for each: **None** (no grant), **User**, **Associate**, **Client Manager**, **Logistics**, or **Super User**. Each row shows the name (bold) and email on one line; changing a selector saves immediately (with a small updating/saved state).

Granted users **float to the top**, ordered Super User → Logistics → Client Manager → Associate → User (each carrying a small colored role pill; Associate's is teal), with the **None** rows muted below, alphabetical by name. A summary line up top reads e.g. "N users · N granted · N none", and a **"Show granted only"** checkbox hides the None rows so you can review just who's assigned.

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
  role        text NOT NULL CHECK (role IN ('user','associate','client_manager','logistics','super_user')),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text
);
ALTER TABLE public.user_role_grants ENABLE ROW LEVEL SECURITY;
```

If the table already exists from before **Client Manager** or **Associate** was added, widen its CHECK constraint — this is `sql/22_associate_role.sql`, or run it inline (once, in the Supabase SQL editor). **Associate cannot be saved in Admin → Users until this runs** — the write fails at the database rather than silently granting the role:

```sql
ALTER TABLE public.user_role_grants DROP CONSTRAINT IF EXISTS user_role_grants_role_check;
ALTER TABLE public.user_role_grants ADD CONSTRAINT user_role_grants_role_check
  CHECK (role IN ('user','associate','client_manager','logistics','super_user'));
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

#### Actions row scoping — Tasks / Touchpoints / Notes (2026-10-20)

**Rule.** A Task, Touchpoint or Note row is visible iff ANY of:

| | Condition | Columns (on `v_admin_*_all`) |
|---|---|---|
| a | Viewer is on the row's client's **core** team — Primary, Secondary, Associate, Logistics (Feedback Report / Memo do **not** count) | `client_account_id` ∈ accounts where `sales_lead_primary_id` / `secondary_manager_id` / `associate_id` / `logistics_coordinator_id` is the viewer |
| b | Viewer **owns** it | task: `owner_id`, `created_by_id`, `current_assignment_id` · touchpoint: `created_by_id` (its `owner_id` is a client-named team, never a person) · note: `owner_id`, `created_by_id` |
| c | Viewer has super-user privileges (`hasSuperUserPrivileges` — super_user OR admin) | — sees every row |
| d | **Exempt type** — visible to all | tasks with sub-type `Feedback` (755860017), `Feedback Report Sent` (755860028) or `Data Upload` (755860000, the whole sub-type, mailbox-created or not) |

A task with no client is visible only under (b), (c) or (d).

**Row visibility only.** Who may *open* these pages is unchanged — `/tasks`, `/touchpoints`, `/notes` are still in `ADMIN_ONLY_ROUTES`, so today only super users / admins open them and the rule is a no-op there. It takes effect the moment a page or drawer is reachable by anyone else, and it already applies to the shared surfaces below.

**Code.** Rules: `lib/access/actions-scope-policy.ts` (pure, unit-tested — `actions-scope-policy.test.ts`). Resolver: `lib/access/actions-scope.ts` — `resolveActionsScope()` (per-request memo), `actionsScopeFilter(entity)` (a `fetchRows` / `countRows` `extra`), `canSeeActionsRow(entity, id)` (single-row check, same predicate). Team membership reuses `resolveAccountTeamScope` narrowed to the four core roles; identity reuses `loadIdentity` (unioned duplicate CRM records).

**View as.** The bypass reads the EFFECTIVE role (`getEffectiveRole`); team and ownership read the EFFECTIVE identity (`getEffectiveIdentity`). View as {person} → exactly that person's rows. View as {role} → that role's bypass, but team / ownership are your own account (a role is not a person).

**Fails closed.** Team can't be resolved → own rows + exempt types. Identity can't be resolved (no match, ambiguous, resolver error) → exempt types only. A column the deployed view lacks is dropped from the predicate (fewer rows, never more); with nothing left to match, the clause is `<id> IS NULL` (no rows) — never "unfiltered". A single-row check that errors denies.

**Surfaces it covers (query layer, not UI hiding):**
- CRM Tasks / Touchpoints / Notes: list, saved-view counts, "first N of M" count, Excel export.
- Record drawers, edit loads, edits, Close (`loadTaskRecord`, `closeTask`, `loadTaskForEdit`, `updateTask`, Marketing Memo upload; `loadTouchpointRecord`, `loadTouchContacts`, `loadTouchForEdit`, `updateTouch`; `loadNoteRecord`, `loadNoteForEdit`, `updateNote`).
- Client Detail → Tasks card (`app/client-detail/crm-lists.ts`).
- Onboarding page's touchpoint drawer / edit (`gateTouch` in `app/onboarding/actions.ts`).
- My Dashboard → Team tasks card and the nav badge's team-task count: narrowed from six team roles to the four core roles (`coreBookIds`). "My tasks" (owner) was already inside the rule.

**Deliberately NOT scoped:** the client-context displays — Client Detail's Touches timeline and Recent Note, Portfolio's recent-note column, Client To-Do's touch cell, the AI client summary. They are already gated by Level-2 client scope; the only extra viewers are people with the All data scope, for whom a client's timeline is the point. Also untouched: everything feedback (Feedback Reports, Collection, `v_feedback_pipeline`, claims, FB Coming Soon) and Data Uploads — those rows are exempt — and internal reads that show no rows (event task dates, automations, Client Margin, Client Health).

**SQL.** `sql/patches/2026-10-20_tasks_current_assignment.sql` appends `current_assignment_id` to `v_admin_tasks_all`. Until it is run, the assignment check is simply left out.

### Roles matrix (Admin → **live**)

`/admin/roles` (`dashboard/app/admin/roles/`) is a **pages × roles** matrix that controls, per role, **which pages that role may reach**. It is reached from a **Roles** card on the Admin hub.

- **Rows** come from a central **page registry** — `PAGE_REGISTRY` in `dashboard/lib/page-registry.ts`, one `{ route, label, section }` entry per navigable page, grouped by nav section. It also feeds `getAllowedRoutes` (route ordering for landing).
- A final **Data permissions** section adds rows that are **not pages** — today just **Financials** (`DATA_PERMISSIONS` in the same registry). These gate which **fields** a role receives, not which routes it may open; see _The Financials permission_ above. They share `role_page_access` under a `data:`-prefixed key and are written by a separate action.
- **Columns** are the assignable roles (`ASSIGNABLE_ROLES`): **User**, **Associate**, **Client Manager**, **Logistics**, **Super User**. Each cell is a checkbox — "this role can access this page." The **Super User** column is all-checked and **disabled** (a hard backstop) and is never written.
- Toggling a cell saves immediately through a super-user-gated server action (`setRolePageAccess`), writing a `public.role_page_access` row.

> **Live — WYSIWYG.** The grid now shows the **true enforced state**: a cell is checked only when a saved `allowed = true` row exists. There are **no pre-checked "seed defaults"** — an unset cell is not granted (default deny), so the grid can never imply access that isn't actually enforced. Changes take effect on the user's **next page load**.
>
> `seedDefaultAllowed()` in the registry still documents the *recommended* starting grants (Client Manager → Clients + Institutions; Logistics → Logistics; **Associate → nothing**; User → nothing; Super User → everything, backstopped) — it's the reference for the **optional seed** in _Go-live migration_ below, not something the grid shows.

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
