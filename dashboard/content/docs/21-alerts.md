# 21 — Alerts

## What it does (plain language)

**Clients → Alerts** (`/clients/alerts`) is a **critical-to-dos worklist**: the things that are late, and whose they are. It answers one question — *what should I chase today?* — across four separate slices of feedback and meeting work.

It is **read-only**. Nothing on this page creates, edits, deletes, claims, snoozes or marks anything done. Every row is a link to that client's **Client Detail** page, which is where the work is actually picked up. (A future "mark done / snooze" is deliberately out of scope.)

It is also **personal**. Two people opening it at the same moment see different rows — the page is scoped to *you*, not to the firm. **That includes Super Users:** there is no "see everything" mode on this page for anyone. To look at someone else's alerts, use **View as {person}** (Admin → Users), which the page honours in full.

> **Run the patch first.** Until `sql/patches/2026-09-22_clients_alerts_grants.sql` has been run in Supabase, only a Super User can open the page and nobody else sees the nav link. Page access is deny-by-default (see [01 — Access and Users](01-access-and-users.md)), and the match is segment-aware, so the existing `/clients/to-do` grant does **not** cover `/clients/alerts`.

---

## The severity rules

Three levels, and **one threshold — ten days — everywhere it applies**:

| | Meaning | Rule |
|---|---|---|
| 🔴 **Critical** | badly overdue | **more than 10 days** |
| 🟡 **Needs attention** | on the clock | **10 days or fewer** |
| 🔵 **Informational** | listed, not scored | no age, no colour |

Two deliberate details:

- **Strictly more than ten.** Day 10 is yellow; day 11 is red. Exactly one boundary, stated the same way in every section caption.
- **An unknown age is yellow, never red.** When the date a rule measures from is blank in the CRM, the row still appears — with no age badge — but it is *not* called critical. A missing field is not evidence of lateness, and colouring it red would cry wolf on bad data rather than on late work.

Red rows are **tinted and sorted first** within their section, so a critical item is findable without reading the list. Within a colour, oldest first. Informational sections have no ages, so they sort by date, soonest first.

### What "today" means

Every age is counted in whole **Eastern calendar days**. That is not a preference — `v_feedback_outstanding` computes its own `days_since` as `(now() AT TIME ZONE 'America/New_York')::date - (meeting_date AT TIME ZONE 'America/New_York')::date`, and Section 1 renders that number straight from the view rather than recomputing it. Scoring the other sections on a different basis (UTC, or the browser's clock) would let two rows on the same screen disagree about what today is — and at the ten-day boundary that is the difference between a red row and a yellow one.

The CRM's own date columns are read literally, not re-zoned: they hold a wall clock written with a `+00` offset, so the first ten characters *are* the day the business means. See the note on `meeting_date` in `app/profiles/page.tsx` for the same convention elsewhere.

---

## The four sections

Each card carries a **scope chip** (who the rows are scoped to), a **one-line rule caption** showing the threshold, and **per-severity counts**.

### 1. Feedback collection — *Assigned to you*

Concluded meetings still missing their feedback.

- **Source:** `v_feedback_outstanding` — the same view behind **[Feedback Collection](02-pages.md)** (`/feedback-collection`).
- **Included:** the view already restricts itself to *Confirmed*, *Active* meetings whose date is **in the past** and whose feedback is not complete (`feedback_status_label` null or `Awaiting Additional`). The page adds no further filter.
- **Severity:** days past the meeting. 🔴 > 10, 🟡 ≤ 10.

> **"Assigned to you" means `host_id` on this view — which is not the meeting host.** `v_feedback_outstanding` deliberately overloads that column: it carries the **Feedback-responsible person** (Dynamics `bcs_feedback`), *falling back to* the meeting host when that field is unset. That is the same "responsible person" the Feedback Collection page shows (`ownerName()` in `app/feedback/feedback-view.tsx`). Matching on that one column is therefore correct, and coalescing host and feedback ourselves would double-apply the fallback.

### 2. Feedback reports — pending review — *Account team*

A report has been written and is waiting on a reviewer.

- **Source:** `v_feedback_pipeline`, the `pending_review` bucket.
- **Severity:** **always 🔴 critical.** This is the only section that ignores the age rule — a report sitting in review is blocking the client deliverable regardless of how long it has been there. An age badge is still shown for context; it does not change the colour.
- Shows the reviewer and **your role on that account team**.

### 3. Feedback reports — open & claimed — *Account team*

Someone has claimed a report but not yet submitted it.

- **Source:** `v_feedback_pipeline`, the `in_progress` bucket, **where `claimed_by_id` is not null**. An *unclaimed* open report is excluded: there is nobody to chase, so it is not an alert.
- **Severity:** days since **feedback received** — `received_date` on the view, which is Dynamics `crdfa_feedback_received_date`. 🔴 > 10, 🟡 ≤ 10.
- Shows **who claimed it**.

> The view also carries `days_in_stage`, and on today's data the two agree exactly. The rule names the *received date*, so that is what is scored — if the two ever diverge, the received date wins.

### 4. ~~Profiles — created / under review~~ — **removed for now**

There was a fifth section here: investor profiles drafted for an upcoming meeting, read from `v_profiles_upcoming` filtered to stage **Created/Under Review**, account-team scoped, and 🔵 informational (never red or yellow).

**It was removed on 2026-09-22** while the page settles. It may come back. Nothing else on the page depended on it, so it came out cleanly — the query, the card, and its "Profiles in progress" summary tile all went together, and the section numbering here deliberately skips 4 as the reminder.

**The nav badge is unaffected.** The badge counts 🔴 critical only, and this section was informational, so it never contributed to it. The badge still matches the page exactly.

To bring it back, restore it from git — it was the only place this page read `v_profiles_upcoming`, and `app/clients/alerts/load.ts` carries a note at the spot where its query sat.

### 5. Hosting — next 7 days — *You host*

Meetings you personally are hosting in the coming week.

- **Source:** `public.meetings`, where `host_id` is you, `meeting_status_label = 'Confirmed'`, `state_label = 'Active'`, and the meeting falls between **today and today + 7 days inclusive**.
- **Severity:** 🔵 informational, sorted by **date and time ascending**.
- Shows client (ticker + name), date & time, **Live / Virtual**, institution and investor.

> `state_label` is the Dataverse `statecode` and is a *different field* from `meeting_status_label`. Both are checked, the same guard `v_feedback_outstanding` uses — without it, deactivated-but-still-Confirmed meetings leak into the list.

---

## The nav badge

**Alerts is the one nav item that can shout.** When you have critical work waiting, a **red count** appears on it — everywhere in the app, on every page, not just when you happen to be looking at Alerts.

Two forms of the same badge:

- **Collapsed rail** (icons only) — a small red bubble at the top-right of the **Clients** icon, ringed in white so it floats above the icon. Collapsed, the rail shows only section icons, so the Clients icon is Alerts' only visible surface; putting the bubble in the hover fly-out instead would mean the badge only appeared once you went looking, which defeats the point.
- **Anywhere labels are shown** (expanded sidebar, mobile menu, the rail's hover fly-out) — a solid red pill trailing the word **Alerts**.

Three rules:

- **It counts 🔴 critical items only** — sections 1, 2 and 3. Profiles and Hosting are informational and never counted; neither are 🟡 attention items. The number is therefore the same as the **Critical** tile at the top of the page.
- **It is scoped exactly like the page** — relevant to you, with no super-user bypass. Your badge is yours.
- **It hides completely at 0.** No grey zero, no empty circle. Above nine it displays **9+**, but a screen reader still hears the true number: the item's label reads *"Alerts — 12 critical"*.

### How it stays honest

A badge that disagrees with the page it points at is worse than no badge, so `app/clients/alerts/critical-count.ts` re-derives nothing. It reuses the page's own viewer resolver (`viewerUserIds`), the page's own six-role team resolver, and the page's own ten-day rule.

The one thing it must express differently is that rule: the page scores row by row in TypeScript, while the badge has to count **in the database**. So `criticalCutoffDay()` in `alerts-policy.ts` restates the ten days as a date cutoff for the SQL `WHERE`, and `alerts-policy.test.ts` asserts the two forms agree on every day across the boundary. Change the threshold and both move together.

### Cost

It runs on every page in the app, so it is built to be cheap:

- **No rows are fetched.** All three queries are `head: true` + `count: "exact"` — PostgREST returns a count in a header and an empty body.
- **One batch.** The three counts run in a single `Promise.all`, after the two resolvers (themselves parallel), and the whole thing is folded into the root layout's **existing** `Promise.all` alongside the team-initials map — so it adds no serial round trip.
- **Memoised per request** with React `cache()`, keyed on the effective email. Per-request only, never a module-level cache — that would show one person another person's count.
- **A viewer scoped to nothing costs nothing**: an empty id set or an empty team short-circuits to 0 without issuing a query.
- It is given the effective email as an argument rather than resolving identity itself, because the root layout gets its identity from the proxy header specifically to avoid a ~180 ms auth call per page.

If a count query fails it contributes 0 rather than throwing — the badge is an ornament on the nav and must never be able to break every page in the app.

---

## The summary strip

Four counts across the top:

| Tile | What it counts |
|---|---|
| **Critical** | every 🔴 row in sections 1–3 |
| **Needs attention** | every 🟡 row in sections 1–3 |
| **Feedback due** | section 1 |
| **Hosting this week** | section 5 |

Hosting is informational, so it is counted in its own tile and never rolls into Critical or Needs attention. (A fifth **Profiles in progress** tile sat between them until the Profiles section was removed.)

---

## Who sees what

Access works in **two independent layers**, and both are enforced on the server. The app reads with the service-role key, which **bypasses RLS**, so the loader — not the database — is the gate.

### Layer 1 — may you open the page?

A normal, matrix-grantable route. Tick `/clients/alerts` in **Admin → Roles** and the role gets the page and the nav link; untick it and both vanish. `proxy.ts` blocks the request before the page runs, and the page re-checks `canAccessRoute` itself as defence in depth.

The seed patch grants it to **User, Associate, Client Manager and Logistics**. Super User is a hard backstop in code and is never written to the grants table.

**Client Manager is included on purpose**, even though it holds no `/feedback-*` page grants today: an account manager is exactly the person who should be chased about their clients' pending feedback reports. If Rose disagrees, untick the box — no code change, no redeploy.

Because this grant only decides *who may open the page*, it can never widen whose alerts they see. A person with no assignments opens the page and sees four empty cards.

### Layer 2 — whose rows do you get?

| Sections | Scoped to |
|---|---|
| 1, 5 | **you** — the feedback assignee / the meeting host |
| 2, 3, 4 | your **account team** (the six-role rule below) |

Both scopes resolve from the **effective identity**, so **View as {person}** previews exactly what that person would see.

### There is no super-user data bypass

**Every viewer is scoped the same way — Super Users and `scope_all` holders included.** There is no role, grant or checkbox anywhere in the app that turns this page into a firm-wide list.

This is deliberate. Alerts is a *personal worklist* — "what should **I** chase today" — and an unfiltered firm-wide dump answers a different question badly: ninety-nine collection items belonging to other people is not a to-do list, it's noise. Every other page that needs the firm-wide view (Feedback Collection, Feedback Reports, Profiles, the CRM tables) already provides it.

So a viewer with no assignments and no team memberships **correctly sees an empty page**. A pure-admin Super User who is on nobody's account team and hosts no meetings sees four empty cards. That is the right answer, not a fault.

> **Scope, not access.** This does not change who may *open* the page. A Super User still gets the nav link and can still open it — the role grant is untouched. Only what they see inside is scoped.

The absence is enforced by the type system, not just by convention: `AccountTeamScope` in `lib/access/account-team-policy.ts` deliberately has **no `all` variant**, so there is no value the resolver could return that would mean "every account", and the compiler rejects any branch that tries to reintroduce one.

Every failure path **fails closed and says which**. Two empty states are kept deliberately distinct, because on screen they otherwise look identical and only one of them is good news:

- *"Your sign-in could not be matched to a CRM record"* — the identity resolver found no match, or an ambiguous one. Sections 1 and 5 are **denied**, not empty.
- *"You are not on any client's account team"* — you resolved fine, you just hold none of the six roles anywhere. Sections 2–4 are empty for a legitimate reason.

---

## The account-team definition (SIX roles)

> This is the most important thing on the page to get right, and it is **deliberately broader** than the account-management data scope used elsewhere.

**You are on a client's account team if you hold *any* of these six roles on it:**

| Role | Read from `public.accounts` |
|---|---|
| Account Manager | `sales_lead_primary_id` |
| Secondary Manager | `secondary_manager_id` |
| **Feedback Report** | **`feedback_report_id`** |
| Associate | `associate_id` |
| **Memo** | **`teaser_id`** |
| Logistics Coordinator | `logistics_coordinator_id` |

Resolved by `lib/access/account-team-policy.ts` (the rules) and `lib/access/account-team-scope.ts` (the query).

### How this differs from the `account_mgmt` data scope

The Level-2 client scope behind **Portfolio**, **Client Detail** and **Outreach Status** (`resolveClientScope` → `teamAccountIds` in `lib/access/data-scope.ts`) reads **four** roles: sales lead, secondary manager, associate, logistics. **Feedback Report and Memo are not in it.** That is the right answer for those pages and is completely unchanged.

Alerts is about **feedback work**, so the two people who own feedback work have to be able to see their own alerts. Scoping this page to the four would hide exactly the wrong rows from exactly the wrong people. On live data as of 2026-09-22 the difference is not theoretical:

- One Feedback Report owner goes from **1 client to 64** under the six-role rule.
- Another goes from **27 to 46**.

Two further consequences worth stating plainly:

- **Six roles is a superset of four**, so this can never show a person *less* than the account-management scope would.
- **It consults no data-scope grant at all** — not `account_mgmt`, not `scope_all`. Six-role membership is a fact about the CRM, so it is read only from the CRM. `account_mgmt` gates the *four*-role client scope and is deliberately not read here, so a feedback or memo owner gets their alerts without an admin having to tick Account Management for them; `scope_all` is not read either, because no role grant puts a person on a team they are not on.

### Source of truth: `accounts`, not `account_team_members`

Membership is read from the six FK columns on **`public.accounts`** — the live Dynamics mirror, refreshed by the nightly sync.

It is **not** read from `public.account_team_members`, the dashboard-owned table behind [Admin → Account Teams](17-account-teams.md), even though that table holds these same six roles. Two reasons:

1. **It has already drifted.** That table was seeded from these very columns on 2026-09-15 and has no sync. As of 2026-09-22 the CRM holds **812** (account, role, person) assignments and the owned table holds **801**, disagreeing on **51** of them — 31 only in the CRM, 20 only in the table. An alert routed off a stale team reaches the wrong person.
2. **The repo forbids it.** `lib/account-teams/roles.ts` states that nothing may import it into a scope or permission path until that becomes a deliberate, separately-reviewed change. This page honours that literally: it does not import that module at all, and re-declares the six roles itself.

That duplication is intentional. When `account_team_members` does become the source of truth, `TEAM_ROLES` in `lib/access/account-team-policy.ts` is the single map to repoint.

**Memo = teaser.** `public.accounts` has no memo column; `teaser_id` is the established mapping, reasoned out in `sql/patches/2026-09-15_account_team_members.sql`.

---

## Performance

All four section queries plus one ticker lookup run in **one `Promise.all`**, so the page costs a single round-trip batch. A denied section resolves to `null` without querying at all, so a deny costs nothing and can never be confused with an empty result.

Each section is capped at **100 rows** and says so when the cap bites. These sections are small by nature — the largest any one person has today is 22 — so the cap is a guard against a pathological result set, not a paging mechanism.

Every section **fails soft and on its own**: a broken view puts an error strip in that one card instead of blanking the page.

## Files

| File | What it is |
|---|---|
| `app/clients/alerts/page.tsx` | route, both server-side gates |
| `app/clients/alerts/load.ts` | the parallel section queries + row scoping |
| `app/clients/alerts/alerts-policy.ts` | severity, ordering, dates — pure |
| `app/clients/alerts/alerts-view.tsx` | the rendered page (a server component — nothing to hydrate) |
| `lib/access/account-team-policy.ts` | the six-role membership rules — pure |
| `lib/access/account-team-scope.ts` | the resolver that reads `accounts` |
| `sql/patches/2026-09-22_clients_alerts_grants.sql` | the role grants |

## Files (badge)

| File | What it is |
|---|---|
| `app/clients/alerts/critical-count.ts` | the three COUNT queries + the per-request memo |
| `app/clients/alerts/alerts-policy.ts` | `criticalCutoffDay()` — the ten-day rule as a SQL cutoff |
| `app/layout.tsx` | folds the count into the existing nav data batch |
| `components/nav.tsx` | `RailAlertBubble` (A1), `AlertCountPill` (B1), `AlertCountContext` |
