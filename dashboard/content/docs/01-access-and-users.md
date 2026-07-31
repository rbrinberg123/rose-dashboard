# 01 — Access & Users

## What it does (plain language)

Everyone signs in with a **magic link** — you type your email, get a link, click it, and you're in. There are no passwords.

Once signed in, there are **two levels of access**:

- **Super-user** — sees everything: all the client, institution, productivity, contracts, finance, and admin pages.
- **User** — sees only the **Logistics** pages (Host Calendar, Planning, Feedback, Live Outreach, etc.). Everything else is hidden and blocked.

A third case: someone who signs in but hasn't been given a role yet. They can't see any real page — they land on a "request access" screen.

The rule is **deny-by-default**: a brand-new page is automatically super-user-only until someone explicitly opens it up to plain users. This is a safety feature — you can't accidentally leak a new finance page to everyone.

## How to open a page to plain users

Add its route to one list. In `dashboard/lib/access-control.ts`, add the route path to `USER_ALLOWED_ROUTES`. That single line is the only change needed — both the security gate and the sidebar read from the same list, so they can never disagree.

```ts
// dashboard/lib/access-control.ts
export const USER_ALLOWED_ROUTES = [
  "/scheduler",
  "/planning-v2",
  "/calendar",
  // ... add your new route here
] as const
```

To keep a page super-user-only, do nothing — that's the default.

## Technical

### The two roles

`Role = "super_user" | "user"` (`dashboard/lib/access-control.ts`). Roles are stored in the `user_roles` table (see [03 — Data Model](03-data-model.md)) and looked up by email at request time via `getUserRole()` (`dashboard/lib/user-role.ts`).

### The three route lists (`dashboard/lib/access-control.ts`)

| List | Meaning |
|------|---------|
| `USER_ALLOWED_ROUTES` | The Logistics routes a plain `user` may reach. Matched by path segment, so `/feedback` allows `/feedback` and `/feedback/123` but **not** `/feedback-manager` (listed separately). |
| `ALWAYS_ALLOWED_ROUTES` | Routes any signed-in user may reach regardless of role. Currently just `/no-access` (the request-access landing). |
| `USER_HOME_ROUTE` | Where a plain `user` is sent if they hit a page they can't access (and their post-login home). Currently `/scheduler`. Must be one of `USER_ALLOWED_ROUTES`. |

Current `USER_ALLOWED_ROUTES`: `/scheduler`, `/planning-v2`, `/calendar`, `/profiles`, `/feedback`, `/feedback-manager`, `/live-outreach`, `/onboarding`, `/time-off`. (See the in-app **live panel** or the file itself for the authoritative current list.)

> Feedback Collection and Feedback Report Pipeline were merged into a single **Feedback** page at `/feedback-manager`, so the nav now shows one "Feedback" item instead of two. `/feedback` stays in the allow-list but only redirects to `/feedback-manager#collection` (preserving query params) — both routes remain reachable by a plain `user` (see [02 — Pages](02-pages.md)).

> `/pipeline` (Upcoming Meetings), `/relationships`, and `/conference-rooms` were removed from this list and from the main nav. They're now **parked pages** reachable only from the super-user-gated **Admin → Hidden Pages** section (see [02 — Pages](02-pages.md)); the routes/pages themselves are unchanged.

### The decision function

```ts
// canAccessRoute(role, pathname) — the single source of truth
export function canAccessRoute(role: Role | null, pathname: string): boolean {
  if (ALWAYS_ALLOWED_ROUTES.some((r) => matchesRoute(pathname, r))) return true
  if (role === "super_user") return true          // super-user reaches everything
  if (role === "user") {
    return USER_ALLOWED_ROUTES.some((r) => matchesRoute(pathname, r))
  }
  return false                                     // no role → nothing but ALWAYS_ALLOWED
}
```

`matchesRoute` is segment-aware: `pathname === route || pathname.startsWith(route + "/")`.

### Where it's actually enforced — `dashboard/proxy.ts`

The real security boundary is the **proxy** (Next.js 16's name for middleware), which runs on the server *before any page renders*:

1. It calls `supabase.auth.getUser()` to validate the session and refresh the cookie.
2. **No session** on a protected path → redirect to `/login` (preserving the intended destination in `?next=`).
3. **Signed in** → look up the role and call `canAccessRoute(role, pathname)`. If denied: a user *with* a role goes to `USER_HOME_ROUTE` (`/scheduler`); a user with *no* role goes to `/no-access`.

Public paths (`/login`, `/auth/callback`) are allowlisted. The matcher excludes `/api/*` (those routes do their own auth — see [06 — Automations](06-automations.md)) and static assets.

> Because the proxy runs server-side before render, it also blocks someone who types a restricted URL directly. The sidebar hiding links (via the same `canAccessRoute`) is **cosmetic** — the proxy is the gate.

### The nav mirrors the gate — `dashboard/components/nav.tsx`

The sidebar filters each section's items with `canAccessRoute(role, item.href)` and drops any section left empty. So a plain `user` only ever sees the Logistics section. The pinned **Admin** row is gated on `canAccessRoute(role, "/admin")` — super-user only.

### Admin pages

`/admin` and everything under `/admin/*` are **not** in `USER_ALLOWED_ROUTES`, so they're super-user-only by the deny-by-default rule. Do not add them to the allowlist.

The Admin hub also has a **Hidden Pages** section (`dashboard/app/admin/page.tsx`, the `HIDDEN_PAGES` array) that links to routes parked off the main nav — currently `/pipeline`, `/relationships`, and `/conference-rooms`. Those pages are super-user-only purely because Admin is; the pages themselves keep their own routes. To park another page later, add one `{ href, label }` line to `HIDDEN_PAGES`.

### Magic-link auth

Sign-in uses Supabase's email magic-link flow. The browser/server/proxy Supabase clients live in `dashboard/lib/supabase/{browser,server,proxy}.ts` and use the **anon** key (safe for the client). Data reads, by contrast, use the **service-role** key server-side (`dashboard/lib/supabase.ts`) — a different, secret key. Don't mix them up (see [09 — Configuration](09-configuration.md)).
